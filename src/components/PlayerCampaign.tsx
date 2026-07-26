import { useEffect, useState } from "react";
import { useNet } from "../net/NetContext";
import { saveTableLink } from "../net/activeTable";
import { formatMoney, formatMoneyLong, fromShrives, parseMoney, addShrives, spendShrives } from "../game/money";
import { listCharacters, type CharacterRecord } from "../lib/characters";
import { PortraitFrame } from "./characters/PortraitFrame";

// The player's view of the Curator's table. It appears once a Curator announces
// their campaign to the room — a player never picks the campaign by hand, because
// the campaign lives on the Curator's machine and this is a LINK to it.
export function PlayerCampaign() {
  const net = useNet();
  const table = net.table;
  const [chars, setChars] = useState<CharacterRecord[]>([]);
  const [amount, setAmount] = useState("");
  const [moneyNote, setMoneyNote] = useState("");

  // My own characters, from MY vault — the character is mine, the table is theirs.
  useEffect(() => {
    if (!table?.campaignId) return;
    let alive = true;
    // A player's characters may sit under their own campaign(s), so offer all of
    // them rather than filtering to the Curator's id, which this device does not own.
    void listCharacters(table.campaignId).then((mine) => {
      if (alive) setChars(mine);
    });
    return () => {
      alive = false;
    };
  }, [table?.campaignId]);

  if (net.status !== "connected") {
    return (
      <div className="dashboard">
        <div className="dash-header">
          <div>
            <div className="dash-eyebrow">Table</div>
            <h1 className="dash-title">Not at a table</h1>
          </div>
        </div>
        <p className="list-empty">
          Join your Curator&apos;s room from the Lobby. Your campaign, scene and table info arrive
          automatically once you&apos;re in.
        </p>
      </div>
    );
  }

  if (!table?.campaignId) {
    return (
      <div className="dashboard">
        <div className="dash-header">
          <div>
            <div className="dash-eyebrow">Table · room {net.room}</div>
            <h1 className="dash-title">Waiting for the Curator</h1>
          </div>
        </div>
        <p className="list-empty">
          You&apos;re in the room, but the Curator hasn&apos;t named a campaign yet. It appears here the
          moment they do — they just need a campaign selected on their side.
        </p>
      </div>
    );
  }

  // Bound after the guards above so the closures below narrow cleanly.
  const t = table;
  const inUse = chars.find((c) => c.id === t.inUseCharacterId) ?? null;
  const purse = fromShrives(t.purse);

  function applyMoney(dir: 1 | -1) {
    const parsed = parseMoney(amount);
    if (parsed === null) {
      setMoneyNote("Type an amount — e.g. 2pd, 300cr, 4500sh, or a bare number of Shrives.");
      return;
    }
    if (dir === 1) {
      saveTableLink({ room: t.room, purse: addShrives(t.purse, parsed) });
      setMoneyNote(`Gained ${formatMoneyLong(parsed)}.`);
      setAmount("");
      // Touch the link so the context re-reads the stored purse into state.
      net.setInUseCharacter(t.inUseCharacterId ?? null);
      return;
    }
    const next = spendShrives(t.purse, parsed);
    if (next === null) {
      setMoneyNote(`Not enough — you hold ${formatMoney(t.purse)} and that costs ${formatMoney(parsed)}.`);
      return;
    }
    saveTableLink({ room: t.room, purse: next });
    setMoneyNote(`Spent ${formatMoneyLong(parsed)}.`);
    setAmount("");
    net.setInUseCharacter(t.inUseCharacterId ?? null);
  }

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">
            Table · room {net.room} · {net.role === "host" ? "you are the Curator" : "player"}
          </div>
          <h1 className="dash-title">{t.campaignName || "Untitled campaign"}</h1>
          {net.nextSession && <div className="lobby-id">Next session · {net.nextSession}</div>}
        </div>
      </div>

      <div className="lobby-grid">
        <div className="lobby-card">
          <div className="panel-title">In-use character</div>
          {chars.length === 0 ? (
            <p className="list-empty">
              No characters in this campaign on this device yet. Build one in the Characters tab and it
              appears here.
            </p>
          ) : (
            <>
              {inUse && (
                <div className="inuse-row">
                  <PortraitFrame src={inUse.sheet.portrait} size="sm" />
                  <div>
                    <div className="char-name">{inUse.name}</div>
                    <div className="char-meta">Playing at this table</div>
                  </div>
                </div>
              )}
              <select
                className="bg-select full mt"
                value={t.inUseCharacterId ?? ""}
                onChange={(e) => net.setInUseCharacter(e.target.value || null)}
              >
                <option value="">— nobody selected —</option>
                {chars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="lobby-card">
          <div className="panel-title">Purse</div>
          <div className="purse-total">{formatMoney(t.purse)}</div>
          <div className="purse-breakdown">
            <span>
              <b>{purse.palladium.toLocaleString()}</b> Palladium
            </span>
            <span>
              <b>{purse.credits.toLocaleString()}</b> Credits
            </span>
            <span>
              <b>{purse.shrives.toLocaleString()}</b> Shrives
            </span>
          </div>
          <div className="purse-entry mt">
            <input
              className="bg-select"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="2pd 300cr 50sh"
              onKeyDown={(e) => e.key === "Enter" && applyMoney(1)}
            />
            <button className="icon-btn" onClick={() => applyMoney(1)} title="Add to the purse">
              Gain
            </button>
            <button className="icon-btn" onClick={() => applyMoney(-1)} title="Take out of the purse">
              Spend
            </button>
          </div>
          <p className="purse-rate">10,000 Shrives = 1 Credit · 1,000,000 Credits = 1 Palladium</p>
          {moneyNote && <p className="vtt2-actor-hint" style={{ marginTop: 4 }}>{moneyNote}</p>}
        </div>

        <div className="lobby-card">
          <div className="panel-title">Players ({net.peers.length})</div>
          <div className="chip-list">
            {net.peers.map((p) => (
              <span key={p.id} className={"load-chip" + (p.role === "host" ? " cipher" : "")}>
                {p.name}
                {p.id === net.selfId ? " (you)" : ""}
                {p.role === "host" ? " · Curator" : ""}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="lobby-rooms">
        <div className="panel-title">Unit notes ({net.unitNotes.length})</div>
        {net.unitNotes.length === 0 ? (
          <p className="list-empty">
            Shared party notes appear here — anyone at the table can add them from the Campaign desk.
          </p>
        ) : (
          <ul className="lobby-feed">
            {net.unitNotes.map((n) => (
              <li key={n.id}>
                <b>{n.title || "Untitled"}</b>
                {n.body ? " — " + n.body.slice(0, 160) : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
