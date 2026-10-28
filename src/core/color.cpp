#include "color.hpp"

#include <cstddef>
#include <limits>

#if defined(__aarch64__)
#include <arm_neon.h>
#endif

namespace nsl {
namespace {
// BT.709 coefficients scaled by 2^14; biases keep all shifts nonnegative.
uint8_t luma(int b, int g, int r) {
  return static_cast<uint8_t>((2991 * r + 10064 * g + 1016 * b + 8192) / 16384 + 16);
}
uint8_t blueChroma(int b, int g, int r) {
  return static_cast<uint8_t>((128 * 16384 + 8192 - 1649 * r - 5547 * g + 7196 * b) / 16384);
}
uint8_t redChroma(int b, int g, int r) {
  return static_cast<uint8_t>((128 * 16384 + 8192 + 7196 * r - 6536 * g - 660 * b) / 16384);
}

#if defined(__aarch64__)
/** BT.709 limited-range luma for 8 pixels with 8-bit coefficients in 16-bit lanes. */
uint8x8_t luma8(uint8x8_t b, uint8x8_t g, uint8x8_t r) {
  auto sum = vmlal_u8(vmlal_u8(vmull_u8(r, vdup_n_u8(47)), g, vdup_n_u8(157)), b, vdup_n_u8(16));
  return vadd_u8(vshrn_n_u16(vaddq_u16(sum, vdupq_n_u16(128)), 8), vdup_n_u8(16));
}
/** Averages vertically adjacent pixel pairs and then horizontal neighbours, rounding to nearest. */
uint8x8_t box8(uint8x16_t top, uint8x16_t bottom) {
  return vmovn_u16(vrshrq_n_u16(vaddq_u16(vpaddlq_u8(top), vpaddlq_u8(bottom)), 2));
}
#endif
}  // namespace

template<bool argb, bool nv12>
bool convertToYuv420(const uint8_t* source, int sourceStride,
                  uint8_t* y, int yStride, uint8_t* u, int uStride,
                  uint8_t* v, int vStride, int width, int height) {
  if (!source || !y || !u || !v || width <= 0 || height <= 0 ||
      (width & 1) || (height & 1) || width > std::numeric_limits<int>::max() / 4 ||
      sourceStride < width * 4 || yStride < width ||
      uStride < (nv12 ? width : width / 2) ||
      vStride < (nv12 ? width : width / 2)) return false;
  for (int row = 0; row < height; row += 2) {
    const auto* top = source + static_cast<ptrdiff_t>(row) * sourceStride;
    const auto* bottom = top + sourceStride;
    auto* y0 = y + static_cast<ptrdiff_t>(row) * yStride;
    auto* y1 = y0 + yStride;
    auto* u0 = u + static_cast<ptrdiff_t>(row / 2) * uStride;
    auto* v0 = v + static_cast<ptrdiff_t>(row / 2) * vStride;
    int x = 0;
#if defined(__aarch64__)
    if constexpr (!argb) for (; x <= width - 16; x += 16) {
      const auto a = vld4q_u8(top + x * 4);
      const auto b = vld4q_u8(bottom + x * 4);
      vst1q_u8(y0 + x, vcombine_u8(luma8(vget_low_u8(a.val[0]), vget_low_u8(a.val[1]), vget_low_u8(a.val[2])),
                                   luma8(vget_high_u8(a.val[0]), vget_high_u8(a.val[1]), vget_high_u8(a.val[2]))));
      vst1q_u8(y1 + x, vcombine_u8(luma8(vget_low_u8(b.val[0]), vget_low_u8(b.val[1]), vget_low_u8(b.val[2])),
                                   luma8(vget_high_u8(b.val[0]), vget_high_u8(b.val[1]), vget_high_u8(b.val[2]))));
      const auto blue = box8(a.val[0], b.val[0]);
      const auto green = box8(a.val[1], b.val[1]);
      const auto red = box8(a.val[2], b.val[2]);
      const auto bias = vdupq_n_u16(128 * 256 + 128);
      auto cb = vmlal_u8(bias, blue, vdup_n_u8(112));
      cb = vmlsl_u8(vmlsl_u8(cb, red, vdup_n_u8(26)), green, vdup_n_u8(86));
      auto cr = vmlal_u8(bias, red, vdup_n_u8(112));
      cr = vmlsl_u8(vmlsl_u8(cr, green, vdup_n_u8(102)), blue, vdup_n_u8(10));
      if constexpr (nv12) {
        const uint8x8x2_t chroma = {{vshrn_n_u16(cb, 8), vshrn_n_u16(cr, 8)}};
        vst2_u8(u0 + x, chroma);
      } else {
        vst1_u8(u0 + x / 2, vshrn_n_u16(cb, 8));
        vst1_u8(v0 + x / 2, vshrn_n_u16(cr, 8));
      }
    }
#endif
    for (; x < width; x += 2) {
      const auto* a = top + x * 4;
      const auto* b = bottom + x * 4;
      constexpr int blueOffset = argb ? 3 : 0;
      constexpr int greenOffset = argb ? 2 : 1;
      constexpr int redOffset = argb ? 1 : 2;
      y0[x] = luma(a[blueOffset], a[greenOffset], a[redOffset]);
      y0[x + 1] = luma(a[4 + blueOffset], a[4 + greenOffset], a[4 + redOffset]);
      y1[x] = luma(b[blueOffset], b[greenOffset], b[redOffset]);
      y1[x + 1] = luma(b[4 + blueOffset], b[4 + greenOffset], b[4 + redOffset]);
      const int blue = (a[blueOffset] + a[4 + blueOffset] + b[blueOffset] + b[4 + blueOffset] + 2) / 4;
      const int green = (a[greenOffset] + a[4 + greenOffset] + b[greenOffset] + b[4 + greenOffset] + 2) / 4;
      const int red = (a[redOffset] + a[4 + redOffset] + b[redOffset] + b[4 + redOffset] + 2) / 4;
      u0[nv12 ? x : x / 2] = blueChroma(blue, green, red);
      v0[nv12 ? x + 1 : x / 2] = redChroma(blue, green, red);
    }
  }
  return true;
}
bool bgraToYuv420(const uint8_t* source, int sourceStride,
                  uint8_t* y, int yStride, uint8_t* u, int uStride,
                  uint8_t* v, int vStride, int width, int height) {
  return convertToYuv420<false, false>(source, sourceStride, y, yStride, u, uStride, v, vStride, width, height);
}
bool argbToYuv420(const uint8_t* source, int sourceStride,
                  uint8_t* y, int yStride, uint8_t* u, int uStride,
                  uint8_t* v, int vStride, int width, int height) {
  return convertToYuv420<true, false>(source, sourceStride, y, yStride, u, uStride, v, vStride, width, height);
}
bool bgraToNv12(const uint8_t* source, int sourceStride,
                uint8_t* y, int yStride, uint8_t* uv, int uvStride,
                int width, int height) {
  return convertToYuv420<false, true>(source, sourceStride, y, yStride, uv, uvStride, uv, uvStride, width, height);
}
bool argbToNv12(const uint8_t* source, int sourceStride,
                uint8_t* y, int yStride, uint8_t* uv, int uvStride,
                int width, int height) {
  return convertToYuv420<true, true>(source, sourceStride, y, yStride, uv, uvStride, uv, uvStride, width, height);
}
}  // namespace nsl
