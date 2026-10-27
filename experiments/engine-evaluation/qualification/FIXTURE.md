# Native workload fixture

Run `python3 qualification/fixture.py` in the X11 container. Requires Tk and Pillow.
The borderless root canvas is exactly 1280 by 720 at screen origin (0,0).
No original benchmark or engine file is changed.

Write `/tmp/bench-mode` atomically with `<case> <nonce>`, `<case> fps <nonce>`,
or `<case> freeze <nonce>`. A new nonce repeats the command. `freeze fps`
retains frame markers for fidelity capture. Invalid cases are ignored.

Cases:

- `idle`: unchanged dense monochrome text at 9–16 pt and colored text. The original
  quality ROI (24,105)–(1096,330) is retained.
- `scroll`: roughly full-screen dense document scrolling seven pixels per update,
  with monotonically changing document row numbers.
- `window`: actual separate X11 Toplevel moving over the static text page. Its
  420 by 160 rectangle remains above y=529, clear of latency and frame probes.
- `video`: twelve deterministic precomputed full-frame textured RGB images,
  cycling at 30 Hz. This is explicitly synthetic video, not natural footage or
  recorded game content. A fixed probe strip overlays y=532–600.
- `mixed`: static dense text above 28 animated colored rectangles across the lower
  area. Probes overlay animation.

All dynamic cases target 30 submitted updates per second. Idle with `fps` enabled
updates only the markers at 30 Hz; record that instrumentation overhead. Idle
without `fps`, and all frozen cases, leave pixels unchanged until input/commands.
Twelve Tk image buffers occupy approximately 44 MiB; generation happens once
before the benchmark starts. No per-frame synthetic image generation or decode.
Producer CPU still needs independent measurement; lower CPU than the streamer is
an objective, not an established result.

`/tmp/bench-status.json` is replaced atomically and contains `mode`, `flash`,
`toggles`, `frame`, `time_ns` (monotonic publication time), canvas-root `x`,`y`,
`fps_marker`, `frozen`, `producer_hz` (target 30), `submitted_updates`.
Window mode also publishes `window_geometry`; the Toplevel is raised after every
position update so the fullscreen root cannot cover it after focus or flash input.
The cumulative frame counter increments only when a cadence update is submitted
to Tk, including idle marker updates. Command redraws and input flash changes do
not increment it. This measures producer submissions, not X compositor or decoded
receiver presentation. Actual producer rate is the frame delta over time delta.

F8 or clicking the square toggles flash. Its sample point remains (x+1050,y+565).
Frame markers have fourteen cells, each 8 by 12 pixels: black/white sentinels then
twelve little-endian counter bits modulo 4096. Origins are (x+24,y+540) and
(x+1144,y+700). Match both markers to detect top/bottom delivery disagreement;
agreement cannot prove absence of all tearing or partial updates.

`python3 qualification/fixture.py --self-check` checks command parsing, marker
wrap and deterministic/distinct synthetic frames. A real X11 run must additionally
verify window movement, probe visibility, actual cadence and resource overhead.
