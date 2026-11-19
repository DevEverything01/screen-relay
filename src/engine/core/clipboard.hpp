#pragma once

#include <cstddef>
#include <functional>
#include <optional>
#include <string>

namespace relay {
/** Largest clipboard text the wire format carries, in bytes of UTF-8. */
constexpr size_t max_clipboard_bytes = 1u << 20;

/**
 * The desktop clipboard of the backend's display. Text only.
 *
 * A backend that cannot reach a clipboard leaves every method at its default, so
 * `supported()` is false and the engine reports `clipboard: false`.
 */
struct Clipboard {
  virtual ~Clipboard() = default;
  /** Called once with a function that wakes the service thread after a change. */
  virtual void notify(std::function<void()>) {}
  /** True when the backend can read and write the desktop clipboard. */
  virtual bool supported() const { return false; }
  /** Text that changed since the previous call, or nothing when it did not. */
  virtual std::optional<std::string> take() { return std::nullopt; }
  /** The clipboard text now, for a viewer that just connected. */
  virtual std::string current() { return {}; }
  /** Queues text for the desktop clipboard; false when the backend cannot write it. */
  virtual bool write(const std::string&) { return false; }
};
}  // namespace relay
