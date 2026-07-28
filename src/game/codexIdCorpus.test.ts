// Does slugify actually survive the real content? A COLLISION is the dangerous
// failure: two different pages producing the same id would silently become one
// concept, and every reference to either would resolve to whichever won.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeId, parseId, slugify } from "./codexId";

const BUNDLED = path.resolve(__dirname, "../rules");
const MIRROR = process.env.APPDATA ? path.join(process.env.APPDATA, "com.wte.tabletop/rules") : "";

function pageNames(dir: string): string[] {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, "").replace(/_/g, " "));
}

/** Names from the baked data, grouped BY SOURCE FILE.
 *
 *  Grouping matters: an id carries its kind, so uniqueness is only required WITHIN
 *  a kind. Checking one flat list reported "PHASE" (a cipher) colliding with
 *  "Phase" (a genus ability), when in fact they become wte.cipher.phase and
 *  wte.genus.phase and never meet. */
function namesByFile(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const dir = path.resolve(__dirname, "data");
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    const names: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.name === "string" && o.name.trim()) names.push(o.name);
        Object.values(o).forEach(walk);
      }
    };
    walk(parsed);
    if (names.length) out[f] = [...new Set(names)];
  }
  return out;
}

function collisions(names: string[]): Record<string, string[]> {
  // A Map, not a plain object: a slug like "constructor" or "toString" would hit
  // Object.prototype and return an inherited function instead of an array. Found
  // the hard way — the corpus really does contain such a name.
  const bySlug = new Map<string, string[]>();
  for (const n of names) {
    const s = slugify(n);
    if (!s) continue;
    const list = bySlug.get(s);
    if (list) list.push(n);
    else bySlug.set(s, [n]);
  }
  const out: Record<string, string[]> = {};
  for (const [s, ns] of bySlug) {
    const distinct = [...new Set(ns)];
    if (distinct.length > 1) out[s] = distinct;
  }
  return out;
}

describe("the bundled page names slugify cleanly", () => {
  const names = pageNames(BUNDLED);

  it("finds the bundled pages", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it("produces a usable slug for every one", () => {
    const empty = names.filter((n) => !slugify(n));
    expect(empty).toEqual([]);
  });

  it("produces no collisions", () => {
    expect(collisions(names)).toEqual({});
  });

  it("produces a well-formed, parseable id for every one", () => {
    const bad = names.filter((n) => !parseId(makeId("page", n)));
    expect(bad).toEqual([]);
  });
});

describe("the baked ability and item names slugify cleanly", () => {
  const byFile = namesByFile();
  const allNames = Object.values(byFile).flat();

  it("finds names in the baked data", () => {
    expect(allNames.length).toBeGreaterThan(0);
  });

  it("produces a usable slug for every one", () => {
    expect(allNames.filter((n) => !slugify(n))).toEqual([]);
  });

  it("produces no collisions WITHIN a kind", () => {
    // If this ever fires, the colliding names need disambiguating BEFORE ids are
    // assigned — after the fact, every reference to either is already ambiguous.
    const perFile: Record<string, Record<string, string[]>> = {};
    for (const [file, names] of Object.entries(byFile)) {
      const c = collisions(names);
      if (Object.keys(c).length) perFile[file] = c;
    }
    expect(perFile).toEqual({});
  });

  it("keeps same-named concepts of DIFFERENT kinds apart", () => {
    // The real case from the corpus: a cipher called PHASE and a genus ability
    // called Phase. Different kinds, so different ids, so no ambiguity.
    expect(makeId("cipher", "PHASE")).toBe("wte.cipher.phase");
    expect(makeId("genus", "Phase")).toBe("wte.genus.phase");
    expect(makeId("cipher", "PHASE")).not.toBe(makeId("genus", "Phase"));
  });
});

describe.skipIf(!pageNames(MIRROR).length)("the full wiki mirror slugifies cleanly", () => {
  const names = pageNames(MIRROR);

  it("produces a usable slug for every page and no collisions", () => {
    expect({
      pages: names.length,
      empty: names.filter((n) => !slugify(n)),
      collisions: collisions(names),
    }).toEqual({ pages: names.length, empty: [], collisions: {} });
  });
});
