import { useMemo, useRef, useState } from "react";

// The Axis Wheel — the Codex's Archive View (Remaster slice 3). A dark star-chart
// index: slow counter-rotating astrolabe rings around a central Axis, the record
// constellations (types) orbiting it, and bookmarks/recents as named stars.
// Animation language: calibrate / align / rotate — heavy and slow, never bouncy.

interface Mark {
  url: string;
  title: string;
}
interface SeqNode {
  id: string;
  title: string;
  icon: string;
  color: string;
  scripts: { id: string; title: string }[];
}
interface Props {
  pageCount: number;
  /** stem → type ("creature" | "weapon" | …) once the archive scan completes. */
  typeMap: Map<string, string> | null;
  scanning: boolean;
  marks: Mark[];
  recents: Mark[];
  /** User Sequences — they orbit between the core and the constellations. */
  sequences: SeqNode[];
  onOpenType: (chip: string) => void; // "Creature" | … | "All"
  onOpenIndex: () => void;
  onOpen: (url: string) => void;
  onOpenSeq: (id: string) => void;
  onBeginScript: (seqId: string, scriptId: string) => void;
}

const NODES: { chip: string; label: string; type: string | null; angle: number }[] = [
  { chip: "Creature", label: "Creatures", type: "creature", angle: -90 },
  { chip: "Weapon", label: "Weapons", type: "weapon", angle: -30 },
  { chip: "Equipment", label: "Equipment", type: "equipment", angle: 30 },
  { chip: "Cipher", label: "Ciphers", type: "cipher", angle: 90 },
  { chip: "Genus", label: "Genus", type: "genus", angle: 150 },
  { chip: "All", label: "Lore & Records", type: null, angle: 210 },
];
const ORBIT = 205;

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sequence station positions: the first ten sit on the bezel ring; the rest
 *  spiral outward as far "systems" you pan the camera to. */
function seqPos(i: number, total: number): { x: number; y: number; deg: number } {
  if (i < 10) {
    const deg = i * (360 / Math.min(total, 10)) - 90 + 18;
    const a = (deg * Math.PI) / 180;
    return { x: Math.cos(a) * 358, y: Math.sin(a) * 358, deg };
  }
  const deg = i * 137.5 + 40; // golden-angle spread for outlying systems
  const a = (deg * Math.PI) / 180;
  const r = 520 + (i - 10) * 46;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.82, deg };
}

export function AxisWheel({ pageCount, typeMap, scanning, marks, recents, sequences, onOpenType, onOpenIndex, onOpen, onOpenSeq, onBeginScript }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const [hoverSeq, setHoverSeq] = useState<string | null>(null);

  // ── Camera: drag to pan, wheel to zoom (at the cursor), double-click to reset.
  // Transform is written straight to the <g> so panning never re-renders React.
  const svgRef = useRef<SVGSVGElement>(null);
  const camG = useRef<SVGGElement>(null);
  const cam = useRef({ x: 0, y: 0, k: 1 });
  const pan = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);
  function applyCam(smooth = false) {
    const g = camG.current;
    if (!g) return;
    g.style.transition = smooth ? "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)" : "";
    g.setAttribute("transform", `translate(${cam.current.x} ${cam.current.y}) scale(${cam.current.k})`);
  }
  /** Pointer position in viewBox units (handles the meet letterboxing). */
  function toView(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = svgRef.current!.getBoundingClientRect();
    const s = Math.min(r.width / 1240, r.height / 840);
    return {
      x: (e.clientX - r.left - (r.width - 1240 * s) / 2) / s - 620,
      y: (e.clientY - r.top - (r.height - 840 * s) / 2) / s - 420,
    };
  }
  const isInteractive = (t: EventTarget | null) =>
    !!(t as Element | null)?.closest?.(".axis-node, .axis-core, .axis-seq, .axis-star, .axis-branch");
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 || isInteractive(e.target)) return;
    const p = toView(e);
    pan.current = { px: p.x, py: p.y, cx: cam.current.x, cy: cam.current.y };
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!pan.current) return;
    const p = toView(e);
    cam.current.x = pan.current.cx + (p.x - pan.current.px);
    cam.current.y = pan.current.cy + (p.y - pan.current.py);
    applyCam();
  }
  function onPointerUp() {
    pan.current = null;
  }
  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    const p = toView(e);
    const k0 = cam.current.k;
    const k1 = Math.max(0.4, Math.min(2.6, k0 * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    // keep the point under the cursor fixed while zooming
    cam.current.x = p.x - ((p.x - cam.current.x) / k0) * k1;
    cam.current.y = p.y - ((p.y - cam.current.y) / k0) * k1;
    cam.current.k = k1;
    applyCam();
  }
  function resetCam() {
    cam.current = { x: 0, y: 0, k: 1 };
    applyCam(true);
  }
  // Grace timer: the branch fan survives the pointer crossing gaps on its way to a node.
  const seqLeave = useRef<number | undefined>(undefined);
  function seqEnter(id: string) {
    window.clearTimeout(seqLeave.current);
    setHoverSeq(id);
  }
  function seqOut() {
    window.clearTimeout(seqLeave.current);
    seqLeave.current = window.setTimeout(() => setHoverSeq(null), 380);
  }

  const stars = useMemo(() => {
    const rnd = mulberry32(1889);
    return Array.from({ length: 170 }, () => ({
      x: rnd() * 1240 - 620,
      y: rnd() * 840 - 420,
      r: rnd() * 1.3 + 0.3,
      o: rnd() * 0.45 + 0.1,
    })).filter((s) => Math.hypot(s.x, s.y) > 130);
  }, []);

  // Named stars: bookmarks (violet) + recents (teal) pinned on the outer band.
  const named = useMemo(() => {
    const seen = new Set<string>();
    const list: (Mark & { kind: "mark" | "recent" })[] = [];
    for (const m of marks.slice(0, 8)) {
      if (!seen.has(m.url)) {
        seen.add(m.url);
        list.push({ ...m, kind: "mark" });
      }
    }
    for (const m of recents.slice(0, 8)) {
      if (!seen.has(m.url)) {
        seen.add(m.url);
        list.push({ ...m, kind: "recent" });
      }
    }
    return list.map((m, i) => {
      const angle = ((i * 137.5 + 24) * Math.PI) / 180; // golden-angle spread
      const r = 242 + (i % 3) * 27; // between the constellation orbit and the outer rings
      return { ...m, x: Math.cos(angle) * r, y: Math.sin(angle) * r * 0.85 };
    });
  }, [marks, recents]);

  const byType = useMemo(() => {
    const m = new Map<string, string[]>();
    if (typeMap) {
      for (const [stem, t] of typeMap) {
        const arr = m.get(t) || [];
        arr.push(stem);
        m.set(t, arr);
      }
    }
    return m;
  }, [typeMap]);

  function countOf(n: (typeof NODES)[number]): number | null {
    if (!n.type) return typeMap ? pageCount - [...typeMap.values()].length : null;
    if (!typeMap) return null;
    return (byType.get(n.type) || []).length;
  }
  const hovered = NODES.find((n) => n.chip === hover) || null;
  const hoverSamples: string[] = hovered
    ? hovered.type
      ? (byType.get(hovered.type) || []).slice(0, 6)
      : []
    : [];

  return (
    <div className="axis-wrap">
      <svg
        ref={svgRef}
        className="axis-svg"
        viewBox="-620 -420 1240 840"
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={(e) => !isInteractive(e.target) && resetCam()}
      >
        <g ref={camG}>
        <g className="axis-stars">
          {stars.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} opacity={s.o} />
          ))}
        </g>

        {/* outer calibration rings — slow, heavy, counter-rotating */}
        <g className="axis-ring rot-a">
          <circle r={318} className="axis-line" />
          {Array.from({ length: 60 }, (_, i) => (
            <line key={i} x1={312} y1={0} x2={i % 5 === 0 ? 300 : 306} y2={0} className="axis-tick" transform={`rotate(${i * 6})`} />
          ))}
        </g>
        <g className="axis-ring rot-b">
          <circle r={262} className="axis-line dash" />
        </g>
        <circle r={ORBIT} className="axis-line faint" />

        {/* the Axis core — click for the full index */}
        <g className="axis-core" onClick={onOpenIndex}>
          <circle r={92} className="axis-core-disc" />
          <g className="axis-ring rot-b">
            <circle r={78} className="axis-line dash" />
          </g>
          <g className="axis-ring rot-a">
            <circle r={62} className="axis-line" />
            {Array.from({ length: 12 }, (_, i) => (
              <line key={i} x1={58} y1={0} x2={52} y2={0} className="axis-tick" transform={`rotate(${i * 30})`} />
            ))}
          </g>
          <circle r={42} className="axis-line" />
          <text className="axis-core-title" y={-4}>
            AXIS
          </text>
          <text className="axis-core-sub" y={16}>
            {pageCount} RECORDS
          </text>
        </g>

        {/* orbiting constellations (record types) */}
        {NODES.map((n) => {
          const a = (n.angle * Math.PI) / 180;
          const x = Math.cos(a) * ORBIT;
          const y = Math.sin(a) * ORBIT;
          const c = countOf(n);
          const on = hover === n.chip;
          return (
            <g
              key={n.chip}
              className={"axis-node" + (on ? " on" : "")}
              transform={`translate(${x} ${y})`}
              onMouseEnter={() => setHover(n.chip)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onOpenType(n.chip)}
            >
              <line x1={-x * 0.28} y1={-y * 0.28} x2={0} y2={0} className="axis-spoke" />
              <circle r={26} className="axis-node-disc" />
              <circle r={31} className="axis-node-halo" />
              <text className="axis-node-count" y={4}>
                {c == null ? (scanning ? "…" : "·") : c}
              </text>
              <text className="axis-node-label" y={48}>
                {n.label.toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* Sequences — large stations on the OUTERMOST bezel ring; hover unseals
            animated branches fanning inward to the sequence's Scripts. */}
        {sequences.length > 0 && (
          <g className="axis-seqring">
            <g className="axis-ring rot-b">
              <circle r={372} className="axis-line" />
              {Array.from({ length: 90 }, (_, i) => (
                <line key={i} x1={366} y1={0} x2={i % 5 === 0 ? 356 : 361} y2={0} className="axis-tick" transform={`rotate(${i * 4})`} />
              ))}
            </g>
            <circle r={344} className="axis-line faint" />
          </g>
        )}
        {sequences.map((s, i) => {
          const { x, y, deg } = seqPos(i, sequences.length);
          const open = hoverSeq === s.id;
          // branches fan INWARD from the outer station toward the wheel
          const branches: { key: string; label: string; glyph: string; act: () => void }[] = [
            { key: "open", label: "Open sequence", glyph: s.icon, act: () => onOpenSeq(s.id) },
            ...s.scripts.slice(0, 4).map((sc) => ({
              key: sc.id,
              label: sc.title,
              glyph: "▸",
              act: () => onBeginScript(s.id, sc.id),
            })),
          ];
          return (
            <g
              key={s.id}
              className={"axis-seq" + (open ? " open" : "")}
              transform={`translate(${x} ${y})`}
              onMouseEnter={() => seqEnter(s.id)}
              onMouseLeave={seqOut}
            >
              {/* invisible hover zone keeps the fan alive while travelling to a node */}
              {open && <circle r={150} className="axis-seq-hitzone" />}
              {open && (
                <g className="axis-branches">
                  {branches.map((b, bi) => {
                    const off = (bi - (branches.length - 1) / 2) * 24;
                    const br = ((deg + 180 + off) * Math.PI) / 180;
                    const bx = Math.cos(br) * 104;
                    const by = Math.sin(br) * 104;
                    const rightSide = Math.cos(br) >= 0;
                    return (
                      <g
                        key={b.key}
                        className="axis-branch"
                        style={{ animationDelay: `${bi * 70}ms` }}
                        onClick={(e) => {
                          e.stopPropagation();
                          b.act();
                        }}
                      >
                        <line x1={0} y1={0} x2={bx} y2={by} className="axis-branch-line" style={{ stroke: s.color, animationDelay: `${bi * 70}ms` }} />
                        <circle cx={bx} cy={by} r={13} className="axis-branch-node" style={{ stroke: s.color }} />
                        <text x={bx} y={by + 4} className="axis-branch-glyph" style={{ fill: s.color }}>
                          {b.glyph}
                        </text>
                        <text
                          x={bx + (rightSide ? 19 : -19)}
                          y={by + 4}
                          className="axis-branch-label"
                          style={{ textAnchor: rightSide ? "start" : "end" }}
                        >
                          {b.label.length > 22 ? b.label.slice(0, 21) + "…" : b.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              )}
              <circle r={23} className="axis-seq-disc" style={{ stroke: s.color }} onClick={() => onOpenSeq(s.id)} />
              <text className="axis-seq-glyph" y={7} style={{ fill: s.color }} onClick={() => onOpenSeq(s.id)}>
                {s.icon}
              </text>
              {!open && (
                <text className="axis-seq-label" y={42}>
                  {s.title.length > 18 ? s.title.slice(0, 17) + "…" : s.title}
                </text>
              )}
            </g>
          );
        })}

        {/* named stars — bookmarks (violet) and recent records (teal) */}
        {named.map((s) => (
          <g key={s.url} className={"axis-star " + s.kind} transform={`translate(${s.x} ${s.y})`} onClick={() => onOpen(s.url)}>
            <title>{s.title}</title>
            <circle r={3.4} className="axis-star-dot" />
            <circle r={7} className="axis-star-halo" />
            <text className="axis-star-label" x={10} y={3}>
              {s.title.length > 26 ? s.title.slice(0, 25) + "…" : s.title}
            </text>
          </g>
        ))}
        </g>
      </svg>
      <div className="axis-cam-hint">drag to pan · scroll to zoom · double-click to recentre</div>

      {/* hover preview — page summaries for the focused constellation */}
      {hovered && (
        <div className="axis-preview">
          <div className="axis-preview-head">{hovered.label}</div>
          {hovered.type == null ? (
            <p className="axis-preview-note">Everything sealed in the archive — lore, rules, and untyped records.</p>
          ) : typeMap == null ? (
            <p className="axis-preview-note">{scanning ? "Calibrating the archive index…" : "Index not yet calibrated."}</p>
          ) : hoverSamples.length === 0 ? (
            <p className="axis-preview-note">No records of this kind yet.</p>
          ) : (
            <ul>
              {hoverSamples.map((s) => (
                <li key={s}>{s.replace(/_/g, " ")}</li>
              ))}
            </ul>
          )}
          <div className="axis-preview-foot">click to open the {hovered.type ? "constellation" : "index"}</div>
        </div>
      )}
    </div>
  );
}
