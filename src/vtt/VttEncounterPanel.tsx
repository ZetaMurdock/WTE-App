import { useCallback, useEffect, useRef, useState } from "react";
import { getEncounter, saveEncounter, deleteEncounter } from "./data/encounterRepo";
import {
  newEncounter,
  orderedCombatants,
  turnNumber,
  type VttCombatant,
  type VttEncounter,
} from "./types/encounter";
import { newId, type VttToken } from "./types/scene";

interface Props {
  campaignId: string;
  sceneId: string;
  /** Current scene tokens, for adding combatants + name/HP lookups. */
  tokens: VttToken[];
  /** Scene's linked encounter id (scene.data.encounterId), or null. */
  linkedId: string | null;
  /** Persist scene.data.encounterId. */
  onLink: (id: string | null) => void;
  /** Mirror round/turn into scene.data.timeline. */
  onTimeline: (round: number, turn: number) => void;
  /** Push a combatant HP edit onto its linked token. */
  onTokenHp: (tokenId: string, hp: number) => void;
  /** Select a token on the map (focus the active combatant). */
  onFocusToken: (tokenId: string) => void;
  onClose: () => void;
}

function d20(): number {
  return 1 + Math.floor(Math.random() * 20);
}

// VTT v2 (slice 9): the Encounter / initiative tracker. Owns its own encounter row
// (encounters table); mirrors round/turn into the scene timeline via callbacks.
export function VttEncounterPanel({ campaignId, sceneId, tokens, linkedId, onLink, onTimeline, onTokenHp, onFocusToken, onClose }: Props) {
  const [enc, setEnc] = useState<VttEncounter | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<number | undefined>(undefined);
  // The encounter id currently shown — so we only hit the DB when the scene's
  // link points somewhere new, not after we just started/mutated one locally.
  const loadedId = useRef<string | null>(null);

  useEffect(() => {
    if (linkedId === loadedId.current) {
      setLoading(false);
      return;
    }
    let alive = true;
    async function load() {
      setLoading(true);
      const e = linkedId ? await getEncounter(linkedId).catch(() => null) : null;
      if (!alive) return;
      loadedId.current = e ? e.id : null;
      setEnc(e);
      setLoading(false);
    }
    void load();
    return () => {
      alive = false;
    };
  }, [linkedId, sceneId]);

  // Apply a mutation from an event handler: clone, mutate, persist (debounced),
  // and mirror round/turn into the scene timeline. Reads `enc` from the closure
  // (never inside a setState updater) so the parent isn't updated during render.
  const mutate = useCallback(
    (fn: (e: VttEncounter) => void) => {
      if (!enc) return;
      const next: VttEncounter = { ...enc, data: { ...enc.data, combatants: enc.data.combatants.map((c) => ({ ...c })) } };
      fn(next);
      setEnc(next);
      onTimeline(next.data.round, turnNumber(next.data));
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void saveEncounter(next).catch(() => {}), 400);
    },
    [enc, onTimeline]
  );

  async function start() {
    const e = newEncounter(campaignId, sceneId, "Encounter");
    e.data.activeId = null;
    await saveEncounter(e).catch(() => {});
    loadedId.current = e.id;
    setEnc(e);
    onLink(e.id);
    onTimeline(e.data.round, 0);
  }

  async function end() {
    if (enc) await deleteEncounter(enc.id).catch(() => {});
    loadedId.current = null;
    setEnc(null);
    onLink(null);
    onTimeline(0, 0);
  }

  function addFromTokens() {
    mutate((e) => {
      const have = new Set(e.data.combatants.map((c) => c.tokenId).filter(Boolean));
      for (const t of tokens) {
        if (have.has(t.id)) continue;
        e.data.combatants.push({
          id: newId("cb"),
          name: t.name,
          tokenId: t.id,
          initiative: 0,
          hp: t.hp ?? t.hpMax ?? 0,
          hpMax: t.hpMax ?? t.hp ?? 0,
          status: [],
          color: t.color,
        });
      }
    });
  }

  function addBlank() {
    mutate((e) => {
      e.data.combatants.push({ id: newId("cb"), name: "Combatant", initiative: 0, hp: 0, hpMax: 0, status: [] });
    });
  }

  function rollInitiative() {
    mutate((e) => {
      for (const c of e.data.combatants) c.initiative = d20();
      // Kick off the round on the top of the order if nothing is active yet.
      if (!e.data.activeId) e.data.activeId = orderedCombatants(e.data)[0]?.id ?? null;
    });
  }

  function patchCombatant(id: string, patch: Partial<VttCombatant>) {
    mutate((e) => {
      const c = e.data.combatants.find((x) => x.id === id);
      if (!c) return;
      Object.assign(c, patch);
      if (patch.hp !== undefined && c.tokenId) onTokenHp(c.tokenId, patch.hp);
    });
  }

  function removeCombatant(id: string) {
    mutate((e) => {
      e.data.combatants = e.data.combatants.filter((c) => c.id !== id);
      if (e.data.activeId === id) e.data.activeId = orderedCombatants(e.data)[0]?.id ?? null;
    });
  }

  function step(dir: 1 | -1) {
    mutate((e) => {
      const order = orderedCombatants(e.data);
      if (order.length === 0) return;
      const cur = order.findIndex((c) => c.id === e.data.activeId);
      let next = cur < 0 ? 0 : cur + dir;
      if (next >= order.length) {
        next = 0;
        e.data.round += 1;
      } else if (next < 0) {
        next = order.length - 1;
        e.data.round = Math.max(1, e.data.round - 1);
      }
      e.data.activeId = order[next].id;
      const focus = order[next].tokenId;
      if (focus) onFocusToken(focus);
    });
  }

  function addStatus(id: string) {
    const s = prompt("Add status / condition");
    if (s && s.trim()) {
      mutate((e) => {
        const c = e.data.combatants.find((x) => x.id === id);
        if (c && !c.status.includes(s.trim())) c.status.push(s.trim());
      });
    }
  }

  function removeStatus(id: string, s: string) {
    mutate((e) => {
      const c = e.data.combatants.find((x) => x.id === id);
      if (c) c.status = c.status.filter((x) => x !== s);
    });
  }

  const order = enc ? orderedCombatants(enc.data) : [];

  return (
    <div className="vtt2-encounter">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>
          Encounter
        </span>
        <button className="cdx-tab-x" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {loading ? (
        <p className="list-empty" style={{ margin: "6px 0" }}>
          Loading…
        </p>
      ) : !enc ? (
        <>
          <p className="list-empty" style={{ margin: "6px 0 10px" }}>
            No encounter running on this scene.
          </p>
          <button className="vtt2-scene-new" onClick={() => void start()}>
            + Start encounter
          </button>
        </>
      ) : (
        <>
          <div className="vtt2-enc-bar">
            <button className="icon-btn sm" onClick={() => step(-1)} title="Previous turn">
              ‹
            </button>
            <span className="vtt2-enc-round">Round {enc.data.round}</span>
            <button className="icon-btn sm" onClick={() => step(1)} title="Next turn">
              ›
            </button>
          </div>

          {order.length === 0 ? (
            <p className="list-empty" style={{ margin: "6px 0" }}>
              No combatants yet.
            </p>
          ) : (
            <ul className="vtt2-enc-list">
              {order.map((c) => (
                <li key={c.id} className={"vtt2-enc-row" + (c.id === enc.data.activeId ? " active" : "")}>
                  <input
                    className="vtt2-enc-init"
                    type="number"
                    value={c.initiative}
                    title="Initiative"
                    onChange={(e) => patchCombatant(c.id, { initiative: parseInt(e.target.value, 10) || 0 })}
                  />
                  <div className="vtt2-enc-main">
                    <input
                      className="vtt2-enc-name"
                      value={c.name}
                      onChange={(e) => patchCombatant(c.id, { name: e.target.value })}
                      onFocus={() => c.tokenId && onFocusToken(c.tokenId)}
                    />
                    <div className="vtt2-enc-hp">
                      <input
                        type="number"
                        value={c.hp}
                        title="HP"
                        onChange={(e) => patchCombatant(c.id, { hp: parseInt(e.target.value, 10) || 0 })}
                      />
                      <span>/</span>
                      <input
                        type="number"
                        value={c.hpMax}
                        title="Max HP"
                        onChange={(e) => patchCombatant(c.id, { hpMax: parseInt(e.target.value, 10) || 0 })}
                      />
                      <button className="vtt2-enc-status-add" onClick={() => addStatus(c.id)} title="Add status">
                        +st
                      </button>
                      <button className="vtt2-enc-remove" onClick={() => removeCombatant(c.id)} title="Remove">
                        ✕
                      </button>
                    </div>
                    {c.status.length > 0 && (
                      <div className="vtt2-enc-statuses">
                        {c.status.map((s) => (
                          <button key={s} className="vtt2-enc-status" onClick={() => removeStatus(c.id, s)} title="Remove status">
                            {s} ×
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="vtt2-enc-actions">
            <button className="chip" onClick={addFromTokens} title="Add all scene tokens">
              + Tokens
            </button>
            <button className="chip" onClick={addBlank}>
              + Blank
            </button>
            <button className="chip" onClick={rollInitiative} title="Roll 1d20 initiative for all">
              Roll init
            </button>
            <button className="chip" onClick={() => void end()} title="End + clear this encounter">
              End
            </button>
          </div>
        </>
      )}
    </div>
  );
}
