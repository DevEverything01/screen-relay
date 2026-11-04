#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <deque>

namespace relay {
// All times are server steady-clock microseconds; service thread owns this state.
struct FlowControl {
  static constexpr size_t max_bytes = 8 * 1024 * 1024;
  static constexpr uint64_t pause_age_us = 250000;
  static constexpr uint64_t timeout_us = 3000000;
  static constexpr size_t max_frames = timeout_us * 120 / 1000000;
  static constexpr unsigned legacy_max_frames = 8;
  static constexpr uint64_t delivery_window_us = 1000000;
  static constexpr uint64_t bitrate_smoothing_us = 500000;
  static constexpr uint64_t sample_interval_us = 10000, idle_sample_interval_us = 100000;
  struct TransportSample {
    uint64_t min_rtt_us = 0, rtt_us = 0, delivery_rate_bps = 0;
    uint64_t notsent_bytes = 0, bytes_acked = 0, application_queued_bytes = 0;
    uint32_t snd_cwnd = 0, total_retrans = 0;
    bool app_limited = false;
  };
  struct DeliverySample { uint64_t time_us, rate_bps; };
  TransportSample transport;
  bool transport_available = false;
  uint64_t delivery_rate_bps = 0, last_transport_update_us = 0;
  std::deque<DeliverySample> delivery_samples;
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
    min_bitrate = minimum; initial_bitrate = initial; max_bitrate = maximum; target_bitrate = initial; frame_rate = std::max(1u, fps);
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
  uint64_t frameIntervalUs() const { return (1000000ULL + frame_rate - 1) / frame_rate; }
  uint64_t serviceDeadlineUs(uint64_t now, uint64_t pending) const {
    const uint64_t next = now + (frames.empty() ? idle_sample_interval_us : sample_interval_us);
    return pending ? std::min(pending, next) : next;
  }
  uint64_t admissionAgeUs() const {
    if (!transport_available || !transport.min_rtt_us) return pause_age_us;
    return std::min(timeout_us, 2 * std::min(transport.min_rtt_us, timeout_us) + 2 * frameIntervalUs());
  }
  unsigned frameLimit() const {
    const uint64_t count = transport_available ? (timeout_us * frame_rate + 999999) / 1000000 :
        (uint64_t(legacy_max_frames) * frame_rate + 59) / 60;
    return unsigned(std::clamp<uint64_t>(count, 2, max_frames));
  }
  uint64_t notsentLowat() const {
    const uint64_t denominator = uint64_t(frame_rate) * 4;
    return std::max<uint64_t>(16 * 1024, (target_bitrate + denominator - 1) / denominator);
  }
  uint64_t senderQueueUs() const {
    double queued = double(transport.notsent_bytes) + double(transport.application_queued_bytes);
    for (const auto& frame : frames) if (!frame.sent) queued += double(frame.bytes);
    const uint64_t rate = delivery_rate_bps ? delivery_rate_bps : std::max<uint64_t>(1, target_bitrate);
    return uint64_t(std::ceil(queued * 8000000.0 / double(rate)));
  }
  static uint64_t headroomBitrate(uint64_t target, uint64_t maximum, uint64_t elapsed_us,
      uint64_t queued_us, uint64_t interval_us, uint64_t oldest_us, uint64_t age_limit_us) {
    if (queued_us >= (interval_us + 1) / 2 || oldest_us >= age_limit_us) return target;
    return uint64_t(std::round(std::min(double(maximum), double(target) *
        std::pow(1.25, double(elapsed_us) / 1000000.0))));
  }
  uint64_t frameBitrate() const {
    if (!transport_available) return target_bitrate;
    const uint64_t interval = frameIntervalUs();
    const uint64_t queued = std::clamp(senderQueueUs(), interval, 3 * interval);
    return uint64_t(double(target_bitrate) *
        (1.0 - 0.75 * double(queued - interval) / double(2 * interval)));
  }
  bool paused(uint64_t now) const {
    return bytes >= max_bytes || oldestAge(now) >= admissionAgeUs() ||
        (transport_available && (frames.size() >= window || senderQueueUs() >= 3 * frameIntervalUs()));
  }
  bool timedOut(uint64_t now) const {
    return !frames.empty() && (now - std::min(now, last_progress_us) >= timeout_us ||
                               oldestAge(now) >= timeout_us);
  }
  bool enqueue(uint32_t seq, size_t size, uint64_t captured, uint64_t now) {
    if (!seq || seq != last_encoded + 1 || frames.size() >= frameLimit() ||
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
    // Sample continuous demand only: idle gaps and tiny updates are not capacity evidence.
    if (!transport_available) {
      if (previous_sent_us && frame.sent_us - previous_sent_us > 3000000 / frame_rate) {
        sample_start_us = sample_bytes = sample_acks = 0;
      }
      if (!sample_start_us) sample_start_us = frame.sent_us;
      previous_sent_us = frame.sent_us;
      sample_bytes += frame.bytes; ++sample_acks;
    }
    bytes -= frame.bytes; frames.pop_front(); ++acknowledged; last_progress_us = now;
    update(now);
    return true;
  }
  void expireDelivery(uint64_t now) {
    while (!delivery_samples.empty() &&
           now - std::min(now, delivery_samples.front().time_us) >= delivery_window_us) {
      delivery_samples.pop_front();
    }
    delivery_rate_bps = delivery_samples.empty() ? 0 : delivery_samples.front().rate_bps;
  }
  void sampleTransport(const TransportSample& sample, uint64_t now) {
    const bool progress = !transport_available || sample.bytes_acked > transport.bytes_acked;
    if (!transport_available) last_transport_update_us = now;
    transport = sample; transport_available = true;
    expireDelivery(now);
    if (progress && !sample.app_limited && sample.delivery_rate_bps) {
      if (delivery_samples.empty()) last_transport_update_us = now;
      while (!delivery_samples.empty() && delivery_samples.back().rate_bps <= sample.delivery_rate_bps) {
        delivery_samples.pop_back();
      }
      delivery_samples.push_back({now, sample.delivery_rate_bps});
    }
    update(now);
  }
  void clearTransport() {
    if (!transport_available) return;
    transport = {}; transport_available = false; delivery_rate_bps = last_transport_update_us = 0;
    delivery_samples.clear();
    sample_start_us = sample_bytes = sample_acks = previous_sent_us = 0;
    goodput_bps = 0;
    updateWindow();
  }
  void updateWindow() {
    if (transport_available) {
      const uint64_t count = transport.min_rtt_us ?
          (2 * std::min(transport.min_rtt_us, timeout_us) * frame_rate + 999999) / 1000000 + 2 :
          (pause_age_us * frame_rate + 999999) / 1000000;
      window = unsigned(std::clamp<uint64_t>(count, 2, frameLimit()));
    } else {
      window = acknowledged ? unsigned(std::clamp(std::ceil(ack_rtt_us * frame_rate / 1000000.0) + 1,
          2.0, double(frameLimit()))) : 1;
    }
  }
  void update(uint64_t now) {
    updateWindow();
    if (transport_available) {
      expireDelivery(now);
      const uint64_t elapsed = now - std::min(now, last_transport_update_us);
      last_transport_update_us = now;
      const uint64_t probe = transport.app_limited || !delivery_rate_bps ?
          headroomBitrate(target_bitrate, max_bitrate, elapsed, senderQueueUs(), frameIntervalUs(),
              oldestAge(now), admissionAgeUs()) : 0;
      if (delivery_rate_bps) {
        const double desired = std::clamp(double(delivery_rate_bps) * 0.85,
            double(min_bitrate), double(max_bitrate));
        if (!transport.app_limited || desired > double(target_bitrate)) {
          const double weight = 1.0 - std::exp(-double(elapsed) / double(bitrate_smoothing_us));
          target_bitrate = std::clamp<uint64_t>(uint64_t(std::round(double(target_bitrate) +
              (desired - double(target_bitrate)) * weight)), min_bitrate, max_bitrate);
        }
      }
      target_bitrate = std::max(target_bitrate, probe);
      return;
    }
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
