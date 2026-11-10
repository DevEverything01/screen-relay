import { createServer as createHttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { registerTools } from "./tools.ts";
import { registerViewer } from "./viewer.ts";

/** Builds a server with the relay tools and viewer resource. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "relay-mcp-app", version: "0.1.0" });
  registerTools(server);
  registerViewer(server);
  return server;
}

function cors(origin: string | undefined) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  };
  if (origin) {
    const host = new URL(origin).hostname;
    if (host === "localhost" || host === "127.0.0.1") headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

async function startHttp() {
  const port = Number(process.env.PORT ?? 3001);
  const http = createHttpServer(async (req, res) => {
    const headers = cors(req.headers.origin);
    if (req.url !== "/mcp") {
      res.writeHead(404, headers).end();
      return;
    }
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const server = createServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { ...headers, "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        id: null,
      }));
    }
  });
  http.listen(port, "127.0.0.1", () => console.log(`MCP server listening on http://localhost:${port}/mcp`));
}

if (process.argv.includes("--http")) {
  await startHttp();
} else {
  await createServer().connect(new StdioServerTransport());
}
