# Releasing W.T.E (and publishing to itch.io)

The normal release loop, then the extra work that only matters once strangers
are downloading the app.

## 1. The release loop (unchanged)

```bash
npm run bump          # or: npm run bump 1.0.0
npm run typecheck && npm test && npm run build
git add -A && git commit -m "…"
git push
git tag v1.0.0 && git push origin v1.0.0
```

Pushing the tag triggers `.github/workflows/release.yml`: a `check` job
(typecheck + tests) gates a 3-OS build matrix, which publishes installers and
`latest.json` to a GitHub Release. The in-app auto-updater reads that
`latest.json`, so **updates keep working even for players who installed from
itch.io** — nothing extra to do there.

## 2. Code signing — the big download-friction item

The release already signs the *updater manifest* (minisign, via the
`TAURI_SIGNING_PRIVATE_KEY` secret). That is **not** OS code signing. Without
OS signing:

* **Windows** shows a SmartScreen "Windows protected your PC" wall. Users must
  click *More info → Run anyway*.
* **macOS** shows "cannot be opened because it is from an unidentified
  developer". Users must right-click → Open, or clear the quarantine flag.

Options, cheapest first:

1. **Ship unsigned and document it** (fine for a first release). Put the
   click-through steps on the itch page — see the blurb in §5.
2. **Windows**: an OV code-signing certificate (~$100–400/yr, e.g. Sectigo,
   DigiCert). EV certificates clear SmartScreen instantly but cost more and
   need a hardware token. Add the cert + password as repo secrets and set
   `bundle.windows.certificateThumbprint` in `tauri.conf.json`.
3. **macOS**: Apple Developer Program ($99/yr) → Developer ID Application
   certificate → notarize. Tauri reads `APPLE_CERTIFICATE`,
   `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
   from the environment during `tauri build`.

Distributing through the **itch.io app** (rather than a raw download) softens
both warnings, so encourage players to use it.

## 3. The shared Codex library — read this before a public launch

`DEFAULT_FB_CONFIG` in `src/lib/tauri.ts` ships **one Firebase project baked
into every copy** (`codexlib-b81bf`). Consequences to accept deliberately:

* **Everyone shares one library.** Any page published there is visible to every
  person who downloads the app. Writes are locked to accounts granted a role
  (Codex → Library… → Roles), so in practice it is *your* official content that
  players read — but it is **not** per-group.
* **Free (Spark) plan ceilings**: ~100 simultaneous connections, 1 GB stored,
  10 GB/month egress. A busy launch can exhaust the connection cap and everyone
  — including your own table — fails to reach the library at once.
* **It is your Google project.** Usage and any abuse land on your account.

Mitigations, in order of effort:

1. Keep the library **read-mostly**: you publish, players pull. (Current design.)
2. Watch usage in the Firebase console; upgrade to **Blaze** (pay-as-you-go,
   with a budget alert) before a big launch.
3. Groups who want their own private library can paste their own Firebase config
   in **Lobby → Shared library** — mention this on the itch page for power users.

## 4. Pre-flight checklist

- [ ] `npm run typecheck && npm test` clean; CI green on the tag.
- [ ] Installed the built installer and launched it once on a clean machine.
- [ ] First-run guide appears (delete the `wte-seen-intro` key to re-test).
- [ ] `LICENSE` and `THIRD-PARTY-NOTICES.md` are present in the repo and shipped
      alongside the download.
- [ ] Firebase: usage checked, roles claimed, rules published.
- [ ] Auto-update verified: install the previous version, launch, confirm it
      offers the new one.
- [ ] A real multiplayer session on two machines — netplay has the least
      automated coverage, so it needs human testing every release.

## 5. itch.io page copy (starter)

**Install note to paste on the page:**

> W.T.E is not code-signed yet, so Windows may show a SmartScreen warning and
> macOS may say it's from an unidentified developer. On Windows click
> **More info → Run anyway**; on macOS right-click the app → **Open**.
> Installing through the itch.io app avoids most of this.

**What to disclose (be upfront — it's good practice and itch asks):**

* The app stores your campaigns, characters and scenes **locally** on your
  computer.
* The shared Codex library is **public**: anything published there is readable
  by anyone using the app. Don't put private notes in it.
* Signing in with Google is optional and only used to grant publishing roles;
  it stores your email address in the library's role list.
* Multiplayer connects players **directly to each other** (peer-to-peer) through
  a signaling server you configure.
