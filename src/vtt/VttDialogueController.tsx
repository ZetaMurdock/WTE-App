import { useEffect, useState } from "react";
import { useNet } from "../net/NetContext";
import { listCharacters, type CharacterRecord } from "../lib/characters";
import { SECTORS } from "../game/wte";
import {
  INFLUENCE_LEVELS,
  beaconLine,
  consequencesAt,
  crossingWarning,
  influenceOf,
  isEscalation,
  type InfluenceBand,
} from "../game/mogulInfluence";

interface Props {
  campaignId: string;
  onClose: () => void;
}

// The Curator's dialogue desk. Two ways to put words on the table:
//
//  • SPEECH — pick a character from the vault, type a line, push it. The portrait
//    comes off their sheet, so a recurring NPC always looks the same.
//  • BEACON — the automatic kind: a location readout built from the Mogul
//    Influence bands, so exploration announcements are consistent instead of
//    retyped from memory every session.
export function VttDialogueController({ campaignId, onClose }: Props) {
  const net = useNet();
  const [chars, setChars] = useState<CharacterRecord[]>([]);
  const [speakerId, setSpeakerId] = useState("");
  const [line, setLine] = useState("");
  const [tab, setTab] = useState<"speech" | "beacon">("speech");

  // Beacon fields
  const [planet, setPlanet] = useState("");
  const [sector, setSector] = useState("");
  const [band, setBand] = useState<InfluenceBand>("marginal");
  const [note, setNote] = useState("");
  const [lastBand, setLastBand] = useState<InfluenceBand | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void listCharacters(campaignId).then((c) => alive && setChars(c));
    return () => {
      alive = false;
    };
  }, [campaignId]);

  const speaker = chars.find((c) => c.id === speakerId) ?? null;
  const lvl = influenceOf(band);
  const preview = beaconLine({ planet, sector, band, note });
  const escalating = isEscalation(lastBand, band);

  function pushSpeech() {
    if (!line.trim() && !speaker) return;
    net.setDialogue({
      kind: "speech",
      speaker: speaker?.name,
      portrait: speaker?.sheet.portrait,
      text: line.trim(),
    });
    setLine("");
  }

  function pushBeacon() {
    net.setDialogue({ kind: "beacon", text: preview });
    setLastBand(band);
  }

  function pushCrossing() {
    const warn = crossingWarning(band);
    if (warn) net.setDialogue({ kind: "beacon", text: warn });
  }

  return (
    <div className="vtt2-sheet-overlay" onMouseDown={onClose}>
      <div className="dlg-ctl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vtt2-insp-head">
          <span className="panel-title" style={{ margin: 0 }}>Dialogue</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div className="chip-row">
              <button className={"chip" + (tab === "speech" ? " active" : "")} onClick={() => setTab("speech")}>
                Speech
              </button>
              <button className={"chip" + (tab === "beacon" ? " active" : "")} onClick={() => setTab("beacon")}>
                Beacon
              </button>
            </div>
            <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
          </div>
        </div>

        {net.status !== "connected" && (
          <p className="vtt2-actor-hint" style={{ margin: "0 0 8px" }}>
            Not in a room — this will show on your screen only until players join.
          </p>
        )}

        {tab === "speech" ? (
          <>
            <label className="lobby-field">
              <span>Speaker — any character in this campaign's vault</span>
              <select className="bg-select full" value={speakerId} onChange={(e) => setSpeakerId(e.target.value)}>
                <option value="">— narration, no portrait —</option>
                {chars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {speaker && !speaker.sheet.portrait && (
              <p className="vtt2-actor-hint" style={{ margin: "4px 0 0" }}>
                {speaker.name} has no portrait on their sheet — the box will show their initial instead.
              </p>
            )}
            <label className="lobby-field mt">
              <span>Line</span>
              <textarea
                className="bg-select full"
                style={{ minHeight: 84 }}
                value={line}
                onChange={(e) => setLine(e.target.value)}
                placeholder="An extraction ship is on its way but the Grineer will be hunting you…"
              />
            </label>
            <div className="dlg-ctl-actions">
              <button className="primary-btn" onClick={pushSpeech} disabled={!line.trim() && !speaker}>
                Show on every screen
              </button>
              <button className="icon-btn" onClick={() => net.setDialogue(null)}>
                Clear
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dlg-beacon-grid">
              <label className="lobby-field">
                <span>Planet</span>
                <input className="bg-select full" value={planet} onChange={(e) => setPlanet(e.target.value)} placeholder="Ashfall" />
              </label>
              <label className="lobby-field">
                <span>Sector</span>
                <input
                  className="bg-select full"
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  placeholder="Boren"
                  list="wte-sectors"
                />
                <datalist id="wte-sectors">
                  {SECTORS.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.epithet}
                    </option>
                  ))}
                </datalist>
              </label>
            </div>

            <div className="lobby-field mt">
              <span>Mogul Influence</span>
              <div className="chip-row">
                {INFLUENCE_LEVELS.map((l) => (
                  <button
                    key={l.band}
                    className={"chip inf-" + l.band + (band === l.band ? " active" : "")}
                    onClick={() => setBand(l.band)}
                    title={`${l.territory} — ${l.character}`}
                  >
                    {l.zone}
                  </button>
                ))}
              </div>
            </div>

            <div className={"inf-readout sev" + lvl.severity}>
              <div className="inf-readout-top">
                <b>{lvl.territory}</b>
                <span>{lvl.hazard}</span>
              </div>
              <div className="inf-readout-sub">{lvl.character}</div>
              {escalating && <div className="inf-escalate">Deeper than the last logged position.</div>}
            </div>

            {lvl.beyondGeofence && (
              <ul className="inf-consequences">
                {consequencesAt(band).map((c) => (
                  <li key={c.name}>
                    <b>{c.name}</b> — {c.detail}
                  </li>
                ))}
              </ul>
            )}

            <label className="lobby-field mt">
              <span>Extra note (optional)</span>
              <input className="bg-select full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quarantine in force" />
            </label>

            <div className="dlg-preview">{preview}</div>

            <div className="dlg-ctl-actions">
              <button className="primary-btn" onClick={pushBeacon}>
                Broadcast beacon
              </button>
              {lvl.beyondGeofence && (
                <button className="icon-btn" onClick={pushCrossing} title="Announce that jurisdiction is gone">
                  Announce crossing
                </button>
              )}
              <button className="icon-btn" onClick={() => net.setDialogue(null)}>
                Clear
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
