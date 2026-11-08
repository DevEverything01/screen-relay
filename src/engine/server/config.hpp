#pragma once

#include <libwebsockets.h>
#include <cstdint>
#include <string>

namespace relay {
struct Config {
  std::string bind = "127.0.0.1", viewer, token, origin, authority, cert, key, backend, output;
  unsigned port = 8080;
  unsigned fps = 60;
  uint64_t bitrate_min = 1000000, bitrate_start = 8000000, bitrate_max = 40000000;
  bool proxy = false, insecure_local = false, check = false;
};
bool unsignedNumber(const std::string& text, uint64_t& value);
/** Fills config from argv and throws std::runtime_error on invalid options; returns false after printing --help. */
bool parseConfig(int argc, char** argv, Config& config);
bool secretEqual(const std::string& a, const std::string& b);
std::string header(lws* wsi, lws_token_indexes token);
bool authenticated(const Config& config, lws* wsi, bool websocket = false);
bool loopbackOrigin(const std::string& origin);
bool loopbackHost(const std::string& host);
bool localRequest(const Config& config, lws* wsi);
}  // namespace relay
