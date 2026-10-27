#include "capture.hpp"
#include <libwebsockets.h>
#include <X11/Xlib.h>
#include <X11/keysym.h>
#include <X11/extensions/XTest.h>
#include <array>
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
#include <set>
#include <string>
#include <vector>

namespace {
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
int pixelCoordinate(uint16_t normalized, uint16_t extent) {
  return int((uint64_t(normalized) * (extent - 1) + 32767) / 65535);
}
KeySym hidSym(uint16_t hid) {
  if (hid >= 4 && hid <= 29) return XK_a + hid - 4;
  if (hid >= 30 && hid <= 38) return XK_1 + hid - 30;
  if (hid >= 58 && hid <= 69) return XK_F1 + hid - 58;
  if (hid >= 104 && hid <= 115) return XK_F13 + hid - 104;
  switch (hid) {
    case 39: return XK_0; case 40: return XK_Return; case 41: return XK_Escape;
    case 42: return XK_BackSpace; case 43: return XK_Tab; case 44: return XK_space;
    case 45: return XK_minus; case 46: return XK_equal; case 47: return XK_bracketleft;
    case 48: return XK_bracketright; case 49: case 50: return XK_backslash;
    case 51: return XK_semicolon; case 52: return XK_apostrophe; case 53: return XK_grave;
    case 54: return XK_comma; case 55: return XK_period; case 56: return XK_slash;
    case 57: return XK_Caps_Lock; case 70: return XK_Print; case 71: return XK_Scroll_Lock;
    case 72: return XK_Pause; case 73: return XK_Insert; case 74: return XK_Home;
    case 75: return XK_Page_Up; case 76: return XK_Delete; case 77: return XK_End;
    case 78: return XK_Page_Down; case 79: return XK_Right; case 80: return XK_Left;
    case 81: return XK_Down; case 82: return XK_Up; case 83: return XK_Num_Lock;
    case 84: return XK_KP_Divide; case 85: return XK_KP_Multiply; case 86: return XK_KP_Subtract;
    case 87: return XK_KP_Add; case 88: return XK_KP_Enter;
    case 89: return XK_KP_1; case 90: return XK_KP_2; case 91: return XK_KP_3;
    case 92: return XK_KP_4; case 93: return XK_KP_5; case 94: return XK_KP_6;
    case 95: return XK_KP_7; case 96: return XK_KP_8; case 97: return XK_KP_9;
    case 98: return XK_KP_0; case 99: return XK_KP_Decimal; case 100: return XK_backslash;
    case 101: return XK_Menu; case 103: return XK_KP_Equal;
    case 224: return XK_Control_L; case 225: return XK_Shift_L; case 226: return XK_Alt_L;
    case 227: return XK_Super_L; case 228: return XK_Control_R; case 229: return XK_Shift_R;
    case 230: return XK_Alt_R; case 231: return XK_Super_R;
    default: return NoSymbol;
  }
}
struct Server {
  lws_context* context = nullptr;
  lws* viewer = nullptr;
  Display* display = nullptr;
  std::mutex mutex;
  std::optional<nsl::EncodedFrame> pending;
  nsl::CaptureEncoder capture;
  uint32_t generation = 0, outstanding = 0, lastSequence = 0;
  uint16_t width = 1280, height = 720;
  bool failed = false;
  std::vector<uint8_t> received;
  std::set<KeyCode> keys;
  std::set<unsigned> buttons;
  std::chrono::steady_clock::time_point deadline;
  Server() : capture([this](nsl::EncodedFrame&& frame) {
    std::lock_guard<std::mutex> lock(mutex);
    if (!context || !generation || frame.generation != generation) return false;
    if (pending) { failed = true; lws_cancel_service(context); return false; }
    pending = std::move(frame);
    lws_cancel_service(context);
    return true;
  }) {}
  void release() {
    for (auto key : keys) XTestFakeKeyEvent(display, key, False, CurrentTime);
    for (auto button : buttons) XTestFakeButtonEvent(display, button, False, CurrentTime);
    keys.clear(); buttons.clear(); XFlush(display);
  }
  void end() {
    release();
    uint32_t old;
    { std::lock_guard<std::mutex> lock(mutex); old = generation; generation = 0; pending.reset(); failed = false; }
    if (old) capture.endSession(old);
    outstanding = 0; lastSequence = 0; received.clear(); viewer = nullptr;
  }
  bool input(const uint8_t* p) {
    const unsigned event = p[0], code = u16(p + 2);
    const uint32_t raw = u32(p + 4);
    const int64_t value = raw <= INT32_MAX ? int64_t(raw) : int64_t(raw) - (int64_t(1) << 32);
    if (p[1] || (u16(p + 12) & ~31u) || (u16(p + 14) & ~255u)) return false;
    if (event == 7) {
      if (code || value || u16(p + 12) || u16(p + 14)) return false;
      release(); return true;
    }
    if (event < 1 || event > 6 || (event != 6 && value)) return false;
    if (event <= 2) {
      if (code > 231) return false;
      const KeySym symbol = hidSym(code);
      if (symbol == NoSymbol) return true;
      KeyCode key = XKeysymToKeycode(display, symbol);
      if (!key) return true;
      // Held keys are authoritative; browser modifier masks can describe either side of a transition.
      if (event == 1) { if (keys.insert(key).second) XTestFakeKeyEvent(display, key, True, CurrentTime); }
      else if (keys.erase(key)) XTestFakeKeyEvent(display, key, False, CurrentTime);
    } else {
      if ((event == 3 && code) || ((event == 4 || event == 5) && (code < 1 || code > 3)) ||
          (event == 6 && (code > 1 || value < -1200 || value > 1200 || value % 120))) return false;
      int x = pixelCoordinate(u16(p + 8), width);
      int y = pixelCoordinate(u16(p + 10), height);
      XTestFakeMotionEvent(display, DefaultScreen(display), x, y, CurrentTime);
      if (event == 4) { if (buttons.insert(code).second) XTestFakeButtonEvent(display, code, True, CurrentTime); }
      if (event == 5 && buttons.erase(code)) XTestFakeButtonEvent(display, code, False, CurrentTime);
      if (event == 6) {
        unsigned button = code == 0 ? (value > 0 ? 5 : 4) : (value > 0 ? 7 : 6);
        for (int64_t n = 0; n < (value < 0 ? -value : value) / 120; ++n) {
          XTestFakeButtonEvent(display, button, True, CurrentTime);
          XTestFakeButtonEvent(display, button, False, CurrentTime);
        }
      }
    }
    XFlush(display); return true;
  }
  bool message() {
    const auto& b = received;
    if (b.size() < 20 || std::memcmp(b.data(), "NSL1", 4) || b[4] != 1 || u16(b.data()+6) || u32(b.data()+16) != b.size()-20) return false;
    const auto gen = u32(b.data()+8), seq = u32(b.data()+12);
    if (!gen) return false;
    if (b[5] == 2) {
      if (b.size() != 20) return false;
      if (gen == generation && seq && seq == outstanding) {
        outstanding = 0; capture.acknowledge(gen, seq);
      }
      return true;
    }
    if (b[5] != 3 || b.size() != 36 || seq || gen != generation) return false;
    return input(b.data()+20);
  }
  int write(lws* wsi) {
    std::optional<nsl::EncodedFrame> frame;
    { std::lock_guard<std::mutex> lock(mutex); if (failed) return -1; frame.swap(pending); }
    if (!frame) return 0;
    auto& f = *frame;
    if (f.generation != generation) return 0;
    if (outstanding || !f.sequence || f.sequence != lastSequence + 1 || !f.width || !f.height ||
        f.width > 1280 || f.height > 720 || f.annex_b.empty() || f.annex_b.size() > 16777216 ||
        (!lastSequence && !f.keyframe)) return -1;
    std::vector<uint8_t> wire(LWS_PRE + 32 + f.annex_b.size());
    auto* p = wire.data()+LWS_PRE;
    std::memcpy(p, "NSL1", 4); p[4]=1; p[5]=1;
    put(p+6, f.keyframe ? 1 : 0, 2); put(p+8, generation, 4); put(p+12, f.sequence, 4);
    put(p+16, 12+f.annex_b.size(), 4); put(p+20, f.width, 2); put(p+22, f.height, 2); put(p+24, f.pts_us, 8);
    std::memcpy(p+32, f.annex_b.data(), f.annex_b.size());
    const size_t size = wire.size()-LWS_PRE;
    if (lws_write(wsi, p, size, LWS_WRITE_BINARY) != int(size)) return -1;
    width = f.width; height = f.height; outstanding = lastSequence = f.sequence;
    deadline = std::chrono::steady_clock::now()+std::chrono::seconds(3);
    return 0;
  }
};
lws_sorted_usec_list_t heartbeat{};
lws_context* heartbeatContext = nullptr;
void heartbeatTick(lws_sorted_usec_list_t*) {
  lws_sul_schedule(heartbeatContext, 0, &heartbeat, heartbeatTick, 100000);
}
struct HttpResponse {
  unsigned char body[256];
  size_t length;
};
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
int metricsResponse(lws* wsi, HttpResponse* response) {
  if (!response) return -1;
  std::string json;
  const bool available = cgroupMetrics(json);
  if (!available) json = "{\"error\":\"cgroup_v2_unavailable\"}";
  if (json.size() > sizeof(response->body)) return -1;
  std::memcpy(response->body, json.data(), json.size());
  response->length = json.size();
  unsigned char buffer[LWS_PRE+512];
  unsigned char* start = buffer+LWS_PRE;
  unsigned char* next = start;
  unsigned char* end = buffer+sizeof(buffer);
  if (lws_add_http_common_headers(wsi, available ? HTTP_STATUS_OK : HTTP_STATUS_SERVICE_UNAVAILABLE,
                                  "application/json", response->length, &next, end) ||
      lws_add_http_header_by_name(wsi, reinterpret_cast<const unsigned char*>("cache-control:"),
                                  reinterpret_cast<const unsigned char*>("no-store"), 8, &next, end) ||
      lws_finalize_http_header(wsi, &next, end) ||
      lws_write(wsi, start, size_t(next-start), LWS_WRITE_HTTP_HEADERS) != next-start) return -1;
  lws_callback_on_writable(wsi);
  return 0;
}
uint32_t nextGeneration = 0;
int callback(lws* wsi, lws_callback_reasons reason, void* user, void* in, size_t len) {
  auto* s = static_cast<Server*>(lws_context_user(lws_get_context(wsi)));
  if (!s) return 0;
  switch (reason) {
    case LWS_CALLBACK_HTTP: {
      const std::string path(static_cast<const char*>(in), len);
      if (path == "/metrics") {
        if (lws_hdr_total_length(wsi, WSI_TOKEN_GET_URI) <= 0) {
          lws_return_http_status(wsi, HTTP_STATUS_METHOD_NOT_ALLOWED, nullptr); return -1;
        }
        return metricsResponse(wsi, static_cast<HttpResponse*>(user));
      }
      const char* file = nullptr; const char* mime = nullptr;
      if (path == "/" || path == "/index.html") { file="/opt/native/viewer/index.html"; mime="text/html"; }
      if (path == "/viewer.js") { file="/opt/native/viewer/viewer.js"; mime="application/javascript"; }
      if (!file) { lws_return_http_status(wsi, HTTP_STATUS_NOT_FOUND, nullptr); return -1; }
      return lws_serve_http_file(wsi, file, mime, nullptr, 0) < 0 ? -1 : 0;
    }
    case LWS_CALLBACK_HTTP_WRITEABLE: {
      auto* response = static_cast<HttpResponse*>(user);
      if (!response || !response->length) return 0;
      unsigned char buffer[LWS_PRE+256];
      std::memcpy(buffer+LWS_PRE, response->body, response->length);
      const size_t count = response->length;
      response->length = 0;
      if (lws_write(wsi, buffer+LWS_PRE, count, LWS_WRITE_HTTP_FINAL) != int(count)) return -1;
      return lws_http_transaction_completed(wsi);
    }
    case LWS_CALLBACK_HTTP_FILE_COMPLETION: return lws_http_transaction_completed(wsi);
    case LWS_CALLBACK_FILTER_PROTOCOL_CONNECTION: {
      char uri[256] = {}, origin[256] = {};
      if (lws_hdr_copy(wsi, uri, sizeof(uri), WSI_TOKEN_GET_URI) <= 0 ||
          lws_hdr_copy(wsi, origin, sizeof(origin), WSI_TOKEN_ORIGIN) <= 0) return 1;
      if (std::strcmp(uri, "/stream") || !loopbackOrigin(origin) || s->viewer || nextGeneration == UINT32_MAX) {
        std::cerr << "Rejected websocket: /stream, loopback Origin, and one viewer required\n"; return 1;
      }
      return 0;
    }
    case LWS_CALLBACK_ESTABLISHED: {
      if (s->viewer || nextGeneration == UINT32_MAX) return -1;
      s->viewer = wsi;
      { std::lock_guard<std::mutex> lock(s->mutex); s->generation = ++nextGeneration; s->pending.reset(); s->failed=false; }
      s->lastSequence=0; s->outstanding=0; s->received.clear();
      s->capture.beginSession(s->generation); lws_set_timer_usecs(wsi, 100000); return 0;
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
    case LWS_CALLBACK_SERVER_WRITEABLE: return s->viewer == wsi ? s->write(wsi) : -1;
    case LWS_CALLBACK_EVENT_WAIT_CANCELLED:
      if (s->viewer) lws_callback_on_writable(s->viewer);
      return 0;
    case LWS_CALLBACK_TIMER:
      if (s->viewer != wsi) return -1;
      if (s->outstanding && std::chrono::steady_clock::now() >= s->deadline) {
        std::cerr << "Viewer ACK timeout\n"; s->end(); return -1;
      }
      lws_set_timer_usecs(wsi, 100000); return 0;
    case LWS_CALLBACK_CLOSED: if (s->viewer == wsi) s->end(); return 0;
    default: return 0;
  }
}
void selfCheck() {
  assert(pixelCoordinate(0, 1280) == 0);
  assert(pixelCoordinate(65535, 1280) == 1279);
  assert(pixelCoordinate(10248, 1280) == 200);
  assert(pixelCoordinate(40992, 1280) == 800);
  assert(pixelCoordinate(65535, 720) == 719);
  assert(pixelCoordinate(36459, 720) == 400);
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
  assert(hidSym(4) == XK_a && hidSym(225) == XK_Shift_L && hidSym(3) == NoSymbol);
}
} // namespace
int main() {
  selfCheck();
  if (!XInitThreads()) { std::cerr << "XInitThreads failed\n"; return 1; }
  std::signal(SIGINT, signalStop); std::signal(SIGTERM, signalStop);
  Server s;
  std::string captureError;
  if (!s.capture.start(captureError)) {
    std::cerr << "Capture startup failed: " << captureError << '\n';
    s.capture.stop(); return 1;
  }
  s.display = XOpenDisplay(nullptr);
  if (!s.display) { std::cerr << "Cannot open XTest display\n"; s.capture.stop(); return 1; }
  int event, error, major, minor;
  if (!XTestQueryExtension(s.display, &event, &error, &major, &minor)) {
    std::cerr << "XTest unavailable\n"; s.capture.stop(); XCloseDisplay(s.display); return 1;
  }
  lws_protocols protocols[] = {{"http", callback, sizeof(HttpResponse), 4096, 0, nullptr, 0}, {"nsl1", callback, 0, 4096, 0, nullptr, 0}, {nullptr, nullptr, 0, 0, 0, nullptr, 0}};
  lws_context_creation_info info{};
  info.port=8080; info.iface="0.0.0.0"; info.protocols=protocols; info.user=&s;
  info.uid=-1; info.gid=-1;
  s.context=lws_create_context(&info);
  if (!s.context) { std::cerr << "Cannot create port 8080 server\n"; s.capture.stop(); XCloseDisplay(s.display); return 1; }
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
  s.end(); s.capture.stop();
  const auto stats=s.capture.stats();
  std::cerr << "capture_stats captures=" << stats.captures << " encoded=" << stats.encoded
            << " capture_ns=" << stats.capture_ns << " convert_ns=" << stats.convert_ns << " encode_ns=" << stats.encode_ns << '\n';
  lws_sul_cancel(&heartbeat);
  lws_context_destroy(s.context); s.context=nullptr; heartbeatContext=nullptr;
  XCloseDisplay(s.display);
  return result;
}
