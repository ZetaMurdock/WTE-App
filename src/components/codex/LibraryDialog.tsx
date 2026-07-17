import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPublishedPages, importPublishedPage, type PublishedPage } from "../../lib/publishedPages";
import { getPulledMap, libStatus, type LibStatus } from "../../lib/pulledLib";
import {
  claimOwnership,
  currentEmail,
  emailKey,
  fetchGrants,
  grantRole,
  revokeRole,
  type LibraryRole,
  type RoleGrant,
} from "../../lib/codexRoles";

interface Props {
  onClose: () => void;
  /** Pages were imported — the Codex re-lists + the game data reloads. */
  onImported: (count: number) => void;
}

const STATUS_LABEL: Record<LibStatus, string> = { new: "new", updated: "updated", current: "up to date" };

// The shared library: pull PARTICULAR categories and pages (not all-or-nothing),
// see what changed since you last pulled, and manage who may publish (roles).
export function LibraryDialog({ onClose, onImported }: Props) {
  const [pages, setPages] = useState<PublishedPage[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // roles
  const [grants, setGrants] = useState<RoleGrant[] | null>(null);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantAs, setGrantAs] = useState<LibraryRole>("engineer");
  const me = currentEmail();
  const pulledMap = useMemo(() => getPulledMap(), []);

  const load = useCallback(async () => {
    try {
      const ps = await fetchPublishedPages();
      setPages(ps);
      // sensible default: everything you don't have yet, or that moved
      setSelected(new Set(ps.filter((p) => libStatus(p, pulledMap) !== "current").map((p) => p.stem)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPages([]);
    }
    fetchGrants().then(setGrants).catch(() => setGrants([]));
  }, [pulledMap]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, PublishedPage[]>();
    for (const p of pages ?? []) {
      const label = p.label || "Unlabeled";
      const arr = map.get(label);
      if (arr) arr.push(p);
      else map.set(label, [p]);
    }
    return [...map.entries()]
      .map(([label, list]) => ({ label, list: [...list].sort((a, b) => a.stem.localeCompare(b.stem)) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [pages]);

  function toggle(stem: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(stem) ? n.delete(stem) : n.add(stem);
      return n;
    });
  }
  function toggleGroup(list: PublishedPage[]) {
    setSelected((s) => {
      const n = new Set(s);
      const all = list.every((p) => n.has(p.stem));
      for (const p of list) (all ? n.delete(p.stem) : n.add(p.stem));
      return n;
    });
  }

  async function pullSelected() {
    if (!pages) return;
    setBusy(true);
    let ok = 0;
    for (const p of pages) {
      if (!selected.has(p.stem)) continue;
      try {
        await importPublishedPage(p);
        ok++;
      } catch {
        /* skip broken page */
      }
    }
    setBusy(false);
    setNote(`Pulled ${ok} page${ok === 1 ? "" : "s"} into your Codex.`);
    onImported(ok);
  }

  const myGrant = grants?.find((g) => me && emailKey(g.email) === emailKey(me));
  const isOwner = myGrant?.role === "owner";
  const unclaimed = grants !== null && grants.length === 0;

  async function doClaim() {
    try {
      await claimOwnership();
      setGrants(await fetchGrants());
      setNote("You are now the library owner — grant publish rights below.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }
  async function doGrant() {
    if (!grantEmail.trim()) return;
    try {
      await grantRole(grantEmail, grantAs, me ?? undefined);
      setGrants(await fetchGrants());
      setGrantEmail("");
    } catch (e) {
      setNote("Grant failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }
  async function doRevoke(email: string) {
    try {
      await revokeRole(email);
      setGrants(await fetchGrants());
    } catch (e) {
      setNote("Revoke failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <div className="page-editor-scrim" onClick={onClose}>
      <div className="page-editor cdx-library" onClick={(e) => e.stopPropagation()}>
        <div className="vtt2-insp-head">
          <span className="panel-title" style={{ margin: 0 }}>Shared library</span>
          <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
        </div>

        {error && <p className="cdx-upload-note">{error}</p>}
        {note && <p className="cdx-upload-note">{note}</p>}

        <div className="panel-title" style={{ marginTop: 8 }}>Pull pages</div>
        <p className="pe-hint" style={{ margin: "2px 0 8px" }}>
          Pick the categories and pages this install pulls — pulled pages feed character creation, sheets, and the VTT.
          Pages you already pulled auto-refresh at launch when the owner republishes them.
        </p>
        {pages === null ? (
          <p className="list-empty">Reading the shared library…</p>
        ) : pages.length === 0 ? (
          <p className="list-empty">Nothing published yet.</p>
        ) : (
          <div className="cdx-lib-groups">
            {groups.map((g) => (
              <div key={g.label} className="cdx-lib-group">
                <label className="cdx-lib-grouphead">
                  <input type="checkbox" checked={g.list.every((p) => selected.has(p.stem))} onChange={() => toggleGroup(g.list)} />
                  <b>{g.label}</b>
                  <span className="cdx-lib-count">{g.list.length}</span>
                </label>
                {g.list.map((p) => {
                  const st = libStatus(p, pulledMap);
                  return (
                    <label key={p.stem} className="cdx-lib-row">
                      <input type="checkbox" checked={selected.has(p.stem)} onChange={() => toggle(p.stem)} />
                      <span className="cdx-lib-name">{(p.title || p.stem).replace(/_/g, " ")}</span>
                      <span className={"cdx-lib-status " + st}>{STATUS_LABEL[st]}</span>
                      {p.by && <span className="cdx-lib-by">{p.by}</span>}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {pages && pages.length > 0 && (
          <div className="pe-actions" style={{ marginTop: 8 }}>
            <button className="ghost-btn" onClick={() => setSelected(new Set(pages.map((p) => p.stem)))}>Select all</button>
            <button className="ghost-btn" onClick={() => setSelected(new Set())}>None</button>
            <button className="primary-btn" disabled={busy || selected.size === 0} onClick={() => void pullSelected()}>
              {busy ? "Pulling…" : `Pull selected (${selected.size})`}
            </button>
          </div>
        )}

        <div className="panel-title" style={{ marginTop: 14 }}>Roles</div>
        <p className="pe-hint" style={{ margin: "2px 0 8px" }}>
          Who may publish to this library. {me ? `Signed in as ${me}.` : "Sign in with Google (Profile menu) to claim or receive a role."}
        </p>
        {grants === null ? (
          <p className="list-empty">Reading roles…</p>
        ) : unclaimed ? (
          <div>
            <p className="list-empty" style={{ marginBottom: 6 }}>
              Unclaimed — anyone with the Firebase config can publish. Claim ownership to start gating publish rights.
            </p>
            <button className="chip" onClick={() => void doClaim()} disabled={!me}>Claim ownership</button>
          </div>
        ) : (
          <div className="cdx-lib-groups">
            {grants.map((g) => (
              <div key={g.email} className="cdx-lib-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="cdx-lib-name">{g.email}</span>
                <span className={"cdx-lib-status " + (g.role === "owner" ? "updated" : "current")}>{g.role}</span>
                {isOwner && emailKey(g.email) !== emailKey(me ?? "") && (
                  <button className="cdx-flag" onClick={() => void doRevoke(g.email)} title="Remove this account's rights">
                    revoke
                  </button>
                )}
              </div>
            ))}
            {isOwner && (
              <div className="pe-label-row" style={{ marginTop: 6 }}>
                <input
                  className="bg-select full"
                  placeholder="account@gmail.com"
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                />
                <select className="bg-select" value={grantAs} onChange={(e) => setGrantAs(e.target.value as LibraryRole)}>
                  <option value="engineer">engineer</option>
                  <option value="owner">owner</option>
                </select>
                <button className="chip" onClick={() => void doGrant()} disabled={!grantEmail.trim()}>Grant</button>
              </div>
            )}
            {!isOwner && myGrant == null && <p className="pe-hint">You have no publish rights here — ask the owner to grant your account.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
