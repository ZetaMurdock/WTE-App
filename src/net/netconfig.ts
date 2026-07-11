// Netplay connection config (persisted) + WebRTC ICE server assembly.
// Signaling URL + optional self-hosted TURN. See docs/NETPLAY.md and server/README.md.

export interface NetConfig {
  signalUrl: string; // wss://signal.example.com  (or ws://localhost:8787 for local testing)
  turnUrl: string; // turns:turn.example.com:5349,turn:turn.example.com:3478  (comma list, optional)
  turnSecret: string; // coturn static-auth-secret — used to mint ephemeral credentials
}

const EMPTY: NetConfig = { signalUrl: "", turnUrl: "", turnSecret: "" };

export function getNetConfig(): NetConfig {
  try {
    return {
      signalUrl: localStorage.getItem("wte-signal-url") || "",
      turnUrl: localStorage.getItem("wte-turn-url") || "",
      turnSecret: localStorage.getItem("wte-turn-secret") || "",
    };
  } catch {
    return { ...EMPTY };
  }
}

export function setNetConfig(c: NetConfig): void {
  try {
    localStorage.setItem("wte-signal-url", c.signalUrl.trim());
    localStorage.setItem("wte-turn-url", c.turnUrl.trim());
    localStorage.setItem("wte-turn-secret", c.turnSecret.trim());
  } catch {
    /* ignore */
  }
}

// coturn REST-style ephemeral credential: username = "<unix-expiry>:<id>",
// password = base64(HMAC-SHA1(secret, username)). No static password ships in the client.
async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function buildIceServers(cfg: NetConfig): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrls = cfg.turnUrl.split(",").map((s) => s.trim()).filter(Boolean);
  if (turnUrls.length && cfg.turnSecret) {
    const expiry = Math.floor(Date.now() / 1000) + 3600; // 1h TTL
    const username = `${expiry}:wte`;
    const credential = await hmacSha1Base64(cfg.turnSecret, username);
    servers.push({ urls: turnUrls, username, credential });
  }
  return servers;
}
