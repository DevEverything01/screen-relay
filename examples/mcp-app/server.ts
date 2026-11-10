import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { registerTools } from "./tools.ts";
import { registerViewer } from "./viewer.ts";

const port = Number(process.env.PORT ?? 3001);
const localHosts = [`localhost:${port}`, `127.0.0.1:${port}`];

/** Builds a server with the relay tools and viewer resource. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "relay-mcp-app", version: "0.1.0" });
  registerTools(server);
  registerViewer(server);
  return server;
}

/** Refuses requests addressed to any host but this loopback server, which blocks DNS rebinding. */
function trustedHost(req: IncomingMessage): boolean {
  return localHosts.includes(String(req.headers.host ?? ""));
}

/** Accepts no Origin, or one served from this machine, so local hosts on any port can connect. */
function trustedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    return (protocol === "http:" || protocol === "https:") &&
      (hostname === "localhost" || hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function cors(origin: string | undefined) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  };
  if (origin && trustedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (!trustedHost(req) || !trustedOrigin(req.headers.origin)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  const headers = cors(req.headers.origin);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  if (req.url !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: localHosts,
  });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

async function startHttp() {
  const http = createHttpServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        id: null,
      }));
    });
  });
  http.listen(port, "127.0.0.1", () => console.log(`MCP server listening on http://localhost:${port}/mcp`));
}

if (process.argv.includes("--http")) {
  await startHttp();
} else {
  await createServer().connect(new StdioServerTransport());
}
