#include "../src/color.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <random>
#include <vector>

namespace {
constexpr uint8_t guard = 0xa5;

// Independent BT.709 floating-point reference, not the converter's coefficients.
std::array<int, 3> reference(double b, double g, double r) {
  const double light = .2126 * r + .7152 * g + .0722 * b;
  return {static_cast<int>(std::lround(16 + 219 * light / 255)),
          static_cast<int>(std::lround(128 + 224 * (b - light) / (2 * (1 - .0722) * 255))),
          static_cast<int>(std::lround(128 + 224 * (r - light) / (2 * (1 - .2126) * 255)))};
}

void check(int width, int height, int pattern) {
  const int sourceStride = width * 4 + 13;
  const int yStride = width + 7, uStride = width / 2 + 5, vStride = width / 2 + 9;
  std::vector<uint8_t> source(sourceStride * height + 2, guard);
  std::vector<uint8_t> y(yStride * height + 2, guard);
  std::vector<uint8_t> u(uStride * height / 2 + 2, guard);
  std::vector<uint8_t> v(vStride * height / 2 + 2, guard);
  std::mt19937 rng(0x709 + width + pattern);
  const std::array<std::array<uint8_t, 3>, 8> colors{{
      {{0, 0, 0}}, {{255, 255, 255}}, {{0, 0, 255}}, {{0, 255, 0}},
      {{255, 0, 0}}, {{255, 255, 0}}, {{255, 0, 255}}, {{0, 255, 255}}}};
  for (int row = 0; row < height; ++row) {
    for (int x = 0; x < width; ++x) {
      auto* pixel = source.data() + 1 + row * sourceStride + x * 4;
      for (int c = 0; c < 3; ++c) {
        pixel[c] = pattern < 8 ? colors[pattern][c] :
            pattern == 8 ? colors[(row % 2) * 2 + x % 2][c] : rng() % 256;
      }
      pixel[3] = rng() % 256;
    }
  }
  const auto original = source;
  assert(nsl::bgraToYuv420(source.data() + 1, sourceStride, y.data() + 1, yStride,
                          u.data() + 1, uStride, v.data() + 1, vStride, width, height));
  assert(source == original);
  for (int row = 0; row < height; ++row) {
    for (int x = 0; x < width; ++x) {
      const auto* p = source.data() + 1 + row * sourceStride + x * 4;
      assert(std::abs(y[1 + row * yStride + x] - reference(p[0], p[1], p[2])[0]) <= 1);
    }
    for (int x = width; x < yStride; ++x) assert(y[1 + row * yStride + x] == guard);
  }
  for (int row = 0; row < height / 2; ++row) {
    for (int x = 0; x < width / 2; ++x) {
      std::array<double, 3> box{};
      for (int dy = 0; dy < 2; ++dy) {
        for (int dx = 0; dx < 2; ++dx) {
          const auto* p = source.data() + 1 + (row * 2 + dy) * sourceStride + (x * 2 + dx) * 4;
          for (int c = 0; c < 3; ++c) box[c] += p[c];
        }
      }
      for (auto& channel : box) channel = std::floor(channel / 4 + .5);
      const auto expected = reference(box[0], box[1], box[2]);
      assert(std::abs(u[1 + row * uStride + x] - expected[1]) <= 1);
      assert(std::abs(v[1 + row * vStride + x] - expected[2]) <= 1);
    }
    for (int x = width / 2; x < uStride; ++x) assert(u[1 + row * uStride + x] == guard);
    for (int x = width / 2; x < vStride; ++x) assert(v[1 + row * vStride + x] == guard);
  }
  assert(y.front() == guard && y.back() == guard);
  assert(u.front() == guard && u.back() == guard);
  assert(v.front() == guard && v.back() == guard);
}
}  // namespace

int main() {
  for (int width : {2, 6, 8, 10, 14, 16, 18, 1280}) {
    for (int pattern = 0; pattern < 10; ++pattern) check(width, 6, pattern);
  }
  uint8_t value = guard;
  for (const auto dimensions : {std::array<int, 2>{0, 2}, {2, 0}, {3, 2}, {2, 3}, {-2, 2}}) {
    assert(!nsl::bgraToYuv420(&value, 8, &value, 2, &value, 1, &value, 1,
                            dimensions[0], dimensions[1]));
  }
  assert(!nsl::bgraToYuv420(nullptr, 8, &value, 2, &value, 1, &value, 1, 2, 2));
  assert(!nsl::bgraToYuv420(&value, 7, &value, 2, &value, 1, &value, 1, 2, 2));
  assert(!nsl::bgraToYuv420(&value, 8, &value, 1, &value, 1, &value, 1, 2, 2));
  assert(!nsl::bgraToYuv420(&value, 8, &value, 2, &value, 0, &value, 1, 2, 2));
  assert(value == guard);
  std::cout << "BT.709 colors, box chroma, random pixels, tails, strides and guards passed\n";
}
