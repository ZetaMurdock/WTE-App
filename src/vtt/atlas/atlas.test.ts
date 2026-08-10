// The Curator Atlas foundation: model parsing, the camera, and cartography math.
//
// The camera tests matter most. "Zoom keeps the cursor's point under the
// cursor" is the single property that makes the Atlas feel like mapping
// software instead of a JPG in a scroll container, and it is exactly the kind
// of arithmetic that drifts without a test noticing.
import { describe, expect, it } from "vitest";
import {
  ATLAS_VERSION,
  atlasForRole,
  emptyAtlas,
  parseAtlas,
  type AtlasDoc,
} from "./atlasModel";
import {
  clampToMap,
  coordLabel,
  distanceMi,
  formatDistance,
  makeCamera,
  MAX_ZOOM,
  MIN_ZOOM,
  nodeVisibleAtZoom,
  nullReadout,
  panBy,
  pickScaleBar,
  pointInPolygon,
  screenToWorld,
  stepInertia,
  worldToScreen,
  zoomAt,
} from "./atlasMath";

const view = { width: 800, height: 600 };

describe("the camera", () => {
  it("round-trips world -> screen -> world", () => {
    const cam = makeCamera(250, 150, 2);
    const p = { x: 300.25, y: 120.5 };
    const back = screenToWorld(cam, view, worldToScreen(cam, view, p));
    expect(back.x).toBeCloseTo(p.x, 10);
    expect(back.y).toBeCloseTo(p.y, 10);
  });

  it("keeps the point under the cursor under the cursor while zooming", () => {
    // The Google Earth property: cursor on Rivenbark, scroll, Rivenbark stays.
    let cam = makeCamera(250, 150, 0.5);
    const cursor = { x: 613, y: 187 }; // deliberately off-center
    const anchored = screenToWorld(cam, view, cursor);
    for (const factor of [1.3, 1.3, 1.3, 0.5, 2.1, 0.77]) {
      cam = zoomAt(cam, view, cursor, factor);
      const now = screenToWorld(cam, view, cursor);
      expect(now.x).toBeCloseTo(anchored.x, 8);
      expect(now.y).toBeCloseTo(anchored.y, 8);
    }
  });

  it("clamps zoom at both ends without moving the world", () => {
    const cam = makeCamera(10, 10, MAX_ZOOM);
    const same = zoomAt(cam, view, { x: 400, y: 300 }, 10);
    expect(same.zoom).toBe(MAX_ZOOM);
    expect(same.x).toBe(cam.x);
    const far = zoomAt(makeCamera(10, 10, MIN_ZOOM), view, { x: 1, y: 1 }, 0.01);
    expect(far.zoom).toBe(MIN_ZOOM);
  });

  it("pans opposite the drag, scaled by zoom", () => {
    const cam = makeCamera(100, 100, 4);
    const dragged = panBy(cam, 40, -20); // drag right & up
    expect(dragged.x).toBeCloseTo(90); // map moves right => center moves west
    expect(dragged.y).toBeCloseTo(105);
  });

  it("glides to rest instead of sliding forever", () => {
    let cam = { ...makeCamera(0, 0, 10), vx: 50, vy: -30 };
    let steps = 0;
    while ((cam.vx !== 0 || cam.vy !== 0) && steps < 600) {
      cam = stepInertia(cam, 16);
      steps++;
    }
    expect(cam.vx).toBe(0);
    expect(cam.vy).toBe(0);
    expect(steps).toBeGreaterThan(3); // it did glide
    expect(steps).toBeLessThan(200); // and it did stop
    expect(cam.x).toBeGreaterThan(0); // having actually moved
  });

  it("returns the identical object at rest, so a render loop can stop", () => {
    const cam = makeCamera(5, 5, 10);
    expect(stepInertia(cam, 16)).toBe(cam);
  });

  it("never lets the map leave the viewport entirely", () => {
    const cam = makeCamera(-10000, -10000, 1);
    const clamped = clampToMap(cam, view, 500, 300);
    // Half a viewport of slack, no more.
    expect(clamped.x).toBeGreaterThanOrEqual(-view.width / 2);
    expect(clamped.y).toBeGreaterThanOrEqual(-view.height / 2);
  });
});

describe("the scale bar", () => {
  it("picks a bar near 120 px at any zoom", () => {
    for (const zoom of [0.05, 0.3, 1, 4, 20, 100, 700, 3000]) {
      const bar = pickScaleBar(zoom, "imperial");
      expect(bar.px, `zoom ${zoom}`).toBeGreaterThan(40);
      expect(bar.px, `zoom ${zoom}`).toBeLessThan(400);
    }
  });

  it("climbs the ladder as you zoom out", () => {
    const near = pickScaleBar(2000, "imperial");
    const far = pickScaleBar(0.5, "imperial");
    expect(near.stepMi).toBeLessThan(far.stepMi);
    expect(near.label).toMatch(/ft/);
    expect(far.label).toMatch(/mi/);
  });

  it("shows both units when asked", () => {
    const bar = pickScaleBar(2, "both");
    expect(bar.label).toMatch(/mi.*\/.*km/);
  });

  it("uses metric steps in metric mode", () => {
    expect(pickScaleBar(2, "metric").label).toMatch(/km|m$/);
  });
});

describe("distance", () => {
  it("measures straight lines in miles", () => {
    expect(distanceMi({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("formats short distances in feet, long in miles", () => {
    expect(formatDistance(0.1, "imperial")).toBe("528 ft");
    expect(formatDistance(17.42, "imperial")).toBe("17.4 mi");
    expect(formatDistance(430.2, "imperial")).toBe("430 mi");
  });

  it("formats both units the way the spec writes them", () => {
    expect(formatDistance(38.4, "both")).toBe("38.4 mi / 61.8 km");
  });
});

describe("zones", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("knows inside from outside, including concave shapes", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    const lShape = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 8 }, lShape)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false); // the notch
  });

  it("treats a degenerate polygon as containing nothing", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
});

describe("node zoom gates", () => {
  it("hides below minZoom and above maxZoom", () => {
    const streetLevel = { minZoom: 50 };
    expect(nodeVisibleAtZoom(streetLevel, 10)).toBe(false);
    expect(nodeVisibleAtZoom(streetLevel, 80)).toBe(true);
    const planetaryOnly = { maxZoom: 1 };
    expect(nodeVisibleAtZoom(planetaryOnly, 0.5)).toBe(true);
    expect(nodeVisibleAtZoom(planetaryOnly, 5)).toBe(false);
  });

  it("shows an ungated node everywhere", () => {
    expect(nodeVisibleAtZoom({}, MIN_ZOOM)).toBe(true);
    expect(nodeVisibleAtZoom({}, MAX_ZOOM)).toBe(true);
  });
});

describe("the document", () => {
  function fullDoc(): AtlasDoc {
    const d = emptyAtlas("Vadruna");
    d.widthMi = 700;
    d.heightMi = 420;
    d.units = "both";
    d.nodes.push(
      { id: "n1", name: "Rivenbark", kind: "settlement", x: 120, y: 80, visibility: "player", status: ["FYBER SATURATION: EXTREME"] },
      { id: "n2", name: "Bondrewed Observation Site", kind: "hazard", x: 300, y: 200, visibility: "curator" }
    );
    d.zones.push(
      { id: "z1", state: "null-locked", polygon: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }] },
      { id: "z2", state: "curator-only", polygon: [{ x: 100, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 150 }] }
    );
    return d;
  }

  it("round-trips through JSON unchanged", () => {
    const doc = fullDoc();
    expect(parseAtlas(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it("refuses a document from a newer build", () => {
    expect(parseAtlas({ ...fullDoc(), version: ATLAS_VERSION + 1 })).toBeNull();
  });

  it("drops a malformed node without losing the map", () => {
    const raw = JSON.parse(JSON.stringify(fullDoc()));
    raw.nodes.push({ id: "", name: "no id" }, { id: "n3", x: NaN, y: 2 }, "not a node");
    const doc = parseAtlas(raw)!;
    expect(doc.nodes).toHaveLength(2);
  });

  it("drops a zone with fewer than three vertices", () => {
    const raw = JSON.parse(JSON.stringify(fullDoc()));
    raw.zones.push({ id: "z3", state: "visible", polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    expect(parseAtlas(raw)!.zones).toHaveLength(2);
  });

  it("refuses a non-image data URL for the map", () => {
    const raw = { ...fullDoc(), image: "data:text/html,<script>alert(1)</script>" };
    expect(parseAtlas(raw)!.image).toBeUndefined();
  });

  it("players never receive curator-only material at all", () => {
    // Filtered from the DOCUMENT, not skipped at draw time: what is not in the
    // data cannot leak through a future renderer change.
    const player = atlasForRole(fullDoc(), "player");
    expect(player.nodes.map((n) => n.id)).toEqual(["n1"]);
    expect(player.zones.map((z) => z.id)).toEqual(["z1"]);
    const curator = atlasForRole(fullDoc(), "curator");
    expect(curator.nodes).toHaveLength(2);
    expect(curator.zones).toHaveLength(2);
  });
});

describe("technical dressing", () => {
  it("gives the same spot the same coordinate designation", () => {
    expect(coordLabel({ x: 8.21, y: 0.44 }, "Vadruna")).toBe(coordLabel({ x: 8.21, y: 0.44 }, "Vadruna"));
    expect(coordLabel({ x: 8.21, y: 0.44 }, "Vadruna")).toMatch(/^VAD-\d{4}\.\d{2}$/);
  });

  it("keeps the readout at fixed width wherever the cursor is", () => {
    // An instrument has a fixed number of digits; 191 mi must not overflow the
    // field and read as a malfunction.
    for (const p of [{ x: 191, y: 137.5 }, { x: 0, y: 0 }, { x: -3, y: 9999 }]) {
      expect(coordLabel(p, "Vadruna"), JSON.stringify(p)).toMatch(/^VAD-\d{4}\.\d{2}$/);
    }
  });

  it("picks a corrupted readout deterministically per spot", () => {
    const a = nullReadout({ x: 3, y: 7 }, 1);
    expect(nullReadout({ x: 3, y: 7 }, 1)).toBe(a);
    expect(a.length).toBeGreaterThan(0);
  });
});
