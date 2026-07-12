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

export function AxisWheel({ pageCount, typeMap, scanning, marks, recents, sequences, onOpenType, onOpenIndex, onOpen, onOpenSeq, onBeginScript }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const [hoverSeq, setHoverSeq] = useState<string | null>(null);
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
      <svg className="axis-svg" viewBox="-620 -420 1240 840" preserveAspectRatio="xMidYMid meet">
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
        {sequences.slice(0, 10).map((s, i) => {
          const deg = i * (360 / Math.min(sequences.length, 10)) - 90 + 18;
          const a = (deg * Math.PI) / 180;
          const x = Math.cos(a) * 358;
          const y = Math.sin(a) * 358;
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
      </svg>

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
