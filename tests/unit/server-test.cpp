#include "server/backend.hpp"
#include "server/config.hpp"
#include "server/metrics.hpp"
#include "server/wire.hpp"
#include <libwebsockets.h>
#include <cassert>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

static bool engineConfig(const std::vector<std::string>& options, relay::Config& config, std::string* error = nullptr) {
  relay::Config parsed;
  std::vector<std::string> values = {"relay-engine", "--viewer-dir", "build/test-viewer"};
  values.insert(values.end(), options.begin(), options.end());
  std::vector<char*> argv;
  for (auto& value : values) argv.push_back(value.data());
  try {
    if (!relay::parseConfig(int(argv.size()), argv.data(), parsed)) return false;
  } catch (const std::runtime_error& exception) {
    if (error) *error = exception.what();
    return false;
  }
  config = std::move(parsed);
  return true;
}

int main() {
  using namespace relay;
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
  std::vector<uint8_t> out;
  controlReady(out, 2, 7, 1280, 720);
  const uint8_t ready[] = {0, 0, 'N', 'S', 'L', '1', 1, 4, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 4, 5, 0, 2, 208};
  assert(out == std::vector<uint8_t>(ready, ready + sizeof(ready)));
  Config engine;
  const std::string defaultName = defaultBackend().name;
  assert(engineConfig({}, engine) && engine.backend == defaultName && engine.fps == 60 &&
         engine.bitrate_min == 1000000 && engine.bitrate_start == 8000000 && engine.bitrate_max == 40000000);
  assert(engineConfig({"--backend", defaultName, "--output", "HDMI-A-1"}, engine) &&
         engine.backend == defaultName && engine.output == "HDMI-A-1");
  std::string error;
  assert(!engineConfig({"--backend", "wayland2"}, engine, &error));
  assert(error.find("wayland2") != std::string::npos && error.find(backendNames()) != std::string::npos);
  assert(!engineConfig({"--output"}, engine, &error));
  assert(error == "Missing value for --output");
  assert(engineConfig({"--fps", "10"}, engine) && engine.fps == 10);
  assert(engineConfig({"--fps", "60"}, engine) && engine.fps == 60);
  assert(engineConfig({"--fps", "120"}, engine) && engine.fps == 120);
  assert(!engineConfig({"--fps", "9"}, engine) && !engineConfig({"--fps", "121"}, engine));
  assert(!engineConfig({"--fps", "-1"}, engine) && !engineConfig({"--fps", "30x"}, engine));
  assert(engineConfig({"--bitrate-min", "250000", "--bitrate-start", "250000", "--bitrate-max", "100000000"}, engine));
  assert(engine.bitrate_min == 250000 && engine.bitrate_start == 250000 && engine.bitrate_max == 100000000);
  assert(engineConfig({"--bitrate-start", "15000000", "--bitrate-max", "20000000"}, engine));
  assert(!engineConfig({"--bitrate-min", "249999"}, engine));
  assert(!engineConfig({"--bitrate-max", "100000001"}, engine));
  assert(!engineConfig({"--bitrate-min", "9000000"}, engine));
  assert(!engineConfig({"--bitrate-start", "40000001"}, engine));
  return 0;
}
