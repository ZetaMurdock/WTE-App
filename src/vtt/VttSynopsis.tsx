import { useEffect, useState } from "react";
import { woundBand } from "./data/partyHud";
import { offlineMoneyReason, planMoneyGift, type ItemGift, type MoneyGift, type SynopsisView } from "./data/synopsis";
import { formatMoney } from "../game/money";
import { WEIGHT_CATS, type WeightKey } from "../game/wte";

/**
 * The Curator's console for one party member.
 *
 * It is deliberately SHORT. Everything above the fold is a reading — who they
 * are, what their body is doing, what they are carrying — and everything below
 * it is the Curator handing something over. What it does not do is restate the
 * character sheet; "Open full sheet" is one button away and is the right answer
 * for anything this page does not carry.
 *
 * ONE GIVE FORM AT A TIME, chosen by the chip row, for the same reason the party
 * HUD carousels: three stacked forms is a panel pretending to be a card, and the
 * Curator is doing one thing.
 *
 * WHAT NEEDS A BODY, WHAT NEEDS A SHEET, AND WHAT NEEDS A CONNECTION — three
 * different requirements, each said out loud where it bites:
 *
 *  • Statuses and vision are properties of a TOKEN, so they are disabled for a
 *    member whose character is not on this scene.
 *  • Information and items are SHEET fields, so they work either way — that is
 *    the point: the Curator can hand a note to someone who is not even logged in
 *    and the player finds it waiting.
 *  • Money needs a LIVE PEER. A purse is not on the sheet; it is on the player's
 *    own device (see data/synopsis), so an offline member's money form is
 *    disabled and says why, rather than accepting a grant that would go nowhere.
 */

type GiveTab = "info" | "item" | "money";

interface Props {
  view: SynopsisView;
  /** Handed the whole decision, refusals included, so the console never has to
   *  own a toast and a refused gift can never be reported as a completed one. */
  onGiveMoney: (gift: MoneyGift) => void;
  onGiveItem: (gift: ItemGift) => void;
  onGiveHandout: (title: string, text: string) => void;
  onTakeBackHandout: (id: string) => void;
  onAddStatus: (status: string) => void;
  onRemoveStatus: (status: string) => void;
  onVision: (cells: number) => void;
  onOpenSheet: () => void;
  onClose: () => void;
}

/** The same 0..30 range the inspector offers, so the two surfaces cannot
 *  disagree about what a legal vision radius is. */
const VISION_MAX = 30;

function Vitals({ view }: { view: SynopsisView }) {
  if (view.hp == null || view.hpMax == null || view.hpMax <= 0) {
    return <div className="vtt2-syn-noverit">{view.tokenId ? "No HP track on this body" : "Not on this scene"}</div>;
  }
  const remaining = Math.max(0, Math.min(1, view.hp / view.hpMax));
  const band = woundBand(remaining);
  const taken = Math.max(0, view.hpMax - view.hp);
  return (
    <div className="vtt2-syn-vitals">
      <div className={"vtt2-hud-bar" + (band ? " " + band : "")}>
        <i style={{ width: `${Math.round(remaining * 100)}%` }} />
      </div>
      <span className="vtt2-syn-hp">
        {view.hp} / {view.hpMax}
      </span>
      {taken > 0 && <span className="vtt2-hud-dmg">−{taken}</span>}
    </div>
  );
}

export function VttSynopsis({
  view,
  onGiveMoney,
  onGiveItem,
  onGiveHandout,
  onTakeBackHandout,
  onAddStatus,
  onRemoveStatus,
  onVision,
  onOpenSheet,
  onClose,
}: Props) {
  const [tab, setTab] = useState<GiveTab>("info");
  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemQty, setItemQty] = useState("1");
  const [itemWeight, setItemWeight] = useState<WeightKey>("standard");
  // Vision is committed on blur or Enter, not per keystroke: bound straight to
  // the token, typing "12" would write 1 and then 12 — two adjudications, two
  // toasts and two undo entries for one decision.
  const [visionDraft, setVisionDraft] = useState(view.vision == null ? "" : String(view.vision));
  useEffect(() => {
    setVisionDraft(view.vision == null ? "" : String(view.vision));
  }, [view.vision, view.tokenId]);
  const [amount, setAmount] = useState("");
  const hasBody = !!view.tokenId;
  // Money is the one gift that cannot wait for them: it is applied by the
  // player's own device, so with no peer there is nothing to send the grant to.
  const canPay = !!view.peerId;

  function addStatus() {
    const s = status.trim();
    if (!s) return;
    onAddStatus(s);
    setStatus("");
  }

  function commitVision() {
    const raw = parseInt(visionDraft, 10);
    if (Number.isNaN(raw)) {
      setVisionDraft(view.vision == null ? "" : String(view.vision));
      return;
    }
    const next = Math.max(0, Math.min(VISION_MAX, raw));
    if (next === view.vision) return;
    onVision(next);
  }

  function give() {
    if (tab === "info") {
      if (!title.trim() && !text.trim()) return;
      onGiveHandout(title, text);
      setTitle("");
      setText("");
      return;
    }
    if (tab === "item") {
      if (!itemName.trim()) return;
      onGiveItem({ name: itemName, qty: parseInt(itemQty, 10) || 1, weight: itemWeight });
      setItemName("");
      setItemQty("1");
      return;
    }
    const gift = planMoneyGift(view, amount);
    onGiveMoney(gift);
    // The field is cleared only on a gift that actually left, so a Curator whose
    // amount was refused still has it in front of them to correct.
    if (gift.ok) setAmount("");
  }

  return (
    <div className="vtt2-sheet-overlay" onMouseDown={onClose}>
      <div className="vtt2-synopsis" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vtt2-insp-head">
          <div className="vtt2-syn-who">
            <span className="panel-title" style={{ margin: 0 }}>{view.name}</span>
            <span className="vtt2-syn-sub">
              {view.ownerName}
              {view.identity.length > 0 && " · " + view.identity.join(" · ")}
            </span>
          </div>
          <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
        </div>

        <Vitals view={view} />

        <div className="vtt2-syn-row">
          <span className="vtt2-syn-label">Conditions</span>
          <div className="vtt2-syn-tags">
            {view.statuses.length === 0 && <em className="vtt2-syn-none">none</em>}
            {view.statuses.map((s) => (
              <button
                key={s}
                className="vtt2-syn-tag"
                title={`Remove ${s}`}
                disabled={!hasBody}
                onClick={() => onRemoveStatus(s)}
              >
                {s} <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        </div>
        <div className="vtt2-syn-inline">
          <input
            className="bg-select full"
            placeholder={hasBody ? "Apply a condition…" : "Needs a body on this scene"}
            value={status}
            disabled={!hasBody}
            onChange={(e) => setStatus(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addStatus()}
          />
          <button className="ghost-btn" disabled={!hasBody || !status.trim()} onClick={addStatus}>
            Apply
          </button>
        </div>

        <div className="vtt2-syn-inline">
          <span className="vtt2-syn-label">Vision</span>
          <input
            className="bg-select vtt2-syn-vision"
            type="number"
            min={0}
            max={VISION_MAX}
            disabled={!hasBody}
            value={visionDraft}
            placeholder="—"
            aria-label="Vision radius in cells"
            onChange={(e) => setVisionDraft(e.target.value)}
            onBlur={commitVision}
            onKeyDown={(e) => e.key === "Enter" && commitVision()}
          />
          <span className="vtt2-syn-none">cells</span>
        </div>

        <div className="vtt2-syn-row">
          <span className="vtt2-syn-label">Carrying</span>
          <div className="vtt2-syn-tags">
            {view.carrying.length === 0 && <em className="vtt2-syn-none">nothing</em>}
            {view.carrying.map((line, i) => (
              <span key={line.from + ":" + line.name + ":" + i} className={"vtt2-syn-carry " + line.from}>
                {line.name}
                {line.qty != null && line.qty > 1 && <em>×{line.qty}</em>}
              </span>
            ))}
          </div>
        </div>

        <div className="vtt2-syn-row">
          <span className="vtt2-syn-label">Purse</span>
          <div className="vtt2-syn-tags">
            {/* Null is not zero. The purse is on the player's device, so a table
                that has never heard from them knows nothing about their money and
                must not print "0 Sh" as though it did. */}
            {view.purseShrives == null ? (
              <em className="vtt2-syn-none">not announced from their device</em>
            ) : (
              <span className="vtt2-syn-coin">
                <b>{formatMoney(view.purseShrives)}</b>
              </span>
            )}
          </div>
        </div>

        {view.handouts.length > 0 && (
          <div className="vtt2-syn-row">
            <span className="vtt2-syn-label">Given</span>
            <div className="vtt2-syn-tags">
              {view.handouts.map((h) => (
                <button
                  key={h.id}
                  className="vtt2-syn-tag"
                  title={`Take back “${h.title}”`}
                  onClick={() => onTakeBackHandout(h.id)}
                >
                  {h.title} <span aria-hidden>×</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="vtt2-syn-give">
          <div className="chip-row" style={{ margin: "0 0 8px" }}>
            <button className={"chip" + (tab === "info" ? " active" : "")} onClick={() => setTab("info")}>Information</button>
            <button className={"chip" + (tab === "item" ? " active" : "")} onClick={() => setTab("item")}>Item</button>
            <button className={"chip" + (tab === "money" ? " active" : "")} onClick={() => setTab("money")}>Money</button>
          </div>

          {tab === "info" && (
            <>
              <input
                className="bg-select full"
                placeholder="What is it — “Torn ledger page”"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className="bg-select full vtt2-syn-text"
                placeholder="What it says. Markdown works; it lands in their Notes."
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </>
          )}

          {tab === "item" && (
            <>
            <div className="vtt2-syn-inline">
              <input
                className="bg-select full"
                placeholder="Item name"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && give()}
              />
              <input
                className="bg-select vtt2-syn-qty"
                type="number"
                min={1}
                aria-label="How many"
                value={itemQty}
                onChange={(e) => setItemQty(e.target.value)}
              />
              <select
                className="bg-select"
                aria-label="Weight class"
                value={itemWeight}
                onChange={(e) => setItemWeight(e.target.value as WeightKey)}
              >
                {WEIGHT_CATS.map((w) => (
                  <option key={w.key} value={w.key}>{w.label}</option>
                ))}
              </select>
            </div>
            {/* Said out loud because the player has TWO lists and this reaches
                only one of them: the sheet's inventory, unequipped. Their
                Table-tab carried items are on their own device with no wire to
                write them (see the note on giveItemPatch). */}
            <div className="vtt2-syn-none">Lands unequipped in their sheet's inventory.</div>
            </>
          )}

          {tab === "money" && (
            <>
              <div className="vtt2-syn-inline">
                {/* One free-text field, not a number box: `parseMoneyDelta` reads
                    "2 Credits", "2cr 500sh" and a bare Shrive count alike, and a
                    type="number" input would refuse every one of them. */}
                <input
                  className="bg-select full"
                  placeholder={canPay ? "2 Credits · 500 Sh · −1 Cr" : "Nobody is holding this purse"}
                  aria-label="How much to give (a leading minus takes it back)"
                  disabled={!canPay}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && give()}
                />
              </div>
              <div className="vtt2-syn-none">
                {canPay
                  ? "Palladium, Credits and Shrives. A leading minus takes it back."
                  : offlineMoneyReason(view)}
              </div>
            </>
          )}

          <div className="vtt2-syn-actions">
            <button className="ghost-btn" onClick={onOpenSheet}>Open full sheet</button>
            <button className="primary-btn" disabled={tab === "money" && !canPay} onClick={give}>
              {tab === "info" ? "Hand it over" : tab === "item" ? "Give item" : "Give money"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
