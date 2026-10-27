# Live CRF/VBV probe

This standalone probe needs no X11 display. It uses the installed libavcodec
`libx264` encoder with the capture engine's CRF 10, ultrafast, zerolatency,
two-thread, no-B-frame and no-lookahead settings. One encoder stays open for
720 deterministic 1280x720 YUV420 frames at 60 fps. Its live `rc_max_rate` and
`rc_buffer_size` fields change from 8 Mbit/s / 2 Mbit to 2 Mbit/s / 0.5 Mbit
and back. It never sets `bit_rate`.

Each four-second phase replays the same high-entropy frame sequence. The first
second of each phase settles the VBV; the remaining three seconds supply byte
counts. Duration comes from frame timestamps, not elapsed encoding time.
The probe checks a substantial downshift and recovery with broad bounds, not
exact CBR or a per-packet cap. Every packet also passes through the H.264
decoder; decoding must produce all 720 frames at the expected dimensions with
no decoder error flags. JSON goes to stdout; codec logs and failures go to stderr.

Run against the actual runtime image (example container name `native-rate-probe`):

```sh
docker run -d --name native-rate-probe --entrypoint sleep native-stream-lab:final2 infinity
docker cp native-stream-lab/probes/rate-control.cpp native-rate-probe:/tmp/rate-control.cpp
docker exec native-rate-probe sh -c 'g++ -O2 -std=c++17 -Wall -Wextra -Wpedantic /tmp/rate-control.cpp -o /tmp/rate-control $(pkg-config --cflags --libs libavcodec libavutil)'
docker exec native-rate-probe /tmp/rate-control
docker stop native-rate-probe
```

An existing container can be used for `docker cp` and `docker exec` after its
performance workload finishes. A passing run establishes effective live VBV
changes in that installed codec version under a demanding synthetic workload.
It does not establish display quality, transport latency, wall-clock throughput,
or independent sensitivity to each VBV field (both fields change together).
