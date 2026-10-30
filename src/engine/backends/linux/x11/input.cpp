#include "core/input.hpp"
#include <X11/Xlib.h>
#include <X11/XKBlib.h>
#include <X11/keysym.h>
#include <X11/extensions/XTest.h>
#include <set>
#include <stdexcept>
#include <vector>

namespace relay {
namespace {
constexpr uint8_t letterKeycodes[26] = {30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50,
                                        49, 24, 25, 16, 19, 31, 20, 22, 47, 17, 45, 21, 44};
constexpr int hidKeycode(uint16_t hid) {
  if (hid >= 4 && hid <= 29) return letterKeycodes[hid - 4];
  if (hid >= 30 && hid <= 39) return 2 + hid - 30;
  if (hid >= 58 && hid <= 67) return 59 + hid - 58;
  if (hid >= 68 && hid <= 69) return 87 + hid - 68;
  if (hid >= 104 && hid <= 115) return 183 + hid - 104;
  switch (hid) {
    case 40: return 28; case 41: return 1; case 42: return 14; case 43: return 15;
    case 44: return 57; case 45: return 12; case 46: return 13; case 47: return 26;
    case 48: return 27; case 49: case 50: return 43; case 51: return 39;
    case 52: return 40; case 53: return 41; case 54: return 51; case 55: return 52;
    case 56: return 53; case 57: return 58; case 70: return 99; case 71: return 70;
    case 72: return 119; case 73: return 110; case 74: return 102; case 75: return 104;
    case 76: return 111; case 77: return 107; case 78: return 109; case 79: return 106;
    case 80: return 105; case 81: return 108; case 82: return 103; case 83: return 69;
    case 84: return 98; case 85: return 55; case 86: return 74; case 87: return 78;
    case 88: return 96; case 89: return 79; case 90: return 80; case 91: return 81;
    case 92: return 75; case 93: return 76; case 94: return 77; case 95: return 71;
    case 96: return 72; case 97: return 73; case 98: return 82; case 99: return 83;
    case 100: return 86; case 101: return 139; case 103: return 117;
    case 224: return 29; case 225: return 42; case 226: return 56; case 227: return 125;
    case 228: return 97; case 229: return 54; case 230: return 100; case 231: return 126;
    default: return 0;
  }
}
static_assert(hidKeycode(4) == 30 && hidKeycode(11) == 35 && hidKeycode(39) == 11 && hidKeycode(68) == 87 &&
              hidKeycode(69) == 88 && hidKeycode(70) == 99 && hidKeycode(115) == 194 && hidKeycode(225) == 42 &&
              hidKeycode(3) == 0);
constexpr size_t spareCount = 16;
KeySym textKeysym(uint32_t codepoint) {
  if (codepoint == '\n') return XK_Return;
  if (codepoint == '\t') return XK_Tab;
  return codepoint <= 0xff ? KeySym(codepoint) : KeySym(0x01000000u | codepoint);
}
class X11Input final : public InputBackend {
  struct Spare {
    KeyCode code = 0;
    KeySym symbol = NoSymbol;
    uint64_t used = 0;
  };
  Display* display = nullptr;
  uint16_t width = 0, height = 0;
  int columns = 1;
  uint64_t typed = 0;
  std::vector<Spare> spares;
  std::set<KeyCode> held;
 public:
  X11Input() {
    display = XOpenDisplay(nullptr);
    if (!display) throw std::runtime_error("X11 input display unavailable; Wayland is unsupported");
    int event, error, major, minor;
    const int screen = DefaultScreen(display);
    const int root_width = DisplayWidth(display, screen), root_height = DisplayHeight(display, screen);
    if (!XTestQueryExtension(display, &event, &error, &major, &minor)) {
      XCloseDisplay(display); display = nullptr;
      throw std::runtime_error("input requires the XTest extension");
    }
    width = uint16_t(root_width); height = uint16_t(root_height);
    findSpares();
  }
  ~X11Input() override {
    if (!display) return;
    restoreSpares();
    XCloseDisplay(display);
  }
  std::pair<uint16_t, uint16_t> dimensions() const override { return {width, height}; }
  const char* name() const override { return "x11"; }
  std::optional<NativeKey> nativeKey(uint16_t usage) const override {
    const int keycode = hidKeycode(usage);
    if (!keycode) return std::nullopt;
    return NativeKey(keycode + 8);
  }
  bool typeText(uint32_t codepoint) override {
    const KeySym symbol = textKeysym(codepoint);
    for (auto& spare : spares) {
      if (spare.symbol != symbol) continue;
      spare.used = ++typed;
      tap(spare.code);
      return true;
    }
    const KeyCode found = XKeysymToKeycode(display, symbol);
    if (found && !held.count(found) && XkbKeycodeToKeysym(display, found, 0, 0) == symbol) {
      tap(found);
      return true;
    }
    Spare* spare = nullptr;
    for (auto& candidate : spares) if (!spare || candidate.used < spare->used) spare = &candidate;
    if (!spare) return false;
    bind(*spare, symbol);
    tap(spare->code);
    return true;
  }
  void pressKey(NativeKey key) override {
    held.insert(KeyCode(key));
    XTestFakeKeyEvent(display, key, True, CurrentTime);
  }
  void releaseKey(NativeKey key) override {
    held.erase(KeyCode(key));
    XTestFakeKeyEvent(display, key, False, CurrentTime);
  }
  void pressButton(unsigned button) override { XTestFakeButtonEvent(display, button, True, CurrentTime); }
  void releaseButton(unsigned button) override { XTestFakeButtonEvent(display, button, False, CurrentTime); }
  void move(int x, int y) override { XTestFakeMotionEvent(display, DefaultScreen(display), x, y, CurrentTime); }
  void scroll(unsigned axis, int notches) override {
    const unsigned button = axis == 0 ? (notches > 0 ? 5 : 4) : (notches > 0 ? 7 : 6);
    for (int n = 0; n < (notches < 0 ? -notches : notches); ++n) {
      XTestFakeButtonEvent(display, button, True, CurrentTime);
      XTestFakeButtonEvent(display, button, False, CurrentTime);
    }
  }
  void resetLocks() override { XkbLockModifiers(display, XkbUseCoreKbd, LockMask, 0); restoreSpares(); }
  void flush() override { XFlush(display); }

 private:
  void tap(KeyCode code) {
    XTestFakeKeyEvent(display, code, True, CurrentTime);
    XTestFakeKeyEvent(display, code, False, CurrentTime);
  }
  void bind(Spare& spare, KeySym symbol) {
    std::vector<KeySym> symbols(size_t(columns), symbol);
    XChangeKeyboardMapping(display, spare.code, columns, symbols.data(), 1);
    spare.symbol = symbol;
    spare.used = ++typed;
  }
  void restoreSpares() {
    for (auto& spare : spares) {
      if (spare.symbol == NoSymbol) continue;
      std::vector<KeySym> symbols(size_t(columns), NoSymbol);
      XChangeKeyboardMapping(display, spare.code, columns, symbols.data(), 1);
      spare.symbol = NoSymbol;
    }
  }
  void findSpares() {
    int min = 0, max = 0, count = 0;
    XDisplayKeycodes(display, &min, &max);
    if (max < min) return;
    KeySym* map = XGetKeyboardMapping(display, KeyCode(min), max - min + 1, &count);
    if (!map || count < 1) { if (map) XFree(map); return; }
    columns = count;
    for (int index = max - min; index >= 0 && spares.size() < spareCount; --index) {
      bool empty = true;
      for (int column = 0; column < count; ++column)
        if (map[index * count + column] != NoSymbol) { empty = false; break; }
      if (empty) spares.push_back(Spare{KeyCode(min + index), NoSymbol, 0});
    }
    XFree(map);
  }
};
}  // namespace
std::unique_ptr<InputBackend> makeInputBackend() {
  return std::make_unique<X11Input>();
}
}  // namespace relay
