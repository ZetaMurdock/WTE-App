# Sharing & servers — free setup guide

Two separate things, both free:

1. **Shared library** — so pages you *publish* in the Codex appear for everyone (Firebase Realtime Database, free Spark plan).
2. **Netplay across the internet** — so people not on your Wi‑Fi can join a VTT room (signaling + optional TURN).

You do **not** need both. LAN play (same Wi‑Fi) already works with zero setup.

---

## 1 · Shared library (publish → everyone sees it)

Free, ~10 minutes, one time. One person (you, the Curator/Engineer) sets up the
project; **everyone else just pastes the same config** into their app.

1. Go to **console.firebase.google.com** → **Add project** (any name). Skip Google Analytics.
2. In the project, open **Build → Realtime Database → Create Database**.
   - Pick a location, start in **locked mode** (we set rules next).
3. Open the **Rules** tab and paste this, then **Publish**:
   ```json
   {
     "rules": {
       "published_pages": {
         ".read": true,
         ".write": "auth != null && (!root.child('role_grants').exists() || root.child('role_grants').child(auth.token.email.toLowerCase().replace('.', ',')).exists())"
       },
       "role_grants": {
         ".read": "auth != null",
         ".write": "auth != null && (!root.child('role_grants').exists() || root.child('role_grants').child(auth.token.email.toLowerCase().replace('.', ',')).child('role').val() === 'owner')"
       }
     }
   }
   ```
   (Anyone can read the shared pages. Writing is **role-gated**: while no roles
   are set, any signed-in app may publish; once someone claims ownership in the
   app, only granted accounts can publish and only the owner can change roles.)
4. Enable anonymous sign‑in: **Build → Authentication → Get started → Sign‑in method → Anonymous → Enable**.
   For the **role system**, players also enable **Google** sign-in there and sign
   in from the app (Profile menu) — roles are granted to Google account emails.
5. Get the config: **Project settings (gear) → General →** scroll to **Your apps →**
   click the **web** icon `</>`, register an app (nickname only), and copy the
   `firebaseConfig = { … }` block. It must include a **`databaseURL`**
   (`https://…firebasedatabase.app`). If it doesn't, you skipped step 2.
6. In W.T.E: **Lobby tab → Shared library →** paste the whole config → **Save**.
   Reopen the app. The header should read **Shared library · connected**.
7. **Everyone else** repeats only step 6 with the *same* config text.

**Using it:** as Engineer, open the Codex, and on a page click **pub** to publish it.
Anyone opens **Codex → Library…** to pull pages — by category or individually,
with NEW / UPDATED / UP-TO-DATE tags per page. Pages you pulled once
**auto-refresh at launch** when the owner republishes them. Published
Species/Paradigm/Background/Weapon/Creature/etc. pages flow into the character
creator, sheets, and VTT automatically (they import marked "pulled").

**Roles:** in **Codex → Library… → Roles**, the first signed-in person clicks
**Claim ownership**; after that the owner grants **engineer** (may publish) or
**owner** roles to Google account emails, and revokes them there too. Until
ownership is claimed the library is open (anyone with the config may publish).

> Free-tier limits (Spark): 1 GB stored, 10 GB/month download — plenty for text
> pages. Keep large images out of published pages.

---

## 2 · Netplay across the internet (optional)

Same‑Wi‑Fi play needs nothing (LAN discovery is built in). To play with people
elsewhere you need a **signaling server** (tiny WebSocket relay that helps two
apps find each other) and, for strict home networks, a **TURN server**.

**Signaling — free options:**
- **Render / Railway / Fly.io free tier**, or **Glitch** — host the small signaling
  service and use its `wss://…` URL. (A minimal `ws` relay is all that's needed;
  ask me and I'll generate one you can deploy.)
- Put the `wss://…` URL in **Lobby → Netplay settings → Signaling server**.

**STUN — already free:** the app defaults to Google's public STUN
(`stun:stun.l.google.com:19302`); no setup. This alone connects many players.

**TURN — only if some players can't connect** (strict/symmetric NAT):
- Free‑ish: **Metered.ca** has a free TURN tier — paste their `turns:` URL +
  credential into **TURN urls** / **TURN secret**.
- Or self‑host **coturn** on an always‑free VPS (**Oracle Cloud Free Tier**), set a
  `static-auth-secret`, and put the `turns:host:5349` URL + that secret in settings.

**Play:** one person **Hosts a room** (shares the room code), others **Join** with it.

---

### Where the app stores this
`localStorage`: `wte-fb-config` (shared library), `wte-signal-url`,
`wte-turn-url`, `wte-turn-secret` (netplay). Clearing app data resets them.
