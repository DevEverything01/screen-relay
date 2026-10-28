#include "core/capture.hpp"
extern "C" {
#include <libavcodec/avcodec.h>
#include <libswscale/swscale.h>
}
#include <sys/eventfd.h>
#include <unistd.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>

using namespace std::chrono_literals;
static void require(bool ok, const char* message) {
  if (!ok) throw std::runtime_error(message);
}
struct SourceState {
  int fd = eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
  std::atomic<unsigned> captures{0};
  std::atomic<bool> red{false};
  int invalid = 0;
  SourceState() { require(fd >= 0, "eventfd failed"); }
  ~SourceState() { close(fd); }
  void damage() {
    const uint64_t one = 1;
    require(write(fd, &one, sizeof(one)) == sizeof(one), "damage wake failed");
  }
};
// This source has no display connection or native-backend factory dependency.
class CpuSource final : public relay::CaptureSource {
  std::shared_ptr<SourceState> state;
  std::vector<uint8_t> pixels = std::vector<uint8_t>(1280 * 720 * 4);
 public:
  explicit CpuSource(std::shared_ptr<SourceState> s) : state(std::move(s)) {}
  int fd() const override { return state->fd; }
  bool drainDamage() override {
    uint64_t value;
    return read(state->fd, &value, sizeof(value)) == sizeof(value);
  }
  relay::PixelFormat pixelFormat() const override { return relay::PixelFormat::BGRA; }
  relay::FrameView capture() override {
    ++state->captures;
    const bool red = state->red.load();
    for (size_t i = 0; i < pixels.size(); i += 4) {
      pixels[i] = red ? 48 : 96; pixels[i + 1] = red ? 64 : 176;
      pixels[i + 2] = red ? 192 : 32; pixels[i + 3] = 255;
    }
    return {pixels.data(), state->invalid == 2 ? 1 : 1280 * 4,
            state->invalid == 1 ? 1 : 1280, 720, relay::PixelFormat::BGRA};
  }
};
struct Frames {
  std::mutex mutex;
  std::condition_variable changed;
  std::vector<relay::EncodedFrame> items;
  bool publish(relay::EncodedFrame&& frame) {
    { std::lock_guard<std::mutex> lock(mutex); items.push_back(std::move(frame)); }
    changed.notify_all(); return true;
  }
  relay::EncodedFrame at(size_t index) {
    std::unique_lock<std::mutex> lock(mutex);
    require(changed.wait_for(lock, 3s, [&] { return items.size() > index; }), "encoded frame timeout");
    return items[index];
  }
};
static void decodedPixel(const relay::EncodedFrame& encoded, bool red) {
  const AVCodec* codec = avcodec_find_decoder(AV_CODEC_ID_H264);
  require(codec, "H264 decoder unavailable");
  AVCodecContext* decoder = avcodec_alloc_context3(codec);
  AVFrame* frame = av_frame_alloc();
  AVPacket* packet = av_packet_alloc();
  SwsContext* converter = nullptr;
  try {
    require(decoder && frame && packet, "decoder allocation failed");
    require(avcodec_open2(decoder, codec, nullptr) >= 0, "decoder open failed");
    require(av_new_packet(packet, int(encoded.annex_b.size())) >= 0, "packet allocation failed");
    std::copy(encoded.annex_b.begin(), encoded.annex_b.end(), packet->data);
    require(avcodec_send_packet(decoder, packet) >= 0, "decoder rejected IDR");
    require(avcodec_receive_frame(decoder, frame) >= 0, "fresh decoder could not decode IDR");
    require(frame->width == 1280 && frame->height == 720, "decoded dimensions differ");
    converter = sws_getContext(1280, 720, AVPixelFormat(frame->format), 1280, 720,
                              AV_PIX_FMT_RGB24, SWS_POINT, nullptr, nullptr, nullptr);
    require(converter, "RGB decoder conversion failed");
    const int* coefficients = sws_getCoefficients(SWS_CS_ITU709);
    require(sws_setColorspaceDetails(converter, coefficients, 0, coefficients, 1,
                                    0, 1 << 16, 1 << 16) >= 0, "decoder colorspace failed");
    std::vector<uint8_t> rgb(1280 * 720 * 3);
    uint8_t* planes[] = {rgb.data(), nullptr, nullptr, nullptr};
    int strides[] = {1280 * 3, 0, 0, 0};
    require(sws_scale(converter, frame->data, frame->linesize, 0, 720, planes, strides) == 720,
            "decoded RGB conversion incomplete");
    const int expected[] = {red ? 192 : 32, red ? 64 : 176, red ? 48 : 96};
    for (int channel = 0; channel < 3; ++channel)
      require(std::abs(int(rgb[(400 * 1280 + 800) * 3 + channel]) - expected[channel]) <= 12,
              "decoded source pixel differs from independent RGB expectation");
  } catch (...) {
    sws_freeContext(converter); av_packet_free(&packet); av_frame_free(&frame);
    avcodec_free_context(&decoder); throw;
  }
  sws_freeContext(converter); av_packet_free(&packet); av_frame_free(&frame);
  avcodec_free_context(&decoder);
}
static void healthySource() {
  auto state = std::make_shared<SourceState>(); Frames frames;
  relay::CaptureEncoder encoder([&](relay::EncodedFrame&& f) { return frames.publish(std::move(f)); },
      [state] { return std::make_unique<CpuSource>(state); });
  std::string error;
  require(encoder.start(error), error.c_str());
  require(state->captures == 0, "capture occurred with no session");
  encoder.beginSession(17);
  const auto initial = frames.at(0);
  require(initial.generation == 17 && initial.sequence == 1 && initial.keyframe,
          "initial session did not start with sequence-one keyframe");
  decodedPixel(initial, false);
  encoder.acknowledge(17, 1);
  const unsigned captured = state->captures;
  std::this_thread::sleep_for(150ms);
  require(state->captures == captured, "idle source caused extra capture");
  state->red = true; state->damage();
  const auto changed = frames.at(1);
  require(changed.generation == 17 && changed.sequence == 2 && changed.pts_us > initial.pts_us,
          "damage did not produce ordered fresh frame");
  encoder.endSession(17); encoder.beginSession(18);
  const auto fresh = frames.at(2);
  require(fresh.generation == 18 && fresh.sequence == 1 && fresh.keyframe,
          "new generation did not reset sequence and IDR");
  decodedPixel(fresh, true);
  encoder.stop();
  const unsigned stopped = state->captures;
  state->damage(); std::this_thread::sleep_for(50ms);
  require(state->captures == stopped, "capture continued after shutdown");
  require(encoder.error().empty(), "healthy source produced fatal error");
}
static void invalidSource(int invalid) {
  auto state = std::make_shared<SourceState>(); state->invalid = invalid;
  std::atomic<unsigned> published{0};
  relay::CaptureEncoder encoder([&](relay::EncodedFrame&&) { ++published; return true; },
      [state] { return std::make_unique<CpuSource>(state); });
  std::string error; require(encoder.start(error), error.c_str()); encoder.beginSession(1);
  const auto deadline = std::chrono::steady_clock::now() + 4s;
  while (encoder.error().empty() && std::chrono::steady_clock::now() < deadline)
    std::this_thread::sleep_for(20ms);
  require(encoder.error().find("invalid capture frame") != std::string::npos,
          "invalid source did not fail within bounded retries");
  encoder.stop(); require(published == 0 && state->captures == 3,
                          "invalid source published or retried without bound");
}
int main() {
  try {
    healthySource(); invalidSource(1); invalidSource(2);
    std::puts("backend source: decoded fresh IDRs, damage, idle, shutdown and invalid frames passed");
    return 0;
  } catch (const std::exception& error) {
    std::fprintf(stderr, "backend source: %s\n", error.what()); return 1;
  }
}
