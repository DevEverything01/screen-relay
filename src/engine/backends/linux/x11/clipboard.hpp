#pragma once

#include "core/clipboard.hpp"
#include <memory>

namespace relay {
namespace x11 {
/** The CLIPBOARD selection of the display in DISPLAY, as UTF-8 text. */
std::unique_ptr<Clipboard> makeClipboard();
}  // namespace x11
}  // namespace relay
