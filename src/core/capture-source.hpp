#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <vector>

namespace relay {
constexpr int frame_width = 1280, frame_height = 720;
enum class PixelFormat { BGRA, ARGB };
// CPU-accessible pixels remain valid until the next capture or source destruction.
// GPU zero-copy would require a separate encoder interface.
struct FrameView {
  const uint8_t* data;
  int stride, width, height;
  PixelFormat format;
  int x = 0, y = 0;
};
struct DamageRect { int x, y, width, height; };
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
  /** Captures only the damage region when full is false; a view may still cover the whole frame. */
  virtual FrameView captureChanged(bool /*full*/) { return capture(); }
  /** Fills the pixel rectangles changed since the previous capture(); false means unknown, treat the whole frame as changed. */
  virtual bool changedRects(std::vector<DamageRect>& /*rects*/) { return false; }
  virtual bool cursorSupported() const { return false; }
  // Called on the source owner thread after draining events, even when video is paused.
  virtual std::optional<CursorImage> cursor(bool /*force*/) { return std::nullopt; }
};
using CaptureSourceFactory = std::function<std::unique_ptr<CaptureSource>()>;
bool initializeNativeBackend();
std::unique_ptr<CaptureSource> makeCaptureSource();
}
