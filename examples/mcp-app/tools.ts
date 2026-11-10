import type { McpServer } from "@modelcontextprotocol/server";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { createClient } from "../../dist/sdk/index.js";
import { originOf, tokenOf } from "./config.ts";
import { runInSandbox } from "./sandbox.ts";
import { RESOURCE_URI } from "./viewer.ts";

let session: { url: string; token?: string } | undefined;

/** Registers the desktop, screenshot, and automation tools on a server. */
export function registerTools(server: McpServer): void {
  registerAppTool(
    server,
    "open_desktop",
    {
      title: "Open desktop",
      description: "Show a relay desktop stream in an interactive viewer.",
      inputSchema: z.object({
        url: z.string().describe("Relay viewer URL, for example http://localhost:18080/"),
        token: z.string().optional().describe("Relay access token. Omit to use RELAY_TOKEN."),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ url, token }) => {
      const viewer = originOf(url);
      const accessToken = tokenOf(token);
      session = { url: viewer.href, token: accessToken };
      return {
        content: [{ type: "text", text: "Desktop opened. Use desktop_screenshot to inspect it." }],
        _meta: { "relay/viewer": { url: viewer.href, token: accessToken } },
      };
    },
  );

  server.registerTool(
    "desktop_screenshot",
    {
      title: "Desktop screenshot",
      description: "Capture the desktop from the last open_desktop session.",
    },
    async () => {
      if (!session) throw new Error("Call open_desktop first");
      const png = await createClient({ url: session.url, token: session.token }).screenshot();
      return {
        content: [{ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" }],
      };
    },
  );

  server.registerTool(
    "desktop_action",
    {
      title: "Desktop action",
      description: "Run an agent-desktop command against the relay desktop, for example [\"snapshot\"].",
      inputSchema: z.object({
        args: z.array(z.string()).describe("Arguments for agent-desktop"),
      }),
    },
    async ({ args }) => runInSandbox("agent-desktop", args),
  );

  server.registerTool(
    "browser_action",
    {
      title: "Browser action",
      description: "Run an agent-browser command inside the relay sandbox, for example [\"open\", \"https://example.com\"].",
      inputSchema: z.object({
        args: z.array(z.string()).describe("Arguments for agent-browser"),
      }),
    },
    async ({ args }) => runInSandbox("/vercel/relay/node_modules/.bin/agent-browser", args),
  );
}
