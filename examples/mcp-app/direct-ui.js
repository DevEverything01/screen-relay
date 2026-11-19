let initialized = false;
let started = false;
let activeToken;
let activeScope;
let pendingStream;

function post(data) {
  window.parent.postMessage({ jsonrpc: "2.0", ...data }, "*");
}

function size() {
  post({ method: "ui/notifications/size-changed", params: { height: 640 } });
}

function show(stream) {
  if (!stream) return;
  try {
    const url = new URL(stream.url);
    if (url.origin !== relayOrigin || url.username || url.password || url.search || url.hash) {
      throw new Error("Unexpected screen-relay origin.");
    }
    if (!/^[0-9a-f]{64}$/.test(stream.token ?? "")) {
      throw new Error("Invalid screen-relay token.");
    }
    if (stream.scope !== "watch" && stream.scope !== "control") throw new Error("Invalid viewer scope.");
    if (!window.isSecureContext) throw new Error("The MCP App needs a secure browser context.");
    if (started) {
      if (activeScope !== stream.scope) throw new Error("Reopen the viewer to change its permissions.");
      if (activeToken === stream.token) return;
      document.querySelector("#access-token").value = stream.token ?? "";
      document.querySelector("#connection-panel").dispatchEvent(new Event("submit", { cancelable: true }));
      activeToken = stream.token;
      return;
    }
    started = true;
    activeToken = stream.token;
    activeScope = stream.scope;
    startViewer({ url: url.origin, token: stream.token, scope: stream.scope });
    size();
  } catch (error) {
    document.querySelector("#status").textContent = error.message;
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.jsonrpc !== "2.0") return;
  const data = event.data;
  if (data.id === 1) {
    if (data.error) {
      document.querySelector("#status").textContent = "MCP App initialization failed.";
      return;
    }
    if (!data.result || initialized) return;
    initialized = true;
    post({ method: "ui/notifications/initialized", params: {} });
    size();
    show(pendingStream);
  } else if (data.method === "ui/notifications/tool-result") {
    pendingStream = data.params?._meta?.["relay/viewer"];
    if (initialized) show(pendingStream);
  }
});

window.addEventListener("resize", size);
document.querySelector("#status").textContent = "Waiting for desktop session…";
post({
  id: 1,
  method: "ui/initialize",
  params: {
    protocolVersion: "2026-01-26",
    appInfo: { name: "relay-mcp-app", version: "0.1.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
  },
});
