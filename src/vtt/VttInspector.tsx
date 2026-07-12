import { TOKEN_COLORS, type VttToken } from "./types/scene";

interface Props {
  token: VttToken;
  onUpdate: (patch: Partial<VttToken>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function VttInspector({ token, onUpdate, onDelete, onClose }: Props) {
  return (
    <div className="vtt2-inspector">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>Token</span>
        <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
      </div>
      <label className="lobby-field">
        <span>Name</span>
        <input className="bg-select full" value={token.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      </label>
      <label className="lobby-field mt">
        <span>Size (cells)</span>
        <input
          className="bg-select full"
          type="number"
          min={1}
          max={6}
          value={token.size}
          onChange={(e) => onUpdate({ size: Math.max(1, Math.min(6, parseInt(e.target.value, 10) || 1)) })}
        />
      </label>
      <div className="lobby-field mt">
        <span>Color</span>
        <div className="seq-pick-row" style={{ marginBottom: 0 }}>
          {TOKEN_COLORS.map((c) => (
            <button key={c} className={"seq-swatch" + (token.color === c ? " on" : "")} style={{ background: c }} onClick={() => onUpdate({ color: c })} />
          ))}
        </div>
      </div>
      <div className="vtt2-hp-row">
        <label className="lobby-field">
          <span>HP</span>
          <input className="bg-select full" type="number" value={token.hp ?? 0} onChange={(e) => onUpdate({ hp: parseInt(e.target.value, 10) || 0 })} />
        </label>
        <label className="lobby-field">
          <span>Max</span>
          <input className="bg-select full" type="number" value={token.hpMax ?? 0} onChange={(e) => onUpdate({ hpMax: parseInt(e.target.value, 10) || 0 })} />
        </label>
      </div>
      <button className="icon-btn" style={{ marginTop: 12 }} onClick={onDelete}>
        Delete token
      </button>
    </div>
  );
}
