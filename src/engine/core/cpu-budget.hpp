#pragma once

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <string>
#include <thread>

namespace relay {
/** Reads one signed number from a file, returning 0 when it is missing or unparsable. */
inline int64_t readCount(const char* path) {
  std::ifstream file(path);
  int64_t value = 0;
  return file && (file >> value) ? value : 0;
}

/** CPUs implied by a cgroup quota, or 0 when the files report no limit. */
inline unsigned quotaCpus(const char* v2_max, const char* v1_quota, const char* v1_period) {
  std::ifstream quota_file(v2_max);
  std::string quota, period;
  if (quota_file >> quota >> period && quota != "max") {
    const uint64_t limit = std::strtoull(quota.c_str(), nullptr, 10);
    const uint64_t window = std::strtoull(period.c_str(), nullptr, 10);
    if (limit && window) return unsigned(std::max<uint64_t>(1, (limit + window - 1) / window));
  }
  const int64_t v1_limit = readCount(v1_quota), v1_window = readCount(v1_period);
  if (v1_limit > 0 && v1_window > 0) {
    const uint64_t limit = uint64_t(v1_limit), window = uint64_t(v1_window);
    return unsigned(std::max<uint64_t>(1, (limit + window - 1) / window));
  }
  return 0;
}

/** CPUs this process may use: the container quota when set, otherwise the online CPU count. */
inline unsigned availableCpus() {
  const unsigned quota = quotaCpus("/sys/fs/cgroup/cpu.max", "/sys/fs/cgroup/cpu/cpu.cfs_quota_us",
                                   "/sys/fs/cgroup/cpu/cpu.cfs_period_us");
  return quota ? quota : std::max(1u, std::thread::hardware_concurrency());
}

/** Sliced threads x264 can use for a frame: one slice per four macroblock rows. */
inline unsigned sliceLimit(int height) { return std::max(1u, unsigned((height + 15) / 16 / 4)); }

/** Slice threads that encode one frame in parallel, bounded by the CPU budget and the slice count. */
inline int encoderThreads(int height) { return int(std::min(availableCpus(), sliceLimit(height))); }
}  // namespace relay
