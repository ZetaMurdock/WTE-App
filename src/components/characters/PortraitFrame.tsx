import { useRef } from "react";
import { fileToPngDataUrl } from "../../lib/image";

interface Props {
  src?: string;
  /** Provide to make the frame editable (upload / clear). Omit for a read-only view. */
  onChange?: (dataUrl: string | null) => void;
  /** Extra size class, e.g. "sm" for vault thumbnails. */
  size?: "sm" | "md" | "lg";
}

// A character portrait in a notched, cyber-sigil frame. Uploaded PNGs are stored
// on the sheet as data URLs (portable + P2P-friendly). Editable when onChange is set.
export function PortraitFrame({ src, onChange, size = "md" }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const editable = !!onChange;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const url = await fileToPngDataUrl(f, 1024).catch(() => null);
    if (url && onChange) onChange(url);
  }

  return (
    <div className={"portrait-frame portrait-" + size}>
      <div className="portrait-body">
        {src ? <img className="portrait-img" src={src} alt="portrait" /> : <span className="portrait-glyph">⛧</span>}
        {editable && (
          <div className="portrait-tools">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
            <button className="portrait-btn" onClick={() => fileRef.current?.click()} title="Upload a portrait (PNG)">
              {src ? "Change" : "Upload"}
            </button>
            {src && (
              <button className="portrait-btn" onClick={() => onChange?.(null)} title="Remove portrait">
                ✕
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
