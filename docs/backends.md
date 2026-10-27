# Capture and input backends

The current refactor separates capture and input interfaces from the streaming pipeline. It is an X11 implementation, not a Wayland implementation. The general3 refactor passed 12 browser/video and five framework checks in release and ASAN/UBSAN builds, plus an injected-source test through the real encoder without X11 linkage. Only Xfce on X11 has been tested in this lab.

| Session | Implementation status | Validation |
| --- | --- | --- |
| Xfce on X11 | X11 capture and XTest input | Release and sanitizer integration passed |
| GNOME on X11 | Same X11 backend may be applicable | Not tested |
| GNOME on Wayland | No native Wayland backend | Not tested or supported |
| Other Wayland sessions | No native Wayland backend | Not tested or supported |

## Implemented boundaries

`src/capture-source.hpp` defines `CaptureSource`: `fd()`, `drainDamage()`, `pixelFormat()` and `capture()`. Its `FrameView` is a non-owning, CPU-accessible pointer, stride, dimensions and BGRA or ARGB format; pixels remain valid until the next capture or source destruction. The stream capture worker creates and owns its source, polls its fd alongside the wake fd, drains notifications, latches dirty work, captures and converts before the next capture. The worker requires a valid fd, stable supported pixel format, fixed 1280×720 dimensions, and stride 5120–10240 bytes. It copies/converts pixels into its own encoder frame; this interface does not provide GPU zero-copy. The X11 implementation owns its display, XDamage and MIT-SHM resources and subtracts damage before reading the root. `CaptureEncoder` accepts a `CaptureSourceFactory`, defaulting to `makeCaptureSource()`; injection allows a source to be selected without placing X11 calls in the encoder. `Snapshot` uses a separate source on its own worker via `makeCaptureSource()` and converts the CPU view to PNG; it does not share the stream worker source.

Optional `cursorSupported()` and `cursor(force)` expose owned cursor images and
hotspots through the same source boundary. The default implementation is
unsupported. X11 requires XFixes 1+, subscribes to cursor notifications and
converts native premultiplied ARGB into bounded straight-alpha RGBA. Only the
capture worker reads that display; a separate publication callback transfers
images into the transport's single latest-image slot. Cursor changes are serviced
while video admission is paused and do not mark the video frame dirty.

`src/input.hpp` defines `InputBackend` with `apply`, `releaseAll`, `dimensions` and `name`; the service thread owns the instance and applies input and release on connection lifecycle events. `src/x11-input.cpp` implements XTest on a separate X connection. `initializeNativeBackend()` initializes Xlib threading before backend use. The current factories construct X11 implementations; no runtime Wayland selection, permission flow or fallback backend exists.

## Future Wayland work

Add a real backend and select it at the existing factory boundary only when implemented and validated. Avoid an empty plugin registry or a pretend-success unsupported stub. A Wayland design must resolve compositor and desktop-specific authorization, portal session creation and revocation, stream lifetime, negotiated format/stride/dimensions, notification fd and threading, frame ownership, and separately authorized remote input. It must map permission denial, session closure and format changes to explicit failures and cleanup, and decide whether the current fixed-size CPU view can represent negotiated frames or needs a deliberate interface revision. Test permission denial/revocation, session shutdown, stalled and resized streams, and held-input cleanup on the actual target desktop. No portal or PipeWire implementation is present here.

Selkies documents both X11 and native Wayland integration, with host portal considerations for GNOME; consult its [documentation](https://selkies-project.github.io/selkies/) and test the actual deployment. KasmVNC Wayland support remains an open question tracked in [issue 193](https://github.com/kasmtech/KasmVNC/issues/193); it is not verified here.

## Language choice

This prototype uses C++ to call the existing X11, FFmpeg and libwebsockets interfaces directly. No benchmark compares Rust with C++, and these results establish no language performance superiority. A Rust backend or rewrite is an option, with tradeoffs in FFI ownership, dependency and build integration, and migration/testing effort; safe Rust can reduce memory-safety hazards while native-library FFI still requires careful ownership. The current interfaces are C++ source contracts, not a stable language-neutral ABI.
