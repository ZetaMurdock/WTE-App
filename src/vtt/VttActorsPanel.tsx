import { useState } from "react";
import type { CharacterRecord } from "../lib/characters";
import type { Creature } from "../models/codex";
import type { QuickCreature } from "./data/quickCreatures";

/** The stat keys the quick form offers — the common creature block. */
const QUICK_STAT_KEYS = ["OFF", "DEF", "SPD", "WIL", "PHY", "INT"] as const;

interface Props {
  characters: CharacterRecord[];
  loading: boolean;
  creatures: Creature[];
  creaturesLoading: boolean;
  /** Curator-only: spawn Codex creatures as linked tokens. */
  canSpawnCreatures: boolean;
  /** Curator's on-the-spot stat blocks (saved per campaign). */
  quickCreatures: QuickCreature[];
  onSaveQuick: (qc: QuickCreature) => void;
  onDeleteQuick: (id: string) => void;
  onSpawnQuick: (qc: QuickCreature) => void;
  /** Characters other players have shared live into the room (netplay). */
  remoteChars: { id: string; name: string; owner: string }[];
  /** Connected players in the room (Curator side) + whether they've shared yet. */
  roomPlayers?: { id: string; name: string; shared: boolean }[];
  /** Curator: ask every player to push their sheets so you can open + edit them. */
  onRequestSheets?: () => void;
  onSpawn: (rec: CharacterRecord) => void;
  onSpawnCreature: (c: Creature) => void;
  /** Open a local vault character's full sheet as an overlay. */
  onOpenSheet: (rec: CharacterRecord) => void;
  /** Open a shared (remote) character's sheet by id — synced live over netplay. */
  onOpenSheetId: (id: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

const CLASS_NAME: Record<number, string> = {
  1: "Standard", 2: "Anima", 3: "Alter Anima", 4: "Fractures", 5: "Doxa", 6: "Nyvilum",
};

// The Actors panel: spawn vault characters or — for the Curator — Codex creatures
// (their sheets pulled from the Codex) as HP/stat-linked tokens.
export function VttActorsPanel({
  characters,
  loading,
  creatures,
  creaturesLoading,
  canSpawnCreatures,
  quickCreatures,
  onSaveQuick,
  onDeleteQuick,
  onSpawnQuick,
  remoteChars,
  roomPlayers = [],
  onRequestSheets,
  onSpawn,
  onSpawnCreature,
  onOpenSheet,
  onOpenSheetId,
  onRefresh,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"party" | "creatures">("party");
  const [filter, setFilter] = useState("");
  // The quick-creature form: null = closed, a draft = open (existing id = editing).
  const [draft, setDraft] = useState<QuickCreature | null>(null);
  const q = filter.trim().toLowerCase();
  const shownCreatures = q ? creatures.filter((c) => c.name.toLowerCase().includes(q)) : creatures;
  const shownQuick = q ? quickCreatures.filter((c) => c.name.toLowerCase().includes(q)) : quickCreatures;

  function newDraft(): QuickCreature {
    return { id: `qc-${Date.now().toString(36)}`, name: "", hp: 10, size: 1 };
  }
  function setDraftStat(k: string, v: string) {
    setDraft((d) => {
      if (!d) return d;
      const stats = { ...(d.stats ?? {}) };
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n !== 0) stats[k] = n;
      else delete stats[k];
      return { ...d, stats: Object.keys(stats).length ? stats : undefined };
    });
  }
  function commitDraft() {
    if (!draft || !draft.name.trim()) return;
    onSaveQuick(draft);
    setDraft(null);
  }

  return (
    <div className="vtt2-actors">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>
          Actors
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn sm" onClick={onRefresh} title="Reload the vault + Codex creatures">
            ⟳
          </button>
          <button className="cdx-tab-x" onClick={onClose} title="Close">
            ×
          </button>
        </div>
      </div>

      <div className="desk-tabs" style={{ marginBottom: 8 }}>
        <button className={"desk-tab" + (tab === "party" ? " active" : "")} onClick={() => setTab("party")}>
          Party
        </button>
        {canSpawnCreatures && (
          <button className={"desk-tab" + (tab === "creatures" ? " active" : "")} onClick={() => setTab("creatures")}>
            Creatures
          </button>
        )}
      </div>

      {tab === "party" ? (
        <>
          {onRequestSheets && (
            <div className="vtt2-room-block">
              <div className="vtt2-actor-group" style={{ marginTop: 0 }}>
                In the room ({roomPlayers.length})
                <button className="chip" style={{ marginLeft: "auto" }} onClick={onRequestSheets} title="Ask every player to send their characters so you can open and edit them">
                  Request sheets
                </button>
              </div>
              {roomPlayers.length === 0 ? (
                <p className="list-empty" style={{ margin: "4px 0 8px" }}>No players connected yet.</p>
              ) : (
                <ul className="vtt2-actor-list">
                  {roomPlayers.map((p) => (
                    <li key={p.id} className="vtt2-actor-row">
                      <span className="vtt2-actor-label">
                        {p.name}
                        <span className="vtt2-actor-sub">{p.shared ? "sheet shared" : "no sheet yet — request it"}</span>
                      </span>
                      <span className={"vtt2-room-dot" + (p.shared ? " on" : "")} title={p.shared ? "This player's sheet is available below" : "Waiting for this player's sheet"} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {remoteChars.length > 0 && (
            <>
              <div className="vtt2-actor-group">Players (live)</div>
              <ul className="vtt2-actor-list">
                {remoteChars.map((c) => (
                  <li key={c.id} className="vtt2-actor-row">
                    <span className="vtt2-actor-label">
                      {c.name}
                      <span className="vtt2-actor-sub">shared by {c.owner}</span>
                    </span>
                    <button className="chip" onClick={() => onOpenSheetId(c.id)} title="Open this player's sheet — edits sync live to them">
                      Open
                    </button>
                  </li>
                ))}
              </ul>
              <div className="vtt2-actor-group">Vault</div>
            </>
          )}
          {loading ? (
          <p className="list-empty" style={{ margin: "6px 0 10px" }}>Loading vault…</p>
        ) : characters.length === 0 ? (
          <p className="list-empty" style={{ margin: "6px 0 10px" }}>No characters in this campaign's vault yet.</p>
        ) : (
          <ul className="vtt2-actor-list">
            {characters.map((c) => (
              <li key={c.id} className="vtt2-actor-row">
                <span className="vtt2-actor-label">{c.name}</span>
                <span style={{ display: "flex", gap: 4 }}>
                  <button className="chip" onClick={() => onOpenSheet(c)} title="Open this character's full sheet — view stats, roll, and edit">
                    Open
                  </button>
                  <button className="chip" onClick={() => onSpawn(c)} title="Spawn a linked token at the view centre">
                    Spawn
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        </>
      ) : (
        <>
          <div className="vtt2-asset-add-row" style={{ marginBottom: 6 }}>
            <input
              className="bg-select"
              style={{ flex: 1 }}
              placeholder="Filter creatures…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button
              className="chip"
              onClick={() => setDraft(draft ? null : newDraft())}
              title="Type a stat block on the spot — no Codex page needed. Saved to this campaign."
            >
              {draft ? "Cancel" : "New creature"}
            </button>
          </div>

          {draft && (
            <div className="vtt2-quick-form">
              <input
                className="bg-select full"
                placeholder="Name"
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <div className="vtt2-quick-grid">
                <label>
                  HP
                  <input className="bg-select" type="number" min={1} value={draft.hp} onChange={(e) => setDraft({ ...draft, hp: parseInt(e.target.value, 10) || 1 })} />
                </label>
                <label>
                  DR
                  <input className="bg-select" type="number" min={0} value={draft.dr ?? 0} onChange={(e) => setDraft({ ...draft, dr: parseInt(e.target.value, 10) || 0 })} />
                </label>
                <label>
                  Size
                  <input className="bg-select" type="number" min={1} max={6} value={draft.size ?? 1} onChange={(e) => setDraft({ ...draft, size: parseInt(e.target.value, 10) || 1 })} title="Token diameter in grid cells (1–6)" />
                </label>
              </div>
              <div className="vtt2-quick-grid">
                {QUICK_STAT_KEYS.map((k) => (
                  <label key={k}>
                    {k}
                    <input className="bg-select" type="number" value={draft.stats?.[k] ?? ""} placeholder="—" onChange={(e) => setDraftStat(k, e.target.value)} />
                  </label>
                ))}
              </div>
              <input
                className="bg-select full"
                placeholder="Traits (one line — feeds ability rolls)"
                value={draft.traits ?? ""}
                onChange={(e) => setDraft({ ...draft, traits: e.target.value || undefined })}
              />
              <input
                className="bg-select full"
                placeholder="Notes (optional)"
                value={draft.desc ?? ""}
                onChange={(e) => setDraft({ ...draft, desc: e.target.value || undefined })}
              />
              <button className="primary-btn" onClick={commitDraft} disabled={!draft.name.trim()}>
                Save to campaign
              </button>
            </div>
          )}

          {shownQuick.length > 0 && (
            <>
              <div className="vtt2-actor-group">Quick creatures</div>
              <ul className="vtt2-actor-list">
                {shownQuick.map((c) => (
                  <li key={c.id} className="vtt2-actor-row">
                    <span className="vtt2-actor-label">
                      {c.name}
                      <span className="vtt2-actor-sub">
                        HP {c.hp}
                        {c.dr ? ` · DR ${c.dr}` : ""}
                        {(c.size ?? 1) > 1 ? ` · ${c.size} cells` : ""}
                      </span>
                    </span>
                    <span style={{ display: "flex", gap: 4 }}>
                      <button className="chip" onClick={() => setDraft({ ...c })} title="Edit this stat block">
                        Edit
                      </button>
                      <button className="chip" onClick={() => onSpawnQuick(c)} title="Spawn as a token at the view centre">
                        Spawn
                      </button>
                      <button className="icon-btn sm" onClick={() => onDeleteQuick(c.id)} title="Delete this quick creature">
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="vtt2-actor-group">Codex</div>
            </>
          )}

          {creaturesLoading ? (
            <p className="list-empty" style={{ margin: "6px 0 10px" }}>Scanning the Codex…</p>
          ) : shownCreatures.length === 0 ? (
            <p className="list-empty" style={{ margin: "6px 0 10px" }}>
              {creatures.length === 0
                ? "No creature pages in the Codex — author some (TYPE | Creature) and pull them, or press New creature to type a stat block right here."
                : "No matches."}
            </p>
          ) : (
            <ul className="vtt2-actor-list">
              {shownCreatures.map((c, i) => (
                <li key={c.name + i} className="vtt2-actor-row">
                  <span className="vtt2-actor-label">
                    {c.name}
                    <span className="vtt2-actor-sub">
                      Class {c.cls} · {c.archive || CLASS_NAME[c.cls]}
                    </span>
                  </span>
                  <button className="chip" onClick={() => onSpawnCreature(c)} title="Spawn this Codex creature as a linked token">
                    Spawn
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="vtt2-actor-hint">Sheets (HP · DR · size · flags) are pulled from the Codex.</p>
        </>
      )}
    </div>
  );
}
