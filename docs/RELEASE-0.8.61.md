# W.T.E v0.8.61 — Trustworthy Core

This release adds no features. It is entirely about making sure W.T.E does not lose
your work, and closing a security hole that could reach every install.

If you keep campaigns in W.T.E, this is the most important update so far.

---

## Your characters were losing fields

Nine fields were being **deleted from every character** on the first save after a
reload — written by the app, then silently dropped when the sheet was read back:

| Field | What it meant |
|---|---|
| `morality` | Polarized Soul position, which feeds derived stats — so your numbers changed |
| `innateChoice` | Your chosen 2-of-4 species innates |
| `sector` | The Sector your Inquisitor joined their Paradigm in |
| `eminence` | System Alignment Index |
| `pressure` | Pressure Engine value |
| `allowOverrides` / `derivedOverrides` | Every Curator-set stat override |
| `focusBonus` / `focusBonusRank` | Talent Holder's banked Synaptic Focus |

Losing `innateChoice` was worse than data loss: an empty value reads as "legacy
sheet, all innates active", so characters silently gained abilities they never
picked.

This is fixed, and it cannot come back — the field list is now checked against the
character model at **compile time**, so adding a field without wiring it is a build
error rather than a silent deletion.

**Note:** the fix stops further loss. It cannot recover fields already gone.

## Damaged records no longer overwrite themselves

A character, scene or encounter whose stored data could not be read used to render
as **blank but with the correct name** — which reads as "the app reset my
character" — and then the autosave wrote that blank over the only copy.

Now a damaged record is never opened for editing. You get a recovery screen showing
the original stored data, with three choices: copy it out, edit and repair it, or
deliberately reset it. A repair that still cannot be read is refused, so trying to
fix something can never destroy it.

The same protection covers scenes (background, tokens, walls, lights, zones, fog),
encounters (initiative order, HP, conditions), your campaign notes and calendar,
folder trees, the custom armory, and Codex page settings.

## Saves tell you the truth

- **Nothing was flushed when you closed the app.** The last 400ms of sheet edits and
  500ms of scene edits were simply dropped, every time. Now they are written on
  close, on losing focus, and when navigating away.
- **A new save indicator** in the corner: quiet when everything is written, bright
  when something is pending, red with the reason when a save failed. Click it to
  force a save.
- **Thirteen writes that failed silently now report.** Previously the change looked
  applied and the loss only appeared at the next launch.
- **A deleted scene stays deleted.** The pending autosave could resurrect it moments
  after you confirmed.
- **A locked database no longer bricks the session.** One failure used to poison
  every read and write for the rest of the run, showing an app with no campaigns
  and no explanation.

## Security: shared content could run code

Codex pages sync between users through the shared library, and character files are
handed player to player. Any HTML in them was rendered **unsanitized**, and with no
Content Security Policy that script could reach the app's own database, your Codex
pages, and stored credentials. A single published page would have executed on every
install that had ever pulled it, at next launch, with no prompt.

Closed:

- All five raw-HTML paths are sanitized through an allowlist that parses with the
  browser's own parser (verified against all 336 real Codex pages — nothing lost).
- A real Content Security Policy. Injected `<script>`, inline `onerror` handlers and
  foreign scripts are all blocked even if sanitizing were bypassed.
- Whole-disk read access via the asset protocol removed.
- A link in a shared page could break out of the shell and run arbitrary commands —
  fixed, with tests.
- **Shared page updates are no longer applied automatically at launch.** They used
  to overwrite your local edits with no prompt, no diff and no backup. Now they are
  offered for review in Codex › Library.

## New: campaign export and import

Whole-campaign packages (`.wtepack`) carrying the campaign, every character, scene,
encounter, asset, note, Sequence and its settings. Previously the only export was
one character at a time.

Importing asks before it acts: if the campaign already exists you choose whether to
merge into it or land a separate copy, and copy mode leaves everything you already
have untouched.

## New: storage diagnostics

On the Dashboard: what is in your database, how many records, whether any are
damaged, and what has been quarantined for recovery. A failed read is now clearly a
failure instead of looking like an empty campaign.

## Archiving a campaign is reversible

Archiving used to be permanent. Nothing in the app ever listed an archived campaign,
so it and all of its characters, scenes and assets became unreachable — while the
confirmation said only "hidden from this list". There is now an Archived section
with Restore, and the wording says what actually happens.

## Also

- Six one-click destructive buttons now confirm: desk note, calendar entry, Codex
  note, a whole Sequence, an uploaded asset, an uploaded sound.
- Codex notes and Sequences belong to a campaign again — every campaign was showing
  every other campaign's.
- Records written by a newer version of W.T.E are no longer silently stripped when
  opened by an older one.
- Character files from a newer format are refused with an explanation instead of
  imported with the unreadable parts quietly dropped.

## Compatibility

This release makes **no database schema changes**, so you can roll back to v0.8.60
by reinstalling it. The storage-consolidation schema was deliberately held back to
Phase 2 for exactly this reason.
