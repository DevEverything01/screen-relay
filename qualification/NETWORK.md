# Network profiles

The loopback TCP relay is protocol-agnostic and carries HTTP and WebSocket traffic for each engine. `local` connects directly. `delay` adds 25 ms in each direction (approximately 50 ms round trip). `bandwidth` adds the same delay and shapes aggregate upload to 2 Mbps and aggregate download to 8 Mbps across connections. Each connection has independent full-duplex queues capped at 256 KiB per direction, with at most 32 connections; socket and operating-system buffers are additional. A slow receiver applies TCP backpressure. `stats()` reports forwarded bytes and peak application queue size, and `close()` aborts active connections.

This is a user-space approximation, not a physical WAN or kernel netem. Scheduling and socket buffers affect measurements; it does not simulate packet loss, jitter, congestion, or retransmissions. Rate pacing permits an initial chunk of up to 16 KiB before its transmission time elapses. The latency is applied to arrival times, not repeatedly to every chunk. TCP still has its normal ordering and head-of-line behavior. Stop-and-wait protocols, including the native WebCodecs path, can be especially sensitive to round-trip delay.

Run `node --test native-stream-lab/qualification/network-test.mjs` for loopback checks. Avoid concurrent performance workloads when measuring rates.
