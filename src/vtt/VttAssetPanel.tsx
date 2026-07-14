import { useRef, useState } from "react";
import type { AssetKind, VttAsset } from "./data/assetRepo";
import { fileToPngDataUrl } from "../lib/image";

interface Props {
  assets: VttAsset[];
  loading: boolean;
  hasSelectedToken: boolean;
  currentBg: string | undefined;
  onAdd: (kind: AssetKind, name: string, uri: string) => void;
  onDelete: (id: string) => void;
  onUseBackground: (uri: string | null) => void;
  onApplyToToken: (uri: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

// VTT v2 (slice 11): campaign-scoped asset library. Assets are image URIs
// (http(s):/data:/asset:) applied as scene backgrounds or token art.
export function VttAssetPanel({
  assets,
  loading,
  hasSelectedToken,
  currentBg,
  onAdd,
  onDelete,
  onUseBackground,
  onApplyToToken,
  onRefresh,
  onClose,
}: Props) {
  const [name, setName] = useState("");
  const [uri, setUri] = useState("");
  const [kind, setKind] = useState<AssetKind>("background");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function submit() {
    const u = uri.trim();
    if (!u) return;
    onAdd(kind, name.trim() || (kind === "token" ? "Token art" : "Map"), u);
    setName("");
    setUri("");
  }

  // Upload an image file: re-encode to PNG, add it to the library (using the
  // typed name / kind selector), then apply it immediately.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked later
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToPngDataUrl(file);
      const nm = name.trim() || file.name.replace(/\.[^.]+$/, "") || (kind === "token" ? "Token art" : "Map");
      onAdd(kind, nm, dataUrl);
      if (kind === "background") onUseBackground(dataUrl);
      else if (hasSelectedToken) onApplyToToken(dataUrl);
      setName("");
    } catch {
      /* unreadable image — ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vtt2-assets">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>
          Assets
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn sm" onClick={onRefresh} title="Reload assets">
            ⟳
          </button>
          <button className="cdx-tab-x" onClick={onClose} title="Close">
            ×
          </button>
        </div>
      </div>

      <div className="vtt2-asset-add">
        <div className="vtt2-asset-add-row">
          <select className="bg-select" value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
            <option value="background">Map</option>
            <option value="token">Token</option>
          </select>
          <input className="bg-select" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        <button className="vtt2-asset-upload" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Importing…" : `Upload ${kind === "token" ? "token art" : "background"} (PNG)`}
        </button>
        <div className="vtt2-asset-add-row">
          <input className="bg-select" style={{ flex: 1 }} placeholder="…or paste an image URL" value={uri} onChange={(e) => setUri(e.target.value)} />
          <button className="chip" onClick={submit} disabled={!uri.trim()}>
            Add
          </button>
        </div>
      </div>

      {currentBg && (
        <button className="vtt2-asset-clearbg" onClick={() => onUseBackground(null)}>
          Clear background
        </button>
      )}

      {loading ? (
        <p className="list-empty" style={{ margin: "6px 0" }}>
          Loading…
        </p>
      ) : assets.length === 0 ? (
        <p className="list-empty" style={{ margin: "6px 0" }}>
          No assets yet — add an image URL above.
        </p>
      ) : (
        <ul className="vtt2-asset-list">
          {assets.map((a) => (
            <li key={a.id} className={"vtt2-asset-row" + (a.uri === currentBg ? " current" : "")}>
              <img className="vtt2-asset-thumb" src={a.uri} alt="" loading="lazy" />
              <div className="vtt2-asset-main">
                <span className="vtt2-asset-name" title={a.name}>
                  {a.name}
                </span>
                <div className="vtt2-asset-actions">
                  {a.kind === "background" ? (
                    <button className="icon-btn sm" onClick={() => onUseBackground(a.uri)} title="Use as scene background">
                      Use BG
                    </button>
                  ) : (
                    <button
                      className="icon-btn sm"
                      onClick={() => onApplyToToken(a.uri)}
                      disabled={!hasSelectedToken}
                      title={hasSelectedToken ? "Apply to the selected token" : "Select a token first"}
                    >
                      To token
                    </button>
                  )}
                  <button className="icon-btn sm" onClick={() => onDelete(a.id)} title="Delete asset">
                    ✕
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
