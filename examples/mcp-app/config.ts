const relayOrigin = new URL(process.env.RELAY_ORIGIN ?? "http://localhost:18080").origin;
const envToken = process.env.RELAY_TOKEN;

/** Origin of the relay server this app may embed and talk to. */
export const ORIGIN = relayOrigin;

/** Name of the sandbox that runs the desktop, for the automation tools. */
export const SANDBOX = process.env.RELAY_SANDBOX;

/** Scope that owns the sandbox, when it belongs to a team. */
export const SANDBOX_SCOPE = process.env.RELAY_SANDBOX_SCOPE;

/** Validates a stream URL and returns it, rejecting anything but the configured origin. */
export function originOf(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Stream URL is not a valid URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Stream URL must be an HTTP(S) origin without credentials or query");
  }
  if (url.origin !== ORIGIN) {
    throw new Error(`Stream URL must use the relay origin ${ORIGIN}`);
  }
  return url;
}

/** Resolves the token from the argument or the environment and checks its shape. */
export function tokenOf(value: string | undefined): string | undefined {
  const token = value ?? envToken;
  if (!token) return undefined;
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Token must be 64 lowercase hexadecimal characters");
  return token;
}
