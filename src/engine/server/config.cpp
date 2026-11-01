#include "config.hpp"
#include "backend.hpp"
#include <charconv>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <sys/stat.h>
#include <unistd.h>

namespace relay {
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
bool authenticated(const Config& config, lws* wsi, bool websocket) {
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
bool localRequest(const Config& config, lws* wsi) {
  const auto host = header(wsi, WSI_TOKEN_HOST);
  if (!loopbackHost(host) && (config.origin.empty() || host != config.authority)) return false;
  if (lws_hdr_total_length(wsi, WSI_TOKEN_ORIGIN) <= 0) return true;
  const auto origin = header(wsi, WSI_TOKEN_ORIGIN);
  return (loopbackHost(host) && loopbackOrigin(origin)) || (!config.token.empty() && !origin.empty() && origin == config.origin);
}
bool unsignedNumber(const std::string& text, uint64_t& value) {
  if (text.empty()) return false;
  const auto parsed = std::from_chars(text.data(), text.data()+text.size(), value);
  return parsed.ec == std::errc{} && parsed.ptr == text.data()+text.size();
}
bool parseConfig(int argc, char** argv, Config& config) {
  config.viewer = (std::filesystem::canonical("/proc/self/exe").parent_path() / "viewer").string();
  if (config.backend.empty()) config.backend = defaultBackend().name;
  const auto bitrate = [](const std::string& text) {
    uint64_t value;
    if (!unsignedNumber(text, value) || value < 250000 || value > 100000000)
      throw std::runtime_error("Bitrate must be an integer from 250000 to 100000000 bits per second");
    return value;
  };
  for (int i = 1; i < argc; ++i) {
    const std::string option = argv[i];
    if (option == "--help") {
      std::cout << "Usage: relay-engine [--bind ADDRESS] [--port PORT] [--viewer-dir DIR]\n"
                   "  [--backend NAME] [--output NAME]\n"
                   "  [--fps N] [--bitrate-min BPS] [--bitrate-start BPS] [--bitrate-max BPS]\n"
                   "  [--token-file FILE [--public-origin https://HOST[:PORT]]]\n"
                   "  [--tls-cert FILE --tls-key FILE | --behind-tls-proxy]\n"
                   "  [--insecure-local: unauthenticated, isolated development network only]\n"
                   "FPS is 10 to 60; bitrates are 250000 to 100000000 bits per second with\n"
                   "min <= start <= max. Non-loopback --bind needs --token-file;\n"
                   "--public-origin also needs TLS or --behind-tls-proxy.\n"
                   "Attach to DISPLAY using the caller's XAUTHORITY. Defaults: 127.0.0.1:8080, 60 fps,\n"
                   "1000000/8000000/40000000 bps.\n"
                << "Compiled backends: " << backendNames() << '\n';
      return false;
    }
    if (option == "--behind-tls-proxy") { config.proxy = true; continue; }
    if (option == "--insecure-local") { config.insecure_local = true; continue; }
    if (++i == argc) throw std::runtime_error("Missing value for " + option);
    const std::string value = argv[i];
    if (option == "--bind") config.bind = value;
    else if (option == "--backend") config.backend = value;
    else if (option == "--output") config.output = value;
    else if (option == "--port") {
      uint64_t port;
      if (!unsignedNumber(value, port) || !port || port > 65535) throw std::runtime_error("Invalid port");
      config.port = unsigned(port);
    } else if (option == "--fps") {
      uint64_t fps;
      if (!unsignedNumber(value, fps) || fps < 10 || fps > 60)
        throw std::runtime_error("FPS must be an integer from 10 to 60");
      config.fps = unsigned(fps);
    } else if (option == "--bitrate-min") config.bitrate_min = bitrate(value);
    else if (option == "--bitrate-start") config.bitrate_start = bitrate(value);
    else if (option == "--bitrate-max") config.bitrate_max = bitrate(value);
    else if (option == "--viewer-dir") config.viewer = value;
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
  backendFor(config.backend);
  if (config.cert.empty() != config.key.empty() || (config.proxy && !config.cert.empty()))
    throw std::runtime_error("Choose a TLS certificate/key pair or a TLS proxy");
  if (config.bitrate_min > config.bitrate_start || config.bitrate_start > config.bitrate_max)
    throw std::runtime_error("Bitrates must satisfy min <= start <= max");
  if (!config.origin.empty() && config.token.empty()) throw std::runtime_error("Public origin requires a token");
  if (config.insecure_local && (!config.token.empty() || !config.origin.empty() || !config.cert.empty() || config.proxy))
    throw std::runtime_error("--insecure-local cannot be combined with remote access options");
  if (config.bind != "127.0.0.1" && !config.insecure_local && (config.token.empty() || (!config.origin.empty() && config.cert.empty() && !config.proxy)))
    throw std::runtime_error("Non-loopback binding requires a token; a public origin also requires TLS or --behind-tls-proxy");
  if (config.insecure_local) std::cerr << "WARNING: unauthenticated development listener; isolate it and publish to host loopback only\n";
  for (const char* name : {"index.html", "viewer.js"})
    if (!std::filesystem::is_regular_file(std::filesystem::path(config.viewer)/name)) throw std::runtime_error("Viewer assets missing; use --viewer-dir");
  return true;
}
}  // namespace relay
