import { useCallback, useEffect, useState } from "react";
import { useNet } from "../net/NetContext";
import { formatMoney, formatMoneyLong, fromShrives, parseMoney, addShrives, spendShrives } from "../game/money";
import { addItem, moveItem, removeItem, stepQty, summarizeInventory, type InvItem } from "../game/tableInventory";
import { assignCharacterCampaign, listAllCharacters, type CharacterRecord } from "../lib/characters";
import { CharacterCreator } from "./characters/CharacterCreator";
import { PortraitFrame } from "./characters/PortraitFrame";
import { Collapsible } from "./ui/Collapsible";
import { useCampaignCodex } from "../game/useCampaignCodex";

// The player's view of the Curator's table. It appears once a Curator announces
// their campaign to the room — a player never picks the campaign by hand, because
// the campaign lives on the Curator's machine and this is a LINK to it.
export function PlayerCampaign() {
  const net = useNet();
  const codex = useCampaignCodex();
  const table = net.table;
  const [chars, setChars] = useState<CharacterRecord[]>([]);
  const [amount, setAmount] = useState("");
  const [unitAmount, setUnitAmount] = useState("");
  const [moneyNote, setMoneyNote] = useState("");
  const [creating, setCreating] = useState(false);

  // EVERY character on this device. A player's characters sit under their own
  // campaign ids — or none at all — so filtering to the Curator's id (which this
  // device does not own) showed an empty list and made the table look broken.
  const reload = useCallback(() => {
    void listAllCharacters().then(setChars);
  }, []);
  useEffect(() => reload(), [reload]);

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
  const codexReady = net.role === "host" || (codex.status === "ready" && codex.campaignId === t.campaignId);
  // Filed under THIS table vs everywhere else — the second group is what needs
  // carrying over for someone who built characters before joining.
  const here = chars.filter((c) => c.campaignId === t.campaignId);
  const elsewhere = chars.filter((c) => c.campaignId !== t.campaignId);
  const inUse = chars.find((c) => c.id === t.inUseCharacterId) ?? null;
  // Prefer the synced value for my own row so a Curator grant shows immediately.
  const myShrives = net.purses[net.selfId]?.shrives ?? t.purse;
  const purse = fromShrives(myShrives);
  // Prefer the synced list so a handoff from the stash shows immediately.
  const myItems = net.invs[net.selfId]?.items ?? t.inventory;

  function applyMoney(dir: 1 | -1) {
    const parsed = parseMoney(amount);
    if (parsed === null) {
      setMoneyNote("Type an amount — e.g. 2pd, 300cr, 4500sh, or a bare number of Shrives.");
      return;
    }
    // setMyPurse persists locally AND announces to the room, so the Curator sees it.
    if (dir === 1) {
      net.setMyPurse(addShrives(myShrives, parsed), inUse?.name);
      setMoneyNote(`Gained ${formatMoneyLong(parsed)}.`);
      setAmount("");
      return;
    }
    const next = spendShrives(myShrives, parsed);
    if (next === null) {
      setMoneyNote(`Not enough — you hold ${formatMoney(myShrives)} and that costs ${formatMoney(parsed)}.`);
      return;
    }
    net.setMyPurse(next, inUse?.name);
    setMoneyNote(`Spent ${formatMoneyLong(parsed)}.`);
    setAmount("");
  }

  function moveUnit(dir: 1 | -1) {
    const parsed = parseMoney(unitAmount);
    if (parsed === null) {
      setMoneyNote("Type an amount to move to or from the Unit purse.");
      return;
    }
    if (dir === 1) {
      // Into the Unit purse, out of mine.
      const mine = spendShrives(myShrives, parsed);
      if (mine === null) {
        setMoneyNote(`You only hold ${formatMoney(myShrives)}.`);
        return;
      }
      net.setMyPurse(mine, inUse?.name);
      net.setUnitPurse(addShrives(net.unitPurse, parsed));
      setMoneyNote(`Put ${formatMoneyLong(parsed)} into the Unit purse.`);
    } else {
      const unit = spendShrives(net.unitPurse, parsed);
      if (unit === null) {
        setMoneyNote(`The Unit purse only holds ${formatMoney(net.unitPurse)}.`);
        return;
      }
      net.setUnitPurse(unit);
      net.setMyPurse(addShrives(myShrives, parsed), inUse?.name);
      setMoneyNote(`Took ${formatMoneyLong(parsed)} from the Unit purse.`);
    }
    setUnitAmount("");
  }

  // Building a character straight from the table: the creator is handed the
  // Curator's campaign id, so it files itself into this table with no local
  // campaign needed. This is the whole point — a player should never have to
  // invent a campaign of their own just to roll a character.
  if (creating) {
    if (!codexReady) {
      return (
        <div className="dashboard">
          <div className="panel">
            <div className="panel-title">Campaign Codex</div>
            <p className="list-empty">
              {codex.status === "error"
                ? codex.message
                : "Syncing the Curator's character options and rules before creation…"}
            </p>
            <button className="ghost-btn" onClick={() => setCreating(false)}>Back to table</button>
          </div>
        </div>
      );
    }
    return (
      <CharacterCreator
        campaignId={t.campaignId}
        onCancel={() => setCreating(false)}
        onDone={(id) => {
          setCreating(false);
          reload();
          if (id) net.setInUseCharacter(id);
        }}
      />
    );
  }

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">
            Table · room {net.room} · {net.role === "host" ? "you are the Curator" : "player"}
          </div>
          <h1 className="dash-title">{t.campaignName || "Untitled campaign"}</h1>
          <div className="table-meta">
            <span className={net.sceneName ? "table-scene on" : "table-scene"}>
              {net.sceneName ? `Scene · ${net.sceneName}` : "No scene set"}
            </span>
            {net.nextSession && <span>Next session · {net.nextSession}</span>}
          </div>
        </div>
      </div>

      <div className="lobby-grid">
        <div className="lobby-card">
          <Collapsible
            defaultOpen={!inUse}
            title={<>Character · {inUse ? inUse.name : "none chosen"}</>}
            right={
              <button
                className="icon-btn xs"
                title="Build a character straight into this table"
                disabled={!codexReady}
                onClick={(e) => {
                  e.stopPropagation();
                  setCreating(true);
                }}
              >
                {codexReady ? "+ New" : "Syncing Codex…"}
              </button>
            }
          >
          {chars.length === 0 ? (
            <p className="list-empty">
              No characters on this device yet. Press <b>+ New</b> — you don&apos;t need a campaign of your
              own; it files straight into this table.
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
                {here.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {here.length === 0 && (
                <p className="vtt2-actor-hint" style={{ margin: "6px 0 0" }}>
                  None of your characters are filed under this table yet — bring one over below.
                </p>
              )}
            </>
          )}

          {/* Characters made before joining sit under another campaign (or none).
              Carrying one over just re-files it; nothing is copied or duplicated. */}
          {elsewhere.length > 0 && (
            <>
              <div className="panel-title mt">Bring a character to this table</div>
              <div className="carry-list">
                {elsewhere.map((c) => (
                  <div className="carry-row" key={c.id}>
                    <PortraitFrame src={c.sheet.portrait} size="sm" />
                    <span className="carry-name">
                      {c.name}
                      <span className="carry-where">{c.campaignId ? "another campaign" : "unfiled"}</span>
                    </span>
                    <button
                      className="icon-btn xs"
                      title="File this character under this table's campaign"
                      onClick={async () => {
                        await assignCharacterCampaign(c.id, t.campaignId);
                        reload();
                        net.setInUseCharacter(c.id);
                      }}
                    >
                      Bring over
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          </Collapsible>
        </div>

        <div className="lobby-card">
          <div className="panel-title">Purse</div>
          <div className="purse-total">{formatMoney(myShrives)}</div>
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
          <div className="panel-title">Unit purse</div>
          <div className="purse-total">{formatMoney(net.unitPurse)}</div>
          <p className="vtt2-actor-hint" style={{ margin: "4px 0 0" }}>
            The party's shared money. Anyone at the table can move money in or out.
          </p>
          <div className="purse-entry mt">
            <input
              className="bg-select"
              value={unitAmount}
              onChange={(e) => setUnitAmount(e.target.value)}
              placeholder="500cr"
              onKeyDown={(e) => e.key === "Enter" && moveUnit(1)}
            />
            <button className="icon-btn" onClick={() => moveUnit(1)} title="Move from your purse into the Unit purse">
              Put in
            </button>
            <button className="icon-btn" onClick={() => moveUnit(-1)} title="Take from the Unit purse into yours">
              Take
            </button>
          </div>
        </div>
      </div>

      <div className="lobby-rooms">
        <div className="panel-title">
          The party ({net.peers.length}){net.role === "host" ? " · you can hand out money" : ""}
        </div>
        <div className="room-grid">
          {net.peers.map((p) => {
            const held = net.purses[p.id];
            return (
              <div className={"room-card" + (p.role === "host" ? " mine" : "")} key={p.id}>
                <div className="room-open" style={{ cursor: "default" }}>
                  <span className="room-code" style={{ letterSpacing: 0, fontFamily: "Georgia, serif" }}>
                    {p.name}
                    {p.id === net.selfId ? " (you)" : ""}
                  </span>
                  <span className="room-meta">
                    {p.role === "host" ? "Curator" : held?.charName || "player"}
                    {" · "}
                    {held ? formatMoney(held.shrives) : "purse unknown"}
                  </span>
                </div>
                {net.role === "host" && p.id !== net.selfId && (
                  <div className="room-tools">
                    <button
                      className="icon-btn xs"
                      title="Give this player the amount typed in your purse box"
                      onClick={() => {
                        const parsed = parseMoney(amount);
                        if (parsed === null) return setMoneyNote("Type an amount in your purse box first, then press Pay.");
                        net.grantPurse(p.id, parsed);
                        setMoneyNote(`Paid ${formatMoneyLong(parsed)} to ${p.name}.`);
                        setAmount("");
                      }}
                    >
                      Pay
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="lobby-grid">
        <InvPanel
          title="My inventory"
          items={myItems}
          summary={summarizeInventory(myItems)}
          onAdd={(name, qty) => net.setMyInv(addItem(myItems, name, qty), inUse?.name)}
          onStep={(id, by) => net.setMyInv(stepQty(myItems, id, by), inUse?.name)}
          onRemove={(id) => net.setMyInv(removeItem(myItems, id), inUse?.name)}
          moveLabel="→ Unit"
          onMove={(id) => {
            const moved = moveItem(myItems, net.unitInv, id, 1);
            if (!moved) return setMoneyNote("Nothing left of that to hand over.");
            net.setMyInv(moved.from, inUse?.name);
            net.setUnitInv(moved.to);
          }}
        />
        <InvPanel
          title="Unit stash"
          items={net.unitInv}
          summary={summarizeInventory(net.unitInv)}
          onAdd={(name, qty) => net.setUnitInv(addItem(net.unitInv, name, qty))}
          onStep={(id, by) => net.setUnitInv(stepQty(net.unitInv, id, by))}
          onRemove={(id) => net.setUnitInv(removeItem(net.unitInv, id))}
          moveLabel="→ Mine"
          onMove={(id) => {
            const moved = moveItem(net.unitInv, myItems, id, 1);
            if (!moved) return setMoneyNote("Nothing left of that in the stash.");
            net.setUnitInv(moved.from);
            net.setMyInv(moved.to, inUse?.name);
          }}
        />
        {net.role === "host" && (
          <div className="lobby-card">
            <div className="panel-title">What the party carries</div>
            {net.peers.filter((p) => p.id !== net.selfId).length === 0 ? (
              <p className="list-empty">No players yet.</p>
            ) : (
              <ul className="lobby-feed">
                {net.peers
                  .filter((p) => p.id !== net.selfId)
                  .map((p) => {
                    const held = net.invs[p.id];
                    return (
                      <li key={p.id}>
                        <b>{held?.charName || p.name}</b> — {held ? summarizeInventory(held.items) : "not reported yet"}
                        {held && held.items.length > 0 && (
                          <div className="char-meta">{held.items.map((x) => `${x.name} ×${x.qty}`).join(", ")}</div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        )}
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

// One inventory list — used for both the personal and the Unit stash, since the
// only difference is which direction "move" goes.
function InvPanel({
  title,
  items,
  summary,
  onAdd,
  onStep,
  onRemove,
  onMove,
  moveLabel,
}: {
  title: string;
  items: InvItem[];
  summary: string;
  onAdd: (name: string, qty: number) => void;
  onStep: (id: string, by: number) => void;
  onRemove: (id: string) => void;
  onMove: (id: string) => void;
  moveLabel: string;
}) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  function commit() {
    if (!name.trim()) return;
    onAdd(name, parseInt(qty, 10) || 1);
    setName("");
    setQty("1");
  }
  return (
    <div className="lobby-card">
      <div className="panel-title">
        {title} <span className="load-badge">{summary}</span>
      </div>
      {items.length === 0 ? (
        <p className="list-empty">Empty.</p>
      ) : (
        <div className="inv-list">
          {items.map((x) => (
            <div className="inv-row" key={x.id}>
              <span className="inv-name" title={x.note}>
                {x.name}
                {x.value ? <span className="inv-worth">{formatMoney(x.value)} ea</span> : null}
              </span>
              <span className="inv-qty">×{x.qty}</span>
              <span className="inv-tools">
                <button className="icon-btn xs" onClick={() => onStep(x.id, -1)} title="One fewer">−</button>
                <button className="icon-btn xs" onClick={() => onStep(x.id, 1)} title="One more">+</button>
                <button className="icon-btn xs" onClick={() => onMove(x.id)} title={"Move one " + moveLabel}>
                  {moveLabel}
                </button>
                <button className="icon-btn xs" onClick={() => onRemove(x.id)} title="Remove entirely">×</button>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="inv-add mt">
        <input
          className="bg-select"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Item name"
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        <input
          className="stat-input"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <button className="icon-btn" onClick={commit} disabled={!name.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}
