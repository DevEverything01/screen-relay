#include "core/input.hpp"
#include <X11/Xlib.h>
#include <X11/XKBlib.h>
#include <X11/keysym.h>
#include <X11/extensions/XTest.h>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <map>
#include <mutex>
#include <set>
#include <stdexcept>
#include <thread>
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
/// Minimum time between tapping a spare keycode and rebinding it.
constexpr std::chrono::milliseconds spareReuse(50);
/// Minimum time between two keyboard mapping changes, so clients refresh their keysym cache first.
constexpr std::chrono::milliseconds spareBind(12);
using TimePoint = std::chrono::steady_clock::time_point;
KeySym textKeysym(uint32_t codepoint) {
  if (codepoint == '\n') return XK_Return;
  if (codepoint == '\t') return XK_Tab;
  return codepoint <= 0xff ? KeySym(codepoint) : KeySym(0x01000000u | codepoint);
}
/// Applies queued input on one thread that owns the X connection, with spare keycode reuse paced for late readers.
class X11Input final : public InputBackend {
  struct Spare {
    KeyCode code = 0;
    KeySym symbol = NoSymbol;
    uint64_t used = 0;
    TimePoint tapped{};
  };
  struct Job {
    enum class Kind : uint8_t { key, text, button, motion, scroll, locks, flush, fence } kind = Kind::flush;
    KeyCode code = 0;
    uint32_t codepoint = 0;
    unsigned number = 0;
    int x = 0, y = 0, notches = 0;
    bool press = false;
    std::shared_ptr<InputFence> fence = nullptr;
  };
  Display* display = nullptr;
  uint16_t width = 0, height = 0;
  int columns = 1;
  uint64_t typed = 0;
  std::map<KeySym, KeyCode> layout;
  std::set<KeyCode> modifiers;
  std::vector<Spare> spares;
  std::set<KeyCode> held;
  TimePoint bound{}, lastTap{};
  std::mutex mutex;
  std::condition_variable wake;
  std::deque<Job> queue;
  bool stopping = false;
  std::thread worker;
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
    findModifiers();
    worker = std::thread([this] { run(); });
  }
  ~X11Input() override {
    { std::lock_guard<std::mutex> lock(mutex); stopping = true; }
    wake.notify_all();
    if (worker.joinable()) worker.join();
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
    if (symbol == NoSymbol || (spares.empty() && !layout.count(symbol))) return false;
    Job job{Job::Kind::text};
    job.codepoint = codepoint;
    post(job);
    return true;
  }
  void pressKey(NativeKey key) override {
    Job job{Job::Kind::key};
    job.code = KeyCode(key); job.press = true;
    post(job);
  }
  void releaseKey(NativeKey key) override {
    Job job{Job::Kind::key};
    job.code = KeyCode(key);
    post(job);
  }
  void pressButton(unsigned button) override {
    Job job{Job::Kind::button};
    job.number = button; job.press = true;
    post(job);
  }
  void releaseButton(unsigned button) override {
    Job job{Job::Kind::button};
    job.number = button;
    post(job);
  }
  void move(int x, int y) override {
    Job job{Job::Kind::motion};
    job.x = x; job.y = y;
    post(job);
  }
  void scroll(unsigned axis, int notches) override {
    Job job{Job::Kind::scroll};
    job.number = axis; job.notches = notches;
    post(job);
  }
  void resetLocks() override { post(Job{Job::Kind::locks}); }
  void fence(std::shared_ptr<InputFence> mark) override {
    Job job{Job::Kind::fence};
    job.fence = std::move(mark);
    post(job);
  }
  void cancel() override {
    std::lock_guard<std::mutex> lock(mutex);
    discard();
  }
  void flush() override { post(Job{Job::Kind::flush}); }

 private:
  void post(Job job) {
    { std::lock_guard<std::mutex> lock(mutex); queue.push_back(std::move(job)); }
    wake.notify_one();
  }
  void run() {
    std::unique_lock<std::mutex> lock(mutex);
    for (;;) {
      wake.wait(lock, [this] { return stopping || !queue.empty(); });
      if (stopping) discard();
      if (queue.empty()) break;
      const Job job = queue.front(); queue.pop_front();
      lock.unlock();
      apply(job);
      lock.lock();
    }
    lock.unlock();
    for (const auto key : held) XTestFakeKeyEvent(display, key, False, CurrentTime);
    held.clear();
    XSync(display, False);
    pace(lastTap + spareReuse);
    restoreSpares();
    XSync(display, False);
  }
  /// Drops queued text and moves, completing the fences that covered them as not applied. Call with the mutex held.
  void discard() {
    bool lost = false;
    for (auto job = queue.begin(); job != queue.end();) {
      if (job->kind == Job::Kind::fence) {
        const bool failed = lost; lost = false;
        if (!failed) { ++job; continue; }
        const auto mark = job->fence; job = queue.erase(job);
        mark->complete(false);
        continue;
      }
      if (job->kind == Job::Kind::text || job->kind == Job::Kind::motion || job->kind == Job::Kind::scroll) {
        lost = true; job = queue.erase(job); continue;
      }
      ++job;
    }
  }
  void apply(const Job& job) {
    switch (job.kind) {
      case Job::Kind::key:
        if (job.press) held.insert(job.code); else held.erase(job.code);
        XTestFakeKeyEvent(display, job.code, job.press, CurrentTime);
        break;
      case Job::Kind::text: type(job.codepoint); break;
      case Job::Kind::button: XTestFakeButtonEvent(display, job.number, job.press, CurrentTime); break;
      case Job::Kind::motion: XTestFakeMotionEvent(display, DefaultScreen(display), job.x, job.y, CurrentTime); break;
      case Job::Kind::scroll: wheel(job.number, job.notches); break;
      case Job::Kind::locks: XkbLockModifiers(display, XkbUseCoreKbd, LockMask, 0); restoreIdle(std::chrono::steady_clock::now()); break;
      case Job::Kind::flush: XFlush(display); break;
      case Job::Kind::fence: job.fence->complete(true); break;
    }
  }
  void type(uint32_t codepoint) {
    const KeySym symbol = textKeysym(codepoint);
    for (auto& spare : spares) {
      if (spare.symbol != symbol) continue;
      tap(spare);
      return;
    }
    const KeyCode found = XKeysymToKeycode(display, symbol);
    if (found && !held.count(found) && XkbKeycodeToKeysym(display, found, 0, 0) == symbol) {
      tapKey(found);
      return;
    }
    Spare* spare = nullptr;
    for (auto& candidate : spares) if (!spare || candidate.used < spare->used) spare = &candidate;
    if (!spare) return;
    pace(spare->tapped + spareReuse);
    bind(*spare, symbol);
    tap(*spare);
  }
  void tap(Spare& spare) {
    tapKey(spare.code);
    spare.used = ++typed;
    spare.tapped = lastTap = std::chrono::steady_clock::now();
  }
  /// Taps code with held modifiers lifted for the tap and pressed again right after.
  void tapKey(KeyCode code) {
    std::vector<KeyCode> lifted;
    for (const auto modifier : held)
      if (modifier != code && modifiers.count(modifier)) lifted.push_back(modifier);
    for (const auto modifier : lifted) XTestFakeKeyEvent(display, modifier, False, CurrentTime);
    XTestFakeKeyEvent(display, code, True, CurrentTime);
    XTestFakeKeyEvent(display, code, False, CurrentTime);
    for (auto it = lifted.rbegin(); it != lifted.rend(); ++it) XTestFakeKeyEvent(display, *it, True, CurrentTime);
  }
  void pace(TimePoint ready) {
    const auto now = std::chrono::steady_clock::now();
    if (ready > now) std::this_thread::sleep_for(ready - now);
  }
  void wheel(unsigned axis, int notches) {
    const unsigned button = axis == 0 ? (notches > 0 ? 5 : 4) : (notches > 0 ? 7 : 6);
    for (int n = 0; n < (notches < 0 ? -notches : notches); ++n) {
      XTestFakeButtonEvent(display, button, True, CurrentTime);
      XTestFakeButtonEvent(display, button, False, CurrentTime);
    }
  }
  void bind(Spare& spare, KeySym symbol) {
    pace(bound + spareBind);
    std::vector<KeySym> symbols(size_t(columns), symbol);
    XChangeKeyboardMapping(display, spare.code, columns, symbols.data(), 1);
    spare.symbol = symbol;
    bound = std::chrono::steady_clock::now();
  }
  void restoreSpares() {
    for (auto& spare : spares) unbind(spare);
    bound = std::chrono::steady_clock::now();
  }
  /// Unbinds spares that have been idle longer than the reuse window, keeping recent ones readable.
  void restoreIdle(TimePoint now) {
    bool changed = false;
    for (auto& spare : spares) {
      if (spare.symbol == NoSymbol || now < spare.tapped + spareReuse) continue;
      unbind(spare); changed = true;
    }
    if (changed) bound = now;
  }
  void unbind(Spare& spare) {
    if (spare.symbol == NoSymbol) return;
    std::vector<KeySym> symbols(size_t(columns), NoSymbol);
    XChangeKeyboardMapping(display, spare.code, columns, symbols.data(), 1);
    spare.symbol = NoSymbol;
  }
  void findModifiers() {
    XModifierKeymap* map = XGetModifierMapping(display);
    if (!map) return;
    for (int index = 0; index < 8 * map->max_keypermod; ++index)
      if (const KeyCode code = map->modifiermap[index]) modifiers.insert(code);
    XFreeModifiermap(map);
  }
  void findSpares() {
    int min = 0, max = 0, count = 0;
    XDisplayKeycodes(display, &min, &max);
    if (max < min) return;
    KeySym* keysyms = XGetKeyboardMapping(display, KeyCode(min), max - min + 1, &count);
    if (!keysyms || count < 1) { if (keysyms) XFree(keysyms); return; }
    columns = count;
    for (int index = 0; index <= max - min; ++index) {
      const KeySym symbol = keysyms[index * count];
      if (symbol != NoSymbol) { layout.emplace(symbol, KeyCode(min + index)); continue; }
      bool empty = true;
      for (int column = 0; column < count; ++column)
        if (keysyms[index * count + column] != NoSymbol) { empty = false; break; }
      if (empty && spares.size() < spareCount) spares.push_back(Spare{KeyCode(min + index), NoSymbol, 0, {}});
    }
    XFree(keysyms);
  }
};
}  // namespace
std::unique_ptr<InputBackend> makeInputBackend() {
  return std::make_unique<X11Input>();
}
}  // namespace relay
