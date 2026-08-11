// Scalar fields: the pure parts — palettes, hillshade, the readout — plus the
// layer model's parsing and role filtering. The canvas half (FieldData) runs
// only where a real 2D context exists; its math is what's tested here.
import { describe, expect, it } from "vitest";
import { CONTOUR_BANDS, formatFieldValue, hillshade, paletteLut } from "./atlasField";
import { atlasForRole, emptyAtlas, parseAtlas, type AtlasLayer } from "./atlasModel";

const layer = (over: Partial<AtlasLayer> = {}): AtlasLayer => ({
  id: "l1",
  name: "Terrain",
  kind: "field",
  src: "data:image/png;base64,iVBORw0KGgo",
  opacity: 0.7,
  blend: "normal",
  visibility: "player",
  enabled: true,
  palette: "terrain",
  style: "tint",
  label: "ELEV",
  min: 0,
  max: 12000,
  unit: "FT",
  ...over,
});

describe("palettes", () => {
  it("builds full 256-entry tables for every palette", () => {
    for (const p of ["gray", "terrain", "thermal", "toxin"] as const) {
      const lut = paletteLut(p, "tint");
      expect(lut.length).toBe(1024);
      expect(lut[3]).toBeGreaterThan(0); // lowest value is drawn
      expect(lut[1023]).toBeGreaterThan(0); // highest value is drawn
    }
  });

  it("runs terrain from deep water to white peaks", () => {
    const lut = paletteLut("terrain", "tint");
    // low: blue over red; high: near-white
    expect(lut[2]).toBeGreaterThan(lut[0]);
    expect(lut[1020]).toBeGreaterThan(220);
    expect(lut[1021]).toBeGreaterThan(220);
  });

  it("makes thermal hot at the top", () => {
    const lut = paletteLut("thermal", "tint");
    expect(lut[1020]).toBeGreaterThan(240); // red channel at max value
    expect(lut[0]).toBeLessThan(60); // cold is dark
  });

  it("contours are mostly transparent with band lines", () => {
    const lut = paletteLut("terrain", "contours");
    let lines = 0;
    let clear = 0;
    for (let i = 0; i < 256; i++) {
      if (lut[i * 4 + 3] > 0) lines++;
      else clear++;
    }
    expect(clear).toBeGreaterThan(lines); // it's a line drawing, not a fill
    expect(lines).toBeGreaterThanOrEqual(CONTOUR_BANDS - 2); // roughly one line per band
  });
});

describe("hillshade", () => {
  it("lights slopes facing the northwest and shades the southeast", () => {
    expect(hillshade(-0.2, -0.2)).toBeGreaterThan(0.5); // rising toward NW light
    expect(hillshade(0.2, 0.2)).toBeLessThan(0.5); // falling away
    expect(hillshade(0, 0)).toBeCloseTo(0.5); // flat is neutral
  });

  it("clamps instead of blowing out", () => {
    expect(hillshade(-9, -9)).toBe(1);
    expect(hillshade(9, 9)).toBe(0);
  });
});

describe("the readout", () => {
  it("maps samples through min/max into the labeled unit", () => {
    expect(formatFieldValue(0.195, layer())).toBe("ELEV | 2,340 FT");
    expect(formatFieldValue(0, layer())).toBe("ELEV | 0 FT");
    expect(formatFieldValue(1, layer())).toBe("ELEV | 12,000 FT");
  });

  it("writes percentages tight and small ranges with a decimal", () => {
    expect(formatFieldValue(0.87, layer({ label: "FYBER", min: 0, max: 100, unit: "%" }))).toBe("FYBER | 87%");
    expect(formatFieldValue(0.5, layer({ label: "DOSE", min: 0, max: 4, unit: "SV" }))).toBe("DOSE | 2 SV");
  });

  it("stays silent without a label", () => {
    expect(formatFieldValue(0.5, layer({ label: undefined }))).toBeNull();
  });
});

describe("layers in the document", () => {
  function docWithLayers() {
    const d = emptyAtlas("Vadruna");
    d.layers.push(
      layer(),
      layer({ id: "l2", name: "Fyber Saturation", visibility: "locked", palette: "thermal", label: "FYBER" }),
      layer({ id: "l3", name: "Curator Notes", kind: "image", visibility: "curator" })
    );
    return d;
  }

  it("round-trips through parse unchanged", () => {
    const d = docWithLayers();
    expect(parseAtlas(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it("drops malformed layers and hostile srcs without losing the map", () => {
    const raw = JSON.parse(JSON.stringify(docWithLayers()));
    raw.layers.push({ id: "", name: "no id" }, "junk");
    raw.layers[0].src = "https://example.com/exfil.png";
    const doc = parseAtlas(raw)!;
    expect(doc.layers).toHaveLength(3);
    expect(doc.layers[0].src).toBeUndefined();
  });

  it("gives players names of locked layers but never their pixels", () => {
    const player = atlasForRole(docWithLayers(), "player");
    expect(player.layers.map((l) => l.id)).toEqual(["l1", "l2"]); // curator-only gone entirely
    const lockedL = player.layers.find((l) => l.id === "l2")!;
    expect(lockedL.name).toBe("Fyber Saturation"); // existence is information
    expect(lockedL.src).toBeUndefined(); // content is not
    expect(atlasForRole(docWithLayers(), "curator").layers).toHaveLength(3);
  });
});
