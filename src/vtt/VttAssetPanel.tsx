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
  /** Place a prop (PNG map decoration) on the scene at the view centre. */
  onPlaceProp: (name: string, uri: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

const KIND_LABEL: Record<string, string> = { background: "Map", token: "Token art", prop: "Prop" };

// VTT v2 (slice 11): campaign-scoped asset library. Assets are image URIs
// (http(s):/data:/asset:) applied as scene backgrounds, token art, or placed
// on the map as props (trees/crates/ruins — full PNGs, not circle-cropped).
export function VttAssetPanel({
  assets,
  loading,
  hasSelectedToken,
  currentBg,
  onAdd,
  onDelete,
  onUseBackground,
  onApplyToToken,
  onPlaceProp,
  onRefresh,
  onClose,
}: Props) {
  const [name, setName] = useState("");
  const [uri, setUri] = useState("");
  const [kind, setKind] = useState<AssetKind>("background");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function submit() {
    const u = uri.trim();
    if (!u) return;
    onAdd(kind, name.trim() || KIND_LABEL[kind] || "Map", u);
    setName("");
    setUri("");
  }

  // Upload a file: images re-encode to PNG, added to the library under the
  // selected kind, then applied immediately (props land on the map right away).
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked later
    if (!file) return;
    setBusy(true);
    setNote("");
    try {
      const dataUrl = await fileToPngDataUrl(file);
      const nm = name.trim() || file.name.replace(/\.[^.]+$/, "") || KIND_LABEL[kind] || "Map";
      onAdd(kind, nm, dataUrl);
      if (kind === "background") onUseBackground(dataUrl);
      else if (kind === "prop") onPlaceProp(nm, dataUrl);
      else if (kind === "token" && hasSelectedToken) onApplyToToken(dataUrl);
      setName("");
    } catch {
      setNote("Couldn't read that file — is it an image?");
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
            <option value="prop">Prop</option>
          </select>
          <input className="bg-select" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        <button className="vtt2-asset-upload" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Importing…" : `Upload ${kind === "token" ? "token art" : kind === "prop" ? "prop" : "background"} (PNG)`}
        </button>
        {note && <p className="vtt2-actor-hint">{note}</p>}
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
                  ) : a.kind === "prop" ? (
                    <button className="icon-btn sm" onClick={() => onPlaceProp(a.name, a.uri)} title="Place on the map at the view centre — drag, rotate, and resize it there">
                      Place
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
