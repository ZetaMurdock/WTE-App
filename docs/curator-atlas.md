# The Curator Atlas

A shared, interactive world map that lives OVER the VTT — separate from the
tactical battle map. The battle map tells players where they physically are;
the Atlas tells them where they are in the world. You can be fighting inside
the Mogul Survey Station battle map while the Atlas shows a several-hundred-mile
region of Vadruna.

The design intent, in one line: **Google Earth filtered through W.T.E. system
technology.** Not a flat JPG you drag around — a continuous spatial environment
that the system itself appears to be *resolving*, and sometimes refuses to.

## Visual identity

Military satellite display × old cartography × W.T.E. systemic technology.
Dark charcoal ground, thin pale measurement lines, small technical typography,
restrained blue-green highlights. Areas outside available information fall to
near-black. Chrome reads like an instrument:

```
VADRUNA // MOGUL SURVEY CARTOGRAPH
SCALE | 50 MI        COORD | VAD-S.0821.44        SIGNAL | 74%
OBSERVATIONAL RESOLUTION: PARTIAL
```

## Zones — five visibility states

The Curator draws polygons and assigns states:

| State          | Players see                                                        |
| -------------- | ------------------------------------------------------------------ |
| `visible`      | Everything: terrain, roads, measurements, nodes, information.      |
| `surveyed`     | Terrain, but detailed information may still be unknown.            |
| `unconfirmed`  | Rough shapes / silhouettes; information corrupted or incomplete.   |
| `null-locked`  | Concealed. **The map actively rejects observation** (below).       |
| `curator-only` | Does not register as an area at all.                               |

**Null rejection** is the signature: hovering a null-locked region is not
nothing — black geometry crawls over the cursor, coordinates flicker to
nonsense, corrupted readouts surface (`DATA NULL`, `OBSERVATION DENIED`,
`CARTOGRAPHIC RETURN: Ø`, `CLEARANCE INSUFFICIENT`), the cursor glitches and
snaps back. Clicking spreads a heavier black distortion that collapses back
into the hidden region. Zooming *into* one pushes the camera back out:
`OBSERVATIONAL DEPTH EXCEEDED`. It must feel like the system cannot resolve
what is there — not like a texture painted on top.

## Navigation

- Grab-and-pan **with momentum**; release glides briefly.
- Continuous wheel zoom **toward the cursor** (the point under the pointer
  stays under the pointer).
- Double-click a node → the camera flies to it. Curator has **Focus Everyone**
  (`FOCUS → UNKNOWN BIOLOGICAL MASS` pans every player's Atlas).
- Progressive detail: planetary → regional → local, with layers *fading in*
  rather than merely scaling. Long-term: globe mode at the top of the stack
  (Universe → star system → planet → continent → region → encounter).
- Subtle 3D later: illustrated map over a shallow heightmap for parallax; the
  Space Elevator physically projects at the right zoom.

## Grid and measurement

A navigation grid (not a combat grid) that fades in with zoom and re-picks its
step: `250 mi → 50 mi → 10 mi → 1 mi → 500 ft → 25 ft`. Units setting:
Imperial / Metric / Both (`38.4 mi / 61.8 km`).

Click-drag measures: `DIRECT DISTANCE 17.4 miles`; with a known route,
`TRAVEL DISTANCE 23.8 miles` and optional travel-time estimates (foot /
vehicle), which the Curator can disable. The party literally watches
`SPACE ELEVATOR — 430 MI` tick down as they progress.

## Nodes

A node is an **information object**, not a marker: name, kind (settlement,
landmark, character, objective, hazard, transport, portal, anomaly, faction…),
status lines, note, optional image, distance from the Unit, last-observed time.
Each node has its own visibility, and **min/max zoom** so far-out views show
only the Space Elevator / the Unit / Rivenbark / the Tree while closer zooms
reveal survey stations, roads, then individual buildings.

- **Player/Unit markers** are live nodes (`◉ UNIT 04 — 430 MI TO ASCENSION`);
  the marker splits when the party splits. The Curator can cut tracking:
  `POSITIONAL SIGNAL LOST`, then a hollow last-known-position marker. Horror.
- **Dynamic nodes** move: the Tree crosses Vadruna, leaving positional echoes
  (`LAST OBSERVED` / `PREVIOUS POSITION` / `CURRENT ESTIMATE`).

## Waypoints and transit

Waypoints are Curator-created travel anchors, separate from nodes. Once
discovered they become selectable; if teleportation is enabled a player sends
`REQUEST TRANSIT`, the Curator gets Approve / Reject (some waypoints may be
auto-approve). Approval uses the Atlas itself as the transition — camera pulls
up, crosses the region with distances ticking, descends on the destination —
then: change active scene, teleport tokens to spawn coordinates, update the
player marker and distances. 2–4 seconds that make travel feel geographically
real.

## Layers

Curator-toggleable information layers: Topography, Political, Infrastructure,
Energy — and eventually **Fyber**, which starts nearly empty and later reveals
the planetary network (Rivenbark wasn't *surrounded* by Fyber; it sat on a
strand). Players may lack access to a layer entirely: `Fyber [LOCKED]`.

## Broadcast

The Curator works privately in Edit Mode, then hits **BROADCAST VIEW**. Every
player gets `CARTOGRAPHIC UPDATE RECEIVED` and their Atlas updates — ideally
with the glitch, when something dramatic just changed.

## Observation Resolution

`OBSERVATIONAL RESOLUTION: 72%` — the in-fiction reason a Google-Earth-like
system doesn't reveal everything: the tech can view enormous areas, but
Observation determines how much reality resolves. Known region 98%, partially
surveyed 61%, Fyber-distorted 23%, Null 0%.

**And the Atlas doesn't necessarily tell the truth.** Under Observation, Fyber,
Null or spatial distortion, the map itself becomes unreliable: a road moves, a
settlement appears twice, a distance reads `38.2 mi` → `91.7 mi` →
`UNRESOLVED`, a player's own marker appears somewhere they aren't, the Space
Elevator briefly disappears. Utility and horror in one instrument.

## The world map itself

Built hierarchically, not as one enormous image:

- **Planet** — continents, oceans, Dominion/Mogul territories, the Space
  Elevator, major facilities, known Fyber concentrations.
- **Region** (where the campaign lives now) — ~500–700 mi around the Trial
  Deployment Zone: Trial Deployment Point, Original Fyber Bloom, The Pit,
  Rivenbark, Icarus Gathering Site, Mogul Survey Station, Space Elevator, plus
  live positions of the Unit and the Tree.
- **Local** — zoom into Rivenbark until the tactical map transition takes over:
  `Vadruna → South Vadruna Trial Region → Rivenbark → Rivenbark battle map`.

Next content step: **the Vadruna regional map first**, so the UI is designed
around real geography rather than a placeholder.

---

## Implementation slices

Storage is `campaign_kv` scope `"atlas"` — the general scoped store added in
schema v5 exists precisely so a new campaign-scoped blob needs no migration.

1. **Foundation (SHIPPED, v0.8.66)** — atlas model + persistence; floating
   Atlas window over the VTT; inertial pan / zoom-to-cursor camera; adaptive
   scale bar with Imperial/Metric/Both; click-drag measurement; nodes with
   zoom gating and info cards; zone polygons with all five states; null
   rejection on hover/click; Curator edit mode (place nodes, draw zones, set
   states); map image upload. Pure math and model fully unit-tested.
2. **Live sharing (BUILT on the atlas branch)** — the host serves players the
   role-filtered document over typed `atlas` / `atlas-request` messages (they
   have none of the host's campaign data); BROADCAST VIEW via `atlas-focus`
   with `CARTOGRAPHIC UPDATE RECEIVED`, Focus Everyone or one chosen player
   (a player's Atlas opens itself). Also landed in this pass, pulled forward
   from later slices by request: resizable instrument window; circular world
   shape with a rim; floating round widget controls + zoom/FIT; fluid
   drag-to-draw zones that auto-close (Douglas-Peucker simplified); zone
   cards (rename/state/particles/sprite/delete); node FOCUS fly-to +
   double-click fly; the world clock with a day/night shade (manual or
   auto-advancing); custom sprites on nodes and zones — animated GIFs stay
   animated (WebCodecs, static fallback); stateless zone particle weather
   (embers/motes/snow/fog). STILL OPEN from this slice: live player/Unit
   markers driven by the session; signal-lost states.
3. **Waypoints & transit** — request/approve flow, the camera transition, and
   the scene-switch + token-spawn integration.
4. **Layers & dynamics** — information layers with per-player access; dynamic
   nodes with positional echoes; travel-distance routes and time estimates.
5. **Depth** — progressive detail levels per zoom band, observation
   resolution, unreliable-map events, heightmap parallax, globe mode, and the
   local-map → battle-map zoom transition.
