#pragma once
#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace relay::wayland {
/** Most spare keys a Keymap takes: a base keymap that leaves fewer keycodes unbound gets fewer. */
constexpr size_t spareSlots = 32;
/** XKB text v1 keymap compiled by libxkbcommon from its default names, which honor XKB_DEFAULT_LAYOUT and the other XKB_DEFAULT_* variables. */
std::string defaultKeymap();
/** A virtual keyboard keymap: a base keymap plus spare keys that are reassigned to Unicode codepoints. */
class Keymap {
 public:
  /** Takes an XKB text v1 keymap; throws std::runtime_error if libxkbcommon cannot compile it. */
  explicit Keymap(const std::string& base);
  /** Evdev keycode (XKB keycode minus 8) that types codepoint: the base keymap's own unmodified key when it already has that keysym, else a spare reassigned to it, which sets changed to true when text() changed and must be uploaded again; returns 0 when the codepoint has no keysym. */
  uint32_t assign(uint32_t codepoint, bool& changed);
  /** Current XKB text v1 keymap, NUL-free. */
  const std::string& text() const;

 private:
  struct Slot {
    uint32_t keycode = 0;
    std::string name;
    uint32_t codepoint = 0;
    uint32_t symbol = 0;
    uint64_t used = 0;
  };
  void refresh();
  std::string original;
  std::string current;
  std::map<uint32_t, uint32_t> direct;
  std::vector<Slot> slots;
  size_t insertAt = 0;
  uint64_t typed = 0;
};
}
