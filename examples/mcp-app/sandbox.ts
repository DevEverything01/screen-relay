import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SANDBOX, SANDBOX_SCOPE } from "./config.ts";

/** Runs one automation command inside the sandbox that hosts the desktop. */
export async function runInSandbox(binary: string, args: string[]) {
  if (!SANDBOX) throw new Error("Set RELAY_SANDBOX to the sandbox name that runs relay");
  const scope = SANDBOX_SCOPE ? ["--scope", SANDBOX_SCOPE] : [];
  const { stdout, stderr } = await promisify(execFile)(
    "sandbox",
    ["exec", SANDBOX, ...scope, "--", "sh", "-lc", `/vercel/.local/bin/relay-env ${binary} "$@"`, "_", ...args],
    { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
  ).catch((error: any) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? `${error.message}` }));
  return { content: [{ type: "text" as const, text: JSON.stringify({ stdout, stderr }) }] };
}
