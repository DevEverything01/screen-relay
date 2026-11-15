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
  static constexpr uint64_t base_window_us = 10000000;
  enum class Pressure { clear, building, congested, paused };
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
  struct DepthSample { uint64_t time_us, depth_us; };
  std::deque<DepthSample> depth_samples;
  std::deque<DepthSample> peak_samples, standing_samples, network_base_samples, network_standing_samples;
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
  /** Reads the viewer wait from an acknowledgement payload: 4 bytes of big-endian microseconds, or zero when absent or malformed. */
  static uint64_t ackWaitUs(const uint8_t* payload, size_t size) {
    return size == 4 ? (uint64_t(payload[0]) << 24) | (uint64_t(payload[1]) << 16) | (uint64_t(payload[2]) << 8) | payload[3] : 0;
  }
  uint64_t oldestAge(uint64_t now) const {
    return frames.empty() ? 0 : now - std::min(now, frames.front().captured_us);
  }
  uint64_t frameIntervalUs() const { return (1000000ULL + frame_rate - 1) / frame_rate; }
  uint64_t serviceDeadlineUs(uint64_t now, uint64_t pending) const {
    const uint64_t next = now + (frames.empty() ? idle_sample_interval_us : sample_interval_us);
    return pending ? std::min(pending, next) : next;
  }
  /** Minimum capture-to-acknowledgement time over recent frames; zero when behind TCP statistics or unmeasured. */
  uint64_t baseDepthUs() const {
    return transport_available || depth_samples.empty() ? 0 : depth_samples.front().depth_us;
  }
  /** Largest capture-to-acknowledgement time seen recently; sizes the frame window. */
  uint64_t peakDepthUs() const { return peak_samples.empty() ? 0 : peak_samples.front().depth_us; }
  /** Span over which the smallest queueing delay is taken: one base round trip, at least two frame intervals. */
  uint64_t standingWindowUs() const { return std::max(baseDepthUs(), 2 * frameIntervalUs()); }
  /** Oldest-frame age at which capture stops: base depth plus two frame intervals of standing queue, or the TCP round trip bound. */
  uint64_t admissionAgeUs() const {
    if (transport_available) {
      if (!transport.min_rtt_us) return pause_age_us;
      return std::min(timeout_us, 2 * std::min(transport.min_rtt_us, timeout_us) + 2 * frameIntervalUs());
    }
    return depth_samples.empty() ? pause_age_us : timeout_us;
  }
  /** Smallest network depth over recent frames (capture-to-acknowledgement minus viewer wait); zero when behind TCP statistics or unmeasured. */
  uint64_t networkBaseDepthUs() const {
    return transport_available || network_base_samples.empty() ? 0 : network_base_samples.front().depth_us;
  }
  uint64_t standingAbove(uint64_t now, const std::deque<DepthSample>& samples, uint64_t base) const {
    if (frames.empty()) return 0;
    uint64_t lowest = oldestAge(now);
    for (const auto& sample : samples) {
      if (now - std::min(now, sample.time_us) < standingWindowUs()) { lowest = std::min(lowest, sample.depth_us); break; }
    }
    return lowest > base ? lowest - base : 0;
  }
  /** Queueing delay present for the whole recent window, wherever it sits: the smallest oldest-frame age or acknowledgement time, above the base depth. */
  uint64_t standingQueueUs(uint64_t now) const { return standingAbove(now, standing_samples, baseDepthUs()); }
  /** The part of the standing queue that is in the network, with the time frames wait inside the viewer taken out. */
  uint64_t standingNetworkQueueUs(uint64_t now) const {
    return standingAbove(now, network_standing_samples, networkBaseDepthUs());
  }
  /** Standing queue at which capture stops; the other states sit at a half and a quarter of it. */
  uint64_t pauseQueueUs() const {
    return depth_samples.empty() ? pause_age_us : baseDepthUs() + 2 * frameIntervalUs();
  }
  Pressure levelOf(uint64_t queue) const {
    const uint64_t limit = pauseQueueUs();
    if (queue >= limit) return Pressure::paused;
    if (queue >= limit / 2) return Pressure::congested;
    return queue >= limit / 4 ? Pressure::building : Pressure::clear;
  }
  /** Capture admission: the total standing queue, viewer wait included, against its limit. */
  Pressure pressure(uint64_t now) const {
    if (transport_available) return oldestAge(now) >= admissionAgeUs() ? Pressure::paused : Pressure::clear;
    return levelOf(standingQueueUs(now));
  }
  /** Bitrate decisions: the standing network queue against the same limit. */
  Pressure networkPressure(uint64_t now) const {
    return levelOf(standingNetworkQueueUs(now));
  }
  unsigned frameLimit() const {
    const uint64_t count = (timeout_us * frame_rate + 999999) / 1000000;
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
    return bytes >= max_bytes || pressure(now) == Pressure::paused ||
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
  /** Credits the oldest frame. The viewer's wait is untrusted: one longer than the frame's whole capture-to-acknowledgement time counts as zero. */
  bool ack(uint32_t seq, uint64_t now, uint64_t viewer_wait_us = 0) {
    if (frames.empty() || !frames.front().sent || frames.front().sequence != seq) return false;
    const auto frame = frames.front();
    const double rtt = double(now - std::min(now, frame.sent_us));
    ack_rtt_us = acknowledged ? ack_rtt_us * 0.875 + rtt * 0.125 : rtt;
    recordDepth(frame.captured_us, now, viewer_wait_us);
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
  static void track(std::deque<DepthSample>& samples, bool smallest, uint64_t now, uint64_t depth, uint64_t window) {
    while (!samples.empty() && now - std::min(now, samples.front().time_us) >= window) samples.pop_front();
    while (!samples.empty() && (smallest ? samples.back().depth_us >= depth : samples.back().depth_us <= depth)) {
      samples.pop_back();
    }
    samples.push_back({now, depth});
  }
  void recordDepth(uint64_t captured, uint64_t now, uint64_t viewer_wait_us) {
    const uint64_t depth = now - std::min(now, captured);
    const uint64_t network = depth - (viewer_wait_us <= depth ? viewer_wait_us : 0);
    track(network_base_samples, true, now, network, base_window_us);
    track(network_standing_samples, true, now, network, standingWindowUs());
    track(depth_samples, true, now, depth, base_window_us);
    track(peak_samples, false, now, depth, base_window_us);
    track(standing_samples, true, now, depth, standingWindowUs());
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
      window = acknowledged ? unsigned(std::clamp(
          std::ceil(double(peakDepthUs()) * frame_rate / 1000000.0) + 2.0, 2.0, double(frameLimit()))) : 1;
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
    if (!frames.empty()) {
      track(standing_samples, true, now, oldestAge(now), standingWindowUs());
      track(network_standing_samples, true, now, oldestAge(now), standingWindowUs());
    }
    const bool busy = sample_start_us && sample_acks >= 8 && sample_bytes >= 65536;
    const uint64_t interval = sample_start_us ? now - std::min(now, sample_start_us) : 0;
    if (busy && interval >= 500000) goodput_bps = double(sample_bytes) * 8000000.0 / interval;
    const Pressure state = networkPressure(now);
    if (frames.size() >= 2 && bytes >= std::min<uint64_t>(target_bitrate / 80, 65536) &&
        state >= Pressure::congested &&
        now - last_decrease_us >= 500000) {
      uint64_t next = target_bitrate * 3 / 4;
      if (busy && interval >= 500000) next = std::min(next, uint64_t(goodput_bps * 0.9));
      target_bitrate = std::max<uint64_t>(min_bitrate, next); last_decrease_us = now;
      last_increase_us = now;
    } else if (busy && interval >= 1000000 && state == Pressure::clear &&
               now - last_increase_us >= 1000000 && now - last_decrease_us >= 2000000) {
      // CRF can emit far below its cap; prompt ACKs of sustained demand permit a probe.
      target_bitrate = std::min<uint64_t>(max_bitrate, target_bitrate + target_bitrate / 10);
      last_increase_us = now;
    }
    if (interval >= 1000000) { sample_start_us = now; sample_bytes = sample_acks = 0; }
  }
};
}  // namespace relay
