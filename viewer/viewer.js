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
  received: 0, drawn: 0, superseded: 0, bytes: 0, decodeerrors: 0, outstanding: 0, pendingBytes: 0, pendingHighWater: 0,
};
let socket, decoder, retryTimer, deadline, frameHandle, drawnThisFrame = false, transportBroken = false;
let generation = 0, sequence = 0, lastTimestamp = -1, ready = false, retry = 0, epoch = 0;
let buttons = 0, modifiers = 0, x = 0, y = 0, viewOnly = false, capsLock = false;
const pending = new Map(), decoded = [], held = new Set(), latched = new Map();
const keys = {};
const assignKeys = (first, names) => names.split(" ").forEach((name, i) => keys[name] = first + i);
assignKeys(4, Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`).join(" "));
assignKeys(30, "Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0");
assignKeys(40, "Enter Escape Backspace Tab Space Minus Equal BracketLeft BracketRight Backslash");
assignKeys(51, "Semicolon Quote Backquote Comma Period Slash CapsLock");
assignKeys(58, Array.from({ length: 12 }, (_, i) => `F${i + 1}`).join(" "));
assignKeys(70, "PrintScreen ScrollLock Pause Insert Home PageUp Delete End PageDown ArrowRight ArrowLeft ArrowDown ArrowUp NumLock");
assignKeys(84, "NumpadDivide NumpadMultiply NumpadSubtract NumpadAdd NumpadEnter Numpad1 Numpad2 Numpad3 Numpad4 Numpad5 Numpad6 Numpad7 Numpad8 Numpad9 Numpad0 NumpadDecimal");
assignKeys(224, "ControlLeft ShiftLeft AltLeft MetaLeft ControlRight ShiftRight AltRight MetaRight");
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
function setModifier(code, down) {
  if (code < 224 || code > 231) return;
  modifiers = down ? modifiers | 1 << (code - 224) : modifiers & ~(1 << (code - 224));
}
function syncCaps(event) {
  if (viewOnly) return;
  const local = event.getModifierState("CapsLock");
  if (local === capsLock) return;
  capsLock = local;
  sendInput(1, keys.CapsLock);
  sendInput(2, keys.CapsLock);
}
function clearLatched() {
  for (const button of latched.values()) button.setAttribute("aria-pressed", "false");
  latched.clear();
}
function releaseLatched() {
  for (const code of latched.keys()) {
    setModifier(code, false);
    sendInput(2, code);
  }
  clearLatched();
}
const authHeaders = () => accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
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
  buttons = modifiers = 0;
  if (ready) sendInput(7);
  held.clear();
  clearLatched();
}
function reset() {
  release();
  ready = false;
  cursorAvailable = false;
  cursor.width = cursor.height = 1;
  renderCursor();
  clearTimeout(deadline);
  cancelAnimationFrame(frameHandle);
  frameHandle = 0;
  drawnThisFrame = false;
  pending.clear();
  for (const item of decoded) item.frame.close();
  decoded.length = 0;
  stats.outstanding = 0;
  stats.pendingBytes = 0;
  generation = 0;
  capsLock = false;
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
function schedulePresent() {
  if (!frameHandle) frameHandle = requestAnimationFrame(present);
}
function ackFrame(item) {
  try {
    if (socket?.readyState !== WebSocket.OPEN) throw new Error("Connection closed before ACK");
    socket.send(header(2, item.gen, item.seq, 0));
    return true;
  } catch (error) {
    fail(`ACK failed: ${error.message}`);
    return false;
  }
}
function retireDecoded() {
  if (transportBroken || socket?.readyState !== WebSocket.OPEN) return;
  for (const item of decoded) if (!ackFrame(item)) break;
}
function draw(item) {
  try {
    if (item.gen !== generation) throw new Error("Stale decoded frame");
    ctx.drawImage(item.frame, 0, 0, canvas.width, canvas.height);
  } catch (error) {
    item.frame.close();
    fail(`Draw failed: ${error.message}`);
    return false;
  }
  item.frame.close();
  stats.drawn++;
  const wasReady = ready;
  ready = true;
  if (!wasReady) renderCursor();
  retry = 0;
  status.textContent = "Live · click to control";
  drawnThisFrame = true;
  return ackFrame(item);
}
function presentDecoded(item) {
  if (!decoded.length && !drawnThisFrame) {
    if (!draw(item)) return false;
  } else {
    decoded.push(item);
  }
  while (decoded.length > 3) {
    const dropped = decoded.shift();
    dropped.frame.close();
    stats.superseded++;
    if (!ackFrame(dropped)) return false;
  }
  schedulePresent();
  return true;
}
function present() {
  frameHandle = 0;
  drawnThisFrame = false;
  const item = decoded.shift();
  if (!item || !draw(item)) return;
  schedulePresent();
}
function codecFromSps(bytes) {
  for (let i = 0; i + 7 < bytes.length; i++) {
    let n = 0;
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) n = i + 3;
    else if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) n = i + 4;
    if (n && n + 3 < bytes.length && (bytes[n] & 31) === 7) {
      return `avc1.${[bytes[n + 1], bytes[n + 2], bytes[n + 3]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
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
    retireDecoded();
    socket.close();
  }
  reset();
  status.textContent = "Connecting…";
  if (!("VideoDecoder" in window) || !("EncodedVideoChunk" in window)) {
    status.textContent = "WebCodecs unavailable in this browser";
    return;
  }
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/stream`,
    accessToken ? ['nsl1', `bearer.${accessToken}`] : 'nsl1',
  );
  transportBroken = false;
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
      const v = new DataView(e.data), gen = v.getUint32(8), seq = v.getUint32(12), flags = v.getUint16(6);
      if (v.getUint32(0) !== 0x4e534c31 || v.getUint8(4) !== 1 || v.getUint32(16) !== e.data.byteLength - 20) {
        throw new Error("Invalid message envelope");
      }
      if (v.getUint8(5) === 6) { receiveCursor(e.data); return; }
      if (e.data.byteLength < 33) throw new Error("Invalid frame length");
      const width = v.getUint16(20), height = v.getUint16(22), pts = v.getBigUint64(24);
      if (
        v.getUint8(5) !== 1 || flags > 1 || !gen || !seq ||
        !width || width > 1920 || !height || height > 1080 ||
        pts > BigInt(Number.MAX_SAFE_INTEGER)
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
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width; canvas.height = height;
          canvas.style.setProperty("--w", width); canvas.style.setProperty("--h", height);
        }
        const config = { codec: codecFromSps(data), codedWidth: width, codedHeight: height, optimizeForLatency: true };
        const instance = new VideoDecoder({
          output(frame) {
            let retained = false;
            try {
              if (current !== epoch || decoder !== instance) return;
              const item = pending.get(frame.timestamp);
              if (!item || item.gen !== generation) {
                throw new Error("Unexpected decoded frame");
              }
              retained = true;
              pending.delete(frame.timestamp);
              stats.pendingBytes -= item.bytes;
              stats.outstanding = pending.size;
              if (!presentDecoded({ gen: item.gen, seq: item.seq, frame })) return;
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
        new EncodedVideoChunk({ type: flags & 1 ? "key" : "delta", timestamp, data }),
      );
    } catch (error) {
      if (current === epoch) fail(error.message);
    }
  };
  ws.onerror = () => {
    if (current === epoch) { transportBroken = true; status.textContent = "Connection error"; }
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
  const px = clamp(Math.floor((e.clientX - r.left) * canvas.width / r.width), 0, canvas.width - 1);
  const py = clamp(Math.floor((e.clientY - r.top) * canvas.height / r.height), 0, canvas.height - 1);
  x = Math.round(px * 65535 / (canvas.width - 1));
  y = Math.round(py * 65535 / (canvas.height - 1));
}
canvas.addEventListener("keydown", (e) => {
  const code = keys[e.code];
  if (!code) return;
  e.preventDefault();
  syncCaps(e);
  if (e.code === "CapsLock") return;
  if (e.repeat || held.has(code)) return;
  held.add(code);
  setModifier(code, true);
  sendInput(1, code);
  if (code < 224) releaseLatched();
});
canvas.addEventListener("keyup", (e) => {
  const code = keys[e.code];
  if (!code) return;
  e.preventDefault();
  syncCaps(e);
  if (e.code === "CapsLock") return;
  if (!held.delete(code)) return;
  setModifier(code, false);
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
      const notches = Math.max(1, Math.round(Math.abs(delta) / 100));
      sendInput(6, axis, clamp(Math.sign(delta) * notches * 120, -1200, 1200));
    }
  }
}, { passive: false });
canvas.addEventListener("blur", release);
window.addEventListener("blur", () => { release(); pointerPosition = null; renderCursor(); });
const METRICS_UNAVAILABLE = "Cgroup CPU (one core): unavailable · Cgroup RAM: unavailable";
let hudTimer, metricsRequest;
function startHud() {
  let previousTime = performance.now(),
    previousDrawn = stats.drawn,
    previousBytes = stats.bytes,
    previousCpu,
    previousCpuTime,
    metrics = METRICS_UNAVAILABLE;
  hudTimer = setInterval(() => {
    const now = performance.now(), seconds = (now - previousTime) / 1000;
    const fps = (stats.drawn - previousDrawn) / seconds;
    const mbps = (stats.bytes - previousBytes) * 8 / seconds / 1_000_000;
    document.querySelector("#hud").textContent = `Drawn FPS: ${fps.toFixed(1)} · Stream Mbps: ${mbps.toFixed(2)} · ${metrics}`;
    previousTime = now;
    previousDrawn = stats.drawn;
    previousBytes = stats.bytes;
    if (!metricsRequest) {
      const controller = metricsRequest = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      fetch("/metrics", { cache: "no-store", signal: controller.signal, redirect: 'error', headers: authHeaders() })
        .then((response) => {
          if (!response.ok) throw new Error("Metrics unavailable");
          return response.json();
        })
        .then((data) => {
          const time = performance.now();
          if (![data.usage_usec, data.memory_current, data.inactive_file].every((n) => Number.isFinite(n) && n >= 0)) {
            throw new Error("Invalid metrics");
          }
          const cpu = previousCpu !== undefined && data.usage_usec >= previousCpu && time > previousCpuTime
            ? `${((data.usage_usec - previousCpu) / ((time - previousCpuTime) * 1000) * 100).toFixed(1)}%`
            : "unavailable";
          const ram = (Math.max(0, data.memory_current - data.inactive_file) / 1048576).toFixed(1);
          metrics = `Cgroup CPU (one core): ${cpu} · Cgroup RAM: ${ram} MiB`;
          previousCpu = data.usage_usec;
          previousCpuTime = time;
        })
        .catch(() => {
          metrics = METRICS_UNAVAILABLE;
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
      `Drawn FPS: 0.0 · Stream Mbps: 0.00 · ${METRICS_UNAVAILABLE}`;
    release();
    epoch++;
    retireDecoded();
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
  fetch("/capabilities", { cache: "no-store", redirect: "error", headers: authHeaders() })
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
  const hold = e.target.closest("[data-hold]");
  if (hold) {
    const code = keys[hold.dataset.hold];
    if (latched.has(code)) {
      latched.delete(code);
      setModifier(code, false);
      sendInput(2, code);
      hold.setAttribute("aria-pressed", "false");
    } else {
      latched.set(code, hold);
      setModifier(code, true);
      sendInput(1, code);
      hold.setAttribute("aria-pressed", "true");
    }
    canvas.focus();
    return;
  }
  const button = e.target.closest("[data-keys]");
  if (!button) return;
  const codes = button.dataset.keys.split("+").map((name) => keys[name]);
  const releasesLatched = codes.some((code) => code < 224);
  for (const code of codes) {
    setModifier(code, true);
    sendInput(1, code);
  }
  for (const code of codes.reverse()) {
    setModifier(code, false);
    sendInput(2, code);
  }
  if (releasesLatched) releaseLatched();
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
