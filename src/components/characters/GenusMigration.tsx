import { useMemo, useState } from "react";
import { planGenusMigrationSafely } from "../../game/codexService";
import { useCodex } from "../../game/useCodex";
import { codexCtx } from "../../game/resolvedGenus";
import type { FocusSpend } from "../../game/synapticFocus";

interface Props {
  spend: FocusSpend;
  campaignId?: string | null;
  characterId?: string | null;
  onApply: (next: Record<string, number>) => void;
  role?: "player" | "curator";
}

// Moving a character's Genus references onto permanent ids.
//
// This is DELIBERATE, and it is the only thing in the app that rewrites a
// character's ability keys. Opening a sheet does not do it, autosave does not do
// it, and rendering a row certainly does not: a character must be able to sit
// unmigrated indefinitely and work perfectly, because the alternative is the app
// quietly rewriting people's characters while they read them.
//
// Everything it will not do is shown as prominently as everything it will. A
// conflict — two entries meaning one ability — is left for a person, because
// merging them changes how much Focus the character has spent and there is no
// safe way to guess which was meant.
export function GenusMigration({ spend, campaignId, characterId, onApply, role }: Props) {
  const [confirming, setConfirming] = useState(false);
  // The plan depends on what the Codex currently says, which can change without
  // the status string changing at all.
  const { revision } = useCodex();

  const plan = useMemo(
    () => planGenusMigrationSafely(spend.genus, codexCtx(campaignId, characterId, role)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spend.genus, campaignId, characterId, revision]
  );

  const legacy = Object.keys(spend.genus ?? {}).filter(
    (k) => !plan.kept.some((x) => x.stored === k && x.reason === "already-an-id")
  );
  // Nothing stored by name and nothing contested: there is simply nothing to do.
  if (legacy.length === 0 && plan.conflicts.length === 0) return null;

  const blocked = !!plan.blocked;
  const unresolved = plan.kept.filter((k) => k.reason === "unresolved");
  const ambiguous = plan.kept.filter((k) => k.reason === "ambiguous");
  const unsound = plan.kept.filter((k) => k.reason === "unsound-id");

  return (
    <div className="diag" style={{ marginTop: 16 }}>
      <div className="panel-title">Ability references</div>

      {blocked ? (
        <p className="diag-hint">
          {plan.kept.length} of this character's abilities are still stored by name. They work exactly as they are — but
          they cannot be updated right now, because the Codex has not finished loading or has reported a problem. Nothing
          has been changed.
        </p>
      ) : (
        <p className="diag-hint">
          {plan.migrated.length > 0
            ? `${plan.migrated.length} ability reference${plan.migrated.length === 1 ? "" : "s"} can be pinned to a permanent id, so renaming the ability in the Codex will not break this character.`
            : "Nothing here can be pinned automatically."}{" "}
          This changes how the abilities are stored, never which abilities the character has.
        </p>
      )}

      {plan.migrated.length > 0 && !blocked && (
        <ul className="diag-list">
          {plan.migrated.map((m) => (
            <li key={m.from}>
              <b>{m.from}</b> <span className="diag-dim">becomes</span> <code>{m.to}</code>
            </li>
          ))}
        </ul>
      )}

      {plan.conflicts.length > 0 && (
        <>
          <div className="panel-title mt">Needs a decision ({plan.conflicts.length})</div>
          <p className="diag-hint">
            These entries mean the same ability. Combining them would change how much Synaptic Focus this character has
            spent, so nothing is combined — remove whichever is wrong, and the rest can then be pinned.
          </p>
          <ul className="diag-list">
            {plan.conflicts.map((c) => (
              <li key={c.target}>
                {c.entries.map((e) => `${e.stored} (${e.focus} Focus)`).join(" · ")}
                <div className="codex-card-id">{c.target}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      {(unresolved.length > 0 || ambiguous.length > 0 || unsound.length > 0) && (
        <>
          <div className="panel-title mt">Left alone</div>
          <ul className="diag-list">
            {unresolved.map((k) => (
              <li key={k.stored}>
                <b>{k.stored}</b> — the Codex here does not know this. Kept exactly as written.
              </li>
            ))}
            {ambiguous.map((k) => (
              <li key={k.stored}>
                <b>{k.stored}</b> — more than one ability answers to this name.
              </li>
            ))}
            {unsound.map((k) => (
              <li key={k.stored}>
                <b>{k.stored}</b> — the Codex entry it points at is not sound enough to reference permanently.
              </li>
            ))}
          </ul>
        </>
      )}

      {!blocked && plan.changed && (
        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
          {confirming ? (
            <>
              <button
                className="primary-btn"
                onClick={() => {
                  onApply(plan.next);
                  setConfirming(false);
                }}
              >
                Yes, update {plan.migrated.length}
              </button>
              <button className="ghost-btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="primary-btn" onClick={() => setConfirming(true)}>
              Update ability references
            </button>
          )}
        </div>
      )}
    </div>
  );
}
