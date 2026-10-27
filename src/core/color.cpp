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
uint16x4_t luma4(uint16x4_t b, uint16x4_t g, uint16x4_t r) {
  auto sum = vmlal_n_u16(vmull_n_u16(r, 2991), g, 10064);
  sum = vmlal_n_u16(sum, b, 1016);
  return vadd_u16(vshrn_n_u32(vaddq_u32(sum, vdupq_n_u32(8192)), 14), vdup_n_u16(16));
}
void luma8(uint8_t* out, const uint8x8x4_t& pixels) {
  auto b = vmovl_u8(pixels.val[0]);
  auto g = vmovl_u8(pixels.val[1]);
  auto r = vmovl_u8(pixels.val[2]);
  vst1_u8(out, vqmovn_u16(vcombine_u16(
      luma4(vget_low_u16(b), vget_low_u16(g), vget_low_u16(r)),
      luma4(vget_high_u16(b), vget_high_u16(g), vget_high_u16(r)))));
}
uint16x4_t box4(uint8x8_t top, uint8x8_t bottom) {
  return vrshrn_n_u32(vpaddlq_u16(vaddl_u8(top, bottom)), 2);
}
#endif
}  // namespace

bool bgraToYuv420(const uint8_t* source, int sourceStride,
                  uint8_t* y, int yStride, uint8_t* u, int uStride,
                  uint8_t* v, int vStride, int width, int height) {
  if (!source || !y || !u || !v || width <= 0 || height <= 0 ||
      (width & 1) || (height & 1) || width > std::numeric_limits<int>::max() / 4 ||
      sourceStride < width * 4 || yStride < width ||
      uStride < width / 2 || vStride < width / 2) return false;
  for (int row = 0; row < height; row += 2) {
    const auto* top = source + static_cast<ptrdiff_t>(row) * sourceStride;
    const auto* bottom = top + sourceStride;
    auto* y0 = y + static_cast<ptrdiff_t>(row) * yStride;
    auto* y1 = y0 + yStride;
    auto* u0 = u + static_cast<ptrdiff_t>(row / 2) * uStride;
    auto* v0 = v + static_cast<ptrdiff_t>(row / 2) * vStride;
    int x = 0;
#if defined(__aarch64__)
    for (; x <= width - 8; x += 8) {
      const auto a = vld4_u8(top + x * 4);
      const auto b = vld4_u8(bottom + x * 4);
      luma8(y0 + x, a);
      luma8(y1 + x, b);
      const auto blue = box4(a.val[0], b.val[0]);
      const auto green = box4(a.val[1], b.val[1]);
      const auto red = box4(a.val[2], b.val[2]);
      auto cb = vmlal_n_u16(vdupq_n_u32(128 * 16384 + 8192), blue, 7196);
      cb = vmlsl_n_u16(vmlsl_n_u16(cb, red, 1649), green, 5547);
      auto cr = vmlal_n_u16(vdupq_n_u32(128 * 16384 + 8192), red, 7196);
      cr = vmlsl_n_u16(vmlsl_n_u16(cr, green, 6536), blue, 660);
      const auto chroma = vqmovn_u16(vcombine_u16(vshrn_n_u32(cb, 14), vshrn_n_u32(cr, 14)));
      // Four-byte stores avoid writing into the next chroma block or row padding.
      uint8_t values[8];
      vst1_u8(values, chroma);
      for (int k = 0; k < 4; ++k) {
        u0[x / 2 + k] = values[k];
        v0[x / 2 + k] = values[k + 4];
      }
    }
#endif
    for (; x < width; x += 2) {
      const auto* a = top + x * 4;
      const auto* b = bottom + x * 4;
      y0[x] = luma(a[0], a[1], a[2]);
      y0[x + 1] = luma(a[4], a[5], a[6]);
      y1[x] = luma(b[0], b[1], b[2]);
      y1[x + 1] = luma(b[4], b[5], b[6]);
      const int blue = (a[0] + a[4] + b[0] + b[4] + 2) / 4;
      const int green = (a[1] + a[5] + b[1] + b[5] + 2) / 4;
      const int red = (a[2] + a[6] + b[2] + b[6] + 2) / 4;
      u0[x / 2] = blueChroma(blue, green, red);
      v0[x / 2] = redChroma(blue, green, red);
    }
  }
  return true;
}
}  // namespace nsl
