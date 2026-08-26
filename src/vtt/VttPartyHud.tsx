import { useCallback, useEffect, useRef, useState } from "react";
import { woundBand, type PartyHud, type PartyHudMember } from "./data/partyHud";

/**
 * The party, at a glance, over the map.
 *
 * This is a HUD and not a panel, and the difference is the whole brief: it sits
 * in the strip of screen directly above the action bar, it never grows past two
 * short lines per member, and it answers four questions without being opened —
 * who is here, what is on them, how badly they are hurt, and how far away they
 * are. Anything that needs a click belongs in the inspector or the synopsis.
 *
 * It carousels rather than wraps, because a HUD that reflows onto a second row
 * when a fifth player joins has quietly become a panel and taken a strip of map
 * with it. Six cards fit; the rest are one arrow away.
 *
 * WHAT A PLAYER GETS HERE IS EXACTLY WHAT THEY HAD BEFORE, arranged better.
 * Every number on a card is already on that player's screen — token labels, HP
 * bars, and the ruler — and the only thing clicking a card does for a player is
 * move their own camera. No write, no selection, no reach into anyone else's
 * body. The synopsis callback is handed in by the Curator's branch only.
 */

interface Props {
  hud: PartyHud;
  /** Curator-only: open this character's synopsis. Absent for players, which is
   *  what keeps a player's click from reaching another player's sheet. */
  onOpenSynopsis?: (characterId: string) => void;
  /** Glide the camera onto a body. Harmless for both roles — it moves the
   *  viewer's own viewport and nothing on the table. */
  onFocusToken?: (tokenId: string) => void;
}

/** How much of the strip one arrow press travels. Less than a full width so a
 *  card is never jumped clean over — the eye needs an overlap to keep its
 *  place. */
const PAGE_FRACTION = 0.8;

function pips(statuses: readonly string[]) {
  if (statuses.length === 0) return null;
  const shown = Math.min(statuses.length, 4);
  return (
    <span className="vtt2-hud-pips" title={statuses.join(", ")}>
      {Array.from({ length: shown }, (_, i) => (
        <i key={i} className="vtt2-hud-pip" />
      ))}
      {statuses.length > shown && <em className="vtt2-hud-pipmore">+{statuses.length - shown}</em>}
    </span>
  );
}

/** What the card says out loud, since a bar and a row of dots say nothing to a
 *  screen reader. Built from the same values the pixels are. */
function describe(m: PartyHudMember): string {
  const parts = [m.name, m.ownerName === "you" ? "your character" : `played by ${m.ownerName}`];
  if (!m.onScene) parts.push("not on this scene");
  if (m.damage != null && m.hpMax != null) {
    parts.push(m.damage === 0 ? "unhurt" : `${m.damage} damage taken of ${m.hpMax}`);
  }
  if (m.statuses.length > 0) parts.push(m.statuses.join(", "));
  if (m.isAnchor) parts.push("measuring from here");
  else if (m.distanceFt != null) parts.push(`${m.distanceFt} feet away`);
  return parts.join(" — ");
}

function Card({ member, onOpenSynopsis, onFocusToken }: { member: PartyHudMember } & Omit<Props, "hud">) {
  const band = woundBand(member.remaining);
  const canSynopsis = !!onOpenSynopsis && !!member.charId;
  const canFocus = !!onFocusToken && !!member.tokenId && member.onScene;
  const inert = !canSynopsis && !canFocus;
  const className =
    "vtt2-hud-card" +
    (member.isAnchor ? " anchor" : "") +
    (member.isSelf ? " self" : "") +
    (member.onScene ? "" : " off") +
    (inert ? " inert" : "");

  const body = (
    <>
      <span className="vtt2-hud-top">
        <span className="vtt2-hud-name">{member.name}</span>
        <span className="vtt2-hud-dist">
          {member.isAnchor ? "⌖" : !member.onScene ? "—" : member.distanceFt != null ? `${member.distanceFt} ft` : "·"}
        </span>
      </span>
      <span className="vtt2-hud-bottom">
        {member.remaining != null ? (
          <span className={"vtt2-hud-bar " + band}>
            <i style={{ width: `${Math.round(member.remaining * 100)}%` }} />
          </span>
        ) : (
          <span className="vtt2-hud-noverit">{member.onScene ? "no vitals" : "off scene"}</span>
        )}
        {/* The pips ride the WOUND line, not the name line. On the name line a
            member carrying four conditions squeezed a 15-character name down to
            three, which is the one thing on the card that has to survive: you
            find the right card by its name. Down here they sit against the bar,
            which shrinks harmlessly. */}
        {pips(member.statuses)}
        {/* THE FIGURE IS DAMAGE TAKEN, not HP remaining — that is what was asked
            for, and it is the number a table acts on: it is the size of the hole
            a heal has to fill, and it does not need the maximum held in your head
            to mean something. The bar beside it carries the other reading, the
            fraction left, which is the one the eye is faster at. Zero damage
            prints nothing at all: a full bar already says "untouched", and a
            column of "0"s is the noise that makes a HUD stop being glanceable. */}
        {member.damage != null && member.damage > 0 && (
          <span className="vtt2-hud-dmg" title={`${member.hp} / ${member.hpMax}`}>
            −{member.damage}
          </span>
        )}
      </span>
    </>
  );

  if (inert) {
    return (
      <div className={className} title={describe(member)}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      title={describe(member)}
      aria-label={describe(member)}
      onClick={() => {
        if (canFocus) onFocusToken!(member.tokenId!);
        if (canSynopsis) onOpenSynopsis!(member.charId!);
      }}
    >
      {body}
    </button>
  );
}

export function VttPartyHud({ hud, onOpenSynopsis, onFocusToken }: Props) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    const el = stripRef.current;
    setOverflowing(!!el && el.scrollWidth - el.clientWidth > 1);
  }, []);

  // Re-measured on party size AND on the pane resizing, because the arrows are
  // wrong the moment either changes: a docked panel opening narrows this strip
  // without the member list moving at all.
  useEffect(() => {
    measure();
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, hud.members.length]);

  const page = (dir: -1 | 1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * PAGE_FRACTION, behavior: "smooth" });
  };

  if (hud.members.length === 0) return null;

  return (
    <div className="vtt2-hud" role="group" aria-label="Party">
      {/* The anchor, named. Three or more bodies have no natural "distance from
          each other", so the strip states its one origin instead of printing a
          column of numbers whose meaning the reader has to guess. */}
      <span className="vtt2-hud-anchor" title="Every distance below is measured from here. Select a token to measure from it.">
        <b>⌖</b>
        {hud.anchor ? `from ${hud.anchor.name}` : "select a token"}
      </span>
      {overflowing && (
        <button type="button" className="vtt2-hud-page" onClick={() => page(-1)} aria-label="Earlier party members">
          ‹
        </button>
      )}
      <div className="vtt2-hud-strip" ref={stripRef} onScroll={measure}>
        {hud.members.map((m) => (
          <Card key={m.key} member={m} onOpenSynopsis={onOpenSynopsis} onFocusToken={onFocusToken} />
        ))}
      </div>
      {overflowing && (
        <button type="button" className="vtt2-hud-page" onClick={() => page(1)} aria-label="Later party members">
          ›
        </button>
      )}
    </div>
  );
}
