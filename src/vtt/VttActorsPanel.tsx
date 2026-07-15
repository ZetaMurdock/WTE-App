import { useState } from "react";
import type { CharacterRecord } from "../lib/characters";
import type { Creature } from "../models/codex";

interface Props {
  characters: CharacterRecord[];
  loading: boolean;
  creatures: Creature[];
  creaturesLoading: boolean;
  /** Curator-only: spawn Codex creatures as linked tokens. */
  canSpawnCreatures: boolean;
  onSpawn: (rec: CharacterRecord) => void;
  onSpawnCreature: (c: Creature) => void;
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
  onSpawn,
  onSpawnCreature,
  onRefresh,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"party" | "creatures">("party");
  const [filter, setFilter] = useState("");
  const shownCreatures = filter.trim()
    ? creatures.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : creatures;

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
        loading ? (
          <p className="list-empty" style={{ margin: "6px 0 10px" }}>Loading vault…</p>
        ) : characters.length === 0 ? (
          <p className="list-empty" style={{ margin: "6px 0 10px" }}>No characters in this campaign's vault yet.</p>
        ) : (
          <ul className="vtt2-actor-list">
            {characters.map((c) => (
              <li key={c.id} className="vtt2-actor-row">
                <span className="vtt2-actor-label">{c.name}</span>
                <button className="chip" onClick={() => onSpawn(c)} title="Spawn a linked token at the view centre">
                  Spawn
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <input
            className="bg-select full"
            style={{ marginBottom: 6 }}
            placeholder="Filter creatures…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {creaturesLoading ? (
            <p className="list-empty" style={{ margin: "6px 0 10px" }}>Scanning the Codex…</p>
          ) : shownCreatures.length === 0 ? (
            <p className="list-empty" style={{ margin: "6px 0 10px" }}>
              {creatures.length === 0
                ? "No creature pages in the Codex — author some (TYPE | Creature) and pull them."
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
