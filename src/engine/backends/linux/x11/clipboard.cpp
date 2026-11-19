#include "backends/linux/x11/clipboard.hpp"
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <poll.h>
#include <atomic>
#include <chrono>
#include <mutex>
#include <optional>
#include <thread>
#include <utility>

namespace relay {
namespace x11 {
namespace {
/// How often the selection owner is checked for a change made by another client.
constexpr int poll_interval_ms = 200;

/**
 * The CLIPBOARD selection of one display, as UTF-8 text.
 *
 * X11 has no clipboard service: the client that owns the selection answers every
 * paste. This class owns a hidden window for that, and polls the owner because
 * X11 reports a change only to the previous owner, as SelectionClear.
 *
 * The worker thread owns the X connection and the window. The service thread only
 * queues text and takes published changes, so a slow paste never blocks a frame.
 */
class X11Clipboard final : public Clipboard {
 public:
  X11Clipboard() {
    display_ = XOpenDisplay(nullptr);
    if (!display_) return;
    window_ = XCreateSimpleWindow(display_, DefaultRootWindow(display_), 0, 0, 1, 1, 0, 0, 0);
    if (!window_) { XCloseDisplay(display_); display_ = nullptr; return; }
    XSelectInput(display_, window_, PropertyChangeMask | StructureNotifyMask);
    clipboard_ = XInternAtom(display_, "CLIPBOARD", False);
    utf8_ = XInternAtom(display_, "UTF8_STRING", False);
    text_ = XInternAtom(display_, "TEXT", False);
    targets_ = XInternAtom(display_, "TARGETS", False);
    property_ = XInternAtom(display_, "SCREEN_RELAY_CLIPBOARD", False);
    XFlush(display_);
    thread_ = std::thread([this] { run(); });
  }
  ~X11Clipboard() override {
    stop_.store(true);
    if (thread_.joinable()) thread_.join();
    if (display_) XCloseDisplay(display_);
  }
  void notify(std::function<void()> wake) override {
    std::lock_guard<std::mutex> lock(mutex_);
    wake_ = std::move(wake);
  }
  bool supported() const override { return display_ != nullptr; }
  std::optional<std::string> take() override {
    std::lock_guard<std::mutex> lock(mutex_);
    return std::exchange(pending_, std::nullopt);
  }
  std::string current() override {
    std::lock_guard<std::mutex> lock(mutex_);
    return published_;
  }
  bool write(const std::string& text) override {
    if (!display_ || text.size() > max_clipboard_bytes) return false;
    std::lock_guard<std::mutex> lock(mutex_);
    queued_ = text;
    return true;
  }

 private:
  void run() {
    auto next = std::chrono::steady_clock::now();
    while (!stop_.load()) {
      applyWrite();
      while (XPending(display_)) {
        XEvent event;
        XNextEvent(display_, &event);
        handle(event);
      }
      pollfd fd{ConnectionNumber(display_), POLLIN, 0};
      poll(&fd, 1, poll_interval_ms);
      const auto now = std::chrono::steady_clock::now();
      if (now >= next) { next = now + std::chrono::milliseconds(poll_interval_ms); watch(); }
    }
  }
  void handle(XEvent& event) {
    if (event.type == SelectionRequest) { serve(event.xselectionrequest); return; }
    if (event.type == SelectionNotify) {
      if (event.xselection.property == None) { requested_ = None; publish(std::string()); }
      return;
    }
    if (event.type == SelectionClear) {
      if (event.xselectionclear.selection == clipboard_) owned_.clear();
      return;
    }
    if (event.type == PropertyNotify && event.xproperty.atom == property_ &&
        event.xproperty.state == PropertyNewValue) receive();
  }
  void serve(const XSelectionRequestEvent& request) {
    XSelectionEvent done{};
    done.type = SelectionNotify;
    done.requestor = request.requestor;
    done.selection = request.selection;
    done.target = request.target;
    done.time = request.time;
    done.property = None;
    const Atom property = request.property == None ? request.target : request.property;
    if (request.selection == clipboard_ && request.target == targets_) {
      const Atom offered[] = {utf8_, XA_STRING, text_};
      XChangeProperty(display_, request.requestor, property, XA_ATOM, 32, PropModeReplace,
                      reinterpret_cast<const unsigned char*>(offered), 3);
      done.property = property;
    } else if (request.selection == clipboard_ &&
               (request.target == utf8_ || request.target == XA_STRING || request.target == text_)) {
      XChangeProperty(display_, request.requestor, property, request.target, 8, PropModeReplace,
                      reinterpret_cast<const unsigned char*>(owned_.data()), int(owned_.size()));
      done.property = property;
    }
    XSendEvent(display_, request.requestor, False, NoEventMask, reinterpret_cast<XEvent*>(&done));
    XFlush(display_);
  }
  void receive() {
    // A conversion requested before we took the selection would publish stale text.
    if (XGetSelectionOwner(display_, clipboard_) == window_) { requested_ = None; return; }
    Atom type = None;
    int format = 0;
    unsigned long count = 0, after = 0;
    unsigned char* data = nullptr;
    const long words = long(max_clipboard_bytes / 4);
    if (XGetWindowProperty(display_, window_, property_, 0, words, False, AnyPropertyType,
                           &type, &format, &count, &after, &data) != Success) {
      requested_ = None;
      return;
    }
    requested_ = None;
    std::string text;
    if (data && !after && format == 8 && (type == utf8_ || type == XA_STRING || type == text_))
      text.assign(reinterpret_cast<const char*>(data), count);
    if (data) XFree(data);
    publish(std::move(text));
  }
  void watch() {
    const Window owner = XGetSelectionOwner(display_, clipboard_);
    if (owner == window_ || owner == requested_) return;
    if (owner == None) { requested_ = None; publish(std::string()); return; }
    requested_ = owner;
    XConvertSelection(display_, clipboard_, utf8_, property_, window_, CurrentTime);
    XFlush(display_);
  }
  void applyWrite() {
    std::optional<std::string> next;
    { std::lock_guard<std::mutex> lock(mutex_); next = std::exchange(queued_, std::nullopt); }
    if (!next) return;
    owned_ = std::move(*next);
    XSetSelectionOwner(display_, clipboard_, window_, CurrentTime);
    XFlush(display_);
    requested_ = window_;
    std::lock_guard<std::mutex> lock(mutex_);
    published_ = owned_;
  }
  void publish(std::string text) {
    if (text.size() > max_clipboard_bytes) text.clear();
    std::function<void()> wake;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (published_ == text) return;
      published_ = text;
      pending_ = text;
      wake = wake_;
    }
    if (wake) wake();
  }
  Display* display_ = nullptr;
  Window window_ = 0;
  Window requested_ = None;
  Atom clipboard_ = None, utf8_ = None, text_ = None, targets_ = None, property_ = None;
  std::string owned_, published_;
  std::thread thread_;
  std::atomic<bool> stop_{false};
  std::mutex mutex_;
  std::optional<std::string> pending_, queued_;
  std::function<void()> wake_;
};
}  // namespace

std::unique_ptr<Clipboard> makeClipboard() { return std::make_unique<X11Clipboard>(); }
}  // namespace x11
}  // namespace relay
