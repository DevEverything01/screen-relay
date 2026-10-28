#include "core/capture.hpp"
#include "core/flow.hpp"
#include "core/input.hpp"
#include "snapshot.hpp"
#include "core/capture-source.hpp"
#include <libwebsockets.h>
#include <array>
#include <algorithm>
#include <cassert>
#include <chrono>
#include <charconv>
#include <fstream>
#include <sstream>
#include <csignal>
#include <cstring>
#include <iostream>
#include <limits>
#include <mutex>
#include <optional>
#include <deque>
#include <string>
#include <vector>
#include <filesystem>
#include <sys/stat.h>
#include <unistd.h>
#if defined(__GLIBC__)
#include <malloc.h>
#endif

namespace {
using Clock = std::chrono::steady_clock;
uint64_t nowUs() {
  return std::chrono::duration_cast<std::chrono::microseconds>(Clock::now().time_since_epoch()).count();
}
volatile std::sig_atomic_t stopping = 0;
void signalStop(int) { stopping = 1; }
uint16_t u16(const uint8_t* p) { return (uint16_t(p[0]) << 8) | p[1]; }
uint32_t u32(const uint8_t* p) { return (uint32_t(p[0]) << 24) | (uint32_t(p[1]) << 16) | (uint32_t(p[2]) << 8) | p[3]; }
void put(uint8_t* p, uint64_t value, unsigned count) {
  while (count) { p[--count] = uint8_t(value); value >>= 8; }
}
struct Config {
  std::string bind = "127.0.0.1", viewer, token, origin, authority, cert, key;
  unsigned port = 8080;
  bool proxy = false, insecure_local = false;
} config;
bool secretEqual(const std::string& a, const std::string& b) {
  if (a.size() != b.size()) return false;
  unsigned difference = 0;
  for (size_t i = 0; i < a.size(); ++i) difference |= unsigned(a[i] ^ b[i]);
  return difference == 0;
}
std::string header(lws* wsi, lws_token_indexes token) {
  char value[1024];
  const int count = lws_hdr_copy(wsi, value, sizeof(value), token);
  return count > 0 ? std::string(value, size_t(count)) : "";
}
bool authenticated(lws* wsi, bool websocket = false) {
  if (config.token.empty()) return true;
  if (!websocket) return secretEqual(header(wsi, WSI_TOKEN_HTTP_AUTHORIZATION), "Bearer " + config.token);
  std::istringstream protocols(header(wsi, WSI_TOKEN_PROTOCOL));
  std::string protocol;
  while (std::getline(protocols, protocol, ',')) {
    const auto first = protocol.find_first_not_of(" \t");
    const auto last = protocol.find_last_not_of(" \t");
    if (first != std::string::npos && secretEqual(protocol.substr(first, last-first+1), "bearer." + config.token)) return true;
  }
  return false;
}
bool loopbackOrigin(const std::string& origin) {
  const auto scheme = origin.find("://");
  if (scheme == std::string::npos || (origin.substr(0, scheme) != "http" && origin.substr(0, scheme) != "https")) return false;
  const auto host = origin.substr(scheme + 3);
  auto colon = host.find(':');
  const auto name = host.substr(0, colon);
  if (name != "localhost" && name != "127.0.0.1") return false;
  if (colon == std::string::npos) return true;
  const auto port = host.substr(colon + 1);
  if (port.empty() || port.size() > 5) return false;
  unsigned value = 0;
  for (char c : port) { if (c < '0' || c > '9') return false; value = value * 10 + unsigned(c - '0'); }
  return value > 0 && value <= 65535;
}
bool loopbackHost(const std::string& host) { return loopbackOrigin("http://" + host); }
bool localRequest(lws* wsi) {
  const auto host = header(wsi, WSI_TOKEN_HOST);
  if (!loopbackHost(host) && (config.origin.empty() || host != config.authority)) return false;
  if (lws_hdr_total_length(wsi, WSI_TOKEN_ORIGIN) <= 0) return true;
  const auto origin = header(wsi, WSI_TOKEN_ORIGIN);
  return (loopbackHost(host) && loopbackOrigin(origin)) || (!config.token.empty() && !origin.empty() && origin == config.origin);
}
nsl::InputEvent inputEvent(const uint8_t* p) {
  const uint32_t raw = u32(p + 4);
  const int64_t value = raw <= INT32_MAX ? int64_t(raw) : int64_t(raw) - (int64_t(1) << 32);
  return {p[0], p[1], u16(p+2), int32_t(value), u16(p+8), u16(p+10), u16(p+12), u16(p+14)};
}
constexpr size_t max_input_batch = 256;
struct HttpResponse {
  unsigned char body[2048], input[max_input_batch * 16];
  size_t length, input_length, input_expected;
  std::vector<uint8_t>* image;
  size_t offset;
  bool image_headers, snapshot_error, control;
};
struct Server {
  lws_context* context = nullptr;
  lws* viewer = nullptr;
  std::unique_ptr<nsl::InputBackend> input;
  nsl::Snapshot snapshot;
  lws* snapshot_client = nullptr;
  bool controller = false, control_ready = false;
  std::deque<std::pair<uint32_t, nsl::InputStatus>> replies;
  std::mutex mutex;
  std::deque<nsl::EncodedFrame> pending;
  std::optional<nsl::CursorImage> pending_cursor;
  bool last_write_cursor = false;
  nsl::FlowControl flow;
  nsl::CaptureEncoder capture;
  uint32_t generation = 0, lastSequence = 0;
  uint16_t width = 1280, height = 720;
  bool failed = false;
  std::vector<uint8_t> received;
  Server() : capture([this](nsl::EncodedFrame&& frame) {
    std::lock_guard<std::mutex> lock(mutex);
    if (!context || !generation || frame.generation != generation) return false;
    if (!flow.enqueue(frame.sequence, frame.annex_b.size(), frame.pts_us, nowUs())) {
      failed = true; lws_cancel_service(context); return false;
    }
    pending.push_back(std::move(frame));
    lws_cancel_service(context);
    return true;
  }, nsl::makeCaptureSource, [this](uint32_t gen, nsl::CursorImage&& cursor) {
    std::lock_guard<std::mutex> lock(mutex);
    if (!context || !generation || gen != generation) return;
    pending_cursor = std::move(cursor);
    lws_cancel_service(context);
  }) {}
  void release() { if (input) input->releaseAll(); }
  void end() {
    release();
    uint32_t old;
    { std::lock_guard<std::mutex> lock(mutex); old = generation; generation = 0; pending.clear(); pending_cursor.reset(); flow = {}; failed = false; }
    last_write_cursor = false;
    if (old) capture.endSession(old);
    lastSequence = 0; received.clear(); replies.clear(); control_ready = controller = false; viewer = nullptr;
  }
  bool message() {
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
    return input->apply(inputEvent(b.data()+20)) != nsl::InputStatus::invalid;
  }
  void updateFlow() {
    uint32_t gen; unsigned window; uint64_t bitrate, admit_until; bool paused;
    { std::lock_guard<std::mutex> lock(mutex);
      const auto now = nowUs(); flow.update(now);
      gen = generation; window = flow.window; bitrate = flow.target_bitrate; paused = flow.paused(now);
      admit_until = flow.frames.empty() ? 0 : flow.frames.front().captured_us + nsl::FlowControl::pause_age_us;
    }
    // Never hold the transport mutex while calling the capture API. Publication takes it later.
    capture.setFlowControl(gen, window, bitrate, paused, admit_until);
  }
  bool timedOut() {
    std::lock_guard<std::mutex> lock(mutex);
    return failed || flow.timedOut(nowUs());
  }
  std::string metrics() {
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
        ",\"max_inflight_frames\":8,\"max_inflight_bytes\":8388608,\"max_frame_bytes\":8388608" +
        ",\"admission_age_ms\":250,\"no_ack_timeout_ms\":3000,\"max_frame_age_ms\":3000";
  }
  int writeControl(lws* wsi) {
    unsigned char buffer[LWS_PRE + 24] = {};
    auto* p = buffer + LWS_PRE;
    std::memcpy(p, "NSL1", 4); p[4] = 1; p[5] = control_ready ? 4 : 5;
    put(p+8, generation, 4);
    size_t size;
    if (control_ready) {
      put(p+16, 4, 4); put(p+20, width, 2); put(p+22, height, 2); size = 24;
    } else {
      if (replies.empty()) return 0;
      put(p+12, replies.front().first, 4); put(p+16, 1, 4);
      p[20] = uint8_t(replies.front().second); size = 21;
    }
    if (lws_write(wsi, p, size, LWS_WRITE_BINARY) != int(size)) return -1;
    if (control_ready) control_ready = false; else replies.pop_front();
    if (!replies.empty()) lws_callback_on_writable(wsi);
    return 0;
  }
  int write(lws* wsi) {
    std::optional<nsl::EncodedFrame> frame;
    std::optional<nsl::CursorImage> cursor;
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
    if (cursor) {
      const auto& c = *cursor;
      if (c.width > nsl::CursorImage::max_extent || c.height > nsl::CursorImage::max_extent ||
          c.rgba.size() != size_t(c.width) * c.height * 4 ||
          (c.width && c.height ? c.xhot >= c.width || c.yhot >= c.height
                              : c.width || c.height || c.xhot || c.yhot)) return -1;
      std::vector<uint8_t> wire(LWS_PRE + 28 + c.rgba.size());
      auto* p = wire.data() + LWS_PRE;
      std::memcpy(p, "NSL1", 4); p[4] = 1; p[5] = 6;
      put(p+8, generation, 4); put(p+16, 8 + c.rgba.size(), 4);
      put(p+20, c.width, 2); put(p+22, c.height, 2); put(p+24, c.xhot, 2); put(p+26, c.yhot, 2);
      std::copy(c.rgba.begin(), c.rgba.end(), p+28);
      const size_t size = wire.size() - LWS_PRE;
      if (lws_write(wsi, p, size, LWS_WRITE_BINARY) != int(size)) return -1;
      last_write_cursor = true;
      { std::lock_guard<std::mutex> lock(mutex);
        if (!pending.empty() || pending_cursor) lws_callback_on_writable(wsi);
      }
      return 0;
    }
    auto& f = *frame;
    if (f.generation != generation) return 0;
    if (!f.sequence || f.sequence != lastSequence + 1 || !f.width || !f.height ||
        f.width > 1280 || f.height > 720 || f.annex_b.empty() || f.annex_b.size() > nsl::FlowControl::max_bytes ||
        (!lastSequence && !f.keyframe)) return -1;
    std::vector<uint8_t> wire(LWS_PRE + 32 + f.annex_b.size());
    auto* p = wire.data()+LWS_PRE;
    std::memcpy(p, "NSL1", 4); p[4]=1; p[5]=1;
    put(p+6, f.keyframe ? 1 : 0, 2); put(p+8, generation, 4); put(p+12, f.sequence, 4);
    put(p+16, 12+f.annex_b.size(), 4); put(p+20, f.width, 2); put(p+22, f.height, 2); put(p+24, f.pts_us, 8);
    std::memcpy(p+32, f.annex_b.data(), f.annex_b.size());
    const size_t size = wire.size()-LWS_PRE;
    if (lws_write(wsi, p, size, LWS_WRITE_BINARY) != int(size)) return -1;
    width = f.width; height = f.height; lastSequence = f.sequence;
    last_write_cursor = false;
    { std::lock_guard<std::mutex> lock(mutex); if (!flow.sent(f.sequence, nowUs())) return -1; }
    updateFlow();
    { std::lock_guard<std::mutex> lock(mutex); if (!pending.empty() || pending_cursor) lws_callback_on_writable(wsi); }
    return 0;
  }
};
lws_sorted_usec_list_t heartbeat{};
lws_context* heartbeatContext = nullptr;
void heartbeatTick(lws_sorted_usec_list_t*) {
  lws_sul_schedule(heartbeatContext, 0, &heartbeat, heartbeatTick, 100000);
}
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
void closeSnapshot(Server* server, lws* wsi, HttpResponse* response) {
  if (server->snapshot_client == wsi) {
    server->snapshot_client = nullptr;
    lws_set_timer_usecs(wsi, LWS_SET_TIMER_USEC_CANCEL);
    // During capture the slot stays busy until its worker result is safely discarded.
    if (response && response->image) server->snapshot.finish();
  }
  if (response) { delete response->image; response->image = nullptr; response->offset = 0; }
}
bool unsignedNumber(const std::string& text, uint64_t& value) {
  if (text.empty()) return false;
  const auto parsed = std::from_chars(text.data(), text.data()+text.size(), value);
  return parsed.ec == std::errc{} && parsed.ptr == text.data()+text.size();
}
/** Validates an /input Content-Length header and returns 0 or the HTTP error status. */
unsigned inputLength(const std::string& text, uint64_t& length) {
  if (text.empty()) return HTTP_STATUS_LENGTH_REQUIRED;
  if (!unsignedNumber(text, length) || !length || length % 16) return HTTP_STATUS_BAD_REQUEST;
  return length > sizeof(HttpResponse::input) ? HTTP_STATUS_REQ_ENTITY_TOO_LARGE : 0;
}
int inputResponse(lws* wsi, HttpResponse* response, Server* s) {
  const bool complete = response->input_length == response->input_expected;
  response->input_expected = 0;
  if (!complete) return -1;
  if (s->viewer) return errorResponse(wsi, response, HTTP_STATUS_CONFLICT, "busy");
  const size_t count = response->input_length / 16;
  size_t index = 0;
  auto status = nsl::InputStatus::ok;
  for (; index < count && status == nsl::InputStatus::ok; ++index) status = s->input->apply(inputEvent(response->input + index * 16));
  s->release();
  if (status == nsl::InputStatus::ok) return jsonResponse(wsi, response, HTTP_STATUS_OK, "{\"applied\":" + std::to_string(count) + "}");
  const bool invalid = status == nsl::InputStatus::invalid;
  return jsonResponse(wsi, response, invalid ? HTTP_STATUS_BAD_REQUEST : 422, std::string("{\"error\":\"") +
                      (invalid ? "invalid_input" : "unsupported_input") + "\",\"index\":" + std::to_string(index - 1) + "}");
}
bool readSmallFile(const char* path, std::string& text) {
  std::ifstream file(path, std::ios::binary);
  if (!file) return false;
  std::array<char, 16384> buffer{};
  file.read(buffer.data(), buffer.size());
  const auto count = file.gcount();
  if (file.bad() || (!file.eof() && file.peek() != std::char_traits<char>::eof())) return false;
  text.assign(buffer.data(), size_t(count));
  return !text.empty();
}
bool statValue(const std::string& text, const std::string& wanted, uint64_t& value) {
  std::istringstream lines(text);
  std::string line;
  bool found = false;
  while (std::getline(lines, line)) {
    std::istringstream fields(line);
    std::string key, number, extra;
    if (!(fields >> key) || key != wanted) continue;
    if (found || !(fields >> number) || (fields >> extra) || !unsignedNumber(number, value)) return false;
    found = true;
  }
  return found;
}
bool cgroupMetrics(std::string& json) {
  std::string cpu, memory, memoryStats;
  uint64_t usage = 0, current = 0, inactive = 0;
  if (!readSmallFile("/sys/fs/cgroup/cpu.stat", cpu) ||
      !readSmallFile("/sys/fs/cgroup/memory.current", memory) ||
      !readSmallFile("/sys/fs/cgroup/memory.stat", memoryStats)) return false;
  const auto first = memory.find_first_not_of(" \t\r\n");
  const auto last = memory.find_last_not_of(" \t\r\n");
  if (first == std::string::npos || !unsignedNumber(memory.substr(first, last-first+1), current) ||
      !statValue(cpu, "usage_usec", usage) || !statValue(memoryStats, "inactive_file", inactive)) return false;
  json = "{\"usage_usec\":"+std::to_string(usage)+",\"memory_current\":"+std::to_string(current)+
         ",\"inactive_file\":"+std::to_string(inactive)+"}";
  return true;
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
uint32_t nextGeneration = 0;
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
        if (!localRequest(wsi)) return errorResponse(wsi, response, HTTP_STATUS_FORBIDDEN, "forbidden");
        if (!authenticated(wsi)) return errorResponse(wsi, response, HTTP_STATUS_UNAUTHORIZED, "unauthorized");
        uint64_t length = 0;
        if (const auto status = inputLength(header(wsi, WSI_TOKEN_HTTP_CONTENT_LENGTH), length)) {
          return errorResponse(wsi, response, status, status == HTTP_STATUS_LENGTH_REQUIRED ? "length_required" :
                               status == HTTP_STATUS_REQ_ENTITY_TOO_LARGE ? "too_large" : "invalid_input");
        }
        if (s->viewer) return errorResponse(wsi, response, HTTP_STATUS_CONFLICT, "busy");
        response->input_length = 0; response->input_expected = length; return 0;
      }
      if (path == "/metrics" || path == "/capabilities" || path == "/snapshot.png") {
        if (lws_hdr_total_length(wsi, WSI_TOKEN_GET_URI) <= 0) {
          return errorResponse(wsi, response, HTTP_STATUS_METHOD_NOT_ALLOWED, "method_not_allowed");
        }
        if (!localRequest(wsi)) return errorResponse(wsi, response, HTTP_STATUS_FORBIDDEN, "forbidden");
        if (!authenticated(wsi)) return errorResponse(wsi, response, HTTP_STATUS_UNAUTHORIZED, "unauthorized");
        if (path == "/metrics") return metricsResponse(wsi, response, s);
        if (path == "/snapshot.png") {
          if (s->snapshot_client || !s->snapshot.request()) {
            return errorResponse(wsi, response, HTTP_STATUS_SERVICE_UNAVAILABLE, "busy");
          }
          s->snapshot_client = wsi; response->image_headers = false; response->offset = 0;
          lws_set_timer_usecs(wsi, 5000000); return 0;
        }
        const std::string json = "{\"version\":1,\"backend\":\"" + std::string(s->input->name()) +
            "\",\"width\":" + std::to_string(s->width) + ",\"height\":" + std::to_string(s->height) +
            ",\"input\":{\"keyboard\":true,\"pointer\":true,\"buttons\":true,\"wheel\":true}," +
            "\"snapshot\":\"/snapshot.png\",\"control\":\"/control\",\"wayland\":false," +
            "\"max_input_pending\":32,\"cursor\":" + (s->capture.stats().cursor_supported ? "true" : "false") +
            ",\"input_endpoint\":\"/input\",\"max_input_batch\":" + std::to_string(max_input_batch) +
            ",\"audio\":false,\"clipboard\":false,\"resize\":false,\"ime\":false}";
        return jsonResponse(wsi, response, HTTP_STATUS_OK, json);
      }
      std::string file; const char* mime = nullptr;
      if (path == "/" || path == "/index.html") { file=config.viewer+"/index.html"; mime="text/html"; }
      if (path == "/viewer.js") { file=config.viewer+"/viewer.js"; mime="application/javascript"; }
      if (file.empty()) return errorResponse(wsi, response, HTTP_STATUS_NOT_FOUND, "not_found");
      return lws_serve_http_file(wsi, file.c_str(), mime, nullptr, 0) < 0 ? -1 : 0;
    }
    case LWS_CALLBACK_HTTP_WRITEABLE: {
      auto* response = static_cast<HttpResponse*>(user);
      if (!response) return -1;
      if (response->image) {
        if (!response->image_headers) {
          response->image_headers = true;
          return responseHeaders(wsi, response->snapshot_error ? HTTP_STATUS_SERVICE_UNAVAILABLE : HTTP_STATUS_OK,
                                 response->snapshot_error ? "application/json" : "image/png", response->image->size());
        }
        unsigned char chunk[LWS_PRE + 16384];
        const size_t count = std::min<size_t>(16384, response->image->size() - response->offset);
        const bool final = response->offset + count == response->image->size();
        std::memcpy(chunk+LWS_PRE, response->image->data()+response->offset, count);
        if (lws_write(wsi, chunk+LWS_PRE, count, final ? LWS_WRITE_HTTP_FINAL : LWS_WRITE_HTTP) != int(count)) return -1;
        response->offset += count;
        if (!final) { lws_callback_on_writable(wsi); return 0; }
        closeSnapshot(s, wsi, response); return lws_http_transaction_completed(wsi);
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
    case LWS_CALLBACK_CLOSED_HTTP: closeSnapshot(s, wsi, static_cast<HttpResponse*>(user)); return 0;
    case LWS_CALLBACK_HTTP_FILE_COMPLETION: return lws_http_transaction_completed(wsi);
    case LWS_CALLBACK_FILTER_PROTOCOL_CONNECTION: {
      char uri[256] = {};
      if (lws_hdr_copy(wsi, uri, sizeof(uri), WSI_TOKEN_GET_URI) <= 0 || !user) return 1;
      const bool control = !std::strcmp(uri, "/control");
      if (!localRequest(wsi) || !authenticated(wsi, true) ||
          (!control && (std::strcmp(uri, "/stream") || lws_hdr_total_length(wsi, WSI_TOKEN_ORIGIN) <= 0)) ||
          s->viewer || nextGeneration == UINT32_MAX) return 1;
      static_cast<HttpResponse*>(user)->control = control;
      return 0;
    }
    case LWS_CALLBACK_ESTABLISHED: {
      if (s->viewer || nextGeneration == UINT32_MAX) return -1;
      s->viewer = wsi; s->controller = static_cast<HttpResponse*>(user)->control;
      { std::lock_guard<std::mutex> lock(s->mutex); s->generation = ++nextGeneration; s->pending.clear(); s->pending_cursor.reset(); s->flow = {}; s->failed=false; }
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
      if (s->snapshot.take(image, error)) {
        if (!s->snapshot_client) { s->snapshot.finish(); return 0; }
        auto* response = static_cast<HttpResponse*>(lws_wsi_user(s->snapshot_client));
        if (!response) { s->snapshot_client = nullptr; s->snapshot.finish(); return 0; }
        response->snapshot_error = !error.empty();
        if (!error.empty()) {
          std::cerr << "Snapshot failed: " << error << '\n';
          const std::string body = "{\"error\":\"snapshot_unavailable\"}";
          image.assign(body.begin(), body.end());
        }
        response->image = new std::vector<uint8_t>(std::move(image));
        lws_callback_on_writable(s->snapshot_client);
      }
      return 0;
    }
    case LWS_CALLBACK_TIMER:
      if (s->snapshot_client == wsi) { closeSnapshot(s, wsi, static_cast<HttpResponse*>(user)); return -1; }
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
void selfCheck() {
  uint64_t parsed = 0;
  assert(statValue("usage_usec 12345\nuser_usec 9\n", "usage_usec", parsed) && parsed == 12345);
  assert(!statValue("usage_usec 12x\n", "usage_usec", parsed));
  assert(!statValue("usage_usec 1\nusage_usec 2\n", "usage_usec", parsed));
  assert(!unsignedNumber("18446744073709551616", parsed));
  uint8_t b[8] = {}; put(b, 0x12345678, 4); assert(u32(b) == 0x12345678);
  put(b, 0xabcd, 2); assert(u16(b) == 0xabcd);
  assert(loopbackOrigin("http://127.0.0.1:8080") && loopbackOrigin("https://localhost"));
  assert(!loopbackOrigin("http://localhost.evil:8080") && !loopbackOrigin("http://localhost:0"));
  assert(!loopbackOrigin("http://localhost:8080/path") && !loopbackOrigin("null"));
  assert(loopbackHost("localhost:8080") && loopbackHost("127.0.0.1:19110"));
  assert(!loopbackHost("localhost.evil:8080") && !loopbackHost("user@localhost") && !loopbackHost("localhost:0"));
  uint8_t event[16] = {6, 0, 0, 1, 0xff, 0xff, 0xff, 0x88};
  event[13] = 16; event[15] = 128;
  const auto input = inputEvent(event);
  assert(input.type == 6 && input.code == 1 && input.value == -120 && input.buttons == 16 && input.modifiers == 128);
  uint64_t length = 0;
  assert(inputLength("", length) == HTTP_STATUS_LENGTH_REQUIRED && inputLength("0", length) == HTTP_STATUS_BAD_REQUEST);
  assert(inputLength("17", length) == HTTP_STATUS_BAD_REQUEST && inputLength("-16", length) == HTTP_STATUS_BAD_REQUEST);
  assert(!inputLength("4096", length) && length == 4096 && inputLength("4112", length) == HTTP_STATUS_REQ_ENTITY_TOO_LARGE);
}
} // namespace
int main(int argc, char** argv) {
#if defined(__GLIBC__)
  mallopt(M_ARENA_MAX, 2);
#endif
  try {
    config.viewer = (std::filesystem::canonical("/proc/self/exe").parent_path() / "viewer").string();
    for (int i = 1; i < argc; ++i) {
      const std::string option = argv[i];
      if (option == "--help") {
        std::cout << "Usage: native-stream-engine [--bind ADDRESS] [--port PORT] [--viewer-dir DIR]\n"
                     "  [--token-file FILE [--public-origin https://HOST[:PORT]]]\n"
                     "  [--tls-cert FILE --tls-key FILE | --behind-tls-proxy]\n"
                     "  [--insecure-local: unauthenticated, isolated development network only]\n"
                     "Non-loopback --bind needs --token-file; --public-origin also needs TLS or --behind-tls-proxy.\n"
                     "Attach to DISPLAY using the caller's XAUTHORITY. Defaults: 127.0.0.1:8080.\n";
        return 0;
      }
      if (option == "--behind-tls-proxy") { config.proxy = true; continue; }
      if (option == "--insecure-local") { config.insecure_local = true; continue; }
      if (++i == argc) throw std::runtime_error("Missing value for " + option);
      const std::string value = argv[i];
      if (option == "--bind") config.bind = value;
      else if (option == "--port") {
        uint64_t port;
        if (!unsignedNumber(value, port) || !port || port > 65535) throw std::runtime_error("Invalid port");
        config.port = unsigned(port);
      } else if (option == "--viewer-dir") config.viewer = value;
      else if (option == "--public-origin") {
        if (value.rfind("https://", 0) != 0 || value.size() <= 8 || value.find_first_of("/?#@\\ \t\r\n", 8) != std::string::npos)
          throw std::runtime_error("Public origin must be an HTTPS origin without path or credentials");
        config.origin = value; config.authority = value.substr(8);
      } else if (option == "--token-file") {
        struct stat st{};
        if (stat(value.c_str(), &st) || !S_ISREG(st.st_mode) || st.st_uid != geteuid() || (st.st_mode & 0077) || st.st_size > 66)
          throw std::runtime_error("Token file must be private, owned by this user and contain 64 hexadecimal characters");
        std::ifstream file(value); std::getline(file, config.token);
        if (!file || config.token.size() != 64 || config.token.find_first_not_of("0123456789abcdef") != std::string::npos)
          throw std::runtime_error("Token must contain 64 lowercase hexadecimal characters");
      } else if (option == "--tls-cert") config.cert = value;
      else if (option == "--tls-key") config.key = value;
      else throw std::runtime_error("Unknown option: " + option);
    }
    if (config.cert.empty() != config.key.empty() || (config.proxy && !config.cert.empty()))
      throw std::runtime_error("Choose a TLS certificate/key pair or a TLS proxy");
    if (!config.origin.empty() && config.token.empty()) throw std::runtime_error("Public origin requires a token");
    if (config.insecure_local && (!config.token.empty() || !config.origin.empty() || !config.cert.empty() || config.proxy))
      throw std::runtime_error("--insecure-local cannot be combined with remote access options");
    if (config.bind != "127.0.0.1" && !config.insecure_local && (config.token.empty() || (!config.origin.empty() && config.cert.empty() && !config.proxy)))
      throw std::runtime_error("Non-loopback binding requires a token; a public origin also requires TLS or --behind-tls-proxy");
    if (config.insecure_local) std::cerr << "WARNING: unauthenticated development listener; isolate it and publish to host loopback only\n";
    for (const char* name : {"index.html", "viewer.js"})
      if (!std::filesystem::is_regular_file(std::filesystem::path(config.viewer)/name)) throw std::runtime_error("Viewer assets missing; use --viewer-dir");
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 2; }
  selfCheck();
  if (!nsl::initializeNativeBackend()) { std::cerr << "Native backend initialization failed\n"; return 1; }
  std::signal(SIGINT, signalStop); std::signal(SIGTERM, signalStop);
  Server s;
  std::string captureError;
  if (!s.capture.start(captureError)) {
    std::cerr << "Capture startup failed: " << captureError << '\n';
    s.capture.stop(); return 1;
  }
  try { s.input = nsl::makeInputBackend(); }
  catch (const std::exception& error) { std::cerr << error.what() << '\n'; s.capture.stop(); return 1; }
  const auto dimensions = s.input->dimensions(); s.width = dimensions.first; s.height = dimensions.second;
  lws_protocols protocols[] = {{"http", callback, sizeof(HttpResponse), 4096, 0, nullptr, 0}, {"nsl1", callback, sizeof(HttpResponse), 4096, 0, nullptr, 0}, {nullptr, nullptr, 0, 0, 0, nullptr, 0}};
  lws_context_creation_info info{};
  info.port=int(config.port); info.iface=config.bind.c_str(); info.protocols=protocols; info.user=&s;
  // shortcut: native TLS supports HTTP/1.1 only, enable HTTP/2 after multiplexed-response lifecycle tests.
  info.alpn = "http/1.1";
  if (!config.cert.empty()) {
    info.options |= LWS_SERVER_OPTION_DO_SSL_GLOBAL_INIT;
    info.ssl_cert_filepath = config.cert.c_str(); info.ssl_private_key_filepath = config.key.c_str();
  }
  info.uid=-1; info.gid=-1;
  s.context=lws_create_context(&info);
  if (!s.context) { std::cerr << "Cannot listen on " << config.bind << ':' << config.port << '\n'; s.capture.stop(); return 1; }
  s.snapshot.start(s.context);
  heartbeatContext=s.context;
  lws_sul_schedule(s.context, 0, &heartbeat, heartbeatTick, 100000);
  int result = 0;
  std::cerr << "Native stream listening on " << config.bind << ':' << config.port << '\n';
  std::cout << "{\"ready\":true,\"pid\":" << getpid() << ",\"port\":" << config.port << "}" << std::endl;
  while (!stopping) {
    captureError = s.capture.error();
    if (!captureError.empty()) {
      std::cerr << "Capture worker failed: " << captureError << '\n';
      result = 1; break;
    }
    if (lws_service(s.context, 100) < 0) {
      std::cerr << "WebSocket service failed\n";
      result = 1; break;
    }
  }
  s.end(); s.capture.stop(); s.snapshot.stop();
  const auto stats=s.capture.stats();
  std::cerr << "capture_stats captures=" << stats.captures << " encoded=" << stats.encoded
            << " capture_ns=" << stats.capture_ns << " convert_ns=" << stats.convert_ns << " encode_ns=" << stats.encode_ns << '\n';
  lws_sul_cancel(&heartbeat);
  lws_context_destroy(s.context); s.context=nullptr; heartbeatContext=nullptr;
  return result;
}
