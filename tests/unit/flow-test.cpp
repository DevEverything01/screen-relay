#include "core/flow.hpp"
#include <cassert>
#include <iostream>
#include <utility>

int main() {
  using relay::FlowControl;
  FlowControl f;
  assert(f.window == 1 && f.target_bitrate == 8000000);
  assert(!f.ack(1, 1));
  assert(!f.enqueue(2, 1, 10, 10));
  assert(!f.enqueue(1, 0, 10, 10));
  assert(!f.enqueue(1, FlowControl::max_bytes + 1, 10, 10));
  assert(f.enqueue(1, 100, 10, 10));
  assert(!f.ack(1, 20)); // Encoded but unsent is never credit.
  assert(f.sent(1, 20));
  assert(!f.ack(2, 30));
  assert(f.ack(1, 100020));
  assert(f.window == 7 && f.bytes == 0 && f.acknowledged == 1);
  assert(!f.ack(1, 100021));
  for (uint32_t seq = 2; seq < 10; ++seq) assert(f.enqueue(seq, 100, 100030, 100030));
  assert(!f.enqueue(10, 100, 100030, 100030));
  assert(f.sent(2, 100040));
  assert(!f.sent(4, 100040));
  assert(!f.ack(3, 100050));
  assert(f.frames.size() == 8 && f.bytes == 800);
  assert(!f.paused(350029) && f.paused(350030));
  assert(!f.timedOut(3100029) && f.timedOut(3100030));
  assert(f.ack(2, 400000));
  assert(!f.timedOut(3100029) && f.timedOut(3100030)); // Trickle ACKs cannot retain an old tail.

  FlowControl cap;
  assert(cap.enqueue(1, FlowControl::max_bytes, 1, 1));
  assert(cap.paused(1));
  assert(!cap.enqueue(2, 1, 1, 1));
  assert(cap.sent(1, 2) && cap.ack(1, 3));
  assert(cap.bytes == 0 && cap.enqueue(2, 1, 4, 4));

  FlowControl congested;
  assert(congested.enqueue(1, 100000, 1, 1));
  assert(congested.enqueue(2, 100000, 1, 1));
  congested.update(500001);
  assert(congested.target_bitrate == 6000000);
  congested.update(500002);
  assert(congested.target_bitrate == 6000000); // Downshift hysteresis.
  for (uint64_t now = 1000001; now < 10000000; now += 500000) congested.update(now);
  assert(congested.target_bitrate == 1000000);

  FlowControl small;
  assert(small.enqueue(1, 100, 1, 1) && small.enqueue(2, 100, 1, 1));
  small.update(1000000);
  assert(small.target_bitrate == 8000000); // Tiny updates are not a bandwidth estimate.

  FlowControl idle;
  idle.update(900000000);
  assert(idle.target_bitrate == 8000000);
  for (uint32_t seq = 1; seq <= 20; ++seq) {
    const uint64_t now = uint64_t(seq) * 1000000;
    assert(idle.enqueue(seq, 200, now, now));
    assert(idle.sent(seq, now));
    assert(idle.ack(seq, now + 10000));
  }
  assert(idle.target_bitrate == 8000000);

  FlowControl recovery;
  for (uint32_t seq = 1; seq <= 180; ++seq) {
    const uint64_t now = uint64_t(seq) * 16667;
    assert(recovery.enqueue(seq, 20000, now, now));
    assert(recovery.sent(seq, now));
    assert(recovery.ack(seq, now + 5000));
  }
  assert(recovery.target_bitrate > 8000000 && recovery.target_bitrate <= 10648000);
  assert(recovery.window == 2);

  // ACKs arrive after 55ms while capture continues, matching an uncongested 50ms path.
  auto demand = [](FlowControl& flow, uint32_t count, size_t size, uint64_t spacing) {
    std::deque<std::pair<uint32_t, uint64_t>> pending;
    for (uint32_t seq = 1; seq <= count; ++seq) {
      const uint64_t now = uint64_t(seq) * spacing;
      while (!pending.empty() && pending.front().second <= now) {
        assert(flow.ack(pending.front().first, pending.front().second));
        pending.pop_front();
      }
      assert(flow.enqueue(seq, size, now, now) && flow.sent(seq, now));
      pending.emplace_back(seq, now + 55000);
    }
    for (const auto& ack : pending) assert(flow.ack(ack.first, ack.second));
  };
  FlowControl cappedQuality;
  cappedQuality.target_bitrate = 8800000;
  demand(cappedQuality, 180, 18000, 33333); // 4.32 Mbit/s is below 60% of the cap.
  assert(cappedQuality.target_bitrate > 8800000);

  FlowControl bounded;
  demand(bounded, 1800, 18000, 33333);
  assert(bounded.target_bitrate == 40000000);
  assert(bounded.enqueue(1801, 1000000, 61000000, 61000000));
  assert(bounded.enqueue(1802, 1000000, 61000000, 61000000));
  bounded.update(61500000);
  assert(bounded.target_bitrate < 40000000); // Probing cannot disable congestion backoff.

  FlowControl tinyContinuous;
  demand(tinyContinuous, 180, 200, 33333);
  assert(tinyContinuous.target_bitrate == 8000000);
  FlowControl discontinuous;
  demand(discontinuous, 60, 100000, 100000);
  assert(discontinuous.target_bitrate == 8000000);

  for (const uint64_t target : {8000000ULL, 17118698ULL}) {
    FlowControl queued;
    queued.target_bitrate = target;
    assert(queued.enqueue(1, 100000, 1, 1) && queued.sent(1, 1));
    assert(queued.ack(1, 300001)); // Actual slow ACK raises the smoothed RTT.
    assert(queued.enqueue(2, 90000, 300002, 300002));
    assert(queued.enqueue(3, 90000, 300002, 300002));
    queued.update(550002); // 250ms backlog must back off despite RTT/cap inflation.
    assert(queued.target_bitrate < target);
  }
  std::cout << "flow policy checks passed\n";
}
