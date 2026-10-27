#pragma once
#include <cstdint>
#include <memory>
#include <utility>

namespace nsl {
enum class InputStatus : uint8_t { ok = 0, invalid = 1, unsupported = 2 };
struct InputEvent {
  uint8_t type = 0, reserved = 0;
  uint16_t code = 0;
  int32_t value = 0;
  uint16_t x = 0, y = 0, buttons = 0, modifiers = 0;
};
class InputBackend {
 public:
  virtual ~InputBackend() = default;
  virtual InputStatus apply(const InputEvent& event) = 0;
  virtual void releaseAll() = 0;
  virtual std::pair<uint16_t, uint16_t> dimensions() const = 0;
  virtual const char* name() const = 0;
};
// Selected native backend; unsupported display systems fail explicitly.
std::unique_ptr<InputBackend> makeInputBackend();
}  // namespace nsl
