"use strict";
const canvas = document.querySelector("#screen"),
  ctx = canvas.getContext("2d"),
  status = document.querySelector("#status");
const cursor = document.querySelector("#cursor"), cursorContext = cursor.getContext("2d");
let accessToken = '';
const trustedPage = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
{
  const fragmentToken = new URLSearchParams(location.hash.slice(1)).get('token');
  if (fragmentToken !== null) {
    history.replaceState(null, '', location.pathname + location.search);
    if (/^[0-9a-f]{64}$/.test(fragmentToken) && trustedPage) accessToken = document.querySelector('#access-token').value = fragmentToken;
  }
}
let cursorAvailable = false, cursorHotX = 0, cursorHotY = 0, pointerPosition;
function renderCursor() {
  canvas.style.cursor = cursorAvailable && ready ? "none" : "default";
  const r = canvas.getBoundingClientRect(), p = pointerPosition;
  cursor.hidden = !cursorAvailable || !ready || !p || p.pointerType === "touch" ||
    p.clientX < r.left || p.clientX >= r.right || p.clientY < r.top || p.clientY >= r.bottom;
  if (cursor.hidden) return;
  const sx = r.width / canvas.width, sy = r.height / canvas.height;
  cursor.style.width = `${cursor.width * sx}px`;
  cursor.style.height = `${cursor.height * sy}px`;
  cursor.style.left = `${p.clientX - cursorHotX * sx}px`;
  cursor.style.top = `${p.clientY - cursorHotY * sy}px`;
}
function receiveCursor(data) {
  const v = new DataView(data);
  if (data.byteLength < 28 || data.byteLength > 28 + 256 * 256 * 4 ||
      v.getUint16(6) || v.getUint32(12) || !generation || v.getUint32(8) !== generation) {
    throw new Error("Invalid cursor envelope");
  }
  const width = v.getUint16(20), height = v.getUint16(22),
    hotX = v.getUint16(24), hotY = v.getUint16(26);
  if (width > 256 || height > 256 || data.byteLength !== 28 + width * height * 4 ||
      (width && height ? hotX >= width || hotY >= height : width || height || hotX || hotY)) {
    throw new Error("Invalid cursor image");
  }
  cursorAvailable = width > 0;
  cursorHotX = hotX; cursorHotY = hotY;
  cursor.width = width || 1; cursor.height = height || 1;
  if (cursorAvailable) cursorContext.putImageData(new ImageData(new Uint8ClampedArray(data, 28), width, height), 0, 0);
  renderCursor();
}
const stats = window.nativeStats = {
  received: 0,
  drawn: 0,
  bytes: 0,
  decodeerrors: 0,
  outstanding: 0,
  pendingBytes: 0,
  pendingHighWater: 0,
};
let socket,
  decoder,
  generation = 0,
  sequence = 0,
  lastTimestamp = -1,
  ready = false,
  retry = 0,
  retryTimer,
  deadline,
  epoch = 0;
let buttons = 0, modifiers = 0, x = 0, y = 0, viewOnly = false;
const pending = new Map(), held = new Set();
const keys = {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  CapsLock: 57,
  PrintScreen: 70,
  ScrollLock: 71,
  Pause: 72,
  Insert: 73,
  Home: 74,
  PageUp: 75,
  Delete: 76,
  End: 77,
  PageDown: 78,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  NumLock: 83,
  NumpadDivide: 84,
  NumpadMultiply: 85,
  NumpadSubtract: 86,
  NumpadAdd: 87,
  NumpadEnter: 88,
  Numpad1: 89,
  Numpad2: 90,
  Numpad3: 91,
  Numpad4: 92,
  Numpad5: 93,
  Numpad6: 94,
  Numpad7: 95,
  Numpad8: 96,
  Numpad9: 97,
  Numpad0: 98,
  NumpadDecimal: 99,
  ControlLeft: 224,
  ShiftLeft: 225,
  AltLeft: 226,
  MetaLeft: 227,
  ControlRight: 228,
  ShiftRight: 229,
  AltRight: 230,
  MetaRight: 231,
};
for (let i = 0; i < 26; i++) keys[`Key${String.fromCharCode(65 + i)}`] = 4 + i;
for (let i = 1; i <= 9; i++) keys[`Digit${i}`] = 29 + i;
keys.Digit0 = 39;
for (let i = 1; i <= 12; i++) keys[`F${i}`] = 57 + i;
function header(type, gen, seq, size) {
  const b = new ArrayBuffer(20 + size), v = new DataView(b);
  v.setUint32(0, 0x4e534c31);
  v.setUint8(4, 1);
  v.setUint8(5, type);
  v.setUint32(8, gen);
  v.setUint32(12, seq);
  v.setUint32(16, size);
  return b;
}
function sendInput(event, code = 0, value = 0) {
  if (!ready || socket?.readyState !== WebSocket.OPEN || (viewOnly && event !== 7)) return;
  const b = header(3, generation, 0, 16), v = new DataView(b);
  v.setUint8(20, event);
  v.setUint16(22, code);
  v.setInt32(24, value);
  v.setUint16(28, x);
  v.setUint16(30, y);
  v.setUint16(32, buttons);
  v.setUint16(34, modifiers);
  socket.send(b);
}
function release() {
  if (ready) {
    buttons = 0;
    modifiers = 0;
    sendInput(7);
  }
  held.clear();
  buttons = 0;
  modifiers = 0;
}
function reset() {
  release();
  ready = false;
  cursorAvailable = false;
  cursor.width = cursor.height = 1;
  renderCursor();
  clearTimeout(deadline);
  for (const item of pending.values()) item.frame?.close();
  pending.clear();
  stats.outstanding = 0;
  stats.pendingBytes = 0;
  generation = 0;
  sequence = 0;
  lastTimestamp = -1;
  if (decoder && decoder.state !== "closed") decoder.close();
  decoder = null;
}
function fail(message) {
  stats.decodeerrors++;
  status.textContent = message;
  const old = socket;
  reset();
  if (old && old.readyState < WebSocket.CLOSING) old.close();
}
function watchPending(current) {
  clearTimeout(deadline);
  const oldest = pending.values().next().value;
  if (oldest) {
    deadline = setTimeout(() => {
      if (current === epoch) fail("Decoder timed out; reconnecting");
    }, Math.max(0, oldest.arrived + 5000 - performance.now()));
  }
}
function codecFromSps(bytes) {
  for (let i = 0; i + 7 < bytes.length; i++) {
    let n = 0;
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) n = i + 3;
    else if (
      bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 &&
      bytes[i + 3] === 1
    ) n = i + 4;
    if (n && n + 3 < bytes.length && (bytes[n] & 31) === 7) {
      return `avc1.${
        [bytes[n + 1], bytes[n + 2], bytes[n + 3]].map((v) =>
          v.toString(16).padStart(2, "0")
        ).join("")
      }`;
    }
  }
  throw new Error("Keyframe is missing SPS");
}
function connect() {
  clearTimeout(retryTimer);
  epoch++;
  const current = epoch;
  if (socket && socket.readyState < WebSocket.CLOSING) {
    release();
    socket.close();
  }
  reset();
  status.textContent = "Connecting…";
  if (!("VideoDecoder" in window) || !("EncodedVideoChunk" in window)) {
    status.textContent = "WebCodecs unavailable in this browser";
    return;
  }
  socket = new WebSocket(
    `${
      location.protocol === "https:" ? "wss" : "ws"
    }://${location.host}/stream`,
    accessToken ? ['nsl1', `bearer.${accessToken}`] : 'nsl1',
  );
  const ws = socket;
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    if (current === epoch) {
      status.textContent = "Waiting for frame…";
      deadline = setTimeout(() => {
        if (current === epoch) fail("First frame timed out; reconnecting");
      }, 5000);
    }
  };
  ws.onmessage = (e) => {
    if (current !== epoch || ws.readyState !== WebSocket.OPEN) return;
    try {
      if (
        !(e.data instanceof ArrayBuffer) || e.data.byteLength < 20 ||
        e.data.byteLength > 8388640
      ) throw new Error("Invalid frame length");
      const v = new DataView(e.data),
        gen = v.getUint32(8),
        seq = v.getUint32(12),
        flags = v.getUint16(6),
        len = v.getUint32(16);
      if (v.getUint32(0) !== 0x4e534c31 || v.getUint8(4) !== 1 || len !== e.data.byteLength - 20) {
        throw new Error("Invalid message envelope");
      }
      if (v.getUint8(5) === 6) { receiveCursor(e.data); return; }
      if (e.data.byteLength < 33) throw new Error("Invalid frame length");
      const
        width = v.getUint16(20),
        height = v.getUint16(22),
        pts = v.getBigUint64(24);
      if (
        v.getUint32(0) !== 0x4e534c31 || v.getUint8(4) !== 1 ||
        v.getUint8(5) !== 1 || flags > 1 || !gen || !seq ||
        len !== e.data.byteLength - 20 || !width || width > 1280 || !height ||
        height > 720 || pts > BigInt(Number.MAX_SAFE_INTEGER)
      ) throw new Error("Invalid frame header");
      if (generation && gen < generation) throw new Error("Stale generation");
      if (gen !== generation) {
        reset();
        generation = gen;
        if (!(flags & 1) || seq !== 1) {
          throw new Error("Generation must start with a keyframe");
        }
      }
      const data = new Uint8Array(e.data, 32), timestamp = Number(pts);
      if (
        seq !== sequence + 1 || timestamp <= lastTimestamp ||
        pending.size >= 8 || stats.pendingBytes + data.byteLength > 8388608
      ) throw new Error("Unexpected frame sequence or queue limit");
      sequence = seq;
      lastTimestamp = timestamp;
      stats.received++;
      stats.bytes += data.byteLength;
      pending.set(timestamp, { gen, seq, bytes: data.byteLength, arrived: performance.now() });
      stats.outstanding = pending.size;
      stats.pendingBytes += data.byteLength;
      stats.pendingHighWater = Math.max(stats.pendingHighWater, pending.size);
      watchPending(current);
      if (!decoder) {
        const config = {
          codec: codecFromSps(data),
          codedWidth: width,
          codedHeight: height,
          optimizeForLatency: true,
        };
        const instance = new VideoDecoder({
          output(frame) {
            let retained = false;
            try {
              if (current !== epoch || decoder !== instance) return;
              const item = pending.get(frame.timestamp);
              if (!item || item.gen !== generation || item.frame) {
                throw new Error("Unexpected decoded frame");
              }
              item.frame = frame;
              retained = true;
              while (pending.size) {
                const [timestamp, next] = pending.entries().next().value;
                if (!next.frame) break;
                ctx.drawImage(next.frame, 0, 0, 1280, 720);
                if (ws.readyState !== WebSocket.OPEN) throw new Error("Connection closed before ACK");
                ws.send(header(2, next.gen, next.seq, 0));
                next.frame.close();
                next.frame = null;
                pending.delete(timestamp);
                stats.pendingBytes -= next.bytes;
                stats.outstanding = pending.size;
                stats.drawn++;
                const wasReady = ready;
                ready = true;
                if (!wasReady) renderCursor();
                retry = 0;
                status.textContent = "Live · click to control";
              }
              watchPending(current);
            } catch (error) {
              fail(`Draw failed: ${error.message}`);
            } finally {
              if (!retained) frame.close();
            }
          },
          error(error) {
            if (current === epoch && decoder === instance) fail(`Decode failed: ${error.message}`);
          },
        });
        decoder = instance;
        decoder.configure(config);
      }
      decoder.decode(
        new EncodedVideoChunk({
          type: flags & 1 ? "key" : "delta",
          timestamp,
          data,
        }),
      );
    } catch (error) {
      if (current === epoch) fail(error.message);
    }
  };
  ws.onerror = () => {
    if (current === epoch) status.textContent = "Connection error";
  };
  ws.onclose = () => {
    if (current !== epoch) return;
    reset();
    if (document.hidden) {
      status.textContent = "Paused while hidden";
      return;
    }
    if (retry >= 5) {
      status.textContent += " · reconnect manually";
      return;
    }
    const delay = Math.min(1000 * 2 ** retry++, 8000);
    status.textContent += ` · retrying in ${delay / 1000}s`;
    retryTimer = setTimeout(connect, delay);
    checkAccess(current);
  };
}
function position(e) {
  pointerPosition = {clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType};
  renderCursor();
  const r = canvas.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return;
  const px = Math.max(
    0,
    Math.min(
      canvas.width - 1,
      Math.floor((e.clientX - r.left) * canvas.width / r.width),
    ),
  );
  const py = Math.max(
    0,
    Math.min(
      canvas.height - 1,
      Math.floor((e.clientY - r.top) * canvas.height / r.height),
    ),
  );
  x = Math.round(px * 65535 / (canvas.width - 1));
  y = Math.round(py * 65535 / (canvas.height - 1));
}
canvas.addEventListener("keydown", (e) => {
  const code = keys[e.code];
  if (!code) return;
  e.preventDefault();
  if (e.repeat || held.has(code)) return;
  held.add(code);
  if (code >= 224 && code <= 231) modifiers |= 1 << (code - 224);
  sendInput(1, code);
});
canvas.addEventListener("keyup", (e) => {
  const code = keys[e.code];
  if (!code) return;
  e.preventDefault();
  if (!held.delete(code)) return;
  if (code >= 224 && code <= 231) modifiers &= ~(1 << (code - 224));
  sendInput(2, code);
});
canvas.addEventListener("pointermove", (e) => {
  position(e);
  sendInput(3);
});
canvas.addEventListener("pointerleave", () => { pointerPosition = null; renderCursor(); });
new ResizeObserver(renderCursor).observe(canvas);
window.addEventListener("scroll", renderCursor, {passive: true});
const buttonMap = [1, 2, 3];
canvas.addEventListener("pointerdown", (e) => {
  const button = buttonMap[e.button];
  if (!button) return;
  e.preventDefault();
  canvas.focus();
  position(e);
  buttons |= 1 << (button - 1);
  canvas.setPointerCapture(e.pointerId);
  sendInput(4, button);
});
canvas.addEventListener("pointerup", (e) => {
  const button = buttonMap[e.button];
  if (!button) return;
  e.preventDefault();
  position(e);
  buttons &= ~(1 << (button - 1));
  sendInput(5, button);
  if (!buttons && canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
});
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("lostpointercapture", () => {
  if (buttons) release();
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  position(e);
  for (const [axis, delta] of [[0, e.deltaY], [1, e.deltaX]]) {
    if (delta) {
      sendInput(
        6,
        axis,
        Math.max(
          -1200,
          Math.min(
            1200,
            Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / 100)) *
              120,
          ),
        ),
      );
    }
  }
}, { passive: false });
canvas.addEventListener("blur", release);
window.addEventListener("blur", () => { release(); pointerPosition = null; renderCursor(); });
let hudTimer, metricsRequest;
function startHud() {
  let previousTime = performance.now(),
    previousDrawn = stats.drawn,
    previousBytes = stats.bytes,
    previousCpu,
    previousCpuTime,
    metrics =
      "Cgroup CPU (one core): unavailable · Cgroup RAM: unavailable";
  hudTimer = setInterval(() => {
    const now = performance.now(), seconds = (now - previousTime) / 1000;
    const fps = (stats.drawn - previousDrawn) / seconds;
    const mbps = (stats.bytes - previousBytes) * 8 / seconds / 1_000_000;
    document.querySelector("#hud").textContent = `Drawn FPS: ${
      fps.toFixed(1)
    } · Stream Mbps: ${mbps.toFixed(2)} · ${metrics}`;
    previousTime = now;
    previousDrawn = stats.drawn;
    previousBytes = stats.bytes;
    if (!metricsRequest) {
      const controller = metricsRequest = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      fetch("/metrics", { cache: "no-store", signal: controller.signal, redirect: 'error',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} })
        .then((response) => {
          if (!response.ok) throw new Error("Metrics unavailable");
          return response.json();
        })
        .then((data) => {
          const time = performance.now();
          if (
            ![data.usage_usec, data.memory_current, data.inactive_file].every(
              Number.isFinite,
            ) ||
            data.usage_usec < 0 || data.memory_current < 0 ||
            data.inactive_file < 0
          ) throw new Error("Invalid metrics");
          const cpu =
            previousCpu !== undefined && data.usage_usec >= previousCpu &&
              time > previousCpuTime
              ? `${
                ((data.usage_usec - previousCpu) /
                  ((time - previousCpuTime) * 1000) * 100).toFixed(1)
              }%`
              : "unavailable";
          const ram =
            (Math.max(0, data.memory_current - data.inactive_file) / 1048576)
              .toFixed(1);
          metrics =
            `Cgroup CPU (one core): ${cpu} · Cgroup RAM: ${ram} MiB`;
          previousCpu = data.usage_usec;
          previousCpuTime = time;
        })
        .catch(() => {
          metrics =
            "Cgroup CPU (one core): unavailable · Cgroup RAM: unavailable";
          previousCpu = undefined;
        })
        .finally(() => {
          clearTimeout(timer);
          if (metricsRequest === controller) metricsRequest = null;
        });
    }
  }, 1000);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInterval(hudTimer);
    metricsRequest?.abort();
    metricsRequest = null;
    document.querySelector("#hud").textContent =
      "Drawn FPS: 0.0 · Stream Mbps: 0.00 · Cgroup CPU (one core): unavailable · Cgroup RAM: unavailable";
    release();
    epoch++;
    if (socket) socket.close();
    reset();
    clearTimeout(retryTimer);
    status.textContent = "Paused while hidden";
  } else {
    startHud();
    retry = 0;
    connect();
  }
});
function checkAccess(current) {
  fetch("/capabilities", { cache: "no-store", redirect: "error",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} })
    .then((response) => {
      if (response.status !== 401 || current !== epoch) return;
      clearTimeout(retryTimer);
      status.textContent = accessToken ? "Access token rejected" : "Access token required";
      setExpanded(true);
      showPanel("connection", true);
      document.querySelector("#access-token").focus();
    })
    .catch(() => {});
}
const toolbar = document.querySelector("#toolbar"),
  toggle = document.querySelector("#toolbar-toggle"),
  actions = document.querySelector("#toolbar-actions"),
  dot = document.querySelector("#dot"),
  panels = { keys: document.querySelector("#keys-panel"), connection: document.querySelector("#connection-panel") };
function showPanel(name, open = panels[name]?.hidden) {
  for (const [key, panel] of Object.entries(panels)) {
    panel.hidden = !(key === name && open);
    toolbar.querySelector(`[data-action="${key}"]`).setAttribute("aria-expanded", String(!panel.hidden));
  }
}
function setExpanded(open) {
  actions.hidden = !open;
  toolbar.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", String(open));
  if (!open) showPanel(null);
}
function syncStatus() {
  const text = status.textContent;
  dot.className = "dot" + (text.startsWith("Live") ? " live" : /^(Connecting|Waiting|Paused)/.test(text) ? "" : " error");
  toggle.title = text;
  toggle.setAttribute("aria-label", `Viewer controls: ${text}`);
}
new MutationObserver(syncStatus).observe(status, { childList: true, characterData: true, subtree: true });
syncStatus();
toggle.addEventListener("click", () => setExpanded(actions.hidden));
canvas.addEventListener("pointerdown", () => showPanel(null));
const toolbarActions = {
  fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())
    .catch(() => {}),
  scale: (button) => {
    button.setAttribute("aria-pressed", String(document.body.classList.toggle("actual")));
    renderCursor();
  },
  keys: () => showPanel("keys"),
  connection: () => showPanel("connection"),
  screenshot: () => canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `desktop-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, "image/png"),
  viewonly: (button) => {
    release();
    viewOnly = !viewOnly;
    button.setAttribute("aria-pressed", String(viewOnly));
  },
  stats: (button) => {
    const panel = document.querySelector("#stats");
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-pressed", String(!panel.hidden));
  },
};
actions.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  if (button) toolbarActions[button.dataset.action](button);
});
document.addEventListener("fullscreenchange", () => {
  toolbar.querySelector('[data-action="fullscreen"]').setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
});
panels.keys.addEventListener("click", (e) => {
  const button = e.target.closest("[data-keys]");
  if (!button) return;
  const codes = button.dataset.keys.split("+").map((name) => keys[name]);
  for (const code of codes) {
    if (code >= 224) modifiers |= 1 << (code - 224);
    sendInput(1, code);
  }
  for (const code of codes.reverse()) {
    if (code >= 224) modifiers &= ~(1 << (code - 224));
    sendInput(2, code);
  }
  showPanel(null);
  canvas.focus();
});
panels.connection.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = document.querySelector('#access-token').value.trim();
  if (value && (!/^[0-9a-f]{64}$/.test(value) || !trustedPage)) {
    status.textContent = 'Use a 64-character token over HTTPS or a localhost tunnel';
    return;
  }
  accessToken = value;
  retry = 0;
  connect();
});
if (!document.hidden) startHud();
connect();
