// The Atlas pop-out bridge.
//
// A popped-out Atlas is a second OS window, which in Tauri means a second
// webview: a separate JS context with its own React tree and NO netplay
// session — WebRTC connections live in the main window and cannot be shared.
// So the popped window talks to the main window over this bridge, and the main
// window does all wire work on its behalf:
//
//   popped curator saves        -> "saved"  -> main broadcasts the filtered doc
//   popped curator hits BRING   -> "bring"  -> main publishes atlas-focus
//   popped player wants the map -> "want"   -> main whispers atlas-request
//   host doc arrives at main    -> "netDoc" -> popped adopts it
//   BROADCAST VIEW hits main    -> "focus"  -> popped flies + banners
//   roster changes at main      -> "peers"  -> popped redraws BRING buttons
//   popped window boots         -> "hello"  -> main re-sends the roster
//
// Transport: Tauri's cross-window event bus in the app; a BroadcastChannel in
// the plain-browser dev preview (where "windows" are tabs).

export type BridgeMsg =
  | { kind: "saved"; campaignId: string }
  | { kind: "want" }
  | { kind: "netDoc"; doc: unknown }
  | { kind: "focus"; x: number; y: number; zoom?: number; label?: string }
  | { kind: "bring"; x: number; y: number; zoom?: number; label?: string; to?: string }
  | { kind: "peers"; players: { id: string; name: string }[] }
  | { kind: "hello" };

const EVENT = "wte://atlas-bridge";

/** Validate a message off the bus. Both ends treat the bus as untrusted input,
 *  same as anything else that crossed a process boundary. */
export function parseBridge(raw: unknown): BridgeMsg | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  switch (m.kind) {
    case "saved":
      return typeof m.campaignId === "string" && m.campaignId ? { kind: "saved", campaignId: m.campaignId } : null;
    case "want":
      return { kind: "want" };
    case "hello":
      return { kind: "hello" };
    case "netDoc":
      return "doc" in m ? { kind: "netDoc", doc: m.doc } : null;
    case "focus":
    case "bring": {
      if (!num(m.x) || !num(m.y)) return null;
      const base = {
        x: m.x as number,
        y: m.y as number,
        zoom: num(m.zoom) ? (m.zoom as number) : undefined,
        label: typeof m.label === "string" ? m.label.slice(0, 80) : undefined,
      };
      if (m.kind === "focus") return { kind: "focus", ...base };
      return { kind: "bring", ...base, to: typeof m.to === "string" ? m.to : undefined };
    }
    case "peers": {
      if (!Array.isArray(m.players)) return null;
      const players = m.players
        .filter((p): p is { id: string; name: string } =>
          !!p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string" && typeof (p as { name?: unknown }).name === "string")
        .map((p) => ({ id: p.id, name: p.name }));
      return { kind: "peers", players };
    }
    default:
      return null;
  }
}

interface TauriGlobal {
  event: {
    emit: (name: string, payload: unknown) => Promise<void>;
    listen: (name: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
  };
  webviewWindow: {
    WebviewWindow: {
      new (label: string, opts: Record<string, unknown>): unknown;
      getByLabel: (label: string) => Promise<{ setFocus: () => Promise<void> } | null>;
    };
  };
  window: { getCurrentWindow: () => { label: string; close: () => Promise<void> } };
}

const tauri = (): TauriGlobal | null => (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;

export function bridgeEmit(msg: BridgeMsg): void {
  const t = tauri();
  if (t) {
    void t.event.emit(EVENT, msg);
    return;
  }
  channel().postMessage(msg);
}

export function bridgeListen(cb: (msg: BridgeMsg) => void): () => void {
  const t = tauri();
  if (t) {
    let dead = false;
    let un: (() => void) | null = null;
    void t.event.listen(EVENT, (e) => {
      const m = parseBridge(e.payload);
      if (m) cb(m);
    }).then((f) => {
      if (dead) f();
      else un = f;
    });
    return () => {
      dead = true;
      un?.();
    };
  }
  const ch = channel();
  const handler = (e: MessageEvent) => {
    const m = parseBridge(e.data);
    if (m) cb(m);
  };
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}

let bc: BroadcastChannel | null = null;
function channel(): BroadcastChannel {
  if (!bc) bc = new BroadcastChannel("wte-atlas-bridge");
  return bc;
}

// ── the popped window itself ─────────────────────────────────────────────────

export interface AtlasStandaloneParams {
  campaignId: string;
  curator: boolean;
  netPlayer: boolean;
}

export const ATLAS_HASH = "#/atlas";

/** Pure so it can be tested: the popped window's identity, from its URL hash. */
export function parseAtlasHash(hash: string): AtlasStandaloneParams | null {
  if (!hash.startsWith(ATLAS_HASH)) return null;
  const q = hash.indexOf("?");
  const params = new URLSearchParams(q >= 0 ? hash.slice(q + 1) : "");
  const campaignId = params.get("campaign") ?? "";
  if (!campaignId) return null;
  return {
    campaignId,
    curator: params.get("curator") === "1",
    netPlayer: params.get("player") === "1",
  };
}

export function atlasHashFor(p: AtlasStandaloneParams): string {
  const q = new URLSearchParams({ campaign: p.campaignId, curator: p.curator ? "1" : "0", player: p.netPlayer ? "1" : "0" });
  return `${ATLAS_HASH}?${q.toString()}`;
}

export function isStandaloneAtlas(): boolean {
  return parseAtlasHash(window.location.hash) !== null;
}

/**
 * Open (or refocus) the popped Atlas window. Resolves true when a window
 * exists; `onClosed` fires when it later goes away, so the caller can let the
 * inline Atlas come back.
 */
export async function openAtlasWindow(p: AtlasStandaloneParams, onClosed: () => void): Promise<true | string> {
  const t = tauri();
  if (t) {
    try {
      // getByLabel can hand back a handle for a window that no longer exists
      // (seen live after a native-X close) — so a failed focus means "make a
      // new one", never "give up".
      const existing = await t.webviewWindow.WebviewWindow.getByLabel("atlas");
      let alive = false;
      if (existing) {
        try {
          await existing.setFocus();
          alive = true;
        } catch {
          alive = false;
        }
      }
      if (!alive) {
        new t.webviewWindow.WebviewWindow("atlas", {
          url: `index.html${atlasHashFor(p)}`,
          title: "W.T.E — Curator Atlas",
          width: 1040,
          height: 720,
          minWidth: 480,
          minHeight: 360,
          resizable: true,
        });
      }
      // Close detection by polling the window registry. A cross-window
      // `tauri://destroyed` listener sounds right but never fires in practice
      // — verified live: the inline Atlas stayed locked out after the popped
      // window closed. getByLabel === null is unambiguous.
      const iv = window.setInterval(() => {
        void t.webviewWindow.WebviewWindow.getByLabel("atlas").then((w) => {
          if (!w) {
            window.clearInterval(iv);
            onClosed();
          }
        });
      }, 1500);
      return true;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  // Browser dev: a popup tab. The poll is crude but tabs have no close event.
  const w = window.open(`${window.location.origin}${window.location.pathname}${atlasHashFor(p)}`, "wte-atlas", "width=1040,height=720");
  if (!w) return "the popup was blocked";
  const iv = window.setInterval(() => {
    if (w.closed) {
      window.clearInterval(iv);
      onClosed();
    }
  }, 1500);
  return true;
}

/** Refocus the popped window (a BROADCAST VIEW should surface it). */
export function focusAtlasWindow(): void {
  const t = tauri();
  if (t) void t.webviewWindow.WebviewWindow.getByLabel("atlas").then((w) => w?.setFocus());
}

/** Close THIS window — the standalone Atlas's × button. */
export function closeThisWindow(): void {
  const t = tauri();
  if (t) void t.window.getCurrentWindow().close();
  else window.close();
}
