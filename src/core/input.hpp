#pragma once
#include <cstdint>
#include <memory>
#include <optional>
#include <set>
#include <utility>

namespace relay {
enum class InputStatus : uint8_t { ok = 0, invalid = 1, unsupported = 2 };
struct InputEvent {
  uint8_t type = 0, reserved = 0;
  uint16_t code = 0;
  int32_t value = 0;
  uint16_t x = 0, y = 0, buttons = 0, modifiers = 0;
};
/// Platform key identifier returned by a backend, tracked by InputController.
using NativeKey = uint32_t;
/// Platform primitives only; protocol rules, coordinate mapping and held input live in InputController.
class InputBackend {
 public:
  virtual ~InputBackend() = default;
  /// Native key for a HID usage, or nothing when the backend cannot produce one.
  virtual std::optional<NativeKey> nativeKey(uint16_t usage) const = 0;
  virtual void pressKey(NativeKey key) = 0;
  virtual void releaseKey(NativeKey key) = 0;
  virtual void pressButton(unsigned button) = 0;
  virtual void releaseButton(unsigned button) = 0;
  virtual void move(int x, int y) = 0;
  /// Scrolls notches on axis 0 (vertical) or 1 (horizontal); positive means down or right.
  virtual void scroll(unsigned axis, int notches) = 0;
  /// Turns lock keys off, currently Caps Lock.
  virtual void resetLocks() = 0;
  virtual void flush() = 0;
  virtual std::pair<uint16_t, uint16_t> dimensions() const = 0;
  virtual const char* name() const = 0;
};
/** Validates protocol events, maps pointer coordinates and dedupes held input for one backend. */
class InputController {
 public:
  explicit InputController(std::unique_ptr<InputBackend> source);
  ~InputController();
  InputController(const InputController&) = delete;
  InputController& operator=(const InputController&) = delete;
  InputStatus apply(const InputEvent& event);
  void releaseAll();
  void resetLocks();
  std::pair<uint16_t, uint16_t> dimensions() const;
  const char* name() const;

 private:
  std::unique_ptr<InputBackend> backend;
  std::set<NativeKey> keys;
  std::set<unsigned> buttons;
};
/// Selected native backend; unsupported display systems fail explicitly.
std::unique_ptr<InputBackend> makeInputBackend();
}  // namespace relay
