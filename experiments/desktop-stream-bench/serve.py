"""Loopback-only viewer and HTTP/WebSocket bridges for this local experiment."""
import asyncio
from pathlib import Path
import json
from aiohttp import web, ClientSession, BasicAuth, WSMsgType

ROOT = Path(__file__).resolve().parent
HOP = {"connection", "upgrade", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "sec-websocket-accept", "sec-websocket-protocol", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions"}

async def proxy(request):
    benchmark = request.headers.get("User-Agent", "").endswith(" DesktopStreamBench/1.0")
    if (ROOT / ".benchmark-active").exists() and not benchmark:
        return web.Response(status=503, content_type="text/html", text='<!doctype html><meta http-equiv="refresh" content="5"><style>body{font:18px system-ui;background:#19212d;color:#edf2fa;padding:30px}</style><h2>Controlled benchmark running</h2><p>This desktop is temporarily reserved. It will reconnect automatically when measurements finish.</p>')
    upstream = request.app["benchmark_upstream" if benchmark else "upstream"] + str(request.rel_url)
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP and k.lower() not in {"authorization", "accept-encoding"}}
    auth = request.app.get("auth")
    async with ClientSession() as session:
        if request.headers.get("Upgrade", "").lower() == "websocket":
            protocols = [s.strip() for s in request.headers.get("Sec-WebSocket-Protocol", "").split(",") if s.strip()]
            async with session.ws_connect(upstream, headers=headers, auth=auth, protocols=protocols, max_msg_size=0) as remote:
                local = web.WebSocketResponse(protocols=[remote.protocol] if remote.protocol else [], max_msg_size=0)
                await local.prepare(request)
                async def forward(source, target):
                    async for message in source:
                        if message.type == WSMsgType.BINARY:
                            await target.send_bytes(message.data)
                        elif message.type == WSMsgType.TEXT:
                            await target.send_str(message.data)
                        elif message.type == WSMsgType.ERROR:
                            break
                    await target.close()
                await asyncio.gather(forward(local, remote), forward(remote, local))
                return local
        async with session.request(request.method, upstream, headers=headers, auth=auth, data=await request.read(), allow_redirects=False) as response:
            output = {k: v for k, v in response.headers.items() if k.lower() not in HOP}
            return web.Response(status=response.status, headers=output, body=await response.read())

async def index(request):
    return web.FileResponse(ROOT / "index.html")

async def status(request):
    results = ROOT / "results" / "summary.json"
    data = json.loads(results.read_text()) if results.exists() else {"state": "Preparing controlled measurements", "runs": []}
    active = ROOT / ".benchmark-active"
    if active.exists():
        data["state"] = json.loads(active.read_text())["state"]
    return web.json_response(data)

async def main():
    password = next(line.split("=", 1)[1] for line in (ROOT / ".env").read_text().splitlines() if line.startswith("BENCH_PASSWORD="))
    for port, target in ((8030, None), (8031, 18081), (8032, 18082)):
        app = web.Application(client_max_size=10 * 1024 * 1024)
        if target:
            app["upstream"] = f"http://127.0.0.1:{target}"
            app["benchmark_upstream"] = f"http://127.0.0.1:{target + 10}"
            if port == 8032:
                app["auth"] = BasicAuth("bench", password)
            app.router.add_route("*", "/{path:.*}", proxy)
        else:
            app.router.add_get("/", index)
            app.router.add_get("/status", status)
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", port).start()
        print(f"Listening on http://localhost:{port}", flush=True)
    await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(main())
