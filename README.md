# W.T.E — Desktop App

The Character Sheet and the VTT, unified into a single installable desktop app (Tauri 2) with built-in auto-update. No more "opens a new VTT every time" — the Sheet and VTT are tabs in one window and both stay loaded, so switching is instant and nothing reloads.

```
WTE-App/
  src/                 ← the app UI (plain HTML, no build step)
    index.html         ← shell: tab bar + both views in iframes + updater UI
    sheet.html         ← your character sheet (cross-link rewired to switch tabs)
    vtt.html           ← your VTT (cross-link rewired to switch tabs)
  src-tauri/           ← the native shell (Rust / Tauri)
    tauri.conf.json    ← app name, window, updater endpoint + public key
    capabilities/      ← which APIs the window may call
    .tauri/            ← updater signing key (GITIGNORED — never commit)
  .github/workflows/release.yml  ← CI that builds signed installers + latest.json
```

## Run it during development

```powershell
cd WTE-App
npm install
npm run dev        # opens the app in a live window
```

## Build an installer locally

```powershell
cd WTE-App
npm install
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content src-tauri\.tauri\wte_updater.key -Raw)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content src-tauri\.tauri\PASSPHRASE.txt -Raw).Trim()
npm run build
```

Installers land in `src-tauri/target/release/bundle/` (`.msi` and `.exe` on Windows).

## Updating the two source files

When you change the standalone files in `Downloads`, copy them back in (the only edits are the two cross-link buttons, which the app overrides at runtime anyway):

```powershell
Copy-Item $env:USERPROFILE\Downloads\WTE_CharSheet_Inquisitor.html .\src\sheet.html
Copy-Item $env:USERPROFILE\Downloads\WTE_VTT.html                  .\src\vtt.html
```
(Then re-add the two `wteTab(...)` buttons, or just leave the original links — the shell intercepts navigation either way.)

## Auto-update — how it works & what you must do once

The app checks `plugins.updater.endpoints` in `tauri.conf.json` on launch. That points at:

```
https://github.com/ZetaMurdock/WTE-App/releases/latest/download/latest.json
```

To make releases flow automatically:

1. **Create the GitHub repo** and push this folder (the `.gitignore` already keeps your private key out).
   If your repo path isn't `ZetaMurdock/WTE-App`, edit the endpoint URL in `tauri.conf.json`.
2. **Add two repo secrets** (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` = the full contents of `src-tauri/.tauri/wte_updater.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the passphrase in `src-tauri/.tauri/PASSPHRASE.txt`
3. **Cut a release**: bump `version` in `tauri.conf.json` (and `package.json`), then:
   ```powershell
   git tag v0.1.0
   git push origin v0.1.0
   ```
   The `Release` workflow builds Windows/macOS/Linux installers, signs them, and publishes
   `latest.json` to the release. Every installed app then sees the update on next launch and
   offers "Restart & update" in the title bar.

> The public key is baked into `tauri.conf.json`; the matching **private key is secret**. If you
> lose the key or passphrase you can't sign updates anymore — back up `src-tauri/.tauri/` somewhere safe.

## Rebrand the icon (optional)

Placeholder icons were copied from `mimyne-os`. Replace with your own:

```powershell
cd WTE-App
npx @tauri-apps/cli@2 icon path\to\your-logo-1024.png
```
