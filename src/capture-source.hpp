#pragma once
#include <cstdint>
#include <functional>
#include <memory>

namespace nsl {
enum class PixelFormat { BGRA, ARGB };
// CPU-accessible pixels remain valid until the next capture or source destruction.
// GPU zero-copy would require a separate encoder interface.
struct FrameView {
  const uint8_t* data;
  int stride, width, height;
  PixelFormat format;
};
class CaptureSource {
 public:
  virtual ~CaptureSource() = default;
  virtual int fd() const = 0;
  virtual bool drainDamage() = 0;
  virtual PixelFormat pixelFormat() const = 0;
  virtual FrameView capture() = 0;
};
using CaptureSourceFactory = std::function<std::unique_ptr<CaptureSource>()>;
bool initializeNativeBackend();
std::unique_ptr<CaptureSource> makeCaptureSource();
}
