#include "capture.hpp"
#include "flow.hpp"
#include "input.hpp"
#include "snapshot.hpp"
#include "capture-source.hpp"
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
  char host[256] = {}, origin[256] = {};
  if (lws_hdr_copy(wsi, host, sizeof(host), WSI_TOKEN_HOST) <= 0 || !loopbackHost(host)) return false;
  if (lws_hdr_total_length(wsi, WSI_TOKEN_ORIGIN) <= 0) return true;
  const int length = lws_hdr_copy(wsi, origin, sizeof(origin), WSI_TOKEN_ORIGIN);
  return length > 0 && loopbackOrigin(origin);
}
nsl::InputEvent inputEvent(const uint8_t* p) {
  const uint32_t raw = u32(p + 4);
  const int64_t value = raw <= INT32_MAX ? int64_t(raw) : int64_t(raw) - (int64_t(1) << 32);
  return {p[0], p[1], u16(p+2), int32_t(value), u16(p+8), u16(p+10), u16(p+12), u16(p+14)};
}
struct HttpResponse {
  unsigned char body[2048];
  size_t length;
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
int errorResponse(lws* wsi, HttpResponse* response, unsigned status, const char* error) {
  if (!response) return -1;
  const std::string json = "{\"error\":\"" + std::string(error) + "\"}";
  if (json.size() > sizeof(response->body)) return -1;
  std::memcpy(response->body, json.data(), json.size()); response->length = json.size();
  return responseHeaders(wsi, status, "application/json", response->length);
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
  if (!available) json = "{\"error\":\"cgroup_v2_unavailable\"}";
  json.pop_back(); json += server->metrics() + "}";
  if (json.size() > sizeof(response->body)) return -1;
  std::memcpy(response->body, json.data(), json.size());
  response->length = json.size();
  return responseHeaders(wsi, available ? HTTP_STATUS_OK : HTTP_STATUS_SERVICE_UNAVAILABLE,
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
      if (path == "/metrics" || path == "/capabilities" || path == "/snapshot.png") {
        if (lws_hdr_total_length(wsi, WSI_TOKEN_GET_URI) <= 0) {
          return errorResponse(wsi, response, HTTP_STATUS_METHOD_NOT_ALLOWED, "method_not_allowed");
        }
        if (!localRequest(wsi)) return errorResponse(wsi, response, HTTP_STATUS_FORBIDDEN, "forbidden");
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
            ",\"audio\":false,\"clipboard\":false,\"resize\":false,\"ime\":false}";
        if (json.size() > sizeof(response->body)) return -1;
        std::memcpy(response->body, json.data(), json.size()); response->length = json.size();
        return responseHeaders(wsi, HTTP_STATUS_OK, "application/json", json.size());
      }
      const char* file = nullptr; const char* mime = nullptr;
      if (path == "/" || path == "/index.html") { file="/opt/native/viewer/index.html"; mime="text/html"; }
      if (path == "/viewer.js") { file="/opt/native/viewer/viewer.js"; mime="application/javascript"; }
      if (!file) return errorResponse(wsi, response, HTTP_STATUS_NOT_FOUND, "not_found");
      return lws_serve_http_file(wsi, file, mime, nullptr, 0) < 0 ? -1 : 0;
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
    case LWS_CALLBACK_CLOSED_HTTP: closeSnapshot(s, wsi, static_cast<HttpResponse*>(user)); return 0;
    case LWS_CALLBACK_HTTP_FILE_COMPLETION: return lws_http_transaction_completed(wsi);
    case LWS_CALLBACK_FILTER_PROTOCOL_CONNECTION: {
      char uri[256] = {}, origin[256] = {};
      if (lws_hdr_copy(wsi, uri, sizeof(uri), WSI_TOKEN_GET_URI) <= 0 || !user) return 1;
      const bool control = !std::strcmp(uri, "/control");
      if ((control && !localRequest(wsi)) ||
          (!control && (std::strcmp(uri, "/stream") ||
            lws_hdr_copy(wsi, origin, sizeof(origin), WSI_TOKEN_ORIGIN) <= 0 || !loopbackOrigin(origin))) ||
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
}
} // namespace
int main() {
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
  info.port=8080; info.iface="0.0.0.0"; info.protocols=protocols; info.user=&s;
  info.uid=-1; info.gid=-1;
  s.context=lws_create_context(&info);
  if (!s.context) { std::cerr << "Cannot create port 8080 server\n"; s.capture.stop(); return 1; }
  s.snapshot.start(s.context);
  heartbeatContext=s.context;
  lws_sul_schedule(s.context, 0, &heartbeat, heartbeatTick, 100000);
  int result = 0;
  std::cerr << "Native stream lab on :8080; publish Docker port to host loopback only\n";
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
