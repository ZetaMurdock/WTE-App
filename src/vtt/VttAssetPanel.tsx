import { useState } from "react";
import type { AssetKind, VttAsset } from "./data/assetRepo";

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

  function submit() {
    const u = uri.trim();
    if (!u) return;
    onAdd(kind, name.trim() || (kind === "token" ? "Token art" : "Map"), u);
    setName("");
    setUri("");
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
        <input className="bg-select full" placeholder="Image URL (http/data:)" value={uri} onChange={(e) => setUri(e.target.value)} />
        <div className="vtt2-asset-add-row">
          <input className="bg-select" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="bg-select" value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
            <option value="background">Map</option>
            <option value="token">Token</option>
          </select>
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
