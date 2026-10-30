#include "input.hpp"

namespace relay {
namespace {
constexpr int pixelCoordinate(uint16_t normalized, uint16_t extent) {
  return int((uint64_t(normalized) * (extent - 1) + 32767) / 65535);
}
static_assert(pixelCoordinate(0, 1280) == 0 && pixelCoordinate(65535, 1280) == 1279 &&
              pixelCoordinate(10248, 1280) == 200 && pixelCoordinate(40992, 1280) == 800 &&
              pixelCoordinate(65535, 720) == 719 && pixelCoordinate(36459, 720) == 400);
}
InputController::InputController(std::unique_ptr<InputBackend> source) : backend(std::move(source)) {}
InputController::~InputController() { releaseAll(); }
std::pair<uint16_t, uint16_t> InputController::dimensions() const { return backend->dimensions(); }
const char* InputController::name() const { return backend->name(); }
void InputController::releaseAll() {
  for (const auto key : keys) backend->releaseKey(key);
  for (const auto button : buttons) backend->releaseButton(button);
  keys.clear(); buttons.clear(); backend->flush();
}
void InputController::resetLocks() { backend->resetLocks(); backend->flush(); }
void InputController::fence(std::shared_ptr<InputFence> mark) { backend->fence(std::move(mark)); }
size_t InputController::pending() const { return backend->pending(); }
void InputController::cancel() { backend->cancel(); }
InputStatus InputController::apply(const InputEvent& input) {
  const unsigned event = input.type, code = input.code;
  const int64_t value = input.value;
  if (input.reserved || (input.buttons & ~31u) || (input.modifiers & ~255u)) return InputStatus::invalid;
  if (event == 7) {
    if (code || value || input.modifiers || input.buttons) return InputStatus::invalid;
    releaseAll(); return InputStatus::ok;
  }
  if (event == 8) {
    if (code || input.modifiers || input.buttons || value < 1 || value > 0x10FFFF ||
        (value >= 0xD800 && value <= 0xDFFF)) return InputStatus::invalid;
    if (!backend->typeText(uint32_t(value))) return InputStatus::unsupported;
    backend->flush(); return InputStatus::ok;
  }
  if (event < 1 || event > 6 || (event != 6 && value)) return InputStatus::invalid;
  if (event <= 2) {
    if (code > 231) return InputStatus::invalid;
    const auto key = backend->nativeKey(uint16_t(code));
    if (!key) return InputStatus::unsupported;
    if (event == 1) { if (keys.insert(*key).second) backend->pressKey(*key); }
    else if (keys.erase(*key)) backend->releaseKey(*key);
  } else {
    if ((event == 3 && code) || ((event == 4 || event == 5) && (code < 1 || code > 3)) ||
        (event == 6 && (code > 1 || value < -1200 || value > 1200 || value % 120))) return InputStatus::invalid;
    const auto size = backend->dimensions();
    backend->move(pixelCoordinate(input.x, size.first), pixelCoordinate(input.y, size.second));
    if (event == 4) { if (buttons.insert(code).second) backend->pressButton(code); }
    if (event == 5 && buttons.erase(code)) backend->releaseButton(code);
    if (event == 6) backend->scroll(code, int(value / 120));
  }
  backend->flush(); return InputStatus::ok;
}
}
