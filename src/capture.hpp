#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace nsl {
struct EncodedFrame {
  uint32_t generation = 0;
  uint32_t sequence = 0;
  uint64_t pts_us = 0;
  uint16_t width = 0;
  uint16_t height = 0;
  bool keyframe = false;
  std::vector<uint8_t> annex_b;
};

struct CaptureStats {
  uint64_t captures = 0;
  uint64_t encoded = 0;
  uint64_t capture_ns = 0;
  uint64_t convert_ns = 0;
  uint64_t encode_ns = 0;
};

class CaptureEncoder {
 public:
  using Publish = std::function<bool(EncodedFrame&&)>;
  explicit CaptureEncoder(Publish publish);
  ~CaptureEncoder();
  CaptureEncoder(const CaptureEncoder&) = delete;
  CaptureEncoder& operator=(const CaptureEncoder&) = delete;
  bool start(std::string& error);
  void beginSession(uint32_t generation);
  void endSession(uint32_t generation);
  void acknowledge(uint32_t generation, uint32_t sequence);
  CaptureStats stats() const;
  std::string error() const;
  void stop();

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
}  // namespace nsl
