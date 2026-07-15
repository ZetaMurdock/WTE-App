import { useEffect, useRef, useState } from "react";
import { myPeerName, setPeerName } from "../net/discovery";

interface Props {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  showLegacy: boolean;
  onToggleLegacy: () => void;
  wallpaper: string | null;
  onWallpaper: (uri: string | null) => void;
  accountLabel: string;
  onAccount: () => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

// Top-right profile menu: consolidates identity + app settings (name, theme,
// wallpaper, account, and the Legacy-tools toggle) so the top nav stays clean.
export function ProfileMenu({ theme, onToggleTheme, showLegacy, onToggleLegacy, wallpaper, onWallpaper, accountLabel, onAccount }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(myPeerName());
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function commitName(v: string) {
    setName(v);
    setPeerName(v.trim() || "Player");
  }
  async function onWallpaperFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    onWallpaper(await fileToDataUrl(f).catch(() => null));
  }

  const initial = (name.trim()[0] || "?").toUpperCase();

  return (
    <div className="profile-wrap" ref={wrapRef}>
      <button className={"profile-btn" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)} title="Profile & settings">
        <span className="profile-avatar">{initial}</span>
      </button>
      {open && (
        <div className="profile-menu">
          <div className="profile-head">
            <span className="profile-avatar lg">{initial}</span>
            <input className="profile-name" value={name} onChange={(e) => commitName(e.target.value)} placeholder="Your name" />
          </div>

          <div className="profile-sec">
            <span className="profile-sec-label">Account</span>
            <button className="profile-row" onClick={onAccount}>
              <span>{accountLabel === "Sign in" ? "Sign in with Google" : accountLabel}</span>
              <span className="profile-row-hint">{accountLabel === "Sign in" ? "" : "signed in"}</span>
            </button>
          </div>

          <div className="profile-sec">
            <span className="profile-sec-label">Appearance</span>
            <button className="profile-row" onClick={onToggleTheme}>
              <span>Theme</span>
              <span className="profile-row-hint">{theme === "light" ? "Light" : "Dark"}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onWallpaperFile(e)} />
            <button className="profile-row" onClick={() => fileRef.current?.click()}>
              <span>Wallpaper</span>
              <span className="profile-row-hint">{wallpaper ? "set" : "none"}</span>
            </button>
            {wallpaper && (
              <button className="profile-row sub" onClick={() => onWallpaper(null)}>
                <span>Clear wallpaper</span>
              </button>
            )}
          </div>

          <div className="profile-sec">
            <span className="profile-sec-label">Tools</span>
            <button className={"profile-row toggle" + (showLegacy ? " on" : "")} onClick={onToggleLegacy}>
              <span>Legacy tools</span>
              <span className="profile-switch" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
