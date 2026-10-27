#include "capture.hpp"
#include "color.hpp"

#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/Xdamage.h>
#include <X11/extensions/XShm.h>
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/opt.h>
#include <libswscale/swscale.h>
}
#include <sys/eventfd.h>
#include <sys/shm.h>
#include <poll.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <atomic>
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

namespace nsl {
namespace {
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
// Xlib's handler is process-wide; the attach probe is limited to this Display.
std::atomic<Display*> probe_display{nullptr};
std::atomic<bool> probe_error{false};
XErrorHandler previous_handler = nullptr;
int attachError(Display* display, XErrorEvent* event) {
  if (display == probe_display.load()) { probe_error = true; return 0; }
  return previous_handler ? previous_handler(display, event) : 0;
}
struct Resources {
  Display* display = nullptr;
  Damage damage = 0;
  XImage* image = nullptr;
  XShmSegmentInfo shm{};
  bool attached = false;
  AVCodecContext* codec = nullptr;
  AVFrame* frame = nullptr;
  AVPacket* packet = nullptr;
  SwsContext* sws = nullptr;
  int damage_event = 0;
  Resources() { shm.shmid = -1; shm.shmaddr = reinterpret_cast<char*>(-1); }
  ~Resources() {
    if (attached) { XShmDetach(display, &shm); XSync(display, False); }
    if (image) { image->data = nullptr; XDestroyImage(image); }
    if (shm.shmaddr != reinterpret_cast<char*>(-1)) shmdt(shm.shmaddr);
    if (shm.shmid >= 0) shmctl(shm.shmid, IPC_RMID, nullptr);
    if (damage) XDamageDestroy(display, damage);
    if (display) XCloseDisplay(display);
    sws_freeContext(sws);
    av_packet_free(&packet);
    av_frame_free(&frame);
    avcodec_free_context(&codec);
  }
  void openEncoder() {
    avcodec_free_context(&codec);
    const AVCodec* encoder = avcodec_find_encoder_by_name("libx264");
    require(encoder, "libx264 unavailable");
    codec = avcodec_alloc_context3(encoder);
    require(codec, "allocating encoder failed");
    codec->width = 1280; codec->height = 720;
    codec->pix_fmt = AV_PIX_FMT_YUV420P;
    codec->time_base = AVRational{1, 1000000};
    codec->framerate = AVRational{60, 1};
    codec->max_b_frames = 0; codec->gop_size = 600; codec->thread_count = 2;
    codec->color_range = AVCOL_RANGE_MPEG;
    codec->colorspace = AVCOL_SPC_BT709;
    codec->color_primaries = AVCOL_PRI_BT709;
    codec->color_trc = AVCOL_TRC_BT709;
    // The fast converter averages each 2x2 block, so chroma samples are centered.
    codec->chroma_sample_location = image->byte_order == LSBFirst
        ? AVCHROMA_LOC_CENTER : AVCHROMA_LOC_LEFT;
    require(av_opt_set(codec->priv_data, "preset", "ultrafast", 0) >= 0 &&
            av_opt_set(codec->priv_data, "tune", "zerolatency", 0) >= 0 &&
            av_opt_set(codec->priv_data, "crf", "10", 0) >= 0 &&
            av_opt_set_int(codec->priv_data, "forced-idr", 1, 0) >= 0 &&
            av_opt_set(codec->priv_data, "x264-params",
                       "annexb=1:repeat-headers=1:scenecut=0:rc-lookahead=0:sync-lookahead=0", 0) >= 0,
            "setting x264 options failed");
    require(avcodec_open2(codec, encoder, nullptr) >= 0, "opening libx264 failed");
  }
  void init() {
    display = XOpenDisplay(nullptr);
    require(display, "opening X display failed");
    int ignored;
    require(XDamageQueryExtension(display, &damage_event, &ignored), "XDamage unavailable");
    require(XShmQueryExtension(display), "MIT-SHM unavailable");
    const int screen = DefaultScreen(display);
    require(DisplayWidth(display, screen) == 1280 && DisplayHeight(display, screen) == 720,
            "capture requires a fixed 1280x720 root");
    image = XShmCreateImage(display, DefaultVisual(display, screen), DefaultDepth(display, screen),
                            ZPixmap, nullptr, &shm, 1280, 720);
    require(image && image->bytes_per_line >= 1280 * 4 && image->bytes_per_line <= 1280 * 8 &&
            image->bits_per_pixel == 32 && image->red_mask == 0xff0000 &&
            image->green_mask == 0xff00 && image->blue_mask == 0xff,
            "unsupported X image masks, depth, or stride");
    require(image->byte_order == LSBFirst || image->byte_order == MSBFirst,
            "unsupported X image byte order");
    const size_t size = static_cast<size_t>(image->bytes_per_line) * image->height;
    shm.shmid = shmget(IPC_PRIVATE, size, IPC_CREAT | 0600);
    require(shm.shmid >= 0, "shmget failed");
    shm.shmaddr = static_cast<char*>(shmat(shm.shmid, nullptr, 0));
    require(shm.shmaddr != reinterpret_cast<char*>(-1), "shmat failed");
    image->data = shm.shmaddr; shm.readOnly = False;
    XSync(display, False);
    probe_display = display; probe_error = false;
    previous_handler = XSetErrorHandler(attachError);
    const bool requested = XShmAttach(display, &shm);
    XSync(display, False);
    XSetErrorHandler(previous_handler); probe_display = nullptr;
    attached = requested && !probe_error;
    require(attached, "XShmAttach failed");
    require(shmctl(shm.shmid, IPC_RMID, nullptr) == 0, "marking shared memory for removal failed");
    shm.shmid = -1;
    damage = XDamageCreate(display, RootWindow(display, screen), XDamageReportNonEmpty);
    require(damage != 0, "creating XDamage failed");
    XFlush(display);
    openEncoder();
    frame = av_frame_alloc(); packet = av_packet_alloc();
    require(frame && packet, "allocating video buffers failed");
    frame->format = codec->pix_fmt; frame->width = 1280; frame->height = 720;
    frame->color_range = codec->color_range; frame->colorspace = codec->colorspace;
    frame->color_primaries = codec->color_primaries; frame->color_trc = codec->color_trc;
    frame->chroma_location = codec->chroma_sample_location;
    require(av_frame_get_buffer(frame, 32) >= 0, "allocating YUV buffer failed");
    if (image->byte_order == MSBFirst) {
      sws = sws_getContext(1280, 720, AV_PIX_FMT_ARGB,
                           1280, 720, AV_PIX_FMT_YUV420P, SWS_FAST_BILINEAR,
                           nullptr, nullptr, nullptr);
      require(sws, "creating RGB conversion failed");
      const int* coefficients = sws_getCoefficients(SWS_CS_ITU709);
      require(sws_setColorspaceDetails(sws, coefficients, 1, coefficients, 0,
                                       0, 1 << 16, 1 << 16) >= 0,
              "setting RGB/YUV color conversion failed");
    }
  }
};
}  // namespace

struct CaptureEncoder::Impl {
  explicit Impl(Publish callback) : publish(std::move(callback)) {}
  Publish publish;
  mutable std::mutex mutex;
  std::condition_variable ready;
  std::thread worker;
  int wake_fd = -1;
  bool stopping = false, initialized = false, running = false;
  std::string startup_error;
  std::string fatal_error;
  uint32_t generation = 0, sequence = 0, outstanding = 0;
  uint64_t revision = 0;
  bool credit = false;
  CaptureStats counters;
  void wake() {
    const uint64_t one = 1;
    if (wake_fd >= 0) { const auto result = write(wake_fd, &one, sizeof(one)); (void)result; }
  }
  void run() {
    try {
      Resources r;
      r.init();
      { std::lock_guard<std::mutex> lock(mutex); initialized = true; running = true; }
      ready.notify_all();
      bool dirty = true, force_idr = true;
      uint64_t seen_revision = 0;
      int64_t last_pts = -1;
      unsigned consecutive_failures = 0;
      auto deadline = Clock::now();
      while (true) {
        while (XPending(r.display)) {
          XEvent event; XNextEvent(r.display, &event);
          if (event.type == r.damage_event + XDamageNotify) dirty = true;
        }
        uint32_t gen, seq;
        uint64_t rev;
        bool admitted;
        {
          std::lock_guard<std::mutex> lock(mutex);
          if (stopping) break;
          if (revision != seen_revision) {
            seen_revision = revision; dirty = true; force_idr = true;
          }
          gen = generation; rev = revision;
          admitted = gen != 0 && credit && sequence < std::numeric_limits<uint32_t>::max();
          seq = sequence + (admitted ? 1 : 0);
        }
        const auto now = Clock::now();
        if (admitted && dirty && now >= deadline) {
          const auto capture_start = Clock::now();
          try {
            XDamageSubtract(r.display, r.damage, None, None);
            dirty = false;
            require(XShmGetImage(r.display, RootWindow(r.display, DefaultScreen(r.display)), r.image, 0, 0, AllPlanes),
                    "XShmGetImage failed");
            const auto captured = Clock::now();
            require(av_frame_make_writable(r.frame) >= 0, "making YUV frame writable failed");
            const auto* pixels = reinterpret_cast<const uint8_t*>(r.image->data);
            if (r.image->byte_order == LSBFirst) {
              require(bgraToYuv420(pixels, r.image->bytes_per_line,
                                   r.frame->data[0], r.frame->linesize[0],
                                   r.frame->data[1], r.frame->linesize[1],
                                   r.frame->data[2], r.frame->linesize[2], 1280, 720),
                      "BGRA conversion failed");
            } else {
              const uint8_t* source[4] = {pixels, nullptr, nullptr, nullptr};
              const int stride[4] = {r.image->bytes_per_line, 0, 0, 0};
              require(sws_scale(r.sws, source, stride, 0, 720,
                                 r.frame->data, r.frame->linesize) == 720,
                      "ARGB conversion failed");
            }
            const auto converted = Clock::now();
            const int64_t timestamp = std::chrono::duration_cast<std::chrono::microseconds>(capture_start.time_since_epoch()).count();
            r.frame->pts = last_pts = std::max(last_pts + 1, timestamp);
            r.frame->pict_type = force_idr ? AV_PICTURE_TYPE_I : AV_PICTURE_TYPE_NONE;
            require(avcodec_send_frame(r.codec, r.frame) >= 0, "encoder rejected frame");
            EncodedFrame output;
            output.generation = gen; output.sequence = seq; output.pts_us = last_pts;
            output.width = 1280; output.height = 720;
            int packets = 0;
            while (true) {
              const int result = avcodec_receive_packet(r.codec, r.packet);
              if (result == AVERROR(EAGAIN)) break;
              require(result >= 0, "receiving encoded frame failed");
              ++packets;
              const bool valid = r.packet->pts == last_pts && r.packet->size > 0 &&
                  output.annex_b.size() + static_cast<size_t>(r.packet->size) <= 16777216;
              if (!valid) { av_packet_unref(r.packet); throw std::runtime_error("invalid or delayed encoded access unit"); }
              output.keyframe |= (r.packet->flags & AV_PKT_FLAG_KEY) != 0;
              output.annex_b.insert(output.annex_b.end(), r.packet->data, r.packet->data + r.packet->size);
              av_packet_unref(r.packet);
            }
            require(packets > 0 && (!force_idr || (output.keyframe &&
                    hasNal(output.annex_b, 5) && hasNal(output.annex_b, 7) && hasNal(output.annex_b, 8))),
                    "encoder buffered frame or omitted IDR/SPS/PPS");
            const auto encoded = Clock::now();
            bool current;
            {
              std::lock_guard<std::mutex> lock(mutex);
              ++counters.captures; ++counters.encoded;
              counters.capture_ns += ns(captured - capture_start);
              counters.convert_ns += ns(converted - captured);
              counters.encode_ns += ns(encoded - converted);
              current = revision == rev && generation == gen && credit;
              if (current) {
                sequence = seq;
                outstanding = seq;
                credit = false;
              }
            }
            if (current) {
              if (!publish(std::move(output))) {
                // A rejected reference packet stalls this generation until transport recovery.
                std::fprintf(stderr, "capture: publish rejected; awaiting new session\n");
                dirty = true; force_idr = true;
              } else {
                force_idr = false;
              }
            } else {
              dirty = true;
              force_idr = true;
            }
            consecutive_failures = 0;
            deadline = capture_start + std::chrono::nanoseconds(16666667);
          } catch (const std::exception& error) {
            std::fprintf(stderr, "capture: %s; retrying with IDR\n", error.what());
            dirty = true;
            force_idr = true;
            av_packet_unref(r.packet);
            if (++consecutive_failures >= 3) {
              throw std::runtime_error(std::string("capture failed three consecutive times: ") + error.what());
            }
            r.openEncoder();
            deadline = Clock::now() + std::chrono::seconds(1);
          }
          continue;
        }
        timespec timeout{};
        const timespec* timeout_ptr = nullptr;
        if (admitted && dirty) {
          const auto remaining = std::chrono::duration_cast<std::chrono::nanoseconds>(
              deadline - Clock::now()).count();
          timeout = pollTimeout(std::max<int64_t>(0, remaining));
          timeout_ptr = &timeout;
        }
        pollfd descriptors[2] = {{ConnectionNumber(r.display), POLLIN, 0}, {wake_fd, POLLIN, 0}};
        const int result = ppoll(descriptors, 2, timeout_ptr, nullptr);
        if (result < 0) {
          if (errno == EINTR) continue;
          throw std::runtime_error("capture ppoll failed");
        }
        require(!(descriptors[0].revents & (POLLERR | POLLHUP | POLLNVAL)), "capture X connection closed");
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
        credit = false;
      }
      ready.notify_all();
    }
    std::lock_guard<std::mutex> lock(mutex); running = false;
  }
};

CaptureEncoder::CaptureEncoder(Publish publish) : impl_(std::make_unique<Impl>(std::move(publish))) {}
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
    i.outstanding = 0;
    i.credit = true;
    ++i.revision;
    i.wake();
  }
}
void CaptureEncoder::endSession(uint32_t generation) {
  auto& i = *impl_;
  std::lock_guard<std::mutex> lock(i.mutex);
  if (generation != i.generation) return;
  i.generation = 0;
  i.credit = false;
  i.outstanding = 0;
  ++i.revision;
  i.wake();
}
void CaptureEncoder::acknowledge(uint32_t generation, uint32_t sequence) {
  auto& i = *impl_;
  std::lock_guard<std::mutex> lock(i.mutex);
  if (!generation || generation != i.generation || !sequence || sequence != i.outstanding || i.credit) return;
  i.outstanding = 0;
  i.credit = true;
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
  i.credit = false;
}
}  // namespace nsl
