#include "backends/linux/wayland/keymap.hpp"
#include <xkbcommon/xkbcommon.h>
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
/** Whether keymap text compiles and gives this evdev keycode a single first-level keysym equal to symbol. */
bool types(const std::string& text, uint32_t keycode, xkb_keysym_t symbol) {
  xkb_context* context = xkb_context_new(XKB_CONTEXT_NO_FLAGS);
  assert(context);
  xkb_keymap* keymap = xkb_keymap_new_from_string(context, text.c_str(), XKB_KEYMAP_FORMAT_TEXT_V1,
                                                  XKB_KEYMAP_COMPILE_NO_FLAGS);
  assert(keymap);
  const xkb_keysym_t* symbols = nullptr;
  const bool found = xkb_keymap_key_get_syms_by_level(keymap, keycode + 8, 0, 0, &symbols) == 1 &&
                     symbols[0] == symbol;
  xkb_keymap_unref(keymap);
  xkb_context_unref(context);
  return found;
}

/** Evdev keycodes the keymap leaves unbound under a short name, capped at the spare keys a Keymap takes. */
std::vector<uint32_t> spareKeycodes(const std::string& text) {
  xkb_context* context = xkb_context_new(XKB_CONTEXT_NO_FLAGS);
  assert(context);
  xkb_keymap* keymap = xkb_keymap_new_from_string(context, text.c_str(), XKB_KEYMAP_FORMAT_TEXT_V1,
                                                  XKB_KEYMAP_COMPILE_NO_FLAGS);
  assert(keymap);
  std::vector<uint32_t> keycodes;
  for (uint32_t code = 9; code <= 255 && keycodes.size() < relay::wayland::spareSlots; ++code) {
    const char* name = xkb_keymap_key_get_name(keymap, code);
    if (!name || std::strlen(name) > 4) continue;
    bool bound = false;
    const xkb_layout_index_t layouts = xkb_keymap_num_layouts_for_key(keymap, code);
    for (xkb_layout_index_t layout = 0; layout < layouts && !bound; ++layout)
      bound = xkb_keymap_num_levels_for_key(keymap, code, layout) > 0;
    if (!bound) keycodes.push_back(code - 8);
  }
  xkb_keymap_unref(keymap);
  xkb_context_unref(context);
  return keycodes;
}
}  // namespace

int main() {
  setenv("XKB_DEFAULT_LAYOUT", "us", 1);
  const std::string base = relay::wayland::defaultKeymap();
  relay::wayland::Keymap keymap(base);
  bool changed = false;
  const uint32_t eacute = keymap.assign(0xe9, changed);
  assert(eacute != 0 && changed);
  const uint32_t euro = keymap.assign(0x20ac, changed);
  assert(euro != 0 && changed);
  const uint32_t emoji = keymap.assign(0x1f600, changed);
  assert(emoji != 0 && changed);
  assert(eacute != euro && euro != emoji && eacute != emoji);
  for (const uint32_t keycode : {eacute, euro, emoji}) assert(keycode >= 1 && keycode <= 247);
  assert(keymap.text().find('\0') == std::string::npos);
  assert(types(keymap.text(), eacute, xkb_utf32_to_keysym(0xe9)));
  assert(types(keymap.text(), euro, xkb_utf32_to_keysym(0x20ac)));
  assert(types(keymap.text(), emoji, xkb_utf32_to_keysym(0x1f600)));

  const std::string assigned = keymap.text();
  assert(keymap.assign(0xe9, changed) == eacute);
  assert(!changed && keymap.text() == assigned);

  const std::vector<uint32_t> spares = spareKeycodes(base);
  assert(!spares.empty());

  relay::wayland::Keymap plain(base);
  const std::string plainText = plain.text();
  assert(plain.assign('a', changed) == 30);
  assert(!changed && plain.text() == plainText);
  for (const char character : std::string("hello world"))
    assert(plain.assign(uint8_t(character), changed) != 0 && !changed);
  assert(plain.text() == plainText);
  const uint32_t upper = plain.assign('A', changed);
  assert(upper != 0 && changed);
  assert(std::find(spares.begin(), spares.end(), upper) != spares.end());
  assert(types(plain.text(), upper, xkb_utf32_to_keysym('A')));
  const uint32_t plainEuro = plain.assign(0x20ac, changed);
  assert(plainEuro != 0 && changed);
  assert(std::find(spares.begin(), spares.end(), plainEuro) != spares.end());
  assert(types(plain.text(), plainEuro, xkb_utf32_to_keysym(0x20ac)));

  relay::wayland::Keymap full(base);
  std::vector<uint32_t> keycodes;
  for (size_t slot = 0; slot < spares.size(); ++slot) {
    const uint32_t keycode = full.assign(0x100 + uint32_t(slot), changed);
    assert(keycode != 0 && changed);
    assert(std::find(spares.begin(), spares.end(), keycode) != spares.end());
    keycodes.push_back(keycode);
  }
  assert(std::set<uint32_t>(keycodes.begin(), keycodes.end()).size() == keycodes.size());
  const uint32_t overflow = 0x100 + uint32_t(spares.size());
  assert(full.assign(overflow, changed) == keycodes.front());
  assert(changed);
  assert(types(full.text(), keycodes.front(), xkb_utf32_to_keysym(overflow)));
  for (size_t slot = 1; slot < keycodes.size(); ++slot)
    assert(types(full.text(), keycodes[slot], xkb_utf32_to_keysym(0x100 + uint32_t(slot))));

  bool rejected = false;
  try {
    relay::wayland::Keymap invalid("not an xkb keymap");
  } catch (const std::runtime_error&) {
    rejected = true;
  }
  assert(rejected);
  std::cout << "wayland spare keycode assignment passed\n";
}
