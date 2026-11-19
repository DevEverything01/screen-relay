import { z } from "zod";
import { isLoopback } from "../../dist/protocol/index.js";

const grantResponse = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  scope: z.enum(["watch", "control"]),
});

export async function mintGrant(origin: URL, owner: string, scope: "watch" | "control") {
  if (origin.protocol !== "https:" && !isLoopback(origin.hostname)) throw new Error("The relay must use HTTPS outside loopback.");
  const response = await fetch(new URL(`/grants/${scope}`, origin), {
    method: "POST",
    headers: { Authorization: `Bearer ${owner}` },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Could not issue a viewer grant (HTTP ${response.status}).`);
  const grant = grantResponse.parse(await response.json());
  if (grant.scope !== scope || grant.token === owner) throw new Error("The relay returned an invalid viewer grant.");
  return grant;
}
