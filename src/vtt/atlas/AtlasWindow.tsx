import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  atlasForRole,
  emptyAtlas,
  type AtlasDoc,
  type AtlasNode,
  type AtlasPoint,
  type ZoneState,
} from "./atlasModel";
import {
  clampToMap,
  coordLabel,
  distanceMi,
  formatDistance,
  makeCamera,
  nodeVisibleAtZoom,
  nullReadout,
  panBy,
  pickScaleBar,
  pointInPolygon,
  screenToWorld,
  stepInertia,
  worldToScreen,
  zoomAt,
  type AtlasCamera,
} from "./atlasMath";
import { loadAtlas, saveAtlas } from "./atlasRepo";
import { fileToPngDataUrl } from "../../lib/image";
import { registerSaver } from "../../lib/saveQueue";
import { reportSaveFailure } from "../../lib/appToast";

interface Props {
  campaignId: string;
  curator: boolean;
  onClose: () => void;
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

// The Curator Atlas — slice 1 (see docs/curator-atlas.md).
//
// A floating world-map instrument over the VTT. The battle map says where you
// physically are; this says where you are in the world. Rendered on a 2D
// canvas: the look is flat cartography — thin lines, small type, restrained
// highlights — and the interesting motion is the CAMERA, whose math lives in
// atlasMath.ts where it is tested.
export function AtlasWindow({ campaignId, curator, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<AtlasDoc>(() => emptyAtlas());
  const [readOnly, setReadOnly] = useState(false);
  const [tool, setTool] = useState<Tool>("pan");
  const [zoneState, setZoneState] = useState<ZoneState>("null-locked");
  const [selected, setSelected] = useState<AtlasNode | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [draft, setDraft] = useState<AtlasPoint[]>([]);
  // The DOM readout (SCALE / COORD) cannot watch camRef mutate, so the render
  // loop pushes the strings into state when they change. String-compared, so a
  // still camera causes no re-renders.
  const [hud, setHud] = useState({ scale: "", coord: "—" });
  const camRef = useRef<AtlasCamera>(makeCamera(250, 150, 1.2));
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const burstsRef = useRef<NullBurst[]>([]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef(0);
  const drag = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null);

  // What this viewer is ALLOWED to have. Players never receive curator-only
  // material in their document at all.
  const visible = useMemo(() => atlasForRole(doc, curator ? "curator" : "player"), [doc, curator]);

  // ── load / save ────────────────────────────────────────────────────────────
  useEffect(() => {
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
  }, [campaignId]);

  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<AtlasDoc | null>(null);
  const saver = useRef<ReturnType<typeof registerSaver> | null>(null);
  useEffect(() => {
    const s = registerSaver("the Atlas", async () => {
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      await saveAtlas(campaignId, p);
    });
    saver.current = s;
    return () => s.unregister();
  }, [campaignId]);

  const mutate = useCallback(
    (fn: (d: AtlasDoc) => AtlasDoc) => {
      if (readOnly) return;
      setDoc((d) => {
        const next = fn(d);
        pending.current = next;
        saver.current?.markPending();
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          const p = pending.current;
          if (!p) return;
          pending.current = null;
          void reportSaveFailure(saveAtlas(campaignId, p), "the Atlas").then(() => saver.current?.markSaved());
        }, 800);
        return next;
      });
    },
    [campaignId, readOnly]
  );

  // ── map image ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!doc.image) {
      imgRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
    };
    img.src = doc.image;
  }, [doc.image]);

  async function onMapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const uri = await fileToPngDataUrl(f).catch(() => null);
    if (!uri) return;
    const probe = new Image();
    probe.onload = () => {
      // Width stays authoritative; height follows the image's aspect so the
      // two can never disagree about the shape of the world.
      mutate((d) => ({ ...d, image: uri, heightMi: +(d.widthMi * (probe.height / probe.width)).toFixed(1) }));
    };
    probe.src = uri;
  }

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

    // the map image, spanning [0,widthMi] × [0,heightMi]
    const tl = worldToScreen(cam, view, { x: 0, y: 0 });
    const br = worldToScreen(cam, view, { x: visible.widthMi, y: visible.heightMi });
    if (imgRef.current) {
      ctx.globalAlpha = 0.92;
      ctx.drawImage(imgRef.current, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = "#232a33";
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
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
    for (const z of visible.zones) {
      if (z.polygon.length < 3) continue;
      ctx.beginPath();
      const first = worldToScreen(cam, view, z.polygon[0]);
      ctx.moveTo(first.x, first.y);
      for (const p of z.polygon.slice(1)) {
        const s = worldToScreen(cam, view, p);
        ctx.lineTo(s.x, s.y);
      }
      ctx.closePath();
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
    }

    // zone being drawn
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
    }

    // nodes
    ctx.font = "10px Consolas, monospace";
    for (const n of visible.nodes) {
      if (!nodeVisibleAtZoom(n, cam.zoom)) continue;
      const s = worldToScreen(cam, view, n);
      if (s.x < -40 || s.y < -40 || s.x > view.width + 40 || s.y > view.height + 40) continue;
      const mine = selected?.id === n.id;
      ctx.strokeStyle = n.visibility === "curator" ? "rgba(154,122,204,0.9)" : "rgba(126,207,202,0.9)";
      ctx.fillStyle = mine ? "rgba(126,207,202,0.9)" : "rgba(16,19,24,0.9)";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(190,205,210,0.85)";
      ctx.fillText(n.name.toUpperCase(), s.x + 8, s.y + 3);
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
  }, [visible, curator, measure, draft, selected]);

  // rAF loop: inertia + redraw. stepInertia returns the identical object at
  // rest, but the glitch effects animate, so the loop runs while the window is
  // open — it is one small canvas, not the battle map.
  useEffect(() => {
    let last = performance.now();
    const tick = () => {
      const c = canvasRef.current;
      // Backing store follows the element HERE, not only in a ResizeObserver —
      // observers can be deferred while the window is hidden, and a canvas
      // whose backing store disagrees with its CSS size draws a blurry, offset
      // world with every hit-test wrong.
      if (c && (c.width !== c.clientWidth || c.height !== c.clientHeight)) {
        c.width = c.clientWidth;
        c.height = c.clientHeight;
      }
      const now = performance.now();
      const cam = stepInertia(camRef.current, now - last);
      camRef.current = clampToMap(cam, sizeOf(), doc.widthMi, doc.heightMi);
      last = now;
      draw();
      // HUD: pushed from the loop because camRef mutates without React ever
      // hearing about it. Same-string updates are free.
      const bar2 = pickScaleBar(camRef.current.zoom, visible.units);
      const h = hoverRef.current;
      const coord = h ? coordLabel(screenToWorld(camRef.current, sizeOf(), h), visible.name) : "—";
      setHud((prev) => (prev.scale === bar2.label && prev.coord === coord ? prev : { scale: bar2.label, coord }));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    // Dev-only handle, same pattern as __vttEngine: lets tooling single-step a
    // frame when rAF is suspended (hidden window). Stripped from production.
    if (import.meta.env.DEV) (window as unknown as { __atlasTick?: () => void }).__atlasTick = tick;
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw, doc.widthMi, doc.heightMi, visible.units, visible.name]);

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
    drag.current = { ...s, t: performance.now(), moved: false };
    if (tool === "measure") {
      const w = screenToWorld(camRef.current, sizeOf(), s);
      setMeasure({ a: w, b: w });
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
    }
  }

  function onUp(e: React.MouseEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const s = local(e);
    const wp = screenToWorld(camRef.current, sizeOf(), s);
    if (tool === "pan" && !d.moved) {
      camRef.current = { ...camRef.current, vx: 0, vy: 0 };
      // a plain click: select a node, or bounce off a null region
      const cam = camRef.current;
      const view = sizeOf();
      const hit = visible.nodes.find((n) => {
        if (!nodeVisibleAtZoom(n, cam.zoom)) return false;
        const p = worldToScreen(cam, view, n);
        return Math.hypot(p.x - s.x, p.y - s.y) < 10;
      });
      if (hit) {
        setSelected(hit);
        return;
      }
      setSelected(null);
      if (!curator && visible.zones.some((z) => z.state === "null-locked" && pointInPolygon(wp, z.polygon))) {
        burstsRef.current.push({ x: s.x, y: s.y, at: performance.now() });
      }
    } else if (tool === "pan" && d.moved) {
      // release into the glide; velocity was set during the drag
    } else if (tool === "node" && curator) {
      mutate((doc0) => ({
        ...doc0,
        nodes: [...doc0.nodes, { id: uid(), name: "NEW NODE", kind: "landmark", x: wp.x, y: wp.y, visibility: "player" }],
      }));
      setTool("pan");
    } else if (tool === "zone" && curator) {
      setDraft((pts) => [...pts, wp]);
    }
  }

  function closeZone() {
    if (draft.length < 3) return;
    const polygon = draft;
    mutate((doc0) => ({ ...doc0, zones: [...doc0.zones, { id: uid(), state: zoneState, polygon }] }));
    setDraft([]);
    setTool("pan");
  }

  function onWheel(e: React.WheelEvent) {
    const factor = Math.exp(-e.deltaY * 0.0015);
    camRef.current = zoomAt(camRef.current, sizeOf(), local(e), factor);
  }


  return (
    <div className="atlas-window">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>
          {visible.name.toUpperCase()} // MOGUL SURVEY CARTOGRAPH
        </span>
        <button className="cdx-tab-x" onClick={onClose} title="Close the Atlas">
          ×
        </button>
      </div>

      {readOnly && (
        <p className="atlas-note">This Atlas was made by a newer version of W.T.E and is shown read-only.</p>
      )}

      <div className="atlas-toolbar">
        <button className={"ghost-btn xs" + (tool === "pan" ? " strong" : "")} onClick={() => setTool("pan")}>
          Navigate
        </button>
        <button className={"ghost-btn xs" + (tool === "measure" ? " strong" : "")} onClick={() => { setTool("measure"); setMeasure(null); }}>
          Measure
        </button>
        {curator && !readOnly && (
          <>
            <button className={"ghost-btn xs" + (tool === "node" ? " strong" : "")} onClick={() => setTool("node")}>
              + Node
            </button>
            <button className={"ghost-btn xs" + (tool === "zone" ? " strong" : "")} onClick={() => { setTool("zone"); setDraft([]); }}>
              + Zone
            </button>
            {tool === "zone" && (
              <>
                <select className="bg-select" value={zoneState} onChange={(e) => setZoneState(e.target.value as ZoneState)}>
                  <option value="visible">visible</option>
                  <option value="surveyed">surveyed</option>
                  <option value="unconfirmed">unconfirmed</option>
                  <option value="null-locked">null-locked</option>
                  <option value="curator-only">curator only</option>
                </select>
                <button className="ghost-btn xs" disabled={draft.length < 3} onClick={closeZone}>
                  Close zone ({draft.length})
                </button>
              </>
            )}
            <button className="ghost-btn xs" onClick={() => fileRef.current?.click()}>
              Map image…
            </button>
            <label className="atlas-width">
              Width
              <input
                className="bg-select"
                type="number"
                min={1}
                value={doc.widthMi}
                onChange={(e) => {
                  const w = Math.max(1, parseFloat(e.target.value) || 1);
                  mutate((d) => ({ ...d, heightMi: +(d.heightMi * (w / d.widthMi)).toFixed(1), widthMi: w }));
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
          </>
        )}
      </div>

      <div className="atlas-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="atlas-canvas"
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={() => {
            hoverRef.current = null;
            drag.current = null;
          }}
          onWheel={onWheel}
          onDoubleClick={() => tool === "zone" && closeZone()}
        />
        {selected && (
          <NodeCard
            node={selected}
            curator={curator && !readOnly}
            onChange={(next) =>
              mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === next.id ? next : n)) }))
            }
            onDelete={() => {
              mutate((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== selected.id) }));
              setSelected(null);
            }}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      <div className="atlas-status">
        <span>
          SCALE | <b>{hud.scale.toUpperCase()}</b>
        </span>
        <span>COORD | {hud.coord}</span>
        <span>OBSERVATIONAL RESOLUTION: {curator ? "FULL" : "PARTIAL"}</span>
      </div>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onMapFile(e)} />
    </div>
  );
}

function NodeCard({
  node,
  curator,
  onChange,
  onDelete,
  onClose,
}: {
  node: AtlasNode;
  curator: boolean;
  onChange: (n: AtlasNode) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="atlas-node-card">
      <div className="vtt2-insp-head">
        {curator ? (
          <input className="bg-select" value={node.name} onChange={(e) => onChange({ ...node, name: e.target.value })} />
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
      {curator && (
        <div className="atlas-node-actions">
          <select
            className="bg-select"
            value={node.visibility}
            onChange={(e) => onChange({ ...node, visibility: e.target.value as AtlasNode["visibility"] })}
          >
            <option value="player">visible to players</option>
            <option value="curator">curator only</option>
          </select>
          <button className="icon-btn danger sm" onClick={onDelete} title="Remove this node">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
