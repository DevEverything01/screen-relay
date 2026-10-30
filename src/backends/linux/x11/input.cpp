#include "core/input.hpp"
#include <X11/Xlib.h>
#include <X11/keysym.h>
#include <X11/extensions/XTest.h>
#include <stdexcept>

namespace relay {
namespace {
constexpr KeySym hidSym(uint16_t hid) {
  if (hid >= 4 && hid <= 29) return XK_a + hid - 4;
  if (hid >= 30 && hid <= 38) return XK_1 + hid - 30;
  if (hid >= 58 && hid <= 69) return XK_F1 + hid - 58;
  if (hid >= 104 && hid <= 115) return XK_F13 + hid - 104;
  switch (hid) {
    case 39: return XK_0; case 40: return XK_Return; case 41: return XK_Escape;
    case 42: return XK_BackSpace; case 43: return XK_Tab; case 44: return XK_space;
    case 45: return XK_minus; case 46: return XK_equal; case 47: return XK_bracketleft;
    case 48: return XK_bracketright; case 49: case 50: return XK_backslash;
    case 51: return XK_semicolon; case 52: return XK_apostrophe; case 53: return XK_grave;
    case 54: return XK_comma; case 55: return XK_period; case 56: return XK_slash;
    case 57: return XK_Caps_Lock; case 70: return XK_Print; case 71: return XK_Scroll_Lock;
    case 72: return XK_Pause; case 73: return XK_Insert; case 74: return XK_Home;
    case 75: return XK_Page_Up; case 76: return XK_Delete; case 77: return XK_End;
    case 78: return XK_Page_Down; case 79: return XK_Right; case 80: return XK_Left;
    case 81: return XK_Down; case 82: return XK_Up; case 83: return XK_Num_Lock;
    case 84: return XK_KP_Divide; case 85: return XK_KP_Multiply; case 86: return XK_KP_Subtract;
    case 87: return XK_KP_Add; case 88: return XK_KP_Enter;
    case 89: return XK_KP_1; case 90: return XK_KP_2; case 91: return XK_KP_3;
    case 92: return XK_KP_4; case 93: return XK_KP_5; case 94: return XK_KP_6;
    case 95: return XK_KP_7; case 96: return XK_KP_8; case 97: return XK_KP_9;
    case 98: return XK_KP_0; case 99: return XK_KP_Decimal; case 100: return XK_backslash;
    case 101: return XK_Menu; case 103: return XK_KP_Equal;
    case 224: return XK_Control_L; case 225: return XK_Shift_L; case 226: return XK_Alt_L;
    case 227: return XK_Super_L; case 228: return XK_Control_R; case 229: return XK_Shift_R;
    case 230: return XK_Alt_R; case 231: return XK_Super_R;
    default: return NoSymbol;
  }
}
static_assert(hidSym(4) == XK_a && hidSym(225) == XK_Shift_L && hidSym(3) == NoSymbol);
class X11Input final : public InputBackend {
  Display* display = nullptr;
  uint16_t width = 0, height = 0;
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
  }
  ~X11Input() override { if (display) XCloseDisplay(display); }
  std::pair<uint16_t, uint16_t> dimensions() const override { return {width, height}; }
  const char* name() const override { return "x11"; }
  std::optional<NativeKey> nativeKey(uint16_t usage) const override {
    const KeySym symbol = hidSym(usage);
    if (symbol == NoSymbol) return std::nullopt;
    const KeyCode key = XKeysymToKeycode(display, symbol);
    if (!key) return std::nullopt;
    return key;
  }
  void pressKey(NativeKey key) override { XTestFakeKeyEvent(display, key, True, CurrentTime); }
  void releaseKey(NativeKey key) override { XTestFakeKeyEvent(display, key, False, CurrentTime); }
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
  void flush() override { XFlush(display); }
};
}  // namespace
std::unique_ptr<InputBackend> makeInputBackend() {
  return std::make_unique<X11Input>();
}
}  // namespace relay
