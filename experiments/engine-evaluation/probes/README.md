# Single-frame decoder probe

Run from the repository root after other browser benchmarks finish:

```sh
rtk proxy node native-stream-lab/experiments/engine-evaluation/probes/decoder.mjs > /private/tmp/native-stream-decoder.json
```

Uses the existing benchmark Playwright installation and installed Chrome, headed with default launch settings. No new dependencies. A routed localhost document supplies a secure context without an external service.

The probe generates exactly one solid green frame `(32,192,64)`, encodes H264 Annex B, and flushes **only the encoder**. It requires exactly one key chunk containing SPS, PPS and an IDR NAL. A separate decoder receives exactly that one chunk with `optimizeForLatency: true`; no subsequent input or decoder flush can release buffered output. It waits up to two seconds, samples the decoded center pixel against the independent known color (20/channel tolerance), and closes frames and codecs. JSON records support probes, configs, timing, chunk/NAL metadata, pixel evidence and input/flush counts.

`pass` means this synthetic browser-produced IDR yielded correctly colored output without a second input or flush. `fail` includes a deadline miss or pixel mismatch; `inconclusive` means encoder output did not satisfy the single-IDR fixture contract. Unsupported APIs/configs produce `not_run`, never a simulated pass. Fail/error exits 1; inspect JSON status even on exit 0. The measured decode interval includes browser scheduling and pixel verification is reported separately from callback arrival timing.

This is a capability gate for single-frame ACK feasibility, not proof for the native server encoder, transport, actual hardware decoding, paint/presentation latency, sustained throughput, or all H264 profiles. Preference support does not identify the selected decoder implementation. Encoder flush time is fixture preparation, not streaming latency. Run against actual native IDR bytes before adopting single-frame ACK as a protocol guarantee.

API references: [WebCodecs specification](https://github.com/w3c/webcodecs/blob/main/index.src.html), [AVC registration](https://github.com/w3c/webcodecs/blob/main/avc_codec_registration.src.html).

Authoring gate: this exercises observable output from the actual browser codec boundary; it detects a decoder buffering its sole input until a later chunk/flush, or producing incorrect pixels. It adds no production seam and does not duplicate a server-stream integration test.
