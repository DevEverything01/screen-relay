#pragma once

#include "capture-source.hpp"
#include <libwebsockets.h>
extern "C" {
#include <libavcodec/avcodec.h>
}
#include <condition_variable>
#include <cerrno>
#include <cstdint>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace nsl {
// One job/result globally. The worker owns its capture source and PNG codec.
class Snapshot {
 public:
  ~Snapshot() { stop(); }
  void start(lws_context* context) {
    worker_ = std::thread([this, context] { run(context); });
  }
  bool request() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (busy_ || stopping_) return false;
    busy_ = requested_ = true; ready_.notify_one(); return true;
  }
  bool take(std::vector<uint8_t>& bytes, std::string& error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!complete_) return false;
    bytes = std::move(bytes_); error = std::move(error_);
    complete_ = false; return true;
  }
  void finish() { std::lock_guard<std::mutex> lock(mutex_); busy_ = false; }
  void stop() {
    { std::lock_guard<std::mutex> lock(mutex_); stopping_ = true; ready_.notify_one(); }
    if (worker_.joinable()) worker_.join();
  }
 private:
  std::mutex mutex_;
  std::condition_variable ready_;
  std::thread worker_;
  bool busy_ = false, requested_ = false, complete_ = false, stopping_ = false;
  std::vector<uint8_t> bytes_;
  std::string error_;
  static void require(bool ok, const char* error) {
    if (!ok) throw std::runtime_error(error);
  }
  struct Resources {
    std::unique_ptr<CaptureSource> source;
    AVCodecContext* codec = nullptr;
    AVFrame* frame = nullptr;
    AVPacket* packet = nullptr;
    int64_t pts = 0;
    ~Resources() {
      av_packet_free(&packet); av_frame_free(&frame); avcodec_free_context(&codec);
    }
    void init() {
      source = makeCaptureSource();
      const auto* encoder = avcodec_find_encoder(AV_CODEC_ID_PNG);
      require(encoder, "PNG encoder unavailable");
      codec = avcodec_alloc_context3(encoder); require(codec, "PNG context allocation failed");
      codec->width = 1280; codec->height = 720; codec->pix_fmt = AV_PIX_FMT_RGB24;
      codec->time_base = AVRational{1, 1}; codec->thread_count = 1;
      require(avcodec_open2(codec, encoder, nullptr) >= 0, "PNG encoder initialization failed");
      frame = av_frame_alloc(); packet = av_packet_alloc(); require(frame && packet, "PNG allocation failed");
      frame->format = codec->pix_fmt; frame->width = 1280; frame->height = 720;
      require(av_frame_get_buffer(frame, 32) >= 0, "PNG frame allocation failed");
    }
    std::vector<uint8_t> capture() {
      source->drainDamage();
      const auto image = source->capture();
      require(image.data && image.width == 1280 && image.height == 720 && image.stride >= 5120 &&
              image.stride <= 10240 && (image.format == PixelFormat::BGRA || image.format == PixelFormat::ARGB),
              "unsupported snapshot frame");
      require(av_frame_make_writable(frame) >= 0, "PNG frame not writable");
      for (int y = 0; y < 720; ++y) {
        const auto* source = image.data + y * image.stride;
        auto* target = frame->data[0] + y * frame->linesize[0];
        for (int x = 0; x < 1280; ++x) {
          target[x * 3] = source[x * 4 + (image.format == PixelFormat::BGRA ? 2 : 1)];
          target[x * 3 + 1] = source[x * 4 + (image.format == PixelFormat::BGRA ? 1 : 2)];
          target[x * 3 + 2] = source[x * 4 + (image.format == PixelFormat::BGRA ? 0 : 3)];
        }
      }
      frame->pts = ++pts;
      require(avcodec_send_frame(codec, frame) >= 0, "PNG encode failed");
      require(avcodec_receive_packet(codec, packet) >= 0, "PNG output unavailable");
      require(packet->size > 0 && packet->size <= 8 * 1024 * 1024, "PNG output exceeds 8 MiB");
      std::vector<uint8_t> result(packet->data, packet->data + packet->size);
      av_packet_unref(packet);
      require(avcodec_receive_packet(codec, packet) == AVERROR(EAGAIN), "PNG output was not one image");
      return result;
    }
  };
  void run(lws_context* context) {
    std::unique_ptr<Resources> resources;
    for (;;) {
      { std::unique_lock<std::mutex> lock(mutex_);
        ready_.wait(lock, [this] { return stopping_ || requested_; });
        if (stopping_) return;
        requested_ = false;
      }
      std::vector<uint8_t> result;
      std::string error;
      try {
        if (!resources) { resources = std::make_unique<Resources>(); resources->init(); }
        result = resources->capture();
      } catch (const std::exception& failure) { error = failure.what(); resources.reset(); }
      { std::lock_guard<std::mutex> lock(mutex_);
        bytes_ = std::move(result); error_ = std::move(error); complete_ = true;
      }
      lws_cancel_service(context);
    }
  }
};
}  // namespace nsl
