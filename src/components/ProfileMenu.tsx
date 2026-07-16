import { useEffect, useRef, useState } from "react";
import { myPeerName, setPeerName } from "../net/discovery";

interface Props {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  wallpaper: string | null;
  onWallpaper: (uri: string | null) => void;
  dotCursor: boolean;
  onToggleDotCursor: () => void;
  accountLabel: string;
  onAccount: () => void;
  curator: boolean;
  onToggleCurator: () => void;
  engineer: boolean;
  onToggleEngineer: () => void;
  /** Hide the role toggles (netplay players don't get GM/Engineer modes). */
  rolesHidden: boolean;
  /** Open a retired legacy iframe tool (old sheets/VTT/Codex) — kept for data transfer. */
  onOpenLegacy: (tab: "sheet" | "vtt" | "wiki") => void;
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
// picture, wallpaper, roles, account) so the top nav stays clean.
export function ProfileMenu({
  theme,
  onToggleTheme,
  wallpaper,
  onWallpaper,
  dotCursor,
  onToggleDotCursor,
  accountLabel,
  onAccount,
  curator,
  onToggleCurator,
  engineer,
  onToggleEngineer,
  rolesHidden,
  onOpenLegacy,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(myPeerName());
  const [pic, setPic] = useState<string | null>(() => {
    try {
      return localStorage.getItem("wte-profile-pic");
    } catch {
      return null;
    }
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const picRef = useRef<HTMLInputElement>(null);

  function changePic(uri: string | null) {
    setPic(uri);
    try {
      if (uri) localStorage.setItem("wte-profile-pic", uri);
      else localStorage.removeItem("wte-profile-pic");
    } catch {
      /* image too large for storage — keep it for this session only */
    }
  }
  /** Downscale to a small square so the avatar stores comfortably. */
  async function onPicFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const raw = await fileToDataUrl(f).catch(() => null);
    if (!raw) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const x = c.getContext("2d")!;
      const s = Math.min(img.width, img.height);
      x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
      changePic(c.toDataURL("image/jpeg", 0.85));
    };
    img.src = raw;
  }

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
  const avatar = (lg: boolean) =>
    pic ? (
      <span className={"profile-avatar" + (lg ? " lg" : "")}>
        <img src={pic} alt="" />
      </span>
    ) : (
      <span className={"profile-avatar" + (lg ? " lg" : "")}>{initial}</span>
    );

  return (
    <div className="profile-wrap" ref={wrapRef}>
      <button className={"profile-btn" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)} title="Profile & settings">
        {avatar(false)}
      </button>
      {open && (
        <div className="profile-menu">
          <div className="profile-head">
            <input ref={picRef} type="file" accept="image/*" hidden onChange={(e) => void onPicFile(e)} />
            <button className="profile-avatar-btn" onClick={() => picRef.current?.click()} title="Set a profile picture">
              {avatar(true)}
            </button>
            <input className="profile-name" value={name} onChange={(e) => commitName(e.target.value)} placeholder="Your name" />
          </div>
          {pic && (
            <button className="profile-row sub" onClick={() => changePic(null)}>
              <span>Remove picture</span>
            </button>
          )}

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
            <button className={"profile-row toggle" + (dotCursor ? " on" : "")} onClick={onToggleDotCursor}>
              <span>Dot cursor</span>
              <span className="profile-switch" aria-hidden />
            </button>
          </div>

          {!rolesHidden && (
            <div className="profile-sec">
              <span className="profile-sec-label">Roles</span>
              <button
                className={"profile-row toggle" + (curator ? " on" : "")}
                onClick={onToggleCurator}
                title="Curator (GM) mode — reveal GM-only Codex pages & controls"
              >
                <span>Curator</span>
                <span className="profile-switch" aria-hidden />
              </button>
              <button
                className={"profile-row toggle" + (engineer ? " on" : "")}
                onClick={onToggleEngineer}
                title="Engineer mode — manage which Codex pages are pulled and player-visible"
              >
                <span>Engineer</span>
                <span className="profile-switch" aria-hidden />
              </button>
            </div>
          )}

          <div className="profile-sec">
            <span className="profile-sec-label">Legacy tools</span>
            <button
              className="profile-row"
              onClick={() => { onOpenLegacy("sheet"); setOpen(false); }}
              title="Open the old character-sheet tool — use it to copy characters over to the new Sheet"
            >
              <span>Character sheets (legacy)</span>
              <span className="profile-row-hint">transfer</span>
            </button>
            <button className="profile-row" onClick={() => { onOpenLegacy("vtt"); setOpen(false); }} title="Open the old VTT">
              <span>VTT (legacy)</span>
            </button>
            <button className="profile-row" onClick={() => { onOpenLegacy("wiki"); setOpen(false); }} title="Open the old Codex/wiki">
              <span>Codex (legacy)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
