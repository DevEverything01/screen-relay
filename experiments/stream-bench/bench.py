"""Headless stream-bench run: builds the engine from /src, streams four workloads to an
ACK-immediately WebSocket client, and prints one JSON object of CPU, RAM, FPS and quality."""
import asyncio
import json
import os
import shutil
import struct
import subprocess
import sys
import threading
import time
import urllib.request

import numpy as np
import websockets

W, H = 1280, 720
PORT = 18080
DISPLAY = ":99"
TICK = os.sysconf("SC_CLK_TCK")
WORKLOAD = "/bench/workload"
WORK = "/tmp/run"
PHASES = [("typing", 30), ("scroll", 60), ("motion", 60)]
PHASE_ID = {"typing": 1, "scroll": 2, "motion": 3}
RECTS = {"typing": (320, 300, 640, 48), "scroll": (240, 60, 960, 620), "motion": (0, 0, W, H)}
SAMPLES = 24

result = {"worst_cases": []}


def emit(code=0):
    print(json.dumps(result, sort_keys=True))
    sys.exit(code)


def fail_gate(key, message):
    result[key] = 0
    result["worst_cases"].append(message)
    emit()


def cpu_ticks(pid):
    with open(f"/proc/{pid}/stat") as f:
        fields = f.read().rsplit(")", 1)[1].split()
    return int(fields[11]) + int(fields[12])


def status_kib(pid, key):
    with open(f"/proc/{pid}/status") as f:
        for line in f:
            if line.startswith(key + ":"):
                return int(line.split()[1])
    return 0


def build():
    shutil.copytree("/src", "/tmp/src", ignore=shutil.ignore_patterns(".git", "node_modules", "experiments", "build", "native-stream"))
    started = time.monotonic()
    made = subprocess.run(["make", "-C", "/tmp/src", "-j2", "native-stream"], capture_output=True, text=True)
    result["build_seconds"] = round(time.monotonic() - started, 1)
    if made.returncode:
        result["worst_cases"].append("build failed: " + made.stderr[-1500:])
        fail_gate("build_ok", "build failed")
    result["build_ok"] = 1
    tests = subprocess.run(["make", "-C", "/tmp/src", "-j2", "test"], capture_output=True, text=True)
    result["tests_ok"] = int(tests.returncode == 0)
    if tests.returncode:
        result["worst_cases"].append("make test failed: " + (tests.stdout + tests.stderr)[-1500:])


def wait_for(check, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except Exception:
            pass
        time.sleep(0.05)
    raise RuntimeError(message)


class Client:
    """Receives NSL1 frames, appends H.264 payloads to a file and ACKs each frame at once."""

    def __init__(self, path):
        self.out = open(path, "wb")
        self.frames = []
        self.cursor_messages = 0
        self.error = None
        self.stop = False
        self.thread = threading.Thread(target=lambda: asyncio.run(self.run()), daemon=True)

    async def run(self):
        try:
            async with websockets.connect(
                f"ws://127.0.0.1:{PORT}/stream", subprotocols=["nsl1"],
                origin=f"http://127.0.0.1:{PORT}", max_size=16 * 1024 * 1024, compression=None,
            ) as ws:
                while not self.stop:
                    try:
                        message = await asyncio.wait_for(ws.recv(), 0.2)
                    except asyncio.TimeoutError:
                        continue
                    arrived = time.monotonic()
                    magic, version, kind, flags, gen, seq, length = struct.unpack(">4sBBHIII", message[:20])
                    if magic != b"NSL1" or version != 1 or length != len(message) - 20:
                        raise RuntimeError("bad envelope")
                    if kind == 6:
                        self.cursor_messages += 1
                        continue
                    if kind != 1:
                        raise RuntimeError(f"unexpected message type {kind}")
                    payload = message[32:]
                    self.out.write(payload)
                    self.frames.append((arrived, seq, flags & 1, len(payload)))
                    await ws.send(struct.pack(">4sBBHIII", b"NSL1", 1, 2, 0, gen, seq, 0))
        except Exception as error:
            if not self.stop:
                self.error = repr(error)
        finally:
            self.out.flush()


class Sampler:
    """Samples engine RSS every 50 ms."""

    def __init__(self, pid):
        self.pid, self.peak_rss, self.peak_anon, self.stop = pid, 0, 0, False
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while not self.stop:
            try:
                self.peak_rss = max(self.peak_rss, status_kib(self.pid, "VmRSS"))
                self.peak_anon = max(self.peak_anon, status_kib(self.pid, "RssAnon"))
            except OSError:
                return
            time.sleep(0.05)


def run_workload(*args):
    return subprocess.run([WORKLOAD, *args], env={**os.environ, "DISPLAY": DISPLAY}, capture_output=True, text=True, check=True)


def psnr(a, b):
    mse = np.mean((a.astype(np.float32) - b.astype(np.float32)) ** 2)
    return 99.0 if mse == 0 else float(10 * np.log10(255.0 ** 2 / mse))


def read_barcode(frame, rect):
    x, y = rect[0], rect[1]
    value = 0
    for bit in range(16):
        block = frame[y + 4:y + 8, x + bit * 12 + 4:x + bit * 12 + 8].astype(np.float32).mean()
        value = (value << 1) | (1 if block < 128 else 0)
    return value >> 14, value & 0x3FFF


def references(requests):
    path = f"{WORK}/refs.raw"
    args = []
    for phase, index in requests:
        args += [phase, str(index)]
    subprocess.run([WORKLOAD, "--dump", path, *args], check=True)
    raw = np.fromfile(path, dtype=np.uint8).reshape(len(requests), H, W, 4)
    return raw[..., [2, 1, 0]]


def main():
    os.makedirs(WORK, exist_ok=True)
    build()
    xvfb = subprocess.Popen(["Xvfb", DISPLAY, "-screen", "0", f"{W}x{H}x24", "-nolisten", "tcp", "-noreset"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait_for(lambda: os.path.exists("/tmp/.X11-unix/X99"), 10, "Xvfb did not start")
    run_workload("background")
    engine_log = open(f"{WORK}/engine.log", "w")
    engine = subprocess.Popen(["/tmp/src/native-stream", "--insecure-local", "--port", str(PORT), "--viewer-dir", "/tmp/src/viewer"],
                              env={**os.environ, "DISPLAY": DISPLAY}, stdout=engine_log, stderr=subprocess.STDOUT)
    try:
        wait_for(lambda: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/capabilities", timeout=1).status == 200, 15, "engine did not start")
    except RuntimeError as error:
        result["worst_cases"].append(open(f"{WORK}/engine.log").read()[-1500:])
        fail_gate("stream_ok", str(error))
    sampler = Sampler(engine.pid)
    sampler.thread.start()
    client = Client(f"{WORK}/stream.h264")
    client.thread.start()
    time.sleep(2.5)

    windows = {}

    def measure(name, seconds):
        start_t = time.monotonic()
        engine_start, xvfb_start = cpu_ticks(engine.pid), cpu_ticks(xvfb.pid)
        time.sleep(seconds)
        end_t = time.monotonic()
        windows[name] = (start_t, end_t)
        engine_pct = 100.0 * (cpu_ticks(engine.pid) - engine_start) / TICK / (end_t - start_t)
        xvfb_pct = 100.0 * (cpu_ticks(xvfb.pid) - xvfb_start) / TICK / (end_t - start_t)
        result[f"{name}_engine_cpu"] = round(engine_pct, 2)
        result[f"{name}_xvfb_cpu"] = round(xvfb_pct, 2)
        result[f"{name}_cpu"] = round(engine_pct + xvfb_pct, 2)

    measure("idle", 8)
    stamps = {}
    for name, hz in PHASES:
        run_workload("background")
        time.sleep(1.0)
        stamp_file = f"{WORK}/{name}.stamps"
        generator = subprocess.Popen([WORKLOAD, name, str(hz), "11", stamp_file], env={**os.environ, "DISPLAY": DISPLAY},
                                     stdout=subprocess.PIPE, text=True)
        time.sleep(2.0)
        measure(name, 8.0)
        generator.wait()
        stamps[name] = [float(line.split()[0]) for line in open(stamp_file)]
        time.sleep(0.5)
    run_workload("final")
    time.sleep(2.5)
    client.stop = True
    client.thread.join(5)
    sampler.stop = True
    result["engine_peak_rss_mib"] = round(max(sampler.peak_rss, status_kib(engine.pid, "VmHWM")) / 1024, 2)
    result["engine_peak_anon_mib"] = round(sampler.peak_anon / 1024, 2)
    result["xvfb_rss_mib"] = round(status_kib(xvfb.pid, "VmRSS") / 1024, 2)
    engine.terminate()
    engine.wait(5)
    engine_log.close()
    stage = {}
    for token in open(f"{WORK}/engine.log").read().split():
        key, _, value = token.partition("=")
        if value.isdigit():
            stage[key] = int(value)
    captures = max(stage.get("captures", 0), 1)
    for key in ("capture_ns", "convert_ns", "encode_ns"):
        if key in stage:
            result[f"stage_{key[:-3]}_ms_per_frame"] = round(stage[key] / captures / 1e6, 3)
    xvfb.terminate()
    if client.error:
        result["worst_cases"].append("client: " + client.error)
        result["worst_cases"].append(open(f"{WORK}/engine.log").read()[-1500:])
        fail_gate("stream_ok", "client error")
    result["stream_ok"] = 1

    frames = client.frames
    result["frames_received"] = len(frames)
    result["first_is_key"] = int(bool(frames) and frames[0][2] == 1)
    for name, (start_t, end_t) in windows.items():
        inside = [f for f in frames if start_t <= f[0] < end_t]
        result[f"{name}_fps"] = round(len(inside) / (end_t - start_t), 2)
        result[f"{name}_mbps"] = round(sum(f[3] for f in inside) * 8 / (end_t - start_t) / 1e6, 3)
        if name in stamps:
            produced = [t for t in stamps[name] if start_t <= t < end_t]
            result[f"{name}_producer_fps"] = round(len(produced) / (end_t - start_t), 2)
            result[f"{name}_delivery"] = round(result[f"{name}_fps"] / max(result[f"{name}_producer_fps"], 1e-9), 3)
    result["stream_cpu_pct"] = round(sum(result[f"{n}_cpu"] for n in ("idle", "typing", "scroll", "motion")), 2)
    result["active_cpu_pct"] = round(sum(result[f"{n}_cpu"] for n in PHASE_ID), 2)
    result["delivered_fps"] = round(sum(result[f"{n}_fps"] for n in PHASE_ID), 2)

    decoder = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-threads", "2", "-f", "h264", "-i", f"{WORK}/stream.h264",
                                "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    size = W * H * 3
    wanted = {}
    for name in PHASE_ID:
        start_t, end_t = windows[name]
        idx = [i for i, f in enumerate(frames) if start_t <= f[0] < end_t]
        step = max(1, len(idx) // SAMPLES)
        for i in idx[::step][:SAMPLES]:
            wanted[i] = name
    decoded = 0
    barcode_failures = {name: 0 for name in PHASE_ID}
    samples = []
    last = None
    while True:
        chunk = decoder.stdout.read(size)
        if len(chunk) < size:
            break
        frame = np.frombuffer(chunk, dtype=np.uint8).reshape(H, W, 3)
        if decoded < len(frames):
            arrived = frames[decoded][0]
            for name in PHASE_ID:
                start_t, end_t = windows[name]
                if start_t <= arrived < end_t:
                    phase, index = read_barcode(frame, RECTS[name])
                    if phase != PHASE_ID[name]:
                        barcode_failures[name] += 1
                    elif decoded in wanted:
                        x, y, w, h = RECTS[name]
                        samples.append((name, index, frame[y:y + h, x:x + w].copy()))
        last = frame
        decoded += 1
    errors = decoder.stderr.read().decode(errors="replace").strip()
    decoder.wait()
    result["frames_decoded"] = decoded
    result["decode_ok"] = int(decoded == len(frames) and not errors and decoder.returncode == 0)
    if errors:
        result["worst_cases"].append("decoder: " + errors[-800:])
    for name in PHASE_ID:
        result[f"{name}_barcode_failures"] = barcode_failures[name]
    if last is None:
        fail_gate("decode_ok", "no decoded frames")

    refs = references([(name, index) for name, index, _ in samples] + [("final", 0)])
    per_phase = {name: [] for name in PHASE_ID}
    for (name, index, crop), ref in zip(samples, refs[:-1]):
        x, y, w, h = RECTS[name]
        per_phase[name].append((psnr(crop, ref[y:y + h, x:x + w]), index))
    for name, values in per_phase.items():
        if not values:
            result[f"{name}_psnr"] = 0.0
            result["worst_cases"].append(f"{name}: no matched frames")
            continue
        scores = sorted(v for v, _ in values)
        result[f"{name}_psnr"] = round(float(np.median(scores)), 3)
        result[f"{name}_psnr_min"] = round(scores[0], 3)
        result[f"{name}_psnr_pairs"] = len(values)
        worst = min(values)
        if worst[0] < 30:
            result["worst_cases"].append(f"{name}: frame {worst[1]} PSNR {worst[0]:.2f} dB")
    result["settled_psnr"] = round(psnr(last, refs[-1]), 3)
    tx, ty, tw, th = 210, 38, 1060, 672
    result["settled_text_psnr"] = round(psnr(last[ty:ty + th, tx:tx + tw], refs[-1][ty:ty + th, tx:tx + tw]), 3)
    for name in PHASE_ID:
        if result.get(f"{name}_delivery", 1) < 0.95:
            result["worst_cases"].append(f"{name}: delivered {result[f'{name}_fps']} of {result[f'{name}_producer_fps']} produced fps")
    emit()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        result["worst_cases"].append("harness: " + repr(error))
        result.setdefault("stream_ok", 0)
        emit(1)
