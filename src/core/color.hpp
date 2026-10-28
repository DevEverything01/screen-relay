#pragma once

#include <cstdint>

namespace nsl {
// Full-range BGRA (alpha ignored) to limited-range BT.709 planar YUV420.
// Chroma uses a 2x2 box with channels rounded to nearest before conversion.
// Requires disjoint buffers covering every row and positive, even dimensions.
// Invalid pointers, dimensions or strides return false without writing.
bool bgraToYuv420(const uint8_t* source, int sourceStride,
                  uint8_t* y, int yStride, uint8_t* u, int uStride,
                  uint8_t* v, int vStride, int width, int height);
bool argbToYuv420(const uint8_t* source, int sourceStride,
                  uint8_t* y, int yStride, uint8_t* u, int uStride,
                  uint8_t* v, int vStride, int width, int height);
bool bgraToNv12(const uint8_t* source, int sourceStride,
                uint8_t* y, int yStride, uint8_t* uv, int uvStride,
                int width, int height);
bool argbToNv12(const uint8_t* source, int sourceStride,
                uint8_t* y, int yStride, uint8_t* uv, int uvStride,
                int width, int height);
}  // namespace nsl
