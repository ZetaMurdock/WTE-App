import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "../../lib/tauri";
import { renderCodexHtml, pageTitle } from "../../lib/md";
import { parseCodexEntry } from "../../lib/codexParse";
import { computeCreature, addToArmory } from "../../lib/codex";
import type { CodexEntry, Creature, Weapon, Equipment } from "../../models/codex";
import { AxisWheel } from "./AxisWheel";
import { SequenceView } from "./SequenceView";
import { listSequences, saveSequence, deleteSequence } from "../../lib/sequences";
import { newSequence, type Script, type Sequence } from "../../models/sequence";
import { NotesPanel } from "./NotesPanel";
import { listNotes, saveNote, deleteNote } from "../../lib/notes";
import { newNote, type CodexNote } from "../../models/note";
import { allPageMeta, getPageMeta, setPageMeta as savePageMeta, type PageMeta } from "../../lib/pageMeta";
import { PageEditor, type PageDraft } from "./PageEditor";
import { firebasePublishConfigured } from "../../lib/tauri";
import { publishPage, unpublishPage, fetchPublishedPages } from "../../lib/publishedPages";
import { assertCanPublish } from "../../lib/codexRoles";
import { LibraryDialog } from "./LibraryDialog";

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
  | { kind: "sequence"; id: string }
  | { kind: "notes" }
  | { kind: "graph"; stem: string }
  | { kind: "error"; message: string };

interface ActiveRun {
  seqTitle: string;
  script: Script;
  idx: number;
}

// Token colors per creature Class — must match the legacy VTT's SUMMON_COLORS.
const VTT_CLASS_COLORS: Record<number, string> = {
  1: "#6b6f7a", 2: "#c9a227", 3: "#7a4b9a", 4: "#8a3a2a", 5: "#c33fbf", 6: "#20202c",
};
const TYPE_CHIPS = ["All", "Creature", "Weapon", "Equipment", "Cipher", "Genus"];
// Base "pull targets" a page can link to (feed the sheet/VTT); custom labels add to these.
const BASE_LABELS = ["Creature", "Weapon", "Equipment", "Cipher", "Genus", "Species", "Paradigm", "Background"];
// Filter-dot colours (the circular type points above the index).
const DOT_COLORS: Record<string, string> = {
  All: "#7ecfca", Creature: "#a1584a", Weapon: "#a08a4f", Equipment: "#689a96",
  Cipher: "#837aae", Genus: "#6f9a68", Lore: "#a7aebd",
};

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __TAURI__?: { core: { invoke: (c: string, a?: Record<string, unknown>) => Promise<T> } } };
  if (!w.__TAURI__) return Promise.reject(new Error("The archive needs the desktop app."));
  return w.__TAURI__.core.invoke(cmd, args);
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
  if (!m) return null;
  let s = decodeURIComponent(m[1]);
  // Unwrap double-wrapped links (mirrored pages carry full wte://rules/… URLs
  // in data-wte-link, which used to get nested inside wte://page/…).
  const nested = s.match(/^wte:\/\/(?:page|rules?)\/(.+)$/);
  if (nested) s = decodeURIComponent(nested[1]);
  return s;
}
function queryOf(url: string): string | null {
  const m = url.match(/^wte:\/\/search\?q=(.*)$/);
  return m ? decodeURIComponent(m[1]) : null;
}
function seqIdOf(url: string): string | null {
  const m = url.match(/^wte:\/\/sequence\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}
function graphOf(url: string): string | null {
  const m = url.match(/^wte:\/\/graph\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}
// Outgoing wte-links in a page's raw markdown/HTML (mirror + authored formats).
function extractLinks(md: string, self: string): string[] {
  const out = new Set<string>();
  const push = (raw: string) => {
    let s = raw;
    try {
      s = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    const nested = s.match(/^wte:\/\/(?:page|rules?)\/(.+)$/);
    if (nested) s = nested[1];
    s = s.trim();
    if (s && s !== self) out.add(s);
  };
  for (const m of md.matchAll(/data-wte-link="([^"]+)"/g)) push(m[1]);
  for (const m of md.matchAll(/wte:\/\/(?:page|rules?)\/([A-Za-z0-9_%.:-]+)/g)) push(m[1]);
  return [...out];
}

export function CodexBrowser({ curator = false, engineer = false }: { curator?: boolean; engineer?: boolean }) {
  const [tabs, setTabs] = useState<CTab[]>([{ id: uid(), hist: [HOME], idx: 0, title: "Archive" }]);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [addr, setAddr] = useState(HOME);
  const [view, setView] = useState<View>({ kind: "home" });
  const [marks, setMarks] = useState<Mark[]>(() => load<Mark[]>("wte-cdx-bookmarks", []));
  const [recents, setRecents] = useState<Mark[]>(() => load<Mark[]>("wte-cdx-recents", []));
  const [pages, setPages] = useState<string[]>([]);
  const [homeFilter, setHomeFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [homeMode, setHomeMode] = useState<"wheel" | "index">(() => {
    try {
      return localStorage.getItem("wte-cdx-homemode") === "index" ? "index" : "wheel";
    } catch {
      return "wheel";
    }
  });
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done">("idle");
  const [spawnNote, setSpawnNote] = useState("");
  const [seqs, setSeqs] = useState<Sequence[]>([]);
  const [seqVarFilter, setSeqVarFilter] = useState("All");
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [notes, setNotes] = useState<CodexNote[]>([]);
  const [annotate, setAnnotate] = useState<{ x: number; y: number; text: string } | null>(null);
  const [noteSearch, setNoteSearch] = useState("");
  const typeMap = useRef<Map<string, string> | null>(null);
  const linkMap = useRef<Map<string, string[]> | null>(null);
  const [lens, setLens] = useState<string | null>(null);
  // Collapsed record sections + expanded "book" sequences (persisted).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("wte-cdx-collapsed") || "[]"));
    } catch {
      return new Set();
    }
  });
  function toggleSection(name: string) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      try {
        localStorage.setItem("wte-cdx-collapsed", JSON.stringify([...n]));
      } catch {
        /* ignore */
      }
      return n;
    });
  }
  const [openSeqs, setOpenSeqs] = useState<Set<string>>(new Set());
  function toggleSeq(id: string) {
    setOpenSeqs((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  const [packIn, setPackIn] = useState<string | null>(null); // null = closed, "" = open
  const [armoryNote, setArmoryNote] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const [pageMetaMap, setPageMetaMap] = useState<Record<string, PageMeta>>(() => allPageMeta());
  const readerRef = useRef<HTMLDivElement>(null);
  const pageUploadRef = useRef<HTMLInputElement>(null);
  const privileged = curator || engineer;
  const [editor, setEditor] = useState<{ initial?: PageDraft } | null>(null);
  const publishAvail = firebasePublishConfigured();
  const [publishedStems, setPublishedStems] = useState<Set<string>>(new Set());
  const [libraryOpen, setLibraryOpen] = useState(false);

  // Tell the data-driven loader (App) that pages or pull flags changed.
  const notifyPagesChanged = () => window.dispatchEvent(new Event("wte-pages-changed"));

  function togglePull(stem: string) {
    setPageMetaMap(savePageMeta(stem, { pulled: !getPageMeta(stem, pageMetaMap).pulled }));
    notifyPagesChanged();
  }
  function toggleVisibility(stem: string) {
    const cur = getPageMeta(stem, pageMetaMap).visibility;
    setPageMetaMap(savePageMeta(stem, { visibility: cur === "player" ? "gm" : "player" }));
  }

  // Custom section labels in use (beyond the base pull targets / record types).
  const customLabels = useMemo(() => {
    const base = new Set([...TYPE_CHIPS, ...BASE_LABELS]);
    return [...new Set(Object.values(pageMetaMap).map((m) => m.label).filter((l): l is string => !!l && !base.has(l)))];
  }, [pageMetaMap]);
  const labelChips = [...TYPE_CHIPS, ...customLabels];

  async function openEditPage(stem: string) {
    let content = "";
    try {
      content = await invoke<string>("wte_load_page", { path: stem });
    } catch {
      /* new/unavailable — start blank */
    }
    setEditor({ initial: { title: stem, content, label: getPageMeta(stem, pageMetaMap).label ?? BASE_LABELS[0] } });
  }

  async function savePageDraft(draft: PageDraft) {
    try {
      const stem = await invoke<string>("wte_save_page", { name: draft.title, content: draft.content });
      setPageMetaMap(savePageMeta(stem, { label: draft.label }));
      invoke<string[]>("wte_list_pages").then(setPages).catch(() => {});
      typeMap.current = null;
      linkMap.current = null;
      setScanState("idle");
      setEditor(null);
      notifyPagesChanged();
      setUploadNote(`Saved “${draft.title}” to the ${draft.label} section.`);
      window.setTimeout(() => setUploadNote(""), 5000);
    } catch (e) {
      setUploadNote("Could not save page: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  const tab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const url = tab.hist[tab.idx];

  useEffect(() => {
    if (isTauri()) {
      invoke<string[]>("wte_list_pages").then(setPages).catch(() => setPages([]));
      listSequences().then(setSeqs).catch(() => setSeqs([]));
      listNotes().then(setNotes).catch(() => setNotes([]));
    }
  }, []);

  // ── Global publish: Engineers push pages to a shared Firebase node; anyone can
  // sync the official set into their local Codex. ──
  useEffect(() => {
    if (isTauri() && publishAvail) {
      fetchPublishedPages().then((ps) => setPublishedStems(new Set(ps.map((p) => p.stem)))).catch(() => {});
    }
  }, [publishAvail]);

  async function togglePublish(stem: string) {
    try {
      await assertCanPublish(); // role-gated shared library (Codex → Library → Roles)
      if (publishedStems.has(stem)) {
        await unpublishPage(stem);
        setPublishedStems((s) => {
          const n = new Set(s);
          n.delete(stem);
          return n;
        });
        setUploadNote(`Unpublished “${stem.replace(/_/g, " ")}”.`);
      } else {
        const content = await invoke<string>("wte_load_page", { path: stem }).catch(() => "");
        await publishPage({ stem, title: stem, content, label: getPageMeta(stem, pageMetaMap).label });
        setPublishedStems((s) => new Set(s).add(stem));
        setUploadNote(`Published “${stem.replace(/_/g, " ")}” — everyone can now sync it.`);
      }
    } catch (e) {
      setUploadNote("Publish failed: " + (e instanceof Error ? e.message : String(e)));
    }
    window.setTimeout(() => setUploadNote(""), 6000);
  }

  // The Library dialog imported pages — re-list, re-scan, and reload game data.
  function afterLibraryImport(count: number) {
    setPageMetaMap(allPageMeta());
    invoke<string[]>("wte_list_pages").then(setPages).catch(() => {});
    fetchPublishedPages().then((ps) => setPublishedStems(new Set(ps.map((p) => p.stem)))).catch(() => {});
    typeMap.current = null;
    linkMap.current = null;
    setScanState("idle");
    notifyPagesChanged();
    setUploadNote(`Pulled ${count} page${count === 1 ? "" : "s"} from the shared library.`);
    window.setTimeout(() => setUploadNote(""), 6000);
  }

  // ── Official pages: upload .md files into the Codex (App Data rules overlay via
  // wte_save_page). Restores the legacy page-import flow; desktop-only. ──
  async function uploadPages(files: FileList | null) {
    if (!files || !files.length || !isTauri()) return;
    let ok = 0;
    for (const f of Array.from(files)) {
      try {
        const content = await f.text();
        const name = f.name.replace(/\.(md|markdown|txt)$/i, "");
        await invoke("wte_save_page", { name, content });
        ok++;
      } catch {
        /* skip unreadable file */
      }
    }
    invoke<string[]>("wte_list_pages").then(setPages).catch(() => {});
    typeMap.current = null; // force a re-scan so new records classify
    linkMap.current = null;
    setScanState("idle");
    notifyPagesChanged();
    setUploadNote(`${ok} page${ok === 1 ? "" : "s"} uploaded into the Codex.`);
    window.setTimeout(() => setUploadNote(""), 5000);
  }

  // ── Notes: state-first, persisted best-effort ──
  function persistNote(n: CodexNote) {
    setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...n, updatedAt: Date.now() } : x)));
    void saveNote(n).catch(() => {});
  }
  function addNote(attachedTo: string | null, quote: string | null = null) {
    const n = newNote(attachedTo, quote);
    setNotes((ns) => [n, ...ns]);
    void saveNote(n).catch(() => {});
  }
  function removeNote(id: string) {
    setNotes((ns) => ns.filter((x) => x.id !== id));
    void deleteNote(id).catch(() => {});
  }
  // Select text in the reader → a floating Annotate chip → note quoting the selection.
  function onReaderMouseUp(e: React.MouseEvent) {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (text.length > 2 && text.length < 600) setAnnotate({ x: e.clientX, y: e.clientY, text });
    else setAnnotate(null);
  }

  // ── Sequences: persistence + guided-flow runner ──
  function persistSeq(next: Sequence) {
    setSeqs((ss) => ss.map((s) => (s.id === next.id ? next : s)));
    void saveSequence(next);
  }
  async function createSequence() {
    const s = newSequence("New Sequence");
    await saveSequence(s).catch(() => {});
    setSeqs((ss) => [s, ...ss]);
    navigate(`wte://sequence/${s.id}`);
  }
  async function removeSequence(id: string) {
    setSeqs((ss) => ss.filter((s) => s.id !== id));
    await deleteSequence(id).catch(() => {});
    navigate(HOME);
  }
  function beginRun(seq: Sequence, script: Script) {
    setRun({ seqTitle: seq.title, script, idx: 0 });
    navigate(`wte://page/${encodeURIComponent(script.steps[0].stem)}`);
  }
  function runStep(delta: number) {
    if (!run) return;
    const idx = Math.max(0, Math.min(run.script.steps.length - 1, run.idx + delta));
    if (idx === run.idx) return;
    setRun({ ...run, idx });
    navigate(`wte://page/${encodeURIComponent(run.script.steps[idx].stem)}`);
  }

  // Calibrate the wheel's constellation counts in the background once records list.
  useEffect(() => {
    if (pages.length && isTauri()) void ensureTypeScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  function setMode(m: "wheel" | "index") {
    setHomeMode(m);
    try {
      localStorage.setItem("wte-cdx-homemode", m);
    } catch {
      /* ignore */
    }
  }

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
    if (url === "wte://notes") {
      setView({ kind: "notes" });
      retitle(tab.id, "Notes");
      return;
    }
    const g = graphOf(url);
    if (g) {
      setView({ kind: "graph", stem: g });
      retitle(tab.id, `Graph · ${g.replace(/_/g, " ")}`);
      void ensureTypeScan();
      return;
    }
    const sid = seqIdOf(url);
    if (sid) {
      setView({ kind: "sequence", id: sid });
      retitle(tab.id, seqs.find((s) => s.id === sid)?.title || "Sequence");
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

  // One lazy archive pass builds BOTH indexes: record types (home filter chips)
  // and the link graph (connections/graph view).
  async function ensureTypeScan() {
    if (typeMap.current || scanState === "scanning") return;
    setScanState("scanning");
    const map = new Map<string, string>();
    const links = new Map<string, string[]>();
    for (const p of pages) {
      try {
        const md = await invoke<string>("wte_load_page", { path: p });
        const e = parseCodexEntry(md, p);
        if (e) map.set(p, e.type);
        links.set(p, extractLinks(md, p));
      } catch {
        /* unreadable page */
      }
    }
    typeMap.current = map;
    linkMap.current = links;
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
      // Same-window bridge: VTT v2 shares this document with the Codex, where
      // `storage` events don't fire — deliver the payload via a CustomEvent too.
      window.dispatchEvent(new CustomEvent("wte-spawn-creature", { detail: payload }));
      setSpawnNote(`${c.name} sent to the VTT — it spawns on the GM's table.`);
      window.setTimeout(() => setSpawnNote(""), 5000);
    } catch {
      /* ignore */
    }
  }

  // Item → sheet: save a weapon/equipment record into the custom armory, where the
  // Loadout tab's catalogs pick it up.
  function addArmory(entry: Weapon | Equipment) {
    addToArmory(entry);
    setArmoryNote(`${entry.name} added to the armory — equip it from the sheet's Loadout tab.`);
    window.setTimeout(() => setArmoryNote(""), 5000);
  }

  // Packs: import a shared Sequence (JSON) — fresh ids, saved, opened.
  function importPack(text: string): void {
    try {
      const p = JSON.parse(text) as { sequence?: Partial<Sequence> } & Partial<Sequence>;
      const src = (p.sequence ?? p) as Partial<Sequence>;
      if (!src || typeof src.title !== "string" || !Array.isArray(src.recordIds)) throw new Error("bad pack");
      const s: Sequence = {
        ...newSequence(src.title),
        description: src.description || "",
        icon: src.icon || "◈",
        color: src.color || "#689a96",
        scope: (src.scope as Sequence["scope"]) || "community",
        variables: Array.isArray(src.variables) ? src.variables : [],
        recordIds: src.recordIds,
        scripts: (src.scripts || []).map((sc) => ({
          id: "sc-" + Math.random().toString(36).slice(2, 10),
          title: sc.title || "Script",
          steps: Array.isArray(sc.steps) ? sc.steps : [],
          variables: sc.variables || [],
          visibility: sc.visibility === "gm" ? "gm" : "player",
        })),
        visibility: src.visibility === "gm" ? "gm" : "player",
      };
      setSeqs((ss) => [s, ...ss]);
      void saveSequence(s).catch(() => {});
      setPackIn(null);
      navigate(`wte://sequence/${s.id}`);
    } catch {
      setPackIn("__error__");
    }
  }

  // Connections (references / used-by) once the archive scan has run.
  function connectionsFor(stem: string): { refs: string[]; usedBy: string[] } | null {
    const lm = linkMap.current;
    if (!lm) return null;
    const refs = (lm.get(stem) || []).filter((s) => lm.has(s));
    const usedBy: string[] = [];
    for (const [p, ls] of lm) if (p !== stem && ls.includes(stem)) usedBy.push(p);
    return { refs, usedBy };
  }

  // Reader link interception: wte:// + mirrored data-wte-link anchors navigate
  // in-Codex; external http(s) opens in the system browser.
  function onReaderClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const wl = a.getAttribute("data-wte-link");
    const href = a.getAttribute("href") || "";
    if (wl) {
      // data-wte-link may be a bare page name OR a full wte://rules/… URL — canonicalize.
      const stem = stemOf(wl) ?? wl;
      return navigate(`wte://page/${encodeURIComponent(stem)}`);
    }
    if (href.startsWith("wte://")) {
      const stem = stemOf(href);
      return navigate(stem ? `wte://page/${encodeURIComponent(stem)}` : href);
    }
    if (/^https?:\/\//.test(href)) void invoke("open_external", { url: href }).catch(() => {});
  }

  const filteredPages = useMemo(() => {
    const f = homeFilter.trim().toLowerCase();
    let list = f ? pages.filter((p) => p.toLowerCase().includes(f)) : pages;
    if (typeFilter !== "All") {
      const want = typeFilter.toLowerCase();
      // Match a custom section label OR the content-derived record type.
      list = list.filter((p) => getPageMeta(p, pageMetaMap).label === typeFilter || (typeMap.current && typeMap.current.get(p) === want));
    }
    // Players (not Curator/Engineer) only see player-visible pages.
    if (!privileged) list = list.filter((p) => getPageMeta(p, pageMetaMap).visibility === "player");
    return list; // every record — the list box scrolls
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, homeFilter, typeFilter, scanState, privileged, pageMetaMap]);

  // Group records by their section label (chapter-like collapsible sections).
  const groupedPages = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const p of filteredPages) {
      const label = getPageMeta(p, pageMetaMap).label || "Unsorted";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(p);
    }
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === "Unsorted") return 1; // Unsorted sinks to the bottom
      if (b[0] === "Unsorted") return -1;
      return a[0].localeCompare(b[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPages, pageMetaMap]);

  // One record row (title + Engineer flags) — shared by grouped sections & books.
  function pageRow(p: string) {
    const m = getPageMeta(p, pageMetaMap);
    return (
      <div key={p} className="cdx-page-row">
        <button className="cdx-item" onClick={() => navigate(`wte://page/${encodeURIComponent(p)}`)}>
          {p.replace(/_/g, " ")}
          {privileged && m.visibility === "gm" && <span className="cdx-gm-tag">GM</span>}
          {privileged && !m.pulled && <span className="cdx-off-tag">not pulled</span>}
        </button>
        {engineer && (
          <div className="cdx-page-flags">
            <button className="cdx-flag" title="Edit this page" onClick={() => void openEditPage(p)}>
              edit
            </button>
            {publishAvail && (
              <button
                className={"cdx-flag" + (publishedStems.has(p) ? " on" : "")}
                title={publishedStems.has(p) ? "Published to the shared Codex — click to unpublish" : "Publish to the shared official Codex (everyone can sync it)"}
                onClick={() => void togglePublish(p)}
              >
                pub
              </button>
            )}
            <button
              className={"cdx-flag" + (m.pulled ? " on" : "")}
              title={m.pulled ? "Pulled into sheet/VTT catalogs — click to stop pulling" : "Not pulled — click to pull into sheet/VTT catalogs"}
              onClick={() => togglePull(p)}
            >
              pull
            </button>
            <button
              className={"cdx-flag" + (m.visibility === "player" ? " on" : "")}
              title={m.visibility === "player" ? "Player-visible — click to make GM-only" : "GM-only — click to make player-visible"}
              onClick={() => toggleVisibility(p)}
            >
              {m.visibility === "player" ? "plr" : "gm"}
            </button>
          </div>
        )}
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

      {run && (
        <div className="cdx-runner">
          <span className="cdx-runner-title">
            ▸ {run.seqTitle} · {run.script.title}
          </span>
          <span className="cdx-runner-step">
            step {run.idx + 1} / {run.script.steps.length}
          </span>
          <button className="cdx-nav" disabled={run.idx === 0} onClick={() => runStep(-1)}>
            ←
          </button>
          <button className="cdx-nav" disabled={run.idx >= run.script.steps.length - 1} onClick={() => runStep(1)}>
            →
          </button>
          <button className="icon-btn" onClick={() => setRun(null)}>
            End
          </button>
        </div>
      )}

      <div className="cdx-body">
        {view.kind === "home" && homeMode === "wheel" && (
          <div className="axis-home">
            <AxisWheel
              pageCount={pages.length}
              typeMap={typeMap.current}
              scanning={scanState === "scanning"}
              marks={marks}
              recents={recents}
              sequences={seqs.map((s) => ({
                id: s.id,
                title: s.title,
                icon: s.icon,
                color: s.color,
                scripts: s.scripts.map((sc) => ({ id: sc.id, title: sc.title })),
              }))}
              onOpenSeq={(id) => navigate(`wte://sequence/${id}`)}
              onBeginScript={(seqId, scriptId) => {
                const s = seqs.find((x) => x.id === seqId);
                const sc = s?.scripts.find((x) => x.id === scriptId);
                if (s && sc && sc.steps.length) beginRun(s, sc);
                else navigate(`wte://sequence/${seqId}`);
              }}
              onOpenType={(chip) => {
                setTypeFilter(chip);
                setMode("index");
                if (chip !== "All") void ensureTypeScan();
              }}
              onOpenIndex={() => setMode("index")}
              onOpen={(u) => navigate(u)}
            />
            <div className="cdx-mode">
              <button className="chip active">Archive</button>
              <button className="chip" onClick={() => setMode("index")}>
                Index
              </button>
            </div>
          </div>
        )}

        {view.kind === "home" && homeMode === "index" && (
          <div className="cdx-home">
            <div className="cdx-mode inline">
              <button className="chip" onClick={() => setMode("wheel")}>
                Archive
              </button>
              <button className="chip active">Index</button>
            </div>
            <div className="cdx-home-head">
              <div className="cdx-home-brand">W.T.E CODEX</div>
              <div className="cdx-home-sub">archive of the Wonderland — {pages.length} records sealed</div>
              <div className="cdx-search-pill">
                <span className="cdx-search-ico" aria-hidden />
                <input
                  className="cdx-home-search"
                  placeholder="Search the archive…"
                  value={homeFilter}
                  onChange={(e) => setHomeFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && homeFilter.trim()) go(homeFilter);
                  }}
                />
                {homeFilter && (
                  <button className="cdx-search-clear" onClick={() => setHomeFilter("")} title="Clear search">
                    ×
                  </button>
                )}
              </div>
            </div>
            <div className="panel-title">
              Sequences
              <button className="chip" style={{ marginLeft: 10 }} onClick={() => void createSequence()}>
                + New Sequence
              </button>
              <button className="chip" style={{ marginLeft: 6 }} onClick={() => setPackIn(packIn == null ? "" : null)}>
                Import pack
              </button>
            </div>
            {packIn != null && (
              <div className="pack-import">
                {packIn === "__error__" && <p className="list-empty">That didn't parse as a W.T.E pack — paste the exported JSON.</p>}
                <textarea
                  className="sheet-notes"
                  style={{ minHeight: 90 }}
                  placeholder="Paste a Sequence pack (JSON) here…"
                  value={packIn === "__error__" ? "" : packIn}
                  onChange={(e) => setPackIn(e.target.value)}
                />
                <div className="act-actions">
                  <button className="primary-btn seq-begin" disabled={!packIn || packIn === "__error__"} onClick={() => importPack(packIn!)}>
                    Import
                  </button>
                  <button className="ghost-btn" onClick={() => setPackIn(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {seqs.length > 0 && (
              <div className="chip-row" style={{ marginBottom: 10 }}>
                {["All", ...Array.from(new Set(seqs.flatMap((s) => s.variables)))].map((v) => (
                  <button key={v} className={"chip" + (seqVarFilter === v ? " active" : "")} onClick={() => setSeqVarFilter(v)}>
                    {v}
                  </button>
                ))}
              </div>
            )}
            <div className="seq-books">
              {seqs
                .filter((s) => seqVarFilter === "All" || s.variables.includes(seqVarFilter))
                .map((s) => {
                  const open = openSeqs.has(s.id);
                  return (
                    <div key={s.id} className={"seq-book" + (open ? " open" : "")} style={{ borderColor: open ? s.color : undefined }}>
                      <button className="seq-book-head" onClick={() => toggleSeq(s.id)}>
                        <span className="seq-book-chev" aria-hidden>
                          ›
                        </span>
                        <span className="seq-card-glyph" style={{ color: s.color, borderColor: s.color }}>
                          {s.icon}
                        </span>
                        <span className="seq-card-main">
                          <span className="seq-card-title">{s.title}</span>
                          <span className="seq-card-meta">
                            {s.recordIds.length} records · {s.scripts.length} scripts
                            {s.visibility === "gm" ? " · GM" : ""}
                          </span>
                        </span>
                      </button>
                      {open && (
                        <div className="seq-book-body">
                          {s.recordIds.length > 0 && (
                            <>
                              <div className="seq-book-sub">Records</div>
                              {s.recordIds.map((p) => (
                                <button key={p} className="seq-book-item" onClick={() => navigate(`wte://page/${encodeURIComponent(p)}`)}>
                                  {p.replace(/_/g, " ")}
                                </button>
                              ))}
                            </>
                          )}
                          {s.scripts.length > 0 && (
                            <>
                              <div className="seq-book-sub">Scripts</div>
                              {s.scripts.map((sc) => (
                                <button
                                  key={sc.id}
                                  className="seq-book-item script"
                                  onClick={() => (sc.steps.length ? beginRun(s, sc) : navigate(`wte://sequence/${s.id}`))}
                                >
                                  {sc.title}
                                </button>
                              ))}
                            </>
                          )}
                          {s.recordIds.length === 0 && s.scripts.length === 0 && (
                            <p className="list-empty" style={{ margin: "4px 0" }}>Empty sequence.</p>
                          )}
                          <button className="chip" style={{ marginTop: 8, borderColor: s.color }} onClick={() => navigate(`wte://sequence/${s.id}`)}>
                            Open full sequence
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              {seqs.length === 0 && <p className="list-empty">Knowledge paths through the archive — session prep, onboarding, investigations.</p>}
            </div>

            <div className="cdx-home-grid">
              <div className="cdx-home-col">
                <div className="panel-title cdx-records-head">
                  <span>{lens ? "Session lens" : homeFilter ? "Matching records" : "Records"}</span>
                  {privileged && (
                    <>
                      <input
                        ref={pageUploadRef}
                        type="file"
                        accept=".md,.markdown,.txt"
                        multiple
                        hidden
                        onChange={(e) => void uploadPages(e.target.files)}
                      />
                      <button className="chip" onClick={() => setEditor({})} title="Author a new Codex page">
                        + New page
                      </button>
                      <button className="chip" onClick={() => pageUploadRef.current?.click()} title="Upload official .md pages into the Codex">
                        Upload
                      </button>
                    </>
                  )}
                  {publishAvail && (
                    <button className="chip" onClick={() => setLibraryOpen(true)} title="The shared library — pull particular categories/pages and manage publish roles">
                      Library…
                    </button>
                  )}
                </div>
                {uploadNote && <p className="cdx-upload-note">{uploadNote}</p>}
                {seqs.length > 0 && (
                  <div className="chip-row" style={{ marginBottom: 8 }}>
                    <span className="conn-h" style={{ marginRight: 4 }}>Lens</span>
                    <button className={"chip" + (!lens ? " active" : "")} onClick={() => setLens(null)}>
                      None
                    </button>
                    {seqs.map((s) => (
                      <button key={s.id} className={"chip" + (lens === s.id ? " active" : "")} onClick={() => setLens(s.id)} style={lens === s.id ? { borderColor: s.color } : undefined}>
                        {s.icon} {s.title.slice(0, 18)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="cdx-dot-row" style={{ marginBottom: 8 }}>
                  {labelChips.map((t) => (
                    <button
                      key={t}
                      className={"cdx-dot" + (typeFilter === t ? " active" : "")}
                      style={{ "--dotc": DOT_COLORS[t] ?? (customLabels.includes(t) ? "#d8b25a" : "#7ecfca") } as React.CSSProperties}
                      title={t}
                      onClick={() => {
                        setTypeFilter(t);
                        if (t !== "All" && TYPE_CHIPS.includes(t)) void ensureTypeScan();
                      }}
                    >
                      <span className="cdx-dot-pt" aria-hidden />
                      <span className="cdx-dot-label">{t}</span>
                    </button>
                  ))}
                </div>
                {typeFilter !== "All" && scanState === "scanning" && (
                  <p className="list-empty">Calibrating the archive index…</p>
                )}
                <div className="cdx-list">
                  {/* Lens: a sequence's curated records (flat). Otherwise the archive
                      grouped into collapsible chapter sections by label. */}
                  {lens
                    ? (seqs.find((s) => s.id === lens)?.recordIds ?? []).map((p) => pageRow(p))
                    : groupedPages.map(([label, items]) => {
                        const shut = collapsed.has(label);
                        return (
                          <div key={label} className={"cdx-section" + (shut ? " shut" : "")}>
                            <button className="cdx-section-head" onClick={() => toggleSection(label)}>
                              <span className="cdx-section-chev" aria-hidden>
                                ›
                              </span>
                              <span className="cdx-section-name">{label}</span>
                              <span className="cdx-section-count">{items.length}</span>
                            </button>
                            {!shut && <div className="cdx-section-body">{items.map((p) => pageRow(p))}</div>}
                          </div>
                        );
                      })}
                  {lens && (seqs.find((s) => s.id === lens)?.recordIds.length ?? 0) === 0 && (
                    <p className="list-empty">This sequence has no records yet.</p>
                  )}
                  {!lens && pages.length === 0 && <p className="list-empty">No records yet — import or author pages.</p>}
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
                <div className="panel-title" style={{ marginTop: 18 }}>
                  Recent notes
                  <button className="chip" style={{ marginLeft: 10 }} onClick={() => navigate("wte://notes")}>
                    All notes
                  </button>
                </div>
                <div className="cdx-list">
                  {notes.filter((n) => curator || n.visibility !== "gm").slice(0, 6).map((n) => (
                    <button
                      key={n.id}
                      className="cdx-item dim"
                      onClick={() => navigate(n.attachedTo ? `wte://page/${encodeURIComponent(n.attachedTo)}` : "wte://notes")}
                    >
                      {n.title || n.body.slice(0, 40) || "(untitled note)"}
                      {n.attachedTo ? " · " + n.attachedTo.replace(/_/g, " ") : ""}
                    </button>
                  ))}
                  {notes.length === 0 && <p className="list-empty">Annotate a page or add a scratch note.</p>}
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
          <div className="cdx-reader" ref={readerRef} onClick={onReaderClick} onMouseUp={onReaderMouseUp}>
            <div className="cdx-page-meta">wte://page/{view.stem}</div>
            {spawnNote && <div className="cdx-spawn-note">{spawnNote}</div>}
            {armoryNote && <div className="cdx-spawn-note">{armoryNote}</div>}
            {view.entry && <TypedCard entry={view.entry} onSpawn={spawnInVtt} onArmory={addArmory} />}
            <div className="cdx-content" dangerouslySetInnerHTML={{ __html: view.html }} />
            {(() => {
              const conn = connectionsFor(view.stem);
              return (
                <div className="notes-section">
                  <div className="panel-title">
                    Connections
                    <button className="chip" style={{ marginLeft: 10 }} onClick={() => navigate(`wte://graph/${encodeURIComponent(view.stem)}`)}>
                      Open graph
                    </button>
                  </div>
                  {!conn ? (
                    <button className="chip" onClick={() => void ensureTypeScan()}>
                      {scanState === "scanning" ? "Calibrating the archive…" : "Calibrate connections"}
                    </button>
                  ) : (
                    <div className="conn-grid">
                      <div>
                        <div className="conn-h">References · {conn.refs.length}</div>
                        {conn.refs.slice(0, 12).map((s) => (
                          <button key={s} className="cdx-item dim" onClick={() => navigate(`wte://page/${encodeURIComponent(s)}`)}>
                            {s.replace(/_/g, " ")}
                          </button>
                        ))}
                        {conn.refs.length === 0 && <p className="list-empty">No outgoing links.</p>}
                      </div>
                      <div>
                        <div className="conn-h">Used by · {conn.usedBy.length}</div>
                        {conn.usedBy.slice(0, 12).map((s) => (
                          <button key={s} className="cdx-item dim" onClick={() => navigate(`wte://page/${encodeURIComponent(s)}`)}>
                            {s.replace(/_/g, " ")}
                          </button>
                        ))}
                        {conn.usedBy.length === 0 && <p className="list-empty">Nothing links here yet.</p>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="notes-section">
              <div className="panel-title">
                Notes
                <button className="chip" style={{ marginLeft: 10 }} onClick={() => addNote(view.stem)}>
                  + Add note
                </button>
              </div>
              <NotesPanel
                notes={notes.filter((n) => n.attachedTo === view.stem)}
                curator={curator}
                onSave={persistNote}
                onDelete={removeNote}
              />
            </div>
            {annotate && (
              <button
                className="cdx-annotate"
                style={{ left: annotate.x, top: annotate.y + 14 }}
                onClick={() => {
                  addNote(view.stem, annotate.text);
                  setAnnotate(null);
                  window.getSelection()?.removeAllRanges();
                }}
              >
                Annotate selection
              </button>
            )}
          </div>
        )}

        {view.kind === "notes" && (
          <div className="cdx-reader">
            <div className="act-toolbar">
              <h2 className="cdx-search-head" style={{ margin: 0, flex: 1 }}>
                Notes · {notes.filter((n) => curator || n.visibility !== "gm").length}
              </h2>
              <button className="chip" onClick={() => addNote(null)}>
                + Scratch note
              </button>
            </div>
            <input
              className="bg-select full"
              placeholder="Search notes — title, body, tag, page…"
              value={noteSearch}
              onChange={(e) => setNoteSearch(e.target.value)}
              style={{ marginBottom: 14 }}
            />
            <NotesPanel
              notes={notes.filter((n) => {
                const f = noteSearch.trim().toLowerCase();
                if (!f) return true;
                return (
                  n.title.toLowerCase().includes(f) ||
                  n.body.toLowerCase().includes(f) ||
                  (n.attachedTo || "").toLowerCase().includes(f) ||
                  n.tags.some((t) => t.toLowerCase().includes(f))
                );
              })}
              curator={curator}
              onSave={persistNote}
              onDelete={removeNote}
              onOpenPage={(stem) => navigate(`wte://page/${encodeURIComponent(stem)}`)}
            />
          </div>
        )}

        {view.kind === "sequence" &&
          (() => {
            const s = seqs.find((x) => x.id === view.id);
            return (
              <div className="cdx-reader">
                {s ? (
                  <SequenceView
                    seq={s}
                    pages={pages}
                    onSave={persistSeq}
                    onDelete={(id) => void removeSequence(id)}
                    onOpenPage={(stem) => navigate(`wte://page/${encodeURIComponent(stem)}`)}
                    onBegin={beginRun}
                  />
                ) : (
                  <p className="list-empty">Sequence not found.</p>
                )}
              </div>
            );
          })()}

        {view.kind === "graph" &&
          (() => {
            const conn = connectionsFor(view.stem);
            const node = (s: string, x: number, y: number, cls: string) => (
              <g key={cls + s} className={"graph-node " + cls} transform={`translate(${x} ${y})`} onClick={() => navigate(`wte://page/${encodeURIComponent(s)}`)}>
                <line x1={-x} y1={-y} x2={0} y2={0} className="graph-edge" />
                <circle r={7} className="graph-dot" />
                <text x={x >= 0 ? 12 : -12} y={4} className="graph-label" style={{ textAnchor: x >= 0 ? "start" : "end" }}>
                  {s.replace(/_/g, " ").slice(0, 30)}
                </text>
              </g>
            );
            const arc = (list: string[], side: 1 | -1) =>
              list.slice(0, 16).map((s, i, all) => {
                const spread = Math.min(150, all.length * 22);
                const a = (((i - (all.length - 1) / 2) * (spread / Math.max(all.length - 1, 1)) + (side === 1 ? 0 : 180)) * Math.PI) / 180;
                return node(s, Math.cos(a) * 300, Math.sin(a) * 220, side === 1 ? "out" : "in");
              });
            return (
              <div className="graph-wrap">
                <div className="cdx-page-meta" style={{ margin: "16px 24px 0" }}>
                  wte://graph/{view.stem} · <span className="graph-key out">references →</span> · <span className="graph-key in">← used by</span>
                </div>
                {!conn ? (
                  <p className="list-empty" style={{ padding: 24 }}>
                    {scanState === "scanning" ? "Calibrating the archive graph…" : "Graph needs the archive scan."}
                  </p>
                ) : (
                  <svg className="graph-svg" viewBox="-500 -300 1000 600" preserveAspectRatio="xMidYMid meet">
                    {arc(conn.refs, 1)}
                    {arc(conn.usedBy, -1)}
                    <g className="graph-center" onClick={() => navigate(`wte://page/${encodeURIComponent(view.stem)}`)}>
                      <circle r={34} className="graph-core" />
                      <text y={4} className="graph-core-label">
                        {view.stem.replace(/_/g, " ").slice(0, 18)}
                      </text>
                    </g>
                  </svg>
                )}
              </div>
            );
          })()}

        {view.kind === "error" && (
          <div className="cdx-reader">
            <p className="list-empty">{view.message}</p>
          </div>
        )}
      </div>

      {editor && (
        <PageEditor
          initial={editor.initial}
          labels={[...BASE_LABELS, ...customLabels]}
          onSave={(d) => void savePageDraft(d)}
          onCancel={() => setEditor(null)}
        />
      )}
      {libraryOpen && <LibraryDialog onClose={() => setLibraryOpen(false)} onImported={afterLibraryImport} />}
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

function TypedCard({
  entry,
  onSpawn,
  onArmory,
}: {
  entry: CodexEntry;
  onSpawn: (c: Creature) => void;
  onArmory: (e: Weapon | Equipment) => void;
}) {
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
        {(entry.type === "weapon" || entry.type === "equipment") && (
          <button className="primary-btn cdx-card-act" onClick={() => onArmory(entry)}>
            Add to armory
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
