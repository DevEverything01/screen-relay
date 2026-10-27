#include "capture-source.hpp"
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/Xdamage.h>
#include <X11/extensions/XShm.h>
#include <sys/shm.h>
#include <atomic>
#include <stdexcept>
#include <mutex>
namespace nsl {
namespace {
void require(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
// Xlib's handler is process-wide; the attach probe is limited to this Display.
std::atomic<Display*> probe_display{nullptr};
std::atomic<bool> probe_error{false};
std::atomic<XErrorHandler> previous_handler{nullptr};
std::mutex attach_mutex;
int attachError(Display* display, XErrorEvent* event) {
  if (display == probe_display.load()) { probe_error = true; return 0; }
  const auto previous = previous_handler.load();
  return previous ? previous(display, event) : 0;
}
class X11CaptureSource final : public CaptureSource {
  Display* display = nullptr;
  Damage damage = 0;
  XImage* image = nullptr;
  XShmSegmentInfo shm{};
  bool attached = false;
  int damage_event = 0;
 public:
  X11CaptureSource() { shm.shmid = -1; shm.shmaddr = reinterpret_cast<char*>(-1); }
  ~X11CaptureSource() override {
    if (attached) { XShmDetach(display, &shm); XSync(display, False); }
    if (image) { image->data = nullptr; XDestroyImage(image); }
    if (shm.shmaddr != reinterpret_cast<char*>(-1)) shmdt(shm.shmaddr);
    if (shm.shmid >= 0) shmctl(shm.shmid, IPC_RMID, nullptr);
    if (damage) XDamageDestroy(display, damage);
    if (display) XCloseDisplay(display);
  }
  void init() {
    display = XOpenDisplay(nullptr);
    require(display, "opening X display failed");
    int ignored;
    require(XDamageQueryExtension(display, &damage_event, &ignored), "XDamage unavailable");
    require(XShmQueryExtension(display), "MIT-SHM unavailable");
    const int screen = DefaultScreen(display);
    require(DisplayWidth(display, screen) == 1280 && DisplayHeight(display, screen) == 720,
            "capture requires a fixed 1280x720 root");
    image = XShmCreateImage(display, DefaultVisual(display, screen), DefaultDepth(display, screen),
                            ZPixmap, nullptr, &shm, 1280, 720);
    require(image && image->bytes_per_line >= 1280 * 4 && image->bytes_per_line <= 1280 * 8 &&
            image->bits_per_pixel == 32 && image->red_mask == 0xff0000 &&
            image->green_mask == 0xff00 && image->blue_mask == 0xff,
            "unsupported X image masks, depth, or stride");
    require(image->byte_order == LSBFirst || image->byte_order == MSBFirst,
            "unsupported X image byte order");
    const size_t size = static_cast<size_t>(image->bytes_per_line) * image->height;
    shm.shmid = shmget(IPC_PRIVATE, size, IPC_CREAT | 0600);
    require(shm.shmid >= 0, "shmget failed");
    shm.shmaddr = static_cast<char*>(shmat(shm.shmid, nullptr, 0));
    require(shm.shmaddr != reinterpret_cast<char*>(-1), "shmat failed");
    image->data = shm.shmaddr; shm.readOnly = False;
    std::lock_guard<std::mutex> lock(attach_mutex);
    XSync(display, False);
    probe_display = display; probe_error = false;
    previous_handler = XSetErrorHandler(attachError);
    const bool requested = XShmAttach(display, &shm);
    XSync(display, False);
    XSetErrorHandler(previous_handler.load()); probe_display = nullptr;
    attached = requested && !probe_error;
    require(attached, "XShmAttach failed");
    require(shmctl(shm.shmid, IPC_RMID, nullptr) == 0, "marking shared memory for removal failed");
    shm.shmid = -1;
    damage = XDamageCreate(display, RootWindow(display, screen), XDamageReportNonEmpty);
    require(damage != 0, "creating XDamage failed");
    XFlush(display);
  }
  int fd() const override { return ConnectionNumber(display); }
  bool drainDamage() override {
    bool dirty = false;
    while (XPending(display)) {
      XEvent event; XNextEvent(display, &event);
      if (event.type == damage_event + XDamageNotify) dirty = true;
    }
    return dirty;
  }
  PixelFormat pixelFormat() const override {
    return image->byte_order == LSBFirst ? PixelFormat::BGRA : PixelFormat::ARGB;
  }
  FrameView capture() override {
    XDamageSubtract(display, damage, None, None);
    require(XShmGetImage(display, RootWindow(display, DefaultScreen(display)), image, 0, 0, AllPlanes),
            "XShmGetImage failed");
    return {reinterpret_cast<const uint8_t*>(image->data), image->bytes_per_line,
            image->width, image->height, pixelFormat()};
  }
};
}
bool initializeNativeBackend() {
  static std::once_flag once;
  static bool initialized = false;
  std::call_once(once, [] { initialized = XInitThreads() != 0; });
  return initialized;
}
std::unique_ptr<CaptureSource> makeCaptureSource() {
  auto source = std::make_unique<X11CaptureSource>();
  source->init();
  return source;
}
}
