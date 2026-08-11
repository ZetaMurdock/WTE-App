import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  atlasForRole,
  emptyAtlas,
  MAX_ATLAS_WIRE_CHARS,
  parseAtlas,
  ZONE_FX,
  type AtlasDoc,
  type AtlasNode,
  type AtlasPoint,
  type AtlasZone,
  type ZoneState,
} from "./atlasModel";
import {
  clampToMap,
  clampZoom,
  coordLabel,
  dayNightShade,
  distanceMi,
  flyCamera,
  formatDistance,
  formatWorldClock,
  makeCamera,
  nodeVisibleAtZoom,
  nullReadout,
  panBy,
  pickScaleBar,
  pointInPolygon,
  screenToWorld,
  simplifyPath,
  stepInertia,
  worldToScreen,
  zoomAt,
  type AtlasCamera,
  type FlyTarget,
} from "./atlasMath";
import { AtlasArt } from "./animatedImage";
import { loadAtlas, saveAtlas } from "./atlasRepo";
import { fileToImageDataUrl } from "../../lib/image";
import { registerSaver } from "../../lib/saveQueue";
import { pushToast, reportSaveFailure } from "../../lib/appToast";
import { useNet } from "../../net/NetContext";
import type { NetMessage } from "../../net/protocol";
import { bridgeEmit, bridgeListen } from "./atlasBridge";

/** BROADCAST VIEW arriving from the Curator. VttScreen opens the window and
 *  hands the target in; a fresh nonce restarts the flight. */
export interface AtlasFocus {
  x: number;
  y: number;
  zoom?: number;
  label?: string;
  nonce: number;
}

interface Props {
  campaignId: string;
  curator: boolean;
  onClose: () => void;
  focus?: AtlasFocus | null;
  /** Running as its own OS window: net traffic is proxied over the bridge by
   *  the main window, which owns the only WebRTC session. */
  standalone?: boolean;
  /** Standalone on a joined player's machine: no local campaign data — the
   *  world arrives over the bridge, read-only. */
  bridgePlayer?: boolean;
  /** Offered in the inline header; opens the OS window and closes this one. */
  onPopOut?: () => void;
}

type Tool = "pan" | "measure" | "node" | "zone";

interface Measure {
  a: AtlasPoint;
  b: AtlasPoint;
}

/** A click on a null-locked region: a black distortion that spreads and
 *  collapses back into the hidden area. */
interface NullBurst {
  x: number;
  y: number;
  at: number;
}

const uid = () => "a" + Math.random().toString(36).slice(2, 9);

/** Sprite art budget (data-URL chars). GIFs can't be shrunk on import, so this
 *  is a hard gate rather than a downscale target. */
const MAX_SPRITE_CHARS = 12 * 1024 * 1024;

// The Curator Atlas — slices 1+2 (see docs/curator-atlas.md).
//
// A floating, resizable world-map instrument over the VTT. The battle map says
// where you physically are; this says where you are in the world. Rendered on
// a 2D canvas: flat cartography — thin lines, small type, restrained
// highlights — with the interesting motion in the CAMERA (atlasMath.ts, where
// it is tested). In a netplay session the host serves players the role-filtered
// document over the wire (they have none of the host's campaign data), and
// BROADCAST VIEW flies any or every player's camera to a place.
export function AtlasWindow({ campaignId, curator, onClose, focus, standalone, bridgePlayer, onPopOut }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<AtlasDoc>(() => emptyAtlas());
  const [readOnly, setReadOnly] = useState(false);
  const [netReady, setNetReady] = useState(false);
  const [tool, setTool] = useState<Tool>("pan");
  const [cfgOpen, setCfgOpen] = useState(false);
  const [zoneState, setZoneState] = useState<ZoneState>("null-locked");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selZoneId, setSelZoneId] = useState<string | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [bridgePeers, setBridgePeers] = useState<{ id: string; name: string }[]>([]);
  // The DOM readout (SCALE / COORD / WORLD TIME) cannot watch camRef mutate, so
  // the render loop pushes the strings into state when they change.
  const [hud, setHud] = useState({ scale: "", coord: "—", clock: "" });
  const camRef = useRef<AtlasCamera>(makeCamera(250, 150, 1.2));
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const burstsRef = useRef<NullBurst[]>([]);
  const draftRef = useRef<AtlasPoint[]>([]);
  const flightRef = useRef<{ from: AtlasCamera; to: FlyTarget; start: number; ms: number } | null>(null);
  const rafRef = useRef(0);
  const drag = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null);

  const net = useNet();
  const isNetPlayer = net.status === "connected" && net.role === "player";
  const isNetHost = net.status === "connected" && net.role === "host";
  const hostId = net.peers.find((p) => p.role === "host")?.id;
  const netPlayers = useMemo(() => net.peers.filter((p) => p.role === "player"), [net.peers]);
  const netRef = useRef(net);
  netRef.current = net;

  // A popped-out window on a joined player's machine has no local campaign
  // data at all: the bridge is its only source, and it is read-only.
  const feedFromBridge = !!standalone && !!bridgePlayer;

  // What this viewer is ALLOWED to have. Players never receive curator-only
  // material in their document at all — over the wire it was filtered by the
  // host before sending; locally this same filter applies.
  const visible = useMemo(() => atlasForRole(doc, curator ? "curator" : "player"), [doc, curator]);
  const locked = readOnly || isNetPlayer || feedFromBridge;
  const editing = curator && !locked;

  // The live selected node/zone, derived from the document — a SNAPSHOT here
  // was the rename bug: the card's input rendered a stale copy, so every
  // keystroke snapped back to the old name.
  const selected = useMemo(() => visible.nodes.find((n) => n.id === selectedId) ?? null, [visible, selectedId]);
  const selZone = useMemo(() => visible.zones.find((z) => z.id === selZoneId) ?? null, [visible, selZoneId]);

  // ── load / save ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isNetPlayer || feedFromBridge) return; // the wire/bridge is the only source
    let live = true;
    void loadAtlas(campaignId).then(({ doc: d, refused }) => {
      if (!live) return;
      setDoc(d);
      setReadOnly(refused);
      camRef.current = makeCamera(d.widthMi / 2, d.heightMi / 2, Math.max(0.05, 500 / Math.max(d.widthMi, 1)));
    });
    return () => {
      live = false;
    };
  }, [campaignId, isNetPlayer, feedFromBridge]);

  // Joined player: ask the host for the world, adopt whatever arrives (it is
  // untrusted input like any other — parseAtlas gates it).
  const gotNetDoc = useRef(false);
  const adoptDoc = useCallback((raw: unknown) => {
    const d = parseAtlas(raw);
    if (!d) return;
    setDoc(d);
    setNetReady(true);
    // Frame the world on the FIRST document only — a Curator edit arriving
    // mid-pan must never yank the player's camera home.
    if (!gotNetDoc.current) {
      gotNetDoc.current = true;
      camRef.current = makeCamera(d.widthMi / 2, d.heightMi / 2, Math.max(0.05, 500 / Math.max(d.widthMi, 1)));
    }
  }, []);
  useEffect(() => {
    if (!isNetPlayer || !hostId || standalone) return;
    const n = netRef.current;
    const un = n.subscribe("atlas", (m, from) => {
      if (from !== hostId) return;
      adoptDoc((m as Extract<NetMessage, { t: "atlas" }>).doc);
    });
    n.publish({ t: "atlas-request" }, hostId);
    // The reply can be legitimately lost (host mid-load, transport hiccup, an
    // oversize doc the host is being warned about) — keep asking, quietly.
    const retry = window.setInterval(() => {
      if (gotNetDoc.current) {
        window.clearInterval(retry);
        return;
      }
      netRef.current.publish({ t: "atlas-request" }, hostId);
    }, 4000);
    return () => {
      window.clearInterval(retry);
      un();
    };
  }, [isNetPlayer, hostId, standalone, adoptDoc]);

  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<AtlasDoc | null>(null);
  const saver = useRef<ReturnType<typeof registerSaver> | null>(null);
  useEffect(() => {
    if (isNetPlayer || feedFromBridge) return; // nothing of the host's is ours to persist
    const s = registerSaver("the Atlas", async () => {
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      window.clearTimeout(saveTimer.current);
      await saveAtlas(campaignId, p);
      saver.current?.markSaved();
      // Mirror the debounce path: a flush-triggered save must reach players
      // too, or a host who minimizes mid-edit leaves the table on a stale map.
      publishDoc.current(p);
    });
    saver.current = s;
    return () => {
      // Closing the window must not orphan an edit still inside the debounce:
      // once unregistered, the app-close flush no longer knows about it.
      const p = pending.current;
      if (p) {
        pending.current = null;
        window.clearTimeout(saveTimer.current);
        void reportSaveFailure(saveAtlas(campaignId, p), "the Atlas");
        publishDoc.current(p);
      }
      s.unregister();
      saver.current = null;
    };
  }, [campaignId, isNetPlayer, feedFromBridge]);

  // The host serves the table: every debounced save also broadcasts the
  // role-FILTERED document, so players' maps follow the Curator's edits.
  const warnedWire = useRef(false);
  const publishDoc = useRef<(d: AtlasDoc) => void>(() => {});
  publishDoc.current = (d) => {
    if (standalone) {
      // The main window owns the session; it re-reads the DB (just written by
      // this save) and broadcasts the filtered doc if it is hosting.
      bridgeEmit({ kind: "saved", campaignId });
      return;
    }
    if (!isNetHost) return;
    const msg = { t: "atlas" as const, doc: atlasForRole(d, "player") };
    if (JSON.stringify(msg).length > MAX_ATLAS_WIRE_CHARS) {
      if (!warnedWire.current) {
        warnedWire.current = true;
        pushToast("The Atlas is too large to send to players (over 20 MB). Use a smaller map image or smaller sprites.", "error");
      }
      return;
    }
    warnedWire.current = false;
    net.publish(msg);
  };

  const mutate = useCallback(
    (fn: (d: AtlasDoc) => AtlasDoc, opts?: { publish?: boolean }) => {
      if (locked) return;
      // The updater only computes; the save bookkeeping happens out here —
      // markPending() setStates ANOTHER component (the save chip), which React
      // forbids from inside a render-phase updater.
      setDoc((d) => {
        const next = fn(d);
        pending.current = next;
        return next;
      });
      saver.current?.markPending();
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        const p = pending.current;
        if (!p) return;
        pending.current = null;
        void reportSaveFailure(saveAtlas(campaignId, p), "the Atlas").then(() => saver.current?.markSaved());
        if (opts?.publish !== false) publishDoc.current(p);
      }, 800);
    },
    [campaignId, locked]
  );

  // ── map image ──────────────────────────────────────────────────────────────
  async function onMapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const uri = await fileToImageDataUrl(f, 4096, MAX_ATLAS_WIRE_CHARS).catch((err: Error) => {
      pushToast(err.message || "That image could not be used for the map.", "error");
      return null;
    });
    if (!uri) return;
    const probe = new Image();
    probe.onload = () => {
      // Width stays authoritative; height follows the image's aspect so the
      // two can never disagree about the shape of the world. A disc has one
      // diameter.
      mutate((d) => ({
        ...d,
        image: uri,
        heightMi: d.shape === "circle" ? d.widthMi : +(d.widthMi * (probe.height / probe.width)).toFixed(1),
      }));
    };
    probe.src = uri;
  }

  // ── the world clock ────────────────────────────────────────────────────────
  // Authority is doc.clock.hour; when auto, every viewer advances it locally
  // from the moment the document last changed, and the Curator persists (and
  // therefore rebroadcasts) the running hour once a minute so everyone stays
  // within a minute of agreement.
  const clockBase = useRef({ hour: 12, at: performance.now() });
  useEffect(() => {
    clockBase.current = { hour: doc.clock.hour, at: performance.now() };
  }, [doc.clock.hour, doc.clock.auto, doc.clock.speed]);
  const displayHour = useCallback(
    (now: number) => {
      const c = doc.clock;
      if (!c.auto) return c.hour;
      return (((clockBase.current.hour + ((now - clockBase.current.at) / 60000) * c.speed) % 24) + 24) % 24;
    },
    [doc.clock]
  );
  useEffect(() => {
    if (!editing || !doc.clock.auto) return;
    const iv = window.setInterval(() => {
      // publish: false — every viewer advances the running clock locally, so
      // this is bookkeeping, not news; the full doc must not ride the wire
      // once a minute just to move an hour hand.
      mutate((d) => ({ ...d, clock: { ...d.clock, hour: +displayHour(performance.now()).toFixed(2) } }), { publish: false });
    }, 60_000);
    return () => window.clearInterval(iv);
  }, [editing, doc.clock.auto, mutate, displayHour]);

  // ── flight ─────────────────────────────────────────────────────────────────
  const startFlight = useCallback((to: FlyTarget, ms = 1100) => {
    flightRef.current = { from: camRef.current, to, start: performance.now(), ms };
  }, []);

  function frameZoom(): number {
    const v = sizeOf();
    return clampZoom(Math.max(camRef.current.zoom, v.width / Math.max(1, visible.widthMi / 6)));
  }

  const flyToNode = useCallback(
    (n: AtlasNode) => startFlight({ x: n.x, y: n.y, zoom: frameZoom() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startFlight, visible.widthMi]
  );

  /** BROADCAST VIEW: fly one player — or the whole table — to a node. */
  function bring(n: AtlasNode, to?: string) {
    if (standalone) {
      bridgeEmit({ kind: "bring", x: n.x, y: n.y, zoom: frameZoom(), label: n.name, to });
    } else {
      const msg: NetMessage = { t: "atlas-focus", x: n.x, y: n.y, zoom: frameZoom(), label: n.name };
      net.publish(msg, to);
    }
    if (!to) flyToNode(n); // Focus Everyone includes the Curator
  }

  const bannerTimer = useRef<number | undefined>(undefined);
  const applyFocus = useCallback(
    (f: { x: number; y: number; zoom?: number; label?: string }) => {
      startFlight({ x: f.x, y: f.y, zoom: f.zoom ?? camRef.current.zoom }, 1300);
      setBanner("CARTOGRAPHIC UPDATE RECEIVED" + (f.label ? " // " + f.label.toUpperCase() : ""));
      window.clearTimeout(bannerTimer.current);
      bannerTimer.current = window.setTimeout(() => setBanner(null), 4200);
    },
    [startFlight]
  );
  useEffect(() => () => window.clearTimeout(bannerTimer.current), []);
  useEffect(() => {
    if (focus) applyFocus(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  // The popped window's side of the bridge: adopt forwarded documents, fly on
  // forwarded broadcasts, keep the BRING roster fresh — and if this machine is
  // a joined player's, keep asking for the world until it arrives.
  useEffect(() => {
    if (!standalone) return;
    const un = bridgeListen((m) => {
      if (m.kind === "netDoc" && feedFromBridge) adoptDoc(m.doc);
      else if (m.kind === "focus") applyFocus(m);
      else if (m.kind === "peers") setBridgePeers(m.players);
    });
    bridgeEmit({ kind: "hello" });
    let retry: number | undefined;
    if (feedFromBridge) {
      bridgeEmit({ kind: "want" });
      retry = window.setInterval(() => {
        if (gotNetDoc.current) window.clearInterval(retry);
        else bridgeEmit({ kind: "want" });
      }, 4000);
    }
    return () => {
      window.clearInterval(retry);
      un();
    };
  }, [standalone, feedFromBridge, adoptDoc, applyFocus]);

  // ── the render loop ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const view = { width: canvas.width, height: canvas.height };
    const cam = camRef.current;
    const now = performance.now();

    // ground
    ctx.fillStyle = "#101318";
    ctx.fillRect(0, 0, view.width, view.height);

    // the world, spanning [0,widthMi] × [0,heightMi] — clipped to its shape,
    // so a circular world visibly ENDS at the rim
    const tl = worldToScreen(cam, view, { x: 0, y: 0 });
    const br = worldToScreen(cam, view, { x: visible.widthMi, y: visible.heightMi });
    const circle = visible.shape === "circle";
    const rim = {
      x: (tl.x + br.x) / 2,
      y: (tl.y + br.y) / 2,
      r: Math.max(1, (br.x - tl.x) / 2),
    };
    const mapArt = visible.image ? AtlasArt.get(visible.image) : null;
    const frame = mapArt?.frame(now) ?? null;
    if (circle) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(rim.x, rim.y, rim.r, 0, Math.PI * 2);
      ctx.clip();
    }
    if (frame) {
      ctx.globalAlpha = 0.92;
      ctx.drawImage(frame, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.globalAlpha = 1;
    } else if (!circle) {
      ctx.strokeStyle = "#232a33";
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }
    if (circle) {
      ctx.restore();
      // the rim: the edge of the surveyed world
      ctx.strokeStyle = "rgba(126,207,202,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rim.x, rim.y, rim.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(126,207,202,0.12)";
      ctx.beginPath();
      ctx.arc(rim.x, rim.y, rim.r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // navigation grid, stepped with the scale bar so the legend never lies
    const bar = pickScaleBar(cam.zoom, visible.units);
    ctx.strokeStyle = "rgba(160,180,190,0.10)";
    ctx.lineWidth = 1;
    const x0 = Math.floor(screenToWorld(cam, view, { x: 0, y: 0 }).x / bar.stepMi) * bar.stepMi;
    const y0 = Math.floor(screenToWorld(cam, view, { x: 0, y: 0 }).y / bar.stepMi) * bar.stepMi;
    const xEnd = screenToWorld(cam, view, { x: view.width, y: 0 }).x;
    const yEnd = screenToWorld(cam, view, { x: 0, y: view.height }).y;
    ctx.beginPath();
    for (let x = x0; x <= xEnd; x += bar.stepMi) {
      const sx = worldToScreen(cam, view, { x, y: 0 }).x;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, view.height);
    }
    for (let y = y0; y <= yEnd; y += bar.stepMi) {
      const sy = worldToScreen(cam, view, { x: 0, y }).y;
      ctx.moveTo(0, sy);
      ctx.lineTo(view.width, sy);
    }
    ctx.stroke();

    // zones
    const pathZone = (z: AtlasZone) => {
      ctx.beginPath();
      const first = worldToScreen(cam, view, z.polygon[0]);
      ctx.moveTo(first.x, first.y);
      for (const p of z.polygon.slice(1)) {
        const s = worldToScreen(cam, view, p);
        ctx.lineTo(s.x, s.y);
      }
      ctx.closePath();
    };
    for (const z of visible.zones) {
      if (z.polygon.length < 3) continue;
      // custom art first, clipped to the shape — the zone's state then draws
      // OVER it, so a null-locked zone hides its art exactly as it hides its
      // terrain
      if (z.sprite) {
        const art = AtlasArt.get(z.sprite);
        const f = art.frame(now);
        if (f && art.width > 0 && art.height > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of z.polygon) {
            const s = worldToScreen(cam, view, p);
            minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
            maxX = Math.max(maxX, s.x); maxY = Math.max(maxY, s.y);
          }
          const bw = maxX - minX, bh = maxY - minY;
          if (bw > 2 && bh > 2 && minX < view.width && minY < view.height && maxX > 0 && maxY > 0) {
            const scale = Math.max(bw / art.width, bh / art.height);
            const dw = art.width * scale, dh = art.height * scale;
            ctx.save();
            pathZone(z);
            ctx.clip();
            ctx.globalAlpha = 0.9;
            ctx.drawImage(f, minX + (bw - dw) / 2, minY + (bh - dh) / 2, dw, dh);
            ctx.globalAlpha = 1;
            ctx.restore();
          }
        }
      }
      pathZone(z);
      const selectedZone = editing && z.id === selZoneId;
      switch (z.state) {
        case "visible":
          if (curator) {
            ctx.strokeStyle = "rgba(126,207,202,0.35)";
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          break;
        case "surveyed":
          ctx.fillStyle = "rgba(20,26,32,0.35)";
          ctx.fill();
          break;
        case "unconfirmed":
          ctx.fillStyle = "rgba(8,10,13,0.7)";
          ctx.fill();
          ctx.strokeStyle = "rgba(160,180,190,0.15)";
          ctx.setLineDash([2, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        case "null-locked": {
          ctx.fillStyle = curator ? "rgba(0,0,0,0.55)" : "rgba(2,3,4,0.94)";
          ctx.fill();
          // crawling edge: short jittered segments, deterministic per second so
          // it breathes instead of boiling
          const salt = Math.floor(now / 450);
          ctx.strokeStyle = "rgba(90,110,120,0.35)";
          for (let i = 0; i < z.polygon.length; i++) {
            const a = worldToScreen(cam, view, z.polygon[i]);
            const b = worldToScreen(cam, view, z.polygon[(i + 1) % z.polygon.length]);
            const h = Math.abs(Math.sin(i * 12.9898 + salt) * 43758.5453) % 1;
            const t0 = h * 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0);
            ctx.lineTo(a.x + (b.x - a.x) * (t0 + 0.25), a.y + (b.y - a.y) * (t0 + 0.25));
            ctx.stroke();
          }
          break;
        }
        case "curator-only":
          // only ever present in the curator's document
          ctx.strokeStyle = "rgba(154,122,204,0.5)";
          ctx.setLineDash([6, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
      }
      if (selectedZone) {
        pathZone(z);
        ctx.strokeStyle = "rgba(126,207,202,0.9)";
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // ambient particles — only where the zone itself is open to this viewer;
      // hidden means hidden, and weather over a void would betray it
      if (z.fx && (curator || z.state === "visible" || z.state === "surveyed")) {
        drawZoneFx(ctx, cam, view, z, now);
      }
      // the name, at the centroid — never over the void for players
      if (z.name && (curator || z.state === "visible" || z.state === "surveyed" || z.state === "unconfirmed")) {
        let cx = 0, cy = 0;
        for (const p of z.polygon) { cx += p.x; cy += p.y; }
        const c = worldToScreen(cam, view, { x: cx / z.polygon.length, y: cy / z.polygon.length });
        ctx.font = "10px Consolas, monospace";
        ctx.fillStyle = "rgba(160,180,190,0.6)";
        const label = z.name.toUpperCase();
        ctx.fillText(label, c.x - ctx.measureText(label).width / 2, c.y);
      }
    }

    // day / night: the world under its own sky. Painted here — over the map
    // and zones, UNDER the instruments (draft trail, nodes, measurement) so
    // night never dims the readouts in the operator's hand.
    const shade = dayNightShade(displayHour(now));
    if (shade.warmth > 0.01) {
      ctx.fillStyle = `rgba(255,140,60,${(shade.warmth * 0.1).toFixed(3)})`;
      ctx.fillRect(0, 0, view.width, view.height);
    }
    if (shade.dark > 0.01) {
      ctx.fillStyle = `rgba(6,9,20,${shade.dark.toFixed(3)})`;
      ctx.fillRect(0, 0, view.width, view.height);
    }

    // zone being drawn: the trail, and the closing segment it will get on release
    const draft = draftRef.current;
    if (draft.length > 0) {
      ctx.strokeStyle = "rgba(126,207,202,0.8)";
      ctx.beginPath();
      const s0 = worldToScreen(cam, view, draft[0]);
      ctx.moveTo(s0.x, s0.y);
      for (const p of draft.slice(1)) {
        const s = worldToScreen(cam, view, p);
        ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
      if (draft.length > 2) {
        const sl = worldToScreen(cam, view, draft[draft.length - 1]);
        ctx.strokeStyle = "rgba(126,207,202,0.35)";
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(sl.x, sl.y);
        ctx.lineTo(s0.x, s0.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // nodes
    ctx.font = "10px Consolas, monospace";
    for (const n of visible.nodes) {
      if (!nodeVisibleAtZoom(n, cam.zoom)) continue;
      const s = worldToScreen(cam, view, n);
      if (s.x < -60 || s.y < -60 || s.x > view.width + 60 || s.y > view.height + 60) continue;
      const mine = selectedId === n.id;
      let labelX = s.x + 8;
      if (n.sprite) {
        const art = AtlasArt.get(n.sprite);
        const f = art.frame(now);
        if (f && art.width > 0 && art.height > 0) {
          const h = 36;
          const w = Math.min(84, Math.max(12, (art.width / art.height) * h));
          ctx.drawImage(f, s.x - w / 2, s.y - h / 2, w, h);
          if (mine) {
            ctx.strokeStyle = "rgba(126,207,202,0.9)";
            ctx.strokeRect(s.x - w / 2 - 3, s.y - h / 2 - 3, w + 6, h + 6);
          }
          labelX = s.x + w / 2 + 6;
        }
      } else {
        ctx.strokeStyle = n.visibility === "curator" ? "rgba(154,122,204,0.9)" : "rgba(126,207,202,0.9)";
        ctx.fillStyle = mine ? "rgba(126,207,202,0.9)" : "rgba(16,19,24,0.9)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(190,205,210,0.85)";
      ctx.fillText(n.name.toUpperCase(), labelX, s.y + 3);
    }

    // measurement
    if (measure) {
      const a = worldToScreen(cam, view, measure.a);
      const b = worldToScreen(cam, view, measure.b);
      ctx.strokeStyle = "rgba(126,207,202,0.9)";
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.fillStyle = "rgba(190,205,210,0.95)";
      ctx.font = "11px Consolas, monospace";
      ctx.fillText("DIRECT DISTANCE", mid.x + 8, mid.y - 8);
      ctx.fillText(formatDistance(distanceMi(measure.a, measure.b), visible.units), mid.x + 8, mid.y + 6);
    }

    // ── null rejection ──────────────────────────────────────────────────────
    // Hovering a hidden region is not nothing: the map rejects the observer.
    const hover = hoverRef.current;
    if (hover && !curator) {
      const wp = screenToWorld(cam, view, hover);
      const inNull = visible.zones.some((z) => z.state === "null-locked" && pointInPolygon(wp, z.polygon));
      if (inNull) {
        const salt = Math.floor(now / 120);
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        for (let i = 0; i < 7; i++) {
          const h1 = Math.abs(Math.sin((salt + i) * 12.9898) * 43758.5453) % 1;
          const h2 = Math.abs(Math.sin((salt + i) * 78.233) * 12543.123) % 1;
          ctx.fillRect(hover.x + (h1 - 0.5) * 90, hover.y + (h2 - 0.5) * 60, 6 + h1 * 26, 2 + h2 * 8);
        }
        ctx.fillStyle = "rgba(200,60,60,0.9)";
        ctx.font = "10px Consolas, monospace";
        ctx.fillText(nullReadout(wp, salt), hover.x + 14, hover.y - 10);
      }
    }
    // click bursts: spread out, collapse back
    burstsRef.current = burstsRef.current.filter((b) => now - b.at < 650);
    for (const b of burstsRef.current) {
      const t = (now - b.at) / 650;
      const r = t < 0.5 ? t * 2 : (1 - t) * 2;
      ctx.fillStyle = `rgba(0,0,0,${0.9 * (1 - t)})`;
      for (let i = 0; i < 10; i++) {
        const h1 = Math.abs(Math.sin((b.at + i) * 12.9898) * 43758.5453) % 1;
        const ang = h1 * Math.PI * 2;
        const d = r * 70 * (0.4 + h1);
        ctx.fillRect(b.x + Math.cos(ang) * d, b.y + Math.sin(ang) * d, 4 + h1 * 30, 3 + h1 * 6);
      }
    }
  }, [visible, curator, editing, measure, selectedId, selZoneId, displayHour]);

  // rAF loop: flight, inertia, redraw. stepInertia returns the identical object
  // at rest, but the glitch effects animate, so the loop runs while the window
  // is open — it is one small canvas, not the battle map.
  useEffect(() => {
    let last = performance.now();
    const tick = () => {
      const c = canvasRef.current;
      // Backing store follows the element HERE, not only in a ResizeObserver —
      // observers can be deferred while the window is hidden, and a canvas
      // whose backing store disagrees with its CSS size draws a blurry, offset
      // world with every hit-test wrong. This is also what makes the window
      // freely resizable: drag the corner and the world follows.
      if (c && (c.width !== c.clientWidth || c.height !== c.clientHeight)) {
        c.width = c.clientWidth;
        c.height = c.clientHeight;
      }
      const now = performance.now();
      const flight = flightRef.current;
      if (flight) {
        const t = (now - flight.start) / flight.ms;
        camRef.current = flyCamera(flight.from, flight.to, t);
        if (t >= 1) flightRef.current = null;
      } else {
        camRef.current = stepInertia(camRef.current, now - last);
      }
      camRef.current = clampToMap(camRef.current, sizeOf(), doc.widthMi, doc.heightMi);
      last = now;
      draw();
      // HUD: pushed from the loop because camRef mutates without React ever
      // hearing about it. Same-string updates are free.
      const bar2 = pickScaleBar(camRef.current.zoom, visible.units);
      const h = hoverRef.current;
      const coord = h ? coordLabel(screenToWorld(camRef.current, sizeOf(), h), visible.name) : "—";
      const clock = formatWorldClock(displayHour(now));
      setHud((prev) => (prev.scale === bar2.label && prev.coord === coord && prev.clock === clock ? prev : { scale: bar2.label, coord, clock }));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    // Dev-only handle, same pattern as __vttEngine: lets tooling single-step a
    // frame when rAF is suspended (hidden window). Stripped from production.
    if (import.meta.env.DEV) (window as unknown as { __atlasTick?: () => void }).__atlasTick = tick;
    return () => {
      cancelAnimationFrame(rafRef.current);
      // The dev handle must die with the loop — a console call after unmount
      // would otherwise resurrect a self-rescheduling rAF forever.
      if (import.meta.env.DEV) delete (window as unknown as { __atlasTick?: () => void }).__atlasTick;
    };
  }, [draw, doc.widthMi, doc.heightMi, visible.units, visible.name, displayHour]);

  function sizeOf() {
    const c = canvasRef.current;
    return { width: c?.width ?? 800, height: c?.height ?? 500 };
  }

  // keep the canvas backing store at element size
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => {
      c.width = c.clientWidth;
      c.height = c.clientHeight;
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // ── interactions ───────────────────────────────────────────────────────────
  const local = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onDown(e: React.MouseEvent) {
    const s = local(e);
    flightRef.current = null; // grabbing the map takes the controls back
    drag.current = { ...s, t: performance.now(), moved: false };
    if (tool === "measure") {
      const w = screenToWorld(camRef.current, sizeOf(), s);
      setMeasure({ a: w, b: w });
    } else if (tool === "zone" && editing) {
      draftRef.current = [screenToWorld(camRef.current, sizeOf(), s)];
    }
  }

  function onMove(e: React.MouseEvent) {
    const s = local(e);
    hoverRef.current = s;
    const d = drag.current;
    if (!d) return;
    const dx = s.x - d.x;
    const dy = s.y - d.y;
    if (Math.hypot(dx, dy) > 3) d.moved = true;
    if (tool === "pan" && d.moved) {
      const dt = Math.max(1, performance.now() - d.t);
      const cam = panBy(camRef.current, dx, dy);
      // record velocity for the glide, in world mi/s
      camRef.current = { ...cam, vx: (-dx / cam.zoom / dt) * 1000, vy: (-dy / cam.zoom / dt) * 1000 };
      drag.current = { x: s.x, y: s.y, t: performance.now(), moved: true };
    } else if (tool === "measure" && measure) {
      setMeasure({ a: measure.a, b: screenToWorld(camRef.current, sizeOf(), s) });
    } else if (tool === "zone" && editing && draftRef.current.length > 0) {
      // fluid drawing: keep a point every few pixels of trail
      const cam = camRef.current;
      const view = sizeOf();
      const lastS = worldToScreen(cam, view, draftRef.current[draftRef.current.length - 1]);
      if (Math.hypot(s.x - lastS.x, s.y - lastS.y) >= 4) {
        draftRef.current.push(screenToWorld(cam, view, s));
      }
    }
  }

  function onUp(e: React.MouseEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const s = local(e);
    const wp = screenToWorld(camRef.current, sizeOf(), s);
    if (tool === "zone" && editing) {
      // release closes the shape by itself — the trail connects back to its
      // start, simplified so a minute of tracing stays a handful of vertices
      const pts = simplifyPath(draftRef.current, 3 / camRef.current.zoom);
      draftRef.current = [];
      if (pts.length >= 3) {
        const id = uid();
        mutate((doc0) => ({ ...doc0, zones: [...doc0.zones, { id, state: zoneState, polygon: pts }] }));
        setSelectedId(null); // the fresh zone's card, not a leftover node's
        setSelZoneId(id);
      }
      return;
    }
    if (tool === "pan" && !d.moved) {
      camRef.current = { ...camRef.current, vx: 0, vy: 0 };
      // a plain click: select a node, else a zone (curator), else bounce off a
      // null region
      const cam = camRef.current;
      const view = sizeOf();
      const hit = visible.nodes.find((n) => {
        if (!nodeVisibleAtZoom(n, cam.zoom)) return false;
        const p = worldToScreen(cam, view, n);
        return Math.hypot(p.x - s.x, p.y - s.y) < 12;
      });
      if (hit) {
        setSelectedId(hit.id);
        setSelZoneId(null);
        return;
      }
      setSelectedId(null);
      if (editing) {
        const zhit = [...visible.zones].reverse().find((z) => pointInPolygon(wp, z.polygon));
        setSelZoneId(zhit ? zhit.id : null);
        if (zhit) return;
      }
      if (!curator && visible.zones.some((z) => z.state === "null-locked" && pointInPolygon(wp, z.polygon))) {
        burstsRef.current.push({ x: s.x, y: s.y, at: performance.now() });
      }
    } else if (tool === "pan" && d.moved) {
      // release into the glide; velocity was set during the drag
    } else if (tool === "node" && editing) {
      const id = uid();
      mutate((doc0) => ({
        ...doc0,
        nodes: [...doc0.nodes, { id, name: "NEW NODE", kind: "landmark", x: wp.x, y: wp.y, visibility: "player" }],
      }));
      setTool("pan");
      setSelectedId(id); // the card opens ready to rename
    }
  }

  function onWheel(e: React.WheelEvent) {
    flightRef.current = null;
    const factor = Math.exp(-e.deltaY * 0.0015);
    camRef.current = zoomAt(camRef.current, sizeOf(), local(e), factor);
  }

  function onDoubleClick(e: React.MouseEvent) {
    // the Google Earth gesture: double-click flies you there
    if (tool !== "pan") return;
    const wp = screenToWorld(camRef.current, sizeOf(), local(e));
    startFlight({ x: wp.x, y: wp.y, zoom: clampZoom(camRef.current.zoom * 2.5) }, 700);
  }

  function zoomWidget(factor: number) {
    flightRef.current = null;
    const v = sizeOf();
    camRef.current = zoomAt(camRef.current, v, { x: v.width / 2, y: v.height / 2 }, factor);
  }

  function fitMap() {
    const v = sizeOf();
    startFlight(
      {
        x: visible.widthMi / 2,
        y: visible.heightMi / 2,
        zoom: clampZoom(Math.min(v.width / visible.widthMi, v.height / visible.heightMi) * 0.9),
      },
      900
    );
  }

  const waiting = (isNetPlayer || feedFromBridge) && !netReady;

  return (
    <div className={"atlas-window" + (standalone ? " standalone" : "")}>
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>
          {visible.name.toUpperCase()} // MOGUL SURVEY CARTOGRAPH
        </span>
        {!standalone && onPopOut && (
          <button className="ghost-btn xs" onClick={onPopOut} title="Open the Atlas as its own window — drag it to another monitor">
            Pop out
          </button>
        )}
        <button className="cdx-tab-x" onClick={onClose} title="Close the Atlas">
          ×
        </button>
      </div>

      {readOnly && !isNetPlayer && (
        <p className="atlas-note">This Atlas was made by a newer version of W.T.E and is shown read-only.</p>
      )}

      <div className="atlas-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="atlas-canvas"
          style={{ cursor: tool === "pan" ? "grab" : "crosshair" }}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={() => {
            hoverRef.current = null;
            drag.current = null;
            draftRef.current = [];
          }}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
        />

        {banner && <div className="atlas-banner">{banner}</div>}
        {waiting && <div className="atlas-banner">REQUESTING SURVEY DATA FROM THE CURATOR…</div>}

        <div className="atlas-widgets">
          <button className={"atlas-widget" + (tool === "pan" ? " active" : "")} onClick={() => setTool("pan")} title="Navigate — drag to pan, wheel to zoom, double-click to fly">
            NAV
          </button>
          <button className={"atlas-widget" + (tool === "measure" ? " active" : "")} onClick={() => { setTool("measure"); setMeasure(null); }} title="Measure — drag a line to read the distance">
            MEA
          </button>
          {editing && (
            <>
              <button className={"atlas-widget" + (tool === "node" ? " active" : "")} onClick={() => setTool("node")} title="Place a node">
                NODE
              </button>
              <button className={"atlas-widget" + (tool === "zone" ? " active" : "")} onClick={() => { setTool("zone"); draftRef.current = []; }} title="Draw a zone — drag its outline; release closes the shape">
                ZONE
              </button>
              <button className={"atlas-widget" + (cfgOpen ? " active" : "")} onClick={() => setCfgOpen((v) => !v)} title="Map setup — image, shape, size, units, world clock">
                CFG
              </button>
            </>
          )}
        </div>

        <div className="atlas-widgets zoomers">
          <button className="atlas-widget lg" onClick={() => zoomWidget(1.5)} title="Zoom in">
            +
          </button>
          <button className="atlas-widget lg" onClick={() => zoomWidget(1 / 1.5)} title="Zoom out">
            −
          </button>
          <button className="atlas-widget" onClick={fitMap} title="Frame the whole world">
            FIT
          </button>
        </div>

        {editing && tool === "zone" && (
          <div className="atlas-config zone-cfg">
            <div className="atlas-cfg-row">
              <span>New zone</span>
              <select className="bg-select" value={zoneState} onChange={(e) => setZoneState(e.target.value as ZoneState)}>
                <option value="visible">visible</option>
                <option value="surveyed">surveyed</option>
                <option value="unconfirmed">unconfirmed</option>
                <option value="null-locked">null-locked</option>
                <option value="curator-only">curator only</option>
              </select>
            </div>
            <p className="atlas-note" style={{ margin: 0 }}>Drag the outline; release closes the shape.</p>
          </div>
        )}

        {editing && cfgOpen && (
          <div className="atlas-config">
            <div className="atlas-cfg-row">
              <button className="ghost-btn xs" onClick={() => fileRef.current?.click()}>
                Map image…
              </button>
              <select
                className="bg-select"
                value={doc.shape}
                onChange={(e) => {
                  const shape = e.target.value === "circle" ? "circle" : "rect";
                  mutate((d) => ({ ...d, shape, heightMi: shape === "circle" ? d.widthMi : d.heightMi }));
                }}
                title="The world's shape — a circular world is a disc that ends at its rim"
              >
                <option value="rect">rectangular</option>
                <option value="circle">circular</option>
              </select>
            </div>
            <div className="atlas-cfg-row">
              <label className="atlas-width">
                {doc.shape === "circle" ? "Diameter" : "Width"}
                <input
                  className="bg-select"
                  type="number"
                  min={1}
                  value={doc.widthMi}
                  onChange={(e) => {
                    const w = Math.max(1, parseFloat(e.target.value) || 1);
                    mutate((d) => ({
                      ...d,
                      heightMi: d.shape === "circle" ? w : +(d.heightMi * (w / d.widthMi)).toFixed(1),
                      widthMi: w,
                    }));
                  }}
                />
                mi
              </label>
              <select
                className="bg-select"
                value={doc.units}
                onChange={(e) => mutate((d) => ({ ...d, units: e.target.value as AtlasDoc["units"] }))}
              >
                <option value="imperial">Imperial</option>
                <option value="metric">Metric</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className="atlas-cfg-row">
              <span>Clock</span>
              <input
                type="range"
                min={0}
                max={24}
                step={0.25}
                value={doc.clock.hour}
                onChange={(e) => mutate((d) => ({ ...d, clock: { ...d.clock, hour: parseFloat(e.target.value) } }))}
                title="World time"
              />
              <b className="atlas-clock-readout">{formatWorldClock(doc.clock.hour)}</b>
            </div>
            <div className="atlas-cfg-row">
              <button
                className={"ghost-btn xs" + (doc.clock.auto ? " strong" : "")}
                onClick={() => mutate((d) => ({ ...d, clock: { ...d.clock, auto: !d.clock.auto } }))}
                title="Let world time pass by itself"
              >
                {doc.clock.auto ? "Auto: on" : "Auto: off"}
              </button>
              {doc.clock.auto && (
                <select
                  className="bg-select"
                  value={String(doc.clock.speed)}
                  onChange={(e) => mutate((d) => ({ ...d, clock: { ...d.clock, speed: parseFloat(e.target.value) } }))}
                  title="Game hours per real minute"
                >
                  <option value="0.5">0.5 h/min</option>
                  <option value="1">1 h/min</option>
                  <option value="2">2 h/min</option>
                  <option value="5">5 h/min</option>
                  <option value="10">10 h/min</option>
                  <option value="30">30 h/min</option>
                </select>
              )}
            </div>
          </div>
        )}

        {selected && (
          <NodeCard
            node={selected}
            editing={editing}
            players={standalone ? bridgePeers : netPlayers}
            canBring={curator && !readOnly && (isNetHost || (!!standalone && bridgePeers.length > 0))}
            onFocus={() => flyToNode(selected)}
            onBring={(to) => bring(selected, to)}
            onChange={(next) => mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === next.id ? next : n)) }))}
            onDelete={() => {
              mutate((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== selected.id) }));
              setSelectedId(null);
            }}
            onClose={() => setSelectedId(null)}
          />
        )}
        {!selected && selZone && editing && (
          <ZoneCard
            zone={selZone}
            onChange={(next) => mutate((d) => ({ ...d, zones: d.zones.map((z) => (z.id === next.id ? next : z)) }))}
            onDelete={() => {
              mutate((d) => ({ ...d, zones: d.zones.filter((z) => z.id !== selZone.id) }));
              setSelZoneId(null);
            }}
            onClose={() => setSelZoneId(null)}
          />
        )}
      </div>

      <div className="atlas-status">
        <span>
          SCALE | <b>{hud.scale.toUpperCase()}</b>
        </span>
        <span>COORD | {hud.coord}</span>
        <span>WORLD TIME | {hud.clock}</span>
        {measure && <span>MEASURE | {formatDistance(distanceMi(measure.a, measure.b), visible.units)}</span>}
        <span>OBSERVATIONAL RESOLUTION: {curator ? "FULL" : "PARTIAL"}</span>
      </div>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onMapFile(e)} />
    </div>
  );
}

// ── zone weather ─────────────────────────────────────────────────────────────

const frac = (n: number) => {
  const v = Math.abs(Math.sin(n) * 43758.5453);
  return v - Math.floor(v);
};

function zoneSeed(id: string): number {
  let s = 7;
  for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) % 99991;
  return s;
}

/** Stateless ambient particles: every position is a pure function of the zone,
 *  the particle index, and the clock, so peers need no shared emitter state and
 *  a paused frame costs nothing. Particles live in WORLD space — they stick to
 *  the map through pans and zooms. */
function drawZoneFx(
  ctx: CanvasRenderingContext2D,
  cam: AtlasCamera,
  view: { width: number; height: number },
  z: AtlasZone,
  now: number
) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of z.polygon) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return;
  const a = worldToScreen(cam, view, { x: minX, y: minY });
  const b = worldToScreen(cam, view, { x: maxX, y: maxY });
  if (b.x < 0 || b.y < 0 || a.x > view.width || a.y > view.height) return;
  const areaPx = (b.x - a.x) * (b.y - a.y);
  if (import.meta.env.DEV) {
    const dbg = ((window as unknown as { __atlasFx?: { calls: number; drawn: number } }).__atlasFx ??= { calls: 0, drawn: 0 });
    dbg.calls++;
  }
  const seed = zoneSeed(z.id);
  const t = now / 1000;
  const fog = z.fx === "fog";
  const count = fog
    ? Math.max(3, Math.min(10, Math.round(areaPx / 30000)))
    : Math.max(6, Math.min(64, Math.round(areaPx / 9000)));

  for (let i = 0; i < count; i++) {
    const h1 = frac(seed + i * 3.17);
    const h2 = frac(seed + i * 7.31 + 13);
    const h3 = frac(seed + i * 11.73 + 29);
    let wx: number;
    let wy: number;
    switch (z.fx) {
      case "embers":
        wx = minX + h1 * w + Math.sin(t * 1.4 + i) * w * 0.006;
        wy = maxY - ((h2 * h + t * h * 0.045 * (0.4 + h3)) % h);
        break;
      case "snow":
        wx = minX + ((h1 * w + Math.sin(t * 0.9 + i) * w * 0.01 + t * w * 0.004) % w);
        wy = minY + ((h2 * h + t * h * 0.05 * (0.4 + h3)) % h);
        break;
      case "fog":
        wx = minX + ((h1 * w + t * w * 0.008 * (0.3 + h3)) % w);
        wy = minY + h2 * h;
        break;
      default: // motes
        wx = minX + ((h1 * w + t * w * 0.008 * (0.3 + h3)) % w);
        wy = minY + ((h2 * h + t * h * 0.006 * (0.3 + h1)) % h);
        break;
    }
    if (!pointInPolygon({ x: wx, y: wy }, z.polygon)) continue;
    if (import.meta.env.DEV) {
      const dbg = (window as unknown as { __atlasFx?: { calls: number; drawn: number } }).__atlasFx;
      if (dbg) dbg.drawn++;
    }
    const s = worldToScreen(cam, view, { x: wx, y: wy });
    switch (z.fx) {
      case "embers": {
        const flicker = 0.55 + 0.35 * Math.sin(t * 9 + i * 2.3);
        ctx.fillStyle = `rgba(255,${140 + Math.round(60 * h3)},60,${(flicker * (0.35 + 0.4 * h3)).toFixed(3)})`;
        ctx.fillRect(s.x, s.y, 1.5 + h3 * 1.5, 1.5 + h3 * 1.5);
        break;
      }
      case "snow":
        ctx.fillStyle = "rgba(230,240,245,0.6)";
        ctx.fillRect(s.x, s.y, 1.5 + h3, 1.5 + h3);
        break;
      case "fog": {
        const r = Math.max(24, Math.min(160, Math.min(b.x - a.x, b.y - a.y) * (0.18 + h3 * 0.14)));
        ctx.fillStyle = "rgba(160,180,190,0.045)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default:
        ctx.fillStyle = "rgba(190,205,210,0.35)";
        ctx.fillRect(s.x, s.y, 1.5, 1.5);
        break;
    }
  }
}

// ── cards ────────────────────────────────────────────────────────────────────

function SpritePicker({ current, onPick, onClear }: { current?: string; onPick: (uri: string) => void; onClear: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="ghost-btn xs" onClick={() => ref.current?.click()} title="Custom art — PNG, JPG, or an animated GIF">
        Sprite…
      </button>
      {current && (
        <button className="ghost-btn xs" onClick={onClear} title="Remove the custom art">
          Clear
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          void fileToImageDataUrl(f, 2048, MAX_SPRITE_CHARS)
            .then(onPick)
            .catch((err: Error) => pushToast(err.message || "That image could not be used.", "error"));
        }}
      />
    </>
  );
}

function NodeCard({
  node,
  editing,
  players,
  canBring,
  onFocus,
  onBring,
  onChange,
  onDelete,
  onClose,
}: {
  node: AtlasNode;
  editing: boolean;
  players: { id: string; name: string }[];
  canBring: boolean;
  onFocus: () => void;
  onBring: (to?: string) => void;
  onChange: (n: AtlasNode) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="atlas-node-card">
      <div className="vtt2-insp-head">
        {editing ? (
          <input
            className="bg-select"
            value={node.name}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => onChange({ ...node, name: e.target.value })}
          />
        ) : (
          <span className="panel-title" style={{ margin: 0 }}>
            {node.name.toUpperCase()}
          </span>
        )}
        <button className="cdx-tab-x" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <p className="atlas-node-kind">
        {node.kind}
        {node.visibility === "curator" ? " · curator only" : ""}
      </p>
      {(node.status ?? []).map((s, i) => (
        <p className="atlas-node-status" key={i}>
          {s}
        </p>
      ))}
      {node.note && <p className="atlas-note">{node.note}</p>}
      <p className="atlas-node-kind">{coordLabel(node, "")}</p>
      <div className="atlas-node-actions">
        <button className="ghost-btn xs" onClick={onFocus} title="Fly your view to this place">
          Focus
        </button>
        {canBring && (
          <button className="ghost-btn xs" onClick={() => onBring(undefined)} title="Fly EVERYONE's Atlas to this place">
            Bring all
          </button>
        )}
      </div>
      {canBring && players.length > 0 && (
        <div className="atlas-node-actions atlas-bring-row">
          {players.map((p) => (
            <button key={p.id} className="ghost-btn xs" onClick={() => onBring(p.id)} title={`Fly ${p.name}'s Atlas to this place`}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      {editing && (
        <div className="atlas-node-actions">
          <select
            className="bg-select"
            value={node.visibility}
            onChange={(e) => onChange({ ...node, visibility: e.target.value as AtlasNode["visibility"] })}
          >
            <option value="player">visible to players</option>
            <option value="curator">curator only</option>
          </select>
          <SpritePicker
            current={node.sprite}
            onPick={(sprite) => onChange({ ...node, sprite })}
            onClear={() => onChange({ ...node, sprite: undefined })}
          />
          <button className="icon-btn danger sm" onClick={onDelete} title="Remove this node">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function ZoneCard({
  zone,
  onChange,
  onDelete,
  onClose,
}: {
  zone: AtlasZone;
  onChange: (z: AtlasZone) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="atlas-node-card">
      <div className="vtt2-insp-head">
        <input
          className="bg-select"
          value={zone.name ?? ""}
          placeholder="Zone name"
          onChange={(e) => onChange({ ...zone, name: e.target.value || undefined })}
        />
        <button className="cdx-tab-x" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <p className="atlas-node-kind">zone · {zone.polygon.length} vertices</p>
      <div className="atlas-node-actions">
        <select className="bg-select" value={zone.state} onChange={(e) => onChange({ ...zone, state: e.target.value as ZoneState })}>
          <option value="visible">visible</option>
          <option value="surveyed">surveyed</option>
          <option value="unconfirmed">unconfirmed</option>
          <option value="null-locked">null-locked</option>
          <option value="curator-only">curator only</option>
        </select>
        <select
          className="bg-select"
          value={zone.fx ?? ""}
          onChange={(e) => onChange({ ...zone, fx: (ZONE_FX as readonly string[]).includes(e.target.value) ? (e.target.value as AtlasZone["fx"]) : undefined })}
          title="Ambient particles inside the zone"
        >
          <option value="">no particles</option>
          <option value="embers">embers</option>
          <option value="motes">motes</option>
          <option value="snow">snow</option>
          <option value="fog">fog</option>
        </select>
      </div>
      <div className="atlas-node-actions">
        <SpritePicker
          current={zone.sprite}
          onPick={(sprite) => onChange({ ...zone, sprite })}
          onClear={() => onChange({ ...zone, sprite: undefined })}
        />
        <button className="icon-btn danger sm" onClick={onDelete} title="Remove this zone">
          ×
        </button>
      </div>
    </div>
  );
}
