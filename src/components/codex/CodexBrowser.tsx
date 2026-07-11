import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "../../lib/tauri";
import { renderCodexHtml, pageTitle } from "../../lib/md";
import { parseCodexEntry } from "../../lib/codexParse";
import { computeCreature } from "../../lib/codex";
import type { CodexEntry, Creature } from "../../models/codex";

// The new Codex: a browser built solely for W.T.E (Remaster slice 1 — the usable
// shell: tabs, wte:// address bar, history, search, bookmarks, recents, reader).
// The Axis Wheel archive view replaces the home canvas in a later slice.

const HOME = "wte://home";

interface CTab {
  id: string;
  hist: string[];
  idx: number;
  title: string;
}
interface Mark {
  url: string;
  title: string;
}
interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}
type View =
  | { kind: "home" }
  | { kind: "page"; stem: string; title: string; html: string; entry: CodexEntry | null }
  | { kind: "search"; q: string; hits: SearchHit[] }
  | { kind: "error"; message: string };

// Token colors per creature Class — must match the legacy VTT's SUMMON_COLORS.
const VTT_CLASS_COLORS: Record<number, string> = {
  1: "#6b6f7a", 2: "#c9a227", 3: "#7a4b9a", 4: "#8a3a2a", 5: "#c33fbf", 6: "#20202c",
};
const TYPE_CHIPS = ["All", "Creature", "Weapon", "Equipment", "Cipher", "Genus"];

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return (window as unknown as { __TAURI__: { core: { invoke: (c: string, a?: Record<string, unknown>) => Promise<T> } } })
    .__TAURI__.core.invoke(cmd, args);
}
const uid = () => "t" + Math.random().toString(36).slice(2, 9);
const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

function stemOf(url: string): string | null {
  const m = url.match(/^wte:\/\/(?:page|rules?)\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}
function queryOf(url: string): string | null {
  const m = url.match(/^wte:\/\/search\?q=(.*)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function CodexBrowser() {
  const [tabs, setTabs] = useState<CTab[]>([{ id: uid(), hist: [HOME], idx: 0, title: "Archive" }]);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [addr, setAddr] = useState(HOME);
  const [view, setView] = useState<View>({ kind: "home" });
  const [marks, setMarks] = useState<Mark[]>(() => load<Mark[]>("wte-cdx-bookmarks", []));
  const [recents, setRecents] = useState<Mark[]>(() => load<Mark[]>("wte-cdx-recents", []));
  const [pages, setPages] = useState<string[]>([]);
  const [homeFilter, setHomeFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done">("idle");
  const [spawnNote, setSpawnNote] = useState("");
  const typeMap = useRef<Map<string, string> | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);

  const tab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const url = tab.hist[tab.idx];

  useEffect(() => {
    if (isTauri()) invoke<string[]>("wte_list_pages").then(setPages).catch(() => setPages([]));
  }, []);

  const retitle = useCallback((tabId: string, title: string) => {
    setTabs((ts) => ts.map((t) => (t.id === tabId ? { ...t, title } : t)));
  }, []);

  // Resolve the active URL into a view.
  useEffect(() => {
    let alive = true;
    setAddr(url);
    const q = queryOf(url);
    const stem = stemOf(url);
    if (url === HOME) {
      setView({ kind: "home" });
      retitle(tab.id, "Archive");
      return;
    }
    if (q != null) {
      retitle(tab.id, `Search · ${q}`);
      invoke<SearchHit[]>("wte_search", { query: q })
        .then((hits) => alive && setView({ kind: "search", q, hits: hits || [] }))
        .catch(() => alive && setView({ kind: "search", q, hits: [] }));
      return;
    }
    if (stem) {
      invoke<string>("wte_load_page", { path: stem })
        .then((md) => {
          if (!alive) return;
          const title = pageTitle(md, stem);
          setView({ kind: "page", stem, title, html: renderCodexHtml(md), entry: parseCodexEntry(md, stem) });
          retitle(tab.id, title);
          setRecents((r) => {
            const next = [{ url, title }, ...r.filter((x) => x.url !== url)].slice(0, 24);
            save("wte-cdx-recents", next);
            return next;
          });
        })
        .catch(() => alive && setView({ kind: "error", message: `Page not found: ${stem}` }));
      return;
    }
    setView({ kind: "error", message: `Unknown address: ${url}` });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tab.id]);

  function navigate(to: string) {
    setTabs((ts) =>
      ts.map((t) => (t.id === activeId ? { ...t, hist: [...t.hist.slice(0, t.idx + 1), to], idx: t.idx + 1 } : t))
    );
  }
  function back() {
    setTabs((ts) => ts.map((t) => (t.id === activeId && t.idx > 0 ? { ...t, idx: t.idx - 1 } : t)));
  }
  function forward() {
    setTabs((ts) => ts.map((t) => (t.id === activeId && t.idx < t.hist.length - 1 ? { ...t, idx: t.idx + 1 } : t)));
  }
  function refresh() {
    // re-resolve by forcing the effect: replace the URL with itself
    setTabs((ts) => ts.map((t) => (t.id === activeId ? { ...t, hist: [...t.hist] } : t)));
    setView((v) => ({ ...v }));
  }
  function newTab(to = HOME) {
    const t: CTab = { id: uid(), hist: [to], idx: 0, title: to === HOME ? "Archive" : stemOf(to)?.replace(/_/g, " ") || "Tab" };
    setTabs((ts) => [...ts, t]);
    setActiveId(t.id);
  }
  function closeTab(id: string) {
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== id);
      if (!next.length) return [{ id: uid(), hist: [HOME], idx: 0, title: "Archive" }];
      return next;
    });
    setActiveId((cur) => {
      if (cur !== id) return cur;
      const i = tabs.findIndex((t) => t.id === id);
      const next = tabs.filter((t) => t.id !== id);
      return next.length ? next[Math.max(0, i - 1)].id : cur;
    });
  }
  function go(input: string) {
    const t = input.trim();
    if (!t) return;
    if (t.startsWith("wte://")) navigate(t);
    else navigate(`wte://search?q=${encodeURIComponent(t)}`);
  }

  const marked = marks.some((m) => m.url === url);
  function toggleMark() {
    setMarks((ms) => {
      const next = marked ? ms.filter((m) => m.url !== url) : [...ms, { url, title: tab.title }];
      save("wte-cdx-bookmarks", next);
      return next;
    });
  }

  // Scan every record's TYPE once (lazily, on first type-chip use) for home filtering.
  async function ensureTypeScan() {
    if (typeMap.current || scanState === "scanning") return;
    setScanState("scanning");
    const map = new Map<string, string>();
    for (const p of pages) {
      try {
        const md = await invoke<string>("wte_load_page", { path: p });
        const e = parseCodexEntry(md, p);
        if (e) map.set(p, e.type);
      } catch {
        /* unreadable page */
      }
    }
    typeMap.current = map;
    setScanState("done");
  }

  // Type-specific action: send a Creature record to the legacy VTT's spawn listener
  // (localStorage 'wte-spawn-creature' — the VTT iframe's GM side picks it up).
  function spawnInVtt(c: Creature) {
    const d = computeCreature(c);
    const abil = (c.abilities || []).map((a) => `${a.name} — ${a.effect}`).join(". ");
    const desc = (abil + (c.lore ? (abil ? ". " : "") + c.lore : "")).slice(0, 1400);
    const payload = {
      name: c.name, cls: c.cls, hp: d.hp, dr: d.dr, size: d.size,
      color: VTT_CLASS_COLORS[c.cls] || "#6b6f7a", flags: d.flags,
      stats: c.stats, traits: c.traits || "", desc, ts: Date.now(),
    };
    try {
      localStorage.setItem("wte-spawn-creature", JSON.stringify(payload));
      setSpawnNote(`${c.name} sent to the VTT — it spawns on the GM's table.`);
      window.setTimeout(() => setSpawnNote(""), 5000);
    } catch {
      /* ignore */
    }
  }

  // Reader link interception: wte:// + mirrored data-wte-link anchors navigate
  // in-Codex; external http(s) opens in the system browser.
  function onReaderClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const wl = a.getAttribute("data-wte-link");
    const href = a.getAttribute("href") || "";
    if (wl) return navigate(`wte://page/${encodeURIComponent(wl)}`);
    if (href.startsWith("wte://")) {
      const stem = stemOf(href);
      return navigate(stem ? `wte://page/${encodeURIComponent(stem)}` : href);
    }
    if (/^https?:\/\//.test(href)) void invoke("open_external", { url: href }).catch(() => {});
  }

  const filteredPages = useMemo(() => {
    const f = homeFilter.trim().toLowerCase();
    let list = f ? pages.filter((p) => p.toLowerCase().includes(f)) : pages;
    if (typeFilter !== "All" && typeMap.current) {
      const want = typeFilter.toLowerCase();
      list = list.filter((p) => typeMap.current!.get(p) === want);
    }
    return list.slice(0, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, homeFilter, typeFilter, scanState]);

  if (!isTauri()) {
    return (
      <div className="dashboard">
        <p className="list-empty">The Codex needs the desktop app (local archive).</p>
      </div>
    );
  }

  return (
    <div className="cdx">
      <div className="cdx-tabstrip">
        {tabs.map((t) => (
          <div key={t.id} className={"cdx-tab" + (t.id === activeId ? " active" : "")} onClick={() => setActiveId(t.id)}>
            <span className="cdx-tab-title">{t.title}</span>
            {tabs.length > 1 && (
              <button
                className="cdx-tab-x"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                title="Close tab"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button className="cdx-newtab" onClick={() => newTab()} title="New tab">
          +
        </button>
      </div>

      <div className="cdx-toolbar">
        <button className="cdx-nav" onClick={back} disabled={tab.idx === 0} title="Back">
          ←
        </button>
        <button className="cdx-nav" onClick={forward} disabled={tab.idx >= tab.hist.length - 1} title="Forward">
          →
        </button>
        <button className="cdx-nav" onClick={refresh} title="Refresh">
          ⟳
        </button>
        <button className="cdx-nav" onClick={() => navigate(HOME)} title="Archive home">
          ⌂
        </button>
        <input
          className="cdx-addr"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go(addr);
          }}
          spellCheck={false}
          placeholder="wte://  — or type to search the archive"
        />
        <button className={"cdx-nav star" + (marked ? " on" : "")} onClick={toggleMark} title="Bookmark">
          {marked ? "★" : "☆"}
        </button>
      </div>

      <div className="cdx-body">
        {view.kind === "home" && (
          <div className="cdx-home">
            <div className="cdx-home-head">
              <div className="cdx-home-brand">W.T.E CODEX</div>
              <div className="cdx-home-sub">archive of the Wonderland — {pages.length} records sealed</div>
              <input
                className="cdx-home-search"
                placeholder="Search the archive…"
                value={homeFilter}
                onChange={(e) => setHomeFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && homeFilter.trim()) go(homeFilter);
                }}
              />
            </div>
            <div className="cdx-home-grid">
              <div className="cdx-home-col">
                <div className="panel-title">{homeFilter ? "Matching records" : "Records"}</div>
                <div className="chip-row" style={{ marginBottom: 8 }}>
                  {TYPE_CHIPS.map((t) => (
                    <button
                      key={t}
                      className={"chip" + (typeFilter === t ? " active" : "")}
                      onClick={() => {
                        setTypeFilter(t);
                        if (t !== "All") void ensureTypeScan();
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {typeFilter !== "All" && scanState === "scanning" && (
                  <p className="list-empty">Calibrating the archive index…</p>
                )}
                <div className="cdx-list">
                  {filteredPages.map((p) => (
                    <button key={p} className="cdx-item" onClick={() => navigate(`wte://page/${encodeURIComponent(p)}`)}>
                      {p.replace(/_/g, " ")}
                    </button>
                  ))}
                  {pages.length === 0 && <p className="list-empty">No records yet — import or author pages.</p>}
                </div>
              </div>
              <div className="cdx-home-col">
                <div className="panel-title">Bookmarks</div>
                <div className="cdx-list">
                  {marks.length === 0 && <p className="list-empty">Star a page to pin it here.</p>}
                  {marks.map((m) => (
                    <button key={m.url} className="cdx-item" onClick={() => navigate(m.url)}>
                      ★ {m.title}
                    </button>
                  ))}
                </div>
                <div className="panel-title" style={{ marginTop: 18 }}>
                  Recently viewed
                </div>
                <div className="cdx-list">
                  {recents.length === 0 && <p className="list-empty">Pages you open appear here.</p>}
                  {recents.slice(0, 12).map((m) => (
                    <button key={m.url} className="cdx-item dim" onClick={() => navigate(m.url)}>
                      {m.title}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {view.kind === "search" && (
          <div className="cdx-reader">
            <h2 className="cdx-search-head">
              Search · “{view.q}” — {view.hits.length} result{view.hits.length === 1 ? "" : "s"}
            </h2>
            {view.hits.map((h) => {
              const stem = h.url.replace("wte://rules/", "");
              return (
                <button key={h.url} className="cdx-hit" onClick={() => navigate(`wte://page/${encodeURIComponent(stem)}`)}>
                  <span className="cdx-hit-title">{h.title}</span>
                  <span className="cdx-hit-snippet">{h.snippet}</span>
                  <span className="cdx-hit-url">wte://page/{stem}</span>
                </button>
              );
            })}
            {view.hits.length === 0 && <p className="list-empty">The archive returns nothing. Try another term.</p>}
          </div>
        )}

        {view.kind === "page" && (
          <div className="cdx-reader" ref={readerRef} onClick={onReaderClick}>
            <div className="cdx-page-meta">wte://page/{view.stem}</div>
            {spawnNote && <div className="cdx-spawn-note">{spawnNote}</div>}
            {view.entry && <TypedCard entry={view.entry} onSpawn={spawnInVtt} />}
            <div className="cdx-content" dangerouslySetInnerHTML={{ __html: view.html }} />
          </div>
        )}

        {view.kind === "error" && (
          <div className="cdx-reader">
            <p className="list-empty">{view.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Typed record card — the structured header the data hub reads from a page ──
function Spec({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="cdx-spec">
      <span className="cdx-spec-k">{label}</span>
      <span className="cdx-spec-v">{String(value)}</span>
    </div>
  );
}

function TypedCard({ entry, onSpawn }: { entry: CodexEntry; onSpawn: (c: Creature) => void }) {
  return (
    <div className="cdx-card">
      <div className="cdx-card-head">
        <span className={"cdx-type-chip t-" + entry.type}>{entry.type}</span>
        <span className="cdx-card-name">{entry.name}</span>
        {entry.type === "creature" && (
          <button className="primary-btn cdx-card-act" onClick={() => onSpawn(entry)}>
            Spawn in VTT
          </button>
        )}
      </div>
      <div className="cdx-spec-grid">
        {entry.type === "weapon" && (
          <>
            <Spec label="Damage" value={entry.damage} />
            <Spec label="Range" value={entry.range} />
            <Spec label="Slot" value={entry.slot} />
            <Spec label="Weight" value={entry.weight} />
            <Spec label="NC" value={entry.ncCost} />
            <Spec label="Domain" value={entry.domain} />
            <Spec label="Mods" value={entry.mods} />
            <Spec label="Overclock" value={entry.ede ? "Yes" : undefined} />
          </>
        )}
        {entry.type === "equipment" && (
          <>
            <Spec label="Category" value={entry.category} />
            <Spec label="Slot" value={entry.slot} />
            <Spec label="Grade" value={entry.grade} />
            <Spec label="NC" value={entry.ncCost} />
            <Spec label="Mods" value={entry.mods} />
          </>
        )}
        {entry.type === "cipher" && (
          <>
            <Spec label="Paradigm" value={entry.paradigm} />
            <Spec label="Tier" value={entry.tier} />
            <Spec label="SS" value={entry.ss} />
            <Spec label="Activation" value={entry.activation} />
            <Spec label="Range" value={entry.range} />
            <Spec label="Target" value={entry.target} />
          </>
        )}
        {entry.type === "genus" && (
          <>
            <Spec label="Domain" value={entry.domain} />
            <Spec label="SS" value={entry.ss} />
            <Spec label="Activation" value={entry.activation} />
            <Spec label="Range" value={entry.range} />
            <Spec label="Limit" value={entry.limit} />
          </>
        )}
        {entry.type === "creature" &&
          (() => {
            const d = computeCreature(entry);
            return (
              <>
                <Spec label="Class" value={`${entry.cls} · ${entry.archive || ""}`} />
                <Spec label="HP" value={d.hp} />
                <Spec label="DR" value={d.dr || undefined} />
                <Spec label="Size" value={d.size} />
                <Spec label="Note" value={d.note || undefined} />
                <Spec label="Rank/Tier" value={entry.rank || entry.tier || undefined} />
              </>
            );
          })()}
      </div>
    </div>
  );
}
