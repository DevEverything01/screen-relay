#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <vector>

namespace nsl {
enum class PixelFormat { BGRA, ARGB };
// CPU-accessible pixels remain valid until the next capture or source destruction.
// GPU zero-copy would require a separate encoder interface.
struct FrameView {
  const uint8_t* data;
  int stride, width, height;
  PixelFormat format;
};
struct CursorImage {
  static constexpr unsigned max_extent = 256;
  uint16_t width = 0, height = 0, xhot = 0, yhot = 0;
  // Straight-alpha RGBA. Empty dimensions explicitly restore the local arrow.
  std::vector<uint8_t> rgba;
};
class CaptureSource {
 public:
  virtual ~CaptureSource() = default;
  virtual int fd() const = 0;
  virtual bool drainDamage() = 0;
  virtual PixelFormat pixelFormat() const = 0;
  virtual FrameView capture() = 0;
  virtual bool cursorSupported() const { return false; }
  // Called on the source owner thread after draining events, even when video is paused.
  virtual std::optional<CursorImage> cursor(bool /*force*/) { return std::nullopt; }
};
using CaptureSourceFactory = std::function<std::unique_ptr<CaptureSource>()>;
bool initializeNativeBackend();
std::unique_ptr<CaptureSource> makeCaptureSource();
}
