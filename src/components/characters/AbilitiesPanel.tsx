import type { RuleLayer } from "../../game/ruleLayers";
import { Collapsible } from "../ui/Collapsible";
import { codexCtx, genusCatalogFor, genusFocusFor, genusKeyFor } from "../../game/resolvedGenus";
import { grantLabel } from "../../game/inceptGrants";
import {
  ciphersForParadigm,
  CIPHER_TIERS,
  cipherSlots,
  getParadigm,
  resolveCipherRef,
  type CipherAbility,
  inceptPool,
  getIncept,
  wrydeTier,
  wrydeTierFor,
} from "../../game/wte";
import {
  FOCUS_PER_RANK,
  GENUS_FOCUS_MAX,
  costOfIncept,
  focusBudgetWith,
  focusSpent,
  lowerGenus,
  raiseGenus,
  relockIncept,
  unlockIncept,
  type FocusSpend,
} from "../../game/synapticFocus";

interface Props {
  paradigmId?: string;
  speciesId?: string;
  /** The 2-of-4 innates chosen active; the rest seed the Incept pool. */
  innateChoice?: string[];
  rank: number;
  spend: FocusSpend;
  /** Open the contextual Codex card for a stored reference. Optional so the
   *  panel still renders anywhere the card is not mounted. */
  onLookUp?: (storedRef: string) => void;
  campaignId?: string | null;
  characterId?: string | null;
  /** Numeric rule layers, so the cost shown here is the cost play charges. */
  layers?: RuleLayer[];
  /** Who is looking. Stated, so the picker cannot offer a player something the
   *  resolver would hide from them. */
  role?: "player" | "curator";
  cipherLoadout: string[];
  /** Bonus Focus banked from Hyomen's Talent Holder rank-ups. */
  bonusFocus?: number;
  onSpend: (next: FocusSpend) => void;
  onCiphers: (names: string[]) => void;
}

// Synaptic Focus investment — Genus and Incepts draw on ONE pool (3 points per
// rank). Focus IS access: a genus you have not invested in, you do not know, so
// this replaced the old flat genus-slot picker. Ciphers still run on rank slots.
export function AbilitiesBody({
  paradigmId,
  speciesId,
  innateChoice,
  rank,
  spend,
  cipherLoadout,
  bonusFocus = 0,
  onSpend,
  onCiphers,
  onLookUp,
  campaignId,
  characterId,
  layers,
  role,
}: Props) {
  const paradigm = getParadigm(paradigmId);
  // From the RESOLVER, not the legacy overlay: campaign ownership, visibility and
  // stable identity are all honoured because every entry came through the same
  // resolution the sheet and the VTT use.
  const genusGroups = genusCatalogFor(paradigmId, codexCtx(campaignId, characterId, role), layers);
  const ciphers = ciphersForParadigm(paradigmId);
  const cCap = cipherSlots(rank);

  const budget = focusBudgetWith(rank, bonusFocus);
  const used = focusSpent(spend, speciesId);
  const left = budget - used;
  const wryde = wrydeTierFor(speciesId, spend.incepts);

  // Keyed by the cipher each stored entry RESOLVES to, not by the literal string:
  // a loadout holding a permanent id or a former name would otherwise tick
  // nothing, and the untick would append a second entry for the same cipher.
  const chosen = new Map<string, string>();
  for (const raw of cipherLoadout) {
    const hit = resolveCipherRef(ciphers, raw);
    if (hit) chosen.set(hit.name, raw);
  }

  function toggleCipher(c: CipherAbility) {
    const held = chosen.get(c.name);
    if (held !== undefined) onCiphers(cipherLoadout.filter((n) => n !== held));
    else if (cipherLoadout.length < cCap) onCiphers([...cipherLoadout, c.name]);
  }

  if (!paradigm) {
    return <p className="list-empty">Choose a paradigm first to access Genus &amp; Ciphers.</p>;
  }

  const byTier = CIPHER_TIERS.map((t) => ({ tier: t as string, list: ciphers.filter((c) => c.tier === t) })).filter(
    (g) => g.list.length > 0
  );
  const pool = inceptPool(speciesId, innateChoice);

  return (
    <>
      {/* One pool, always visible — every decision below spends from it. */}
      <div className={"focus-bar" + (left < 0 ? " over" : "")}>
        <div className="focus-bar-main">
          <span className="focus-bar-label">Synaptic Focus</span>
          <span className="focus-bar-val">
            {left} <span className="focus-bar-of">of {budget} left</span>
          </span>
        </div>
        <div className="focus-bar-meta">
          {FOCUS_PER_RANK} per rank · rank {rank}
          {bonusFocus > 0 && ` · +${bonusFocus} banked`}
          {spend.incepts.length > 0 && ` · Wryde ${wryde.label}`}
        </div>
      </div>

      <div className="aside-title">Genus</div>
      {genusGroups.length === 0 ? (
        <p className="list-empty">No genus available for this paradigm.</p>
      ) : (
        genusGroups.map((g) => {
          // Counted through the resolver: a sheet may hold these under a legacy
          // name or a stable id, and both mean the same ability is known.
          const invested = g.abilities.filter((a) => genusFocusFor(a, spend.genus) > 0).length;
          return (
            <Collapsible key={g.domain} defaultOpen title={`${g.domain} Genus${invested ? ` · ${invested} known` : ""}`}>
              <div className="ability-list">
                {g.abilities.map((a) => {
                  const f = genusFocusFor(a, spend.genus);
                  // New investments are keyed by stable id; one this sheet
                  // already holds under its old name keeps that key, so a
                  // concept never ends up occupying two entries.
                  const key = genusKeyFor(a, spend.genus);
                  const canRaise = f < GENUS_FOCUS_MAX && left >= 1;
                  return (
                    <div key={a.id ?? a.name} className={"focus-row" + (f > 0 ? " known" : "")}>
                      <button
                        type="button"
                        className="focus-row-name codex-term"
                        title={"What does " + a.name + " mean here?"}
                        onClick={() => onLookUp?.(key)}
                      >
                        {a.name}
                      </button>
                      <span className="ss-badge">{a.ss == null ? "—" : a.ss} SS</span>
                      <span className="focus-pips" title={f ? `Synaptic Focus ${f}` : "Not known — invest to learn"}>
                        {Array.from({ length: GENUS_FOCUS_MAX }, (_, i) => (
                          <span key={i} className={"focus-pip" + (i < f ? " on" : "")} aria-hidden />
                        ))}
                      </span>
                      <span className="focus-btns">
                        <button
                          className="icon-btn xs"
                          disabled={f <= 0}
                          title={f === 1 ? "Forget this genus" : "Lower Focus"}
                          onClick={() => onSpend(lowerGenus(spend, key))}
                        >
                          −
                        </button>
                        <button
                          className="icon-btn xs"
                          disabled={!canRaise}
                          title={f >= GENUS_FOCUS_MAX ? "At maximum Focus" : left < 1 ? "No Focus left" : "Raise Focus"}
                          onClick={() => onSpend(raiseGenus(spend, key, rank, speciesId, bonusFocus))}
                        >
                          +
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </Collapsible>
          );
        })
      )}

      <div className="aside-title mt">
        Incepts{" "}
        {spend.incepts.length > 0 && <span className="load-badge">{spend.incepts.length} unlocked</span>}
      </div>
      {pool.length === 0 ? (
        <p className="list-empty">Choose a species to reveal its Incept pool.</p>
      ) : (
        <Collapsible defaultOpen title={`Incept Pool · ${pool.length}`}>
          <div className="ability-list">
            {pool.map((name) => {
              const inc = getIncept(speciesId, name);
              const cost = costOfIncept(name, speciesId);
              const on = spend.incepts.includes(name);
              const affordable = left >= cost;
              const tier = wrydeTier(inc?.weight);
              return (
                <div key={name} className={"focus-row incept" + (on ? " known" : "")}>
                  <span className="focus-row-name">{name}</span>
                  {inc && (
                    <span className={"wryde-badge t" + tier.tier} title={`${inc.weight} — Wryde ${tier.label}: ${tier.note}`}>
                      {inc.weight}
                    </span>
                  )}
                  <span className="ss-badge">{cost} SF</span>
                  <button
                    className={"icon-btn xs" + (on ? " on" : "")}
                    disabled={!on && !affordable}
                    title={on ? "Give this Incept back" : affordable ? `Unlock for ${cost} Focus` : `Needs ${cost} Focus — ${left} left`}
                    onClick={() => onSpend(on ? relockIncept(spend, name) : unlockIncept(spend, name, rank, speciesId, bonusFocus))}
                  >
                    {on ? "✓" : "+"}
                  </button>
                  {/* What the Incept actually DOES, in the same Roll Axis words
                      the rest of the sheet uses. An Incept with no grants is
                      narrative — it reads, it just has nothing to roll. */}
                  {inc?.grants?.length ? (
                    <div className="incept-grants">
                      {inc.grants.map((grant, i) => (
                        <span className={"grant-chip " + grant.kind} key={i}>
                          {grantLabel(grant)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Collapsible>
      )}

      <div className="aside-title mt">
        Ciphers{" "}
        <span className={"load-badge" + (cipherLoadout.length > cCap ? " over" : "")}>
          {cipherLoadout.length} / {cCap}
        </span>
      </div>
      {byTier.length === 0 ? (
        <p className="list-empty">No ciphers available for this paradigm.</p>
      ) : (
        byTier.map((g) => (
          <Collapsible
            key={g.tier}
            defaultOpen={g.tier === "offline"}
            title={`${g.tier[0].toUpperCase()}${g.tier.slice(1)} · ${g.list.length}`}
          >
            <div className="ability-list">
              {g.list.map((c) => {
                const selected = chosen.has(c.name);
                return (
                  <button
                    key={c.name}
                    className={"ability-row" + (selected ? " selected" : "")}
                    disabled={!selected && cipherLoadout.length >= cCap}
                    onClick={() => toggleCipher(c)}
                  >
                    <span className="ability-check">{selected ? "✓" : "+"}</span>
                    <span className="ability-name">{c.name}</span>
                    <span className="ss-badge">{c.ss == null ? "—" : c.ss} SS</span>
                  </button>
                );
              })}
            </div>
          </Collapsible>
        ))
      )}
    </>
  );
}
