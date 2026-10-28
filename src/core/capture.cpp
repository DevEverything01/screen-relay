#include "capture.hpp"
#include "color.hpp"
#include "flow.hpp"
#include "capture-source.hpp"

#include <cstdint>
#include <x264.h>
#include <sys/eventfd.h>
#include <poll.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <cassert>
#include <chrono>
#include <condition_variable>
#include <ctime>
#include <cstdio>
#include <cstring>
#include <limits>
#include <mutex>
#include <stdexcept>
#include <thread>

namespace relay {
namespace {
/** VBV buffer, in kbit, that holds about 1/15 s of video at `bitrate` bits per second. */
constexpr int vbvBufferKbit(uint64_t bitrate) { return int(bitrate / 15000); }
using Clock = std::chrono::steady_clock;
constexpr timespec pollTimeout(int64_t nanoseconds) {
  return {static_cast<time_t>(nanoseconds / 1000000000),
          static_cast<long>(nanoseconds % 1000000000)};
}
static_assert(pollTimeout(0).tv_sec == 0 && pollTimeout(0).tv_nsec == 0);
static_assert(pollTimeout(16666667).tv_sec == 0 &&
              pollTimeout(16666667).tv_nsec == 16666667);
static_assert(pollTimeout(1000000001).tv_sec == 1 &&
              pollTimeout(1000000001).tv_nsec == 1);

uint64_t ns(Clock::duration d) {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(d).count();
}
bool hasNal(const std::vector<uint8_t>& bytes, uint8_t type) {
  for (size_t i = 0; i + 3 < bytes.size(); ++i) {
    if (bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 1 &&
        (bytes[i + 3] & 31) == type) return true;
  }
  return false;
}
void require(bool ok, const char* message) {
  if (!ok) throw std::runtime_error(message);
}
struct Resources {
  PixelFormat format;
  x264_t* codec = nullptr;
  x264_picture_t frame{};
  std::vector<uint8_t> mb_info = std::vector<uint8_t>((frame_width / 16) * (frame_height / 16));
  bool frame_allocated = false;
  uint64_t bitrate = FlowControl::initial_bitrate;
  explicit Resources(PixelFormat f) : format(f) {}
  ~Resources() {
    if (codec) x264_encoder_close(codec);
    if (frame_allocated) x264_picture_clean(&frame);
  }
  void openEncoder() {
    if (codec) x264_encoder_close(codec);
    codec = nullptr;
    x264_param_t params;
    require(x264_param_default_preset(&params, "ultrafast", "zerolatency") >= 0,
            "setting x264 options failed");
    params.i_width = frame_width; params.i_height = frame_height; params.i_csp = X264_CSP_NV12;
    params.i_timebase_num = 1; params.i_timebase_den = 1000000;
    params.i_fps_num = 60; params.i_fps_den = 1;
    params.i_threads = 1; params.i_keyint_max = 600; params.i_bframe = 0;
    params.i_scenecut_threshold = 0; params.i_sync_lookahead = 0;
    params.rc.i_rc_method = X264_RC_CRF; params.rc.f_rf_constant = 10;
    params.rc.i_lookahead = 0; params.rc.i_vbv_max_bitrate = int(FlowControl::initial_bitrate / 1000); params.rc.i_vbv_buffer_size = vbvBufferKbit(FlowControl::initial_bitrate);
    params.analyse.b_mb_info = 1; params.analyse.b_mb_info_update = 0;
    params.b_annexb = 1; params.b_repeat_headers = 1;
    params.vui.b_fullrange = 0; params.vui.i_colmatrix = 1;
    params.vui.i_colorprim = 1; params.vui.i_transfer = 1;
    params.vui.i_chroma_loc = 1;
    codec = x264_encoder_open(&params);
    require(codec, "opening libx264 failed");
    bitrate = FlowControl::initial_bitrate;
  }
  void init() {
    openEncoder();
    require(x264_picture_alloc(&frame, X264_CSP_NV12, frame_width, frame_height) == 0,
            "allocating YUV buffer failed");
    frame_allocated = true;
  }
};
}  // namespace

struct CaptureEncoder::Impl {
  explicit Impl(Publish callback, CaptureSourceFactory factory, PublishCursor cursor)
      : source_factory(std::move(factory)), publish(std::move(callback)), publish_cursor(std::move(cursor)) {}
  CaptureSourceFactory source_factory;
  Publish publish;
  PublishCursor publish_cursor;
  mutable std::mutex mutex;
  std::condition_variable ready;
  std::thread worker;
  int wake_fd = -1;
  bool stopping = false, initialized = false, running = false;
  std::string startup_error;
  std::string fatal_error;
  uint32_t generation = 0, sequence = 0, acknowledged = 0;
  unsigned window = 1;
  uint64_t bitrate = FlowControl::initial_bitrate, admit_until_us = 0;
  bool paused = false;
  uint64_t revision = 0;
  bool active = false;
  CaptureStats counters;
  void wake() {
    const uint64_t one = 1;
    if (wake_fd >= 0) { const auto result = write(wake_fd, &one, sizeof(one)); (void)result; }
  }
  void run() {
    try {
      auto source = source_factory();
      require(bool(source), "capture source factory returned null");
      require(source->fd() >= 0, "invalid capture source fd");
      const auto format = source->pixelFormat();
      require(format == PixelFormat::BGRA || format == PixelFormat::ARGB, "unsupported capture pixel format");
      Resources r(format);
      r.init();
      { std::lock_guard<std::mutex> lock(mutex);
        counters.cursor_supported = source->cursorSupported(); initialized = true; running = true;
      }
      ready.notify_all();
      bool dirty = true, force_idr = true;
      uint64_t seen_revision = 0;
      int64_t last_pts = -1;
      std::vector<DamageRect> rects;
      unsigned consecutive_failures = 0;
      const auto frame_interval = std::chrono::nanoseconds(16666667);
      const auto refinement_delay = std::chrono::milliseconds(150);
      auto deadline = Clock::now();
      auto last_publish = deadline;
      bool last_was_refinement = true;
      while (true) {
        if (source->drainDamage()) dirty = true;
        uint32_t gen, seq;
        uint64_t rev, rate;
        bool admitted, cursor_active, refresh_cursor = false;
        {
          std::lock_guard<std::mutex> lock(mutex);
          if (stopping) break;
          if (revision != seen_revision) {
            seen_revision = revision; dirty = true; force_idr = true;
            refresh_cursor = true;
          }
          gen = generation; rev = revision; rate = bitrate;
          cursor_active = gen != 0 && active && bool(publish_cursor);
          admitted = gen != 0 && active && !paused &&
                     (!admit_until_us || uint64_t(std::chrono::duration_cast<std::chrono::microseconds>(
                         Clock::now().time_since_epoch()).count()) < admit_until_us) &&
                     sequence - acknowledged < window &&
                     sequence < std::numeric_limits<uint32_t>::max();
          seq = sequence + (admitted ? 1 : 0);
        }
        bool cursor_published = false;
        if (cursor_active) {
          if (auto cursor = source->cursor(refresh_cursor)) {
            publish_cursor(gen, std::move(*cursor)); cursor_published = true;
          }
        }
        const auto now = Clock::now();
        const bool refinement_pending = !dirty && !last_was_refinement;
        const auto encode_deadline = refinement_pending
            ? std::max(deadline, last_publish + refinement_delay) : deadline;
        if (admitted && (dirty || refinement_pending) && now >= encode_deadline) {
          const bool refinement = !dirty;
          const auto capture_start = Clock::now();
          try {
            assert(!refinement || (!force_idr && last_pts >= 0));
            dirty = false;
            auto captured = capture_start, converted = capture_start;
            if (!refinement) {
              const FrameView view = source->captureChanged(force_idr);
              captured = Clock::now();
              require(view.data && view.width > 0 && view.height > 0 &&
                      view.x >= 0 && view.y >= 0 &&
                      view.x + view.width <= frame_width && view.y + view.height <= frame_height &&
                      view.stride >= view.width * 4 && view.stride <= frame_width * 8 &&
                      !(view.x & 1) && !(view.y & 1) && !(view.width & 1) && !(view.height & 1) &&
                      !(force_idr && (view.width != frame_width || view.height != frame_height)) &&
                      view.format == r.format, "invalid capture frame");
              const auto convert = view.format == PixelFormat::BGRA ? bgraToNv12 : argbToNv12;
              require(convert(view.data, view.stride,
                              r.frame.img.plane[0] + view.y * r.frame.img.i_stride[0] + view.x,
                              r.frame.img.i_stride[0],
                              r.frame.img.plane[1] + (view.y / 2) * r.frame.img.i_stride[1] + view.x,
                              r.frame.img.i_stride[1], view.width, view.height),
                      "RGB conversion failed");
              converted = Clock::now();
            }
            const int64_t timestamp = std::chrono::duration_cast<std::chrono::microseconds>(capture_start.time_since_epoch()).count();
            r.frame.i_pts = last_pts = std::max(last_pts + 1, timestamp);
            if (rate != r.bitrate) {
              x264_param_t params;
              x264_encoder_parameters(r.codec, &params);
              params.rc.i_vbv_max_bitrate = int(rate / 1000);
              params.rc.i_vbv_buffer_size = vbvBufferKbit(rate);
              require(x264_encoder_reconfig(r.codec, &params) == 0, "encoder reconfiguration failed");
              r.bitrate = rate;
            }
            r.frame.i_type = force_idr ? X264_TYPE_IDR : X264_TYPE_AUTO;
            r.frame.prop.mb_info = nullptr; r.frame.prop.mb_info_free = nullptr;
            if (!refinement && !force_idr && source->changedRects(rects)) {
              std::fill(r.mb_info.begin(), r.mb_info.end(), uint8_t(X264_MBINFO_CONSTANT));
              for (const DamageRect& d : rects) {
                const int x0 = std::max(d.x, 0) / 16, y0 = std::max(d.y, 0) / 16;
                const int x1 = std::min((std::min(d.x + d.width, frame_width) + 15) / 16, frame_width / 16);
                const int y1 = std::min((std::min(d.y + d.height, frame_height) + 15) / 16, frame_height / 16);
                for (int y = y0; y < y1; ++y)
                  for (int x = x0; x < x1; ++x) r.mb_info[y * (frame_width / 16) + x] = 0;
              }
              r.frame.prop.mb_info = r.mb_info.data();
            }
            x264_nal_t* nals = nullptr;
            int nal_count = 0;
            x264_picture_t picture;
            const int size = x264_encoder_encode(r.codec, &nals, &nal_count, &r.frame, &picture);
            require(size > 0 && nal_count > 0 && nals && picture.i_pts == last_pts &&
                    static_cast<size_t>(size) <= FlowControl::max_bytes,
                    "invalid or delayed encoded access unit");
            EncodedFrame output;
            output.generation = gen; output.sequence = seq; output.pts_us = last_pts;
            output.width = frame_width; output.height = frame_height;
            output.keyframe = picture.b_keyframe;
            output.annex_b.assign(nals[0].p_payload, nals[0].p_payload + size);
            require(!force_idr || (output.keyframe &&
                    hasNal(output.annex_b, 5) && hasNal(output.annex_b, 7) && hasNal(output.annex_b, 8)),
                    "encoder buffered frame or omitted IDR/SPS/PPS");
            const auto encoded = Clock::now();
            bool current;
            {
              std::lock_guard<std::mutex> lock(mutex);
              if (!refinement) ++counters.captures;
              ++counters.encoded;
              counters.capture_ns += ns(captured - capture_start);
              counters.convert_ns += ns(converted - captured);
              counters.encode_ns += ns(encoded - converted);
              current = revision == rev && generation == gen && active;
              if (current) sequence = seq;
            }
            if (current) {
              if (!publish(std::move(output))) {
                // A rejected reference packet stalls this generation until transport recovery.
                std::fprintf(stderr, "capture: publish rejected; awaiting new session\n");
                { std::lock_guard<std::mutex> lock(mutex); if (generation == gen) active = false; }
                dirty = true; force_idr = true;
              } else {
                force_idr = false;
                last_publish = Clock::now();
                last_was_refinement = refinement;
              }
            } else {
              dirty = true;
              force_idr = true;
            }
            consecutive_failures = 0;
            deadline += frame_interval;
            const auto next = Clock::now();
            if (deadline < next - frame_interval) deadline = capture_start + frame_interval;
          } catch (const std::exception& error) {
            std::fprintf(stderr, "capture: %s; retrying with IDR\n", error.what());
            dirty = true;
            force_idr = true;
            if (++consecutive_failures >= 3) {
              throw std::runtime_error(std::string("capture failed three consecutive times: ") + error.what());
            }
            r.openEncoder();
            deadline = Clock::now() + std::chrono::seconds(1);
          }
          continue;
        }
        // A synchronous cursor read may have buffered display events in Xlib.
        if (cursor_published) continue;
        timespec timeout{};
        const timespec* timeout_ptr = nullptr;
        if (admitted && (dirty || refinement_pending)) {
          const auto remaining = std::chrono::duration_cast<std::chrono::nanoseconds>(
              encode_deadline - Clock::now()).count();
          timeout = pollTimeout(std::max<int64_t>(0, remaining));
          timeout_ptr = &timeout;
        }
        pollfd descriptors[2] = {{source->fd(), POLLIN, 0}, {wake_fd, POLLIN, 0}};
        const int result = ppoll(descriptors, 2, timeout_ptr, nullptr);
        if (result < 0) {
          if (errno == EINTR) continue;
          throw std::runtime_error("capture ppoll failed");
        }
        require(!(descriptors[0].revents & (POLLERR | POLLHUP | POLLNVAL)), "capture source connection closed");
        if (descriptors[1].revents & POLLIN) { uint64_t value; const auto n = read(wake_fd, &value, sizeof(value)); (void)n; }
      }
    } catch (const std::exception& error) {
      std::fprintf(stderr, "capture worker stopped: %s\n", error.what());
      {
        std::lock_guard<std::mutex> lock(mutex);
        fatal_error = error.what();
        if (!initialized) startup_error = fatal_error;
        initialized = true;
        running = false;
        active = false;
      }
      ready.notify_all();
    }
    std::lock_guard<std::mutex> lock(mutex); running = false;
  }
};

CaptureEncoder::CaptureEncoder(Publish publish, CaptureSourceFactory factory, PublishCursor cursor)
    : impl_(std::make_unique<Impl>(std::move(publish), std::move(factory), std::move(cursor))) {}
CaptureEncoder::~CaptureEncoder() { stop(); }
bool CaptureEncoder::start(std::string& error) {
  auto& i = *impl_;
  std::unique_lock<std::mutex> lock(i.mutex);
  if (i.worker.joinable()) { error = "capture already started"; return false; }
  if (!i.publish) { error = "capture publish callback missing"; return false; }
  i.wake_fd = eventfd(0, EFD_CLOEXEC | EFD_NONBLOCK);
  if (i.wake_fd < 0) { error = "creating capture eventfd failed"; return false; }
  i.stopping = false;
  i.initialized = false;
  i.startup_error.clear();
  i.fatal_error.clear();
  try { i.worker = std::thread([&i] { i.run(); }); }
  catch (const std::exception& e) { close(i.wake_fd); i.wake_fd = -1; error = e.what(); return false; }
  i.ready.wait(lock, [&i] { return i.initialized; });
  error = i.startup_error.empty() ? i.fatal_error : i.startup_error;
  const bool success = i.running;
  lock.unlock();
  if (!success) stop();
  return success;
}
void CaptureEncoder::beginSession(uint32_t generation) {
  auto& i = *impl_;
  {
    std::lock_guard<std::mutex> lock(i.mutex);
    if (!generation || !i.running) return;
    i.generation = generation;
    i.sequence = 0;
    i.acknowledged = 0;
    i.window = 1; i.bitrate = FlowControl::initial_bitrate; i.paused = false; i.admit_until_us = 0;
    i.active = true;
    ++i.revision;
    i.wake();
  }
}
void CaptureEncoder::endSession(uint32_t generation) {
  auto& i = *impl_;
  std::lock_guard<std::mutex> lock(i.mutex);
  if (generation != i.generation) return;
  i.generation = 0;
  i.active = false;
  i.acknowledged = 0;
  ++i.revision;
  i.wake();
}
void CaptureEncoder::acknowledge(uint32_t generation, uint32_t sequence) {
  auto& i = *impl_;
  std::lock_guard<std::mutex> lock(i.mutex);
  if (!generation || generation != i.generation || sequence != i.acknowledged + 1 || sequence > i.sequence) return;
  i.acknowledged = sequence;
  i.wake();
}
void CaptureEncoder::setFlowControl(uint32_t generation, unsigned window, uint64_t bitrate, bool paused, uint64_t admit_until_us) {
  auto& i = *impl_;
  std::lock_guard<std::mutex> lock(i.mutex);
  if (!generation || generation != i.generation) return;
  i.window = std::clamp(window, 1u, unsigned(FlowControl::max_frames));
  i.bitrate = std::clamp<uint64_t>(bitrate, FlowControl::min_bitrate, FlowControl::max_bitrate);
  i.paused = paused;
  i.admit_until_us = admit_until_us;
  i.wake();
}
CaptureStats CaptureEncoder::stats() const {
  std::lock_guard<std::mutex> lock(impl_->mutex);
  return impl_->counters;
}
std::string CaptureEncoder::error() const {
  std::lock_guard<std::mutex> lock(impl_->mutex);
  return impl_->fatal_error;
}
void CaptureEncoder::stop() {
  auto& i = *impl_;
  {
    std::lock_guard<std::mutex> lock(i.mutex);
    i.stopping = true;
    i.wake();
  }
  if (i.worker.joinable()) i.worker.join();
  std::lock_guard<std::mutex> lock(i.mutex);
  if (i.wake_fd >= 0) { close(i.wake_fd); i.wake_fd = -1; }
  i.generation = 0;
  i.active = false;
}
}  // namespace relay
