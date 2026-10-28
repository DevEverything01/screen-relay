#include "server.hpp"
#include "core/capture-source.hpp"
#include "metrics.hpp"
#include <algorithm>
#include <chrono>
#include <cstring>
#include <iostream>
#ifdef __linux__
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#endif

namespace relay {
namespace {
using Clock = std::chrono::steady_clock;
uint64_t nowUs() {
  return std::chrono::duration_cast<std::chrono::microseconds>(Clock::now().time_since_epoch()).count();
}
#ifdef __linux__
void configureStreamSocket(lws* wsi) {
  const int fd = lws_get_socket_fd(wsi);
  if (fd < 0) return;
  const int enabled = 1, send_buffer = 256 * 1024;
  (void)setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &enabled, sizeof(enabled));
  (void)setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &send_buffer, sizeof(send_buffer));
#ifdef TCP_NOTSENT_LOWAT
  const int notsent_lowat = 128 * 1024;
  (void)setsockopt(fd, IPPROTO_TCP, TCP_NOTSENT_LOWAT, &notsent_lowat, sizeof(notsent_lowat));
#endif
}
#endif
}  // namespace
Server::Server(Config settings) : config(std::move(settings)), capture([this](EncodedFrame&& frame) {
  std::lock_guard<std::mutex> lock(mutex);
  if (!context || !generation || frame.generation != generation) return false;
  if (!flow.enqueue(frame.sequence, frame.annex_b.size(), frame.pts_us, nowUs())) {
    failed = true; lws_cancel_service(context); return false;
  }
  pending.push_back(std::move(frame));
  lws_cancel_service(context);
  return true;
}, makeCaptureSource, [this](uint32_t gen, CursorImage&& cursor) {
  std::lock_guard<std::mutex> lock(mutex);
  if (!context || !generation || gen != generation) return;
  pending_cursor = std::move(cursor);
  lws_cancel_service(context);
}) {}
void Server::release() { if (input) input->releaseAll(); }
void Server::end() {
  release();
  uint32_t old;
  { std::lock_guard<std::mutex> lock(mutex); old = generation; generation = 0; pending.clear(); pending_cursor.reset(); flow = {}; failed = false; }
  last_write_cursor = false;
  if (old) capture.endSession(old);
  lastSequence = 0; received.clear(); replies.clear(); control_ready = controller = false; viewer = nullptr;
}
bool Server::message() {
  const auto& b = received;
  if (b.size() < 20 || std::memcmp(b.data(), "NSL1", 4) || b[4] != 1 || u16(b.data()+6) || u32(b.data()+16) != b.size()-20) return false;
  const auto gen = u32(b.data()+8), seq = u32(b.data()+12);
  if (!gen) return false;
  if (controller) {
    if (b[5] != 3 || b.size() != 36 || !seq || gen != generation || replies.size() >= 32) return false;
    replies.emplace_back(seq, input->apply(inputEvent(b.data()+20)));
    lws_callback_on_writable(viewer); return true;
  }
  if (b[5] == 2) {
    if (b.size() != 20) return false;
    bool accepted = false;
    { std::lock_guard<std::mutex> lock(mutex);
      if (gen == generation && seq) accepted = flow.ack(seq, nowUs());
    }
    if (accepted) { capture.acknowledge(gen, seq); updateFlow(); }
    return true;
  }
  if (b[5] != 3 || b.size() != 36 || seq || gen != generation) return false;
  return input->apply(inputEvent(b.data()+20)) != InputStatus::invalid;
}
void Server::updateFlow() {
  uint32_t gen; unsigned window; uint64_t bitrate, admit_until; bool paused;
  { std::lock_guard<std::mutex> lock(mutex);
    const auto now = nowUs(); flow.update(now);
    gen = generation; window = flow.window; bitrate = flow.target_bitrate; paused = flow.paused(now);
    admit_until = flow.frames.empty() ? 0 : flow.frames.front().captured_us + FlowControl::pause_age_us;
  }
  // Never hold the transport mutex while calling the capture API. Publication takes it later.
  capture.setFlowControl(gen, window, bitrate, paused, admit_until);
}
bool Server::timedOut() {
  std::lock_guard<std::mutex> lock(mutex);
  return failed || flow.timedOut(nowUs());
}
std::string Server::metrics() {
  std::lock_guard<std::mutex> lock(mutex);
  return ",\"inflight_frames\":" + std::to_string(flow.frames.size()) +
      ",\"inflight_bytes\":" + std::to_string(flow.bytes) +
      ",\"window_frames\":" + std::to_string(flow.window) +
      ",\"target_bitrate_bps\":" + std::to_string(flow.target_bitrate) +
      ",\"ack_rtt_ms\":" + std::to_string(flow.ack_rtt_us / 1000.0) +
      ",\"oldest_frame_ms\":" + std::to_string(flow.oldestAge(nowUs()) / 1000.0) +
      ",\"frames_acked\":" + std::to_string(flow.acknowledged) +
      ",\"frames_encoded\":" + std::to_string(flow.encoded) +
      ",\"observed_busy_goodput_bps\":" + std::to_string(flow.goodput_bps) +
      ",\"max_inflight_frames\":" + std::to_string(FlowControl::max_frames) +
      ",\"max_inflight_bytes\":" + std::to_string(FlowControl::max_bytes) +
      ",\"max_frame_bytes\":" + std::to_string(FlowControl::max_bytes) +
      ",\"admission_age_ms\":" + std::to_string(FlowControl::pause_age_us / 1000) +
      ",\"no_ack_timeout_ms\":" + std::to_string(FlowControl::timeout_us / 1000) +
      ",\"max_frame_age_ms\":" + std::to_string(FlowControl::timeout_us / 1000);
}
int Server::writeControl(lws* wsi) {
  if (!control_ready && replies.empty()) return 0;
  std::vector<uint8_t> wire;
  if (control_ready) controlReady(wire, LWS_PRE, generation, width, height);
  else inputReply(wire, LWS_PRE, generation, replies.front().first, replies.front().second);
  const size_t size = wire.size() - LWS_PRE;
  if (lws_write(wsi, wire.data() + LWS_PRE, size, LWS_WRITE_BINARY) != int(size)) return -1;
  if (control_ready) control_ready = false; else replies.pop_front();
  if (!replies.empty()) lws_callback_on_writable(wsi);
  return 0;
}
int Server::write(lws* wsi) {
  std::optional<EncodedFrame> frame;
  std::optional<CursorImage> cursor;
  { std::lock_guard<std::mutex> lock(mutex);
    if (failed) return -1;
    // Start with video to establish the generation; then share writes fairly.
    if (lastSequence && pending_cursor && (!last_write_cursor || pending.empty())) {
      cursor = std::move(pending_cursor); pending_cursor.reset();
    } else {
      if (pending.empty()) return 0;
      frame.emplace(std::move(pending.front())); pending.pop_front();
    }
  }
  std::vector<uint8_t> wire;
  if (cursor) {
    if (!cursorMessage(wire, LWS_PRE, generation, *cursor)) return -1;
    const size_t size = wire.size() - LWS_PRE;
    if (lws_write(wsi, wire.data() + LWS_PRE, size, LWS_WRITE_BINARY) != int(size)) return -1;
    last_write_cursor = true;
    { std::lock_guard<std::mutex> lock(mutex);
      if (!pending.empty() || pending_cursor) lws_callback_on_writable(wsi);
    }
    return 0;
  }
  auto& f = *frame;
  if (f.generation != generation) return 0;
  if (!frameMessage(wire, LWS_PRE, generation, lastSequence, f)) return -1;
  const size_t size = wire.size() - LWS_PRE;
  if (lws_write(wsi, wire.data() + LWS_PRE, size, LWS_WRITE_BINARY) != int(size)) return -1;
  width = f.width; height = f.height; lastSequence = f.sequence;
  last_write_cursor = false;
  { std::lock_guard<std::mutex> lock(mutex); if (!flow.sent(f.sequence, nowUs())) return -1; }
  updateFlow();
  { std::lock_guard<std::mutex> lock(mutex); if (!pending.empty() || pending_cursor) lws_callback_on_writable(wsi); }
  return 0;
}
namespace {
int responseHeaders(lws* wsi, unsigned status, const char* mime, size_t length) {
  unsigned char buffer[LWS_PRE+512];
  unsigned char* start = buffer+LWS_PRE;
  unsigned char* next = start;
  unsigned char* end = buffer+sizeof(buffer);
  if (lws_add_http_common_headers(wsi, status, mime, length, &next, end) ||
      lws_add_http_header_by_name(wsi, reinterpret_cast<const unsigned char*>("cache-control:"),
                                  reinterpret_cast<const unsigned char*>("no-store"), 8, &next, end) ||
      lws_finalize_http_header(wsi, &next, end) ||
      lws_write(wsi, start, size_t(next-start), LWS_WRITE_HTTP_HEADERS) != next-start) return -1;
  lws_callback_on_writable(wsi); return 0;
}
int jsonResponse(lws* wsi, HttpResponse* response, unsigned status, const std::string& json) {
  if (!response || json.size() > sizeof(response->body)) return -1;
  std::memcpy(response->body, json.data(), json.size()); response->length = json.size();
  return responseHeaders(wsi, status, "application/json", response->length);
}
int errorResponse(lws* wsi, HttpResponse* response, unsigned status, const char* error) {
  return jsonResponse(wsi, response, status, "{\"error\":\"" + std::string(error) + "\"}");
}
void closeScreenshot(Server* server, lws* wsi, HttpResponse* response) {
  if (server->screenshot_client == wsi) {
    server->screenshot_client = nullptr;
    lws_set_timer_usecs(wsi, LWS_SET_TIMER_USEC_CANCEL);
    // During capture the slot stays busy until its worker result is safely discarded.
    if (response && response->image) server->screenshot.finish();
  }
  if (response) { delete response->image; response->image = nullptr; response->offset = 0; }
}
int inputResponse(lws* wsi, HttpResponse* response, Server* s) {
  const bool complete = response->input_length == response->input_expected;
  response->input_expected = 0;
  if (!complete) return -1;
  if (s->viewer) return errorResponse(wsi, response, HTTP_STATUS_CONFLICT, "busy");
  const size_t count = response->input_length / 16;
  size_t index = 0;
  auto status = InputStatus::ok;
  for (; index < count && status == InputStatus::ok; ++index) status = s->input->apply(inputEvent(response->input + index * 16));
  s->release();
  if (status == InputStatus::ok) return jsonResponse(wsi, response, HTTP_STATUS_OK, "{\"applied\":" + std::to_string(count) + "}");
  const bool invalid = status == InputStatus::invalid;
  return jsonResponse(wsi, response, invalid ? HTTP_STATUS_BAD_REQUEST : 422, std::string("{\"error\":\"") +
                      (invalid ? "invalid_input" : "unsupported_input") + "\",\"index\":" + std::to_string(index - 1) + "}");
}
int metricsResponse(lws* wsi, HttpResponse* response, Server* server) {
  if (!response) return -1;
  std::string json;
  const bool available = cgroupMetrics(json);
  if (!available) json = "{\"resources_available\":false,\"usage_usec\":null,\"memory_current\":null,\"inactive_file\":null}";
  json.pop_back(); json += server->metrics() + "}";
  if (json.size() > sizeof(response->body)) return -1;
  std::memcpy(response->body, json.data(), json.size());
  response->length = json.size();
  return responseHeaders(wsi, HTTP_STATUS_OK,
                         "application/json", response->length);
}
}  // namespace
int callback(lws* wsi, lws_callback_reasons reason, void* user, void* in, size_t len) {
  auto* s = static_cast<Server*>(lws_context_user(lws_get_context(wsi)));
  if (!s) return 0;
  switch (reason) {
    case LWS_CALLBACK_HTTP: {
      const std::string path(static_cast<const char*>(in), len);
      auto* response = static_cast<HttpResponse*>(user);
      if (path == "/input") {
        if (!response) return -1;
        if (lws_hdr_total_length(wsi, WSI_TOKEN_POST_URI) <= 0) {
          return errorResponse(wsi, response, HTTP_STATUS_METHOD_NOT_ALLOWED, "method_not_allowed");
        }
        if (!localRequest(s->config, wsi)) return errorResponse(wsi, response, HTTP_STATUS_FORBIDDEN, "forbidden");
        if (!authenticated(s->config, wsi)) return errorResponse(wsi, response, HTTP_STATUS_UNAUTHORIZED, "unauthorized");
        uint64_t length = 0;
        if (const auto status = inputLength(header(wsi, WSI_TOKEN_HTTP_CONTENT_LENGTH), length)) {
          return errorResponse(wsi, response, status, status == HTTP_STATUS_LENGTH_REQUIRED ? "length_required" :
                               status == HTTP_STATUS_REQ_ENTITY_TOO_LARGE ? "too_large" : "invalid_input");
        }
        if (s->viewer) return errorResponse(wsi, response, HTTP_STATUS_CONFLICT, "busy");
        response->input_length = 0; response->input_expected = length; return 0;
      }
      if (path == "/metrics" || path == "/capabilities" || path == "/screenshot.png") {
        if (lws_hdr_total_length(wsi, WSI_TOKEN_GET_URI) <= 0) {
          return errorResponse(wsi, response, HTTP_STATUS_METHOD_NOT_ALLOWED, "method_not_allowed");
        }
        if (!localRequest(s->config, wsi)) return errorResponse(wsi, response, HTTP_STATUS_FORBIDDEN, "forbidden");
        if (!authenticated(s->config, wsi)) return errorResponse(wsi, response, HTTP_STATUS_UNAUTHORIZED, "unauthorized");
        if (path == "/metrics") return metricsResponse(wsi, response, s);
        if (path == "/screenshot.png") {
          if (s->screenshot_client || !s->screenshot.request()) {
            return errorResponse(wsi, response, HTTP_STATUS_SERVICE_UNAVAILABLE, "busy");
          }
          s->screenshot_client = wsi; response->image_headers = false; response->offset = 0;
          lws_set_timer_usecs(wsi, 5000000); return 0;
        }
        const std::string json = "{\"version\":1,\"backend\":\"" + std::string(s->input->name()) +
            "\",\"width\":" + std::to_string(s->width) + ",\"height\":" + std::to_string(s->height) +
            ",\"input\":{\"keyboard\":true,\"pointer\":true,\"buttons\":true,\"wheel\":true}," +
            "\"screenshot\":\"/screenshot.png\",\"control\":\"/control\",\"wayland\":false," +
            "\"max_input_pending\":32,\"cursor\":" + (s->capture.stats().cursor_supported ? "true" : "false") +
            ",\"input_endpoint\":\"/input\",\"max_input_batch\":" + std::to_string(max_input_batch) +
            ",\"audio\":false,\"clipboard\":false,\"resize\":false,\"ime\":false}";
        return jsonResponse(wsi, response, HTTP_STATUS_OK, json);
      }
      std::string file; const char* mime = nullptr;
      if (path == "/" || path == "/index.html") { file=s->config.viewer+"/index.html"; mime="text/html"; }
      if (path == "/viewer.js") { file=s->config.viewer+"/viewer.js"; mime="application/javascript"; }
      if (file.empty()) return errorResponse(wsi, response, HTTP_STATUS_NOT_FOUND, "not_found");
      return lws_serve_http_file(wsi, file.c_str(), mime, nullptr, 0) < 0 ? -1 : 0;
    }
    case LWS_CALLBACK_HTTP_WRITEABLE: {
      auto* response = static_cast<HttpResponse*>(user);
      if (!response) return -1;
      if (response->image) {
        if (!response->image_headers) {
          response->image_headers = true;
          return responseHeaders(wsi, response->screenshot_error ? HTTP_STATUS_SERVICE_UNAVAILABLE : HTTP_STATUS_OK,
                                 response->screenshot_error ? "application/json" : "image/png", response->image->size());
        }
        unsigned char chunk[LWS_PRE + 16384];
        const size_t count = std::min<size_t>(16384, response->image->size() - response->offset);
        const bool final = response->offset + count == response->image->size();
        std::memcpy(chunk+LWS_PRE, response->image->data()+response->offset, count);
        if (lws_write(wsi, chunk+LWS_PRE, count, final ? LWS_WRITE_HTTP_FINAL : LWS_WRITE_HTTP) != int(count)) return -1;
        response->offset += count;
        if (!final) { lws_callback_on_writable(wsi); return 0; }
        closeScreenshot(s, wsi, response); return lws_http_transaction_completed(wsi);
      }
      if (!response->length) return 0;
      unsigned char buffer[LWS_PRE+2048];
      std::memcpy(buffer+LWS_PRE, response->body, response->length);
      const size_t count = response->length;
      response->length = 0;
      if (lws_write(wsi, buffer+LWS_PRE, count, LWS_WRITE_HTTP_FINAL) != int(count)) return -1;
      return lws_http_transaction_completed(wsi);
    }
    case LWS_CALLBACK_HTTP_BODY: {
      auto* response = static_cast<HttpResponse*>(user);
      if (!response || !response->input_expected) return 0;
      if (len > response->input_expected - response->input_length) return -1;
      std::memcpy(response->input + response->input_length, in, len); response->input_length += len;
      return 0;
    }
    case LWS_CALLBACK_HTTP_BODY_COMPLETION: {
      auto* response = static_cast<HttpResponse*>(user);
      return response && response->input_expected ? inputResponse(wsi, response, s) : 0;
    }
    case LWS_CALLBACK_CLOSED_HTTP: closeScreenshot(s, wsi, static_cast<HttpResponse*>(user)); return 0;
    case LWS_CALLBACK_HTTP_FILE_COMPLETION: return lws_http_transaction_completed(wsi);
    case LWS_CALLBACK_FILTER_PROTOCOL_CONNECTION: {
      char uri[256] = {};
      if (lws_hdr_copy(wsi, uri, sizeof(uri), WSI_TOKEN_GET_URI) <= 0 || !user) return 1;
      const bool control = !std::strcmp(uri, "/control");
      if (!localRequest(s->config, wsi) || !authenticated(s->config, wsi, true) ||
          (!control && (std::strcmp(uri, "/stream") || lws_hdr_total_length(wsi, WSI_TOKEN_ORIGIN) <= 0)) ||
          s->viewer || s->nextGeneration == UINT32_MAX) return 1;
      static_cast<HttpResponse*>(user)->control = control;
      return 0;
    }
    case LWS_CALLBACK_ESTABLISHED: {
      if (s->viewer || s->nextGeneration == UINT32_MAX) return -1;
      s->viewer = wsi; s->controller = static_cast<HttpResponse*>(user)->control;
#ifdef __linux__
      if (!s->controller) configureStreamSocket(wsi);
#endif
      { std::lock_guard<std::mutex> lock(s->mutex); s->generation = ++s->nextGeneration; s->pending.clear(); s->pending_cursor.reset(); s->flow = {}; s->failed=false; }
      s->last_write_cursor = false;
      s->lastSequence=0; s->received.clear();
      if (s->controller) { s->control_ready = true; lws_callback_on_writable(wsi); }
      else { s->capture.beginSession(s->generation); lws_set_timer_usecs(wsi, 100000); }
      return 0;
    }
    case LWS_CALLBACK_RECEIVE:
      if (s->viewer != wsi || !lws_frame_is_binary(wsi) || len > 65536-s->received.size()) return -1;
      s->received.insert(s->received.end(), static_cast<uint8_t*>(in), static_cast<uint8_t*>(in)+len);
      if (s->received.size() > 36) return -1;
      if (lws_is_final_fragment(wsi) && !lws_remaining_packet_payload(wsi)) {
        if (!s->message()) return -1;
        s->received.clear();
      }
      return 0;
    case LWS_CALLBACK_SERVER_WRITEABLE: return s->viewer == wsi ? (s->controller ? s->writeControl(wsi) : s->write(wsi)) : -1;
    case LWS_CALLBACK_EVENT_WAIT_CANCELLED: {
      if (s->viewer) lws_callback_on_writable(s->viewer);
      std::vector<uint8_t> image; std::string error;
      if (s->screenshot.take(image, error)) {
        if (!s->screenshot_client) { s->screenshot.finish(); return 0; }
        auto* response = static_cast<HttpResponse*>(lws_wsi_user(s->screenshot_client));
        if (!response) { s->screenshot_client = nullptr; s->screenshot.finish(); return 0; }
        response->screenshot_error = !error.empty();
        if (!error.empty()) {
          std::cerr << "Screenshot failed: " << error << '\n';
          const std::string body = "{\"error\":\"screenshot_unavailable\"}";
          image.assign(body.begin(), body.end());
        }
        response->image = new std::vector<uint8_t>(std::move(image));
        lws_callback_on_writable(s->screenshot_client);
      }
      return 0;
    }
    case LWS_CALLBACK_TIMER:
      if (s->screenshot_client == wsi) { closeScreenshot(s, wsi, static_cast<HttpResponse*>(user)); return -1; }
      if (s->viewer != wsi) return -1;
      if (s->timedOut()) {
        std::cerr << "Viewer flow failure, 3s frame age, or no ACK progress for 3s\n"; s->end(); return -1;
      }
      s->updateFlow();
      lws_set_timer_usecs(wsi, 100000); return 0;
    case LWS_CALLBACK_CLOSED: if (s->viewer == wsi) s->end(); return 0;
    default: return 0;
  }
}
}  // namespace relay
