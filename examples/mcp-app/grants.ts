import { z } from "zod";
import { isLoopback } from "../../dist/protocol/index.js";

const grantResponse = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  scope: z.enum(["watch", "control"]),
  expires_in: z.number().int().min(1).max(3600),
});

export async function mintGrant(origin: URL, owner: string, scope: "watch" | "control") {
  if (origin.protocol !== "https:" && !isLoopback(origin.hostname)) throw new Error("The relay must use HTTPS outside loopback.");
  const requestedAt = Date.now();
  const response = await fetch(new URL(`/grants/${scope}`, origin), {
    method: "POST",
    headers: { Authorization: `Bearer ${owner}` },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Could not issue a viewer grant (HTTP ${response.status}).`);
  const grant = grantResponse.parse(await response.json());
  if (grant.scope !== scope || grant.token === owner) throw new Error("The relay returned an invalid viewer grant.");
  const expiresAt = requestedAt + grant.expires_in * 1000;
  if (expiresAt <= Date.now()) throw new Error("The viewer grant expired before it could be used. Call open_desktop again.");
  return { token: grant.token, scope: grant.scope, expiresAt };
}
