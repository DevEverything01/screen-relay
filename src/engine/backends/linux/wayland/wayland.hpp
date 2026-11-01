#pragma once

#include "virtual-keyboard-unstable-v1-client-protocol.h"
#include "wlr-screencopy-unstable-v1-client-protocol.h"
#include "wlr-virtual-pointer-unstable-v1-client-protocol.h"
#include <memory>
#include <string>
#include <vector>
#include <wayland-client.h>

namespace relay::wayland {
struct OutputInfo;

struct Connection {
  wl_display* display = nullptr;
  wl_shm* shm = nullptr;
  wl_seat* seat = nullptr;
  wl_output* output = nullptr;
  int width = 0;
  int height = 0;
  zwlr_screencopy_manager_v1* screencopyManager = nullptr;
  zwp_virtual_keyboard_manager_v1* virtualKeyboardManager = nullptr;
  zwlr_virtual_pointer_manager_v1* virtualPointerManager = nullptr;

  Connection();
  ~Connection();
  Connection(const Connection&) = delete;
  Connection& operator=(const Connection&) = delete;

 private:
  wl_registry* registry_ = nullptr;
  std::unique_ptr<OutputInfo> outputInfo_;
  void initialize();
  void cleanup();
};

bool initializeNativeBackend(const std::string& output);
}
