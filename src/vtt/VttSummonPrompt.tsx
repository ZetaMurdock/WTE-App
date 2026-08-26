import { useState } from "react";
import type { DeclaredSummon } from "./data/summonPlacement";
import { MAX_SUMMON_BATCH } from "./data/summonPlacement";
import { summonProfileNote, type SummonResolution } from "./data/summonRoster";

/** Where the bodies gather. Deliberately the AoE prompt's vocabulary minus
 *  "click to place": a swarm is not aimed at a square, it arrives around
 *  somebody, and packing 100 bodies outward from a pointer event would put the
 *  Curator's own cursor at the centre of the shape. */
export type SummonMode = "self" | "selected" | "center";

export interface SummonRow {
  summon: DeclaredSummon;
  resolution: SummonResolution;
}

interface Props {
  abilityName: string;
  rows: SummonRow[];
  casterName: string | null;
  hasCasterToken: boolean;
  hasSelectedToken: boolean;
  /** The statlines are still loading — the Curator must not confirm against a
   *  half-read roster, or a creature that HAS a page arrives unstatted because
   *  the page had not come back yet. */
  loading?: boolean;
  /** How many bodies of this row the map can actually hold at that anchor.
   *  Asked of the caller because only it has the live scene. */
  roomFor: (row: SummonRow, mode: SummonMode) => number;
  onPlace: (mode: SummonMode) => void;
  onCancel: () => void;
}

/**
 * The Curator's confirmation for a declared `Summon:` step.
 *
 * A summon is a proposal like every other consequence in this engine, and this
 * is where it is proposed. Nothing has been placed when this is on screen.
 *
 * What it shows, it shows because the alternative was a silent version of the
 * same thing: WHERE the bodies came from statwise (or that they came from
 * nowhere), and HOW MANY the map can hold. A prompt that said only "Summon 100
 * Lesser Stygian — Place" would let a Curator confirm 100 and get 63, or
 * confirm a swarm with no numbers on it, and find out either way afterwards.
 */
export function VttSummonPrompt({
  abilityName,
  rows,
  casterName,
  hasCasterToken,
  hasSelectedToken,
  loading = false,
  roomFor,
  onPlace,
  onCancel,
}: Props) {
  const [mode, setMode] = useState<SummonMode>(hasCasterToken ? "self" : hasSelectedToken ? "selected" : "center");

  const blocked = rows.filter((row) => row.resolution.status === "ambiguous");
  const overCap = rows.filter((row) => row.summon.count > MAX_SUMMON_BATCH);
  const canPlace = !loading && blocked.length === 0 && overCap.length === 0;

  return (
    <div className="vtt2-aoe-backdrop" onMouseDown={onCancel}>
      <div className="vtt2-aoe" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vtt2-aoe-title">Summon · {abilityName}</div>

        <div className="vtt2-aoe-label">Gather around</div>
        <div className="vtt2-aoe-modes">
          <button
            className={"chip" + (mode === "self" ? " active" : "")}
            onClick={() => setMode("self")}
            disabled={!hasCasterToken}
            title={hasCasterToken ? "Pack outward from the caster's token" : "The caster has no token on this scene"}
          >
            {casterName || "The caster"}
          </button>
          <button
            className={"chip" + (mode === "selected" ? " active" : "")}
            onClick={() => setMode("selected")}
            disabled={!hasSelectedToken}
            title={hasSelectedToken ? "Pack outward from the selected token" : "Select a token first"}
          >
            The selected token
          </button>
          <button className={"chip" + (mode === "center" ? " active" : "")} onClick={() => setMode("center")}>
            The view centre
          </button>
        </div>

        <div className="vtt2-aoe-label">Arriving</div>
        {rows.map((row) => {
          const room = roomFor(row, mode);
          const shortfall = Math.max(0, Math.min(row.summon.count, MAX_SUMMON_BATCH) - room);
          const capped = row.summon.count > MAX_SUMMON_BATCH;
          return (
            <div className="vtt2-aoe-effect" key={row.summon.id}>
              <div>
                <strong>
                  {row.summon.count > 1 ? `${row.summon.count} × ` : ""}
                  {row.summon.name}
                </strong>
                {row.summon.on !== "always" && <span> · on {row.summon.on === "fail" ? "a failed save" : "a success"}</span>}
              </div>
              <div>{loading ? "Reading the creature roster…" : summonProfileNote(row.resolution)}</div>
              {capped && (
                <div>
                  This table places at most {MAX_SUMMON_BATCH} bodies in one act — {row.summon.count} is more than a
                  scene can hold. Split the summon, or raise the cap in the code that owns it.
                </div>
              )}
              {!capped && room === 0 && <div>There is no open space here for them.</div>}
              {!capped && room > 0 && shortfall > 0 && (
                <div>
                  Room for {room} of {row.summon.count} here — move the anchor, or place {room} and the rest elsewhere.
                </div>
              )}
            </div>
          );
        })}

        <div className="vtt2-aoe-actions">
          <button className="ghost-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ghost-btn strong" onClick={() => onPlace(mode)} disabled={!canPlace}>
            Place bodies
          </button>
        </div>
        <div className="vtt2-aoe-hint">
          Summoned bodies are ordinary Curator tokens and stay until dismissed — select one and use “Dismiss swarm” to
          send the whole batch away at once.
        </div>
      </div>
    </div>
  );
}
