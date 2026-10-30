#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <deque>

namespace relay {
// All times are server steady-clock microseconds; service thread owns this state.
struct FlowControl {
  static constexpr size_t max_frames = 8;
  static constexpr size_t max_bytes = 8 * 1024 * 1024;
  static constexpr uint64_t pause_age_us = 250000;
  static constexpr uint64_t timeout_us = 3000000;
  uint64_t min_bitrate = 1000000, initial_bitrate = 8000000, max_bitrate = 40000000;
  struct Frame { uint32_t sequence; size_t bytes; uint64_t captured_us; bool sent = false; uint64_t sent_us = 0; };
  std::deque<Frame> frames;
  size_t bytes = 0;
  uint32_t last_encoded = 0;
  uint64_t acknowledged = 0, encoded = 0, last_progress_us = 0;
  uint64_t target_bitrate = initial_bitrate;
  double ack_rtt_us = 0;
  unsigned window = 1;
  uint64_t sample_start_us = 0, sample_bytes = 0, sample_acks = 0, previous_sent_us = 0;
  uint64_t last_decrease_us = 0, last_increase_us = 0;
  double goodput_bps = 0;
  unsigned frame_rate = 60;

  /** Applies the configured bitrate limits and starts at the configured initial rate. */
  void configure(uint64_t minimum, uint64_t initial, uint64_t maximum, unsigned fps = 60) {
    min_bitrate = minimum; initial_bitrate = initial; max_bitrate = maximum; target_bitrate = initial; frame_rate = fps;
  }
  /** Restores the idle transport state while keeping the configured bitrate limits. */
  void reset() {
    const uint64_t minimum = min_bitrate, initial = initial_bitrate, maximum = max_bitrate;
    const unsigned fps = frame_rate;
    *this = FlowControl{};
    configure(minimum, initial, maximum, fps);
  }
  uint64_t oldestAge(uint64_t now) const {
    return frames.empty() ? 0 : now - std::min(now, frames.front().captured_us);
  }
  bool paused(uint64_t now) const { return oldestAge(now) >= pause_age_us || bytes >= max_bytes; }
  bool timedOut(uint64_t now) const {
    return !frames.empty() && (now - std::min(now, last_progress_us) >= timeout_us ||
                               oldestAge(now) >= timeout_us);
  }
  bool enqueue(uint32_t seq, size_t size, uint64_t captured, uint64_t now) {
    if (!seq || seq != last_encoded + 1 || frames.size() >= max_frames ||
        !size || size > max_bytes || size > max_bytes - bytes) return false;
    if (frames.empty()) last_progress_us = now;
    frames.push_back({seq, size, captured}); bytes += size; last_encoded = seq; ++encoded;
    return true;
  }
  bool sent(uint32_t seq, uint64_t now) {
    for (auto& frame : frames) {
      if (frame.sent) continue;
      if (frame.sequence != seq) return false;
      frame.sent = true; frame.sent_us = now; return true;
    }
    return false;
  }
  bool ack(uint32_t seq, uint64_t now) {
    if (frames.empty() || !frames.front().sent || frames.front().sequence != seq) return false;
    const auto frame = frames.front();
    const double rtt = double(now - std::min(now, frame.sent_us));
    ack_rtt_us = acknowledged ? ack_rtt_us * 0.875 + rtt * 0.125 : rtt;
    window = std::clamp(unsigned(std::ceil(ack_rtt_us / 16666.667)) + 1, 2u, 8u);
    // Sample continuous demand only: idle gaps and tiny updates are not capacity evidence.
    if (previous_sent_us && frame.sent_us - previous_sent_us > 3000000 / frame_rate) {
      sample_start_us = sample_bytes = sample_acks = 0;
    }
    if (!sample_start_us) sample_start_us = frame.sent_us;
    previous_sent_us = frame.sent_us;
    sample_bytes += frame.bytes; ++sample_acks;
    bytes -= frame.bytes; frames.pop_front(); ++acknowledged; last_progress_us = now;
    update(now);
    return true;
  }
  void update(uint64_t now) {
    const bool busy = sample_start_us && sample_acks >= 8 && sample_bytes >= 65536;
    const uint64_t interval = sample_start_us ? now - std::min(now, sample_start_us) : 0;
    if (busy && interval >= 500000) goodput_bps = double(sample_bytes) * 8000000.0 / interval;
    // The cap is not measured throughput, and smoothed RTT includes queueing delay.
    if (frames.size() >= 2 && bytes >= std::min<uint64_t>(target_bitrate / 80, 65536) &&
        oldestAge(now) >= pause_age_us * 4 / 5 &&
        now - last_decrease_us >= 500000) {
      uint64_t next = target_bitrate * 3 / 4;
      if (busy && interval >= 500000) next = std::min(next, uint64_t(goodput_bps * 0.9));
      target_bitrate = std::max<uint64_t>(min_bitrate, next); last_decrease_us = now;
      last_increase_us = now;
    } else if (busy && interval >= 1000000 && oldestAge(now) < 100000 &&
               now - last_increase_us >= 1000000 && now - last_decrease_us >= 2000000) {
      // CRF can emit far below its cap; prompt ACKs of sustained demand permit a probe.
      target_bitrate = std::min<uint64_t>(max_bitrate, target_bitrate + target_bitrate / 10);
      last_increase_us = now;
    }
    if (interval >= 1000000) { sample_start_us = now; sample_bytes = sample_acks = 0; }
  }
};
}  // namespace relay
