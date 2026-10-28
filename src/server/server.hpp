#pragma once

#include "config.hpp"
#include "core/capture.hpp"
#include "core/flow.hpp"
#include "core/input.hpp"
#include "screenshot.hpp"
#include "wire.hpp"
#include <libwebsockets.h>
#include <deque>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace relay {
struct HttpResponse {
  unsigned char body[2048], input[max_input_batch * 16];
  size_t length, input_length, input_expected;
  std::vector<uint8_t>* image;
  size_t offset;
  bool image_headers, screenshot_error, control;
};
/** One viewer session at a time; the capture thread and the lws service thread share it through mutex. */
struct Server {
  Config config;
  lws_context* context = nullptr;
  lws* viewer = nullptr;
  std::unique_ptr<InputBackend> input;
  Screenshot screenshot;
  lws* screenshot_client = nullptr;
  bool controller = false, control_ready = false;
  std::deque<std::pair<uint32_t, InputStatus>> replies;
  std::mutex mutex;
  std::deque<EncodedFrame> pending;
  std::optional<CursorImage> pending_cursor;
  bool last_write_cursor = false;
  FlowControl flow;
  CaptureEncoder capture;
  uint32_t generation = 0, lastSequence = 0, nextGeneration = 0;
  uint16_t width = frame_width, height = frame_height;
  bool failed = false;
  std::vector<uint8_t> received;
  explicit Server(Config settings);
  void release();
  void end();
  bool message();
  void updateFlow();
  bool timedOut();
  std::string metrics();
  int writeControl(lws* wsi);
  int write(lws* wsi);
};
int callback(lws* wsi, lws_callback_reasons reason, void* user, void* in, size_t len);
}  // namespace relay
