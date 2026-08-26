import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONDITION_STACKING,
  activeCodexConditions,
  isKnownCondition,
  parseConditionPage,
  resolveCondition,
  setCodexConditions,
  type CodexCondition,
} from "./conditions";
import { parseId } from "./codexId";
import { CONDITION_WORDS } from "../vtt/data/outcomeLedger";

const RULES = path.resolve(__dirname, "../rules");

function page(rows: string[], effect = "The target is slowed to a crawl.", title = "Slowed"): string {
  return [
    `# ${title}`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Type | Condition |",
    ...rows,
    "",
    "## Effect",
    effect,
    "",
  ].join("\n");
}

function valid(md: string, stem = "condition-slowed"): CodexCondition {
  const parsed = parseConditionPage(md, stem);
  expect(parsed).toMatchObject({ ok: true });
  if (!parsed?.ok) throw new Error("test condition did not parse");
  return parsed.condition;
}

function errorsFor(md: string, stem = "condition-slowed"): string[] {
  const parsed = parseConditionPage(md, stem);
  if (!parsed || parsed.ok) throw new Error("expected the page to fail validation");
  return parsed.errors;
}

afterEach(() => {
  setCodexConditions([]);
});

describe("Condition page parsing", () => {
  it("reads a condition off a page and leaves everything else alone", () => {
    const condition = valid(page(["| Stacking | refresh |"]));

    expect(condition).toMatchObject({
      name: "Slowed",
      stacking: "refresh",
      effect: "The target is slowed to a crawl.",
      id: "wte.condition.slowed",
      scope: "wte",
    });
    // A page without the Type row is somebody's lore, not a broken condition.
    expect(parseConditionPage("# Slowed\n\nA story about being slow.", "slowed")).toBeNull();
    expect(parseConditionPage("| Type | Genus |\n| Domain | Kinetic |", "lark")).toBeNull();
  });

  it("takes the rule text from an Effect field when there is no Effect section", () => {
    const md = [
      "# Anchored",
      "",
      "| Type | Condition |",
      "| Stacking | refresh |",
      "| Effect | Movement is removed and anchoring is never voluntary. |",
    ].join("\n");

    expect(valid(md, "condition-anchored").effect).toBe("Movement is removed and anchoring is never voluntary.");
  });

  it("reports rather than guesses when Stacking is missing or unrecognized", () => {
    // The whole point of the field: what Slowed(2 rounds) + Slowed(3 rounds)
    // does is the page's decision. Defaulting it would hand every table the
    // same answer while pretending they had authored it.
    expect(errorsFor(page([]))).toEqual([expect.stringContaining("Stacking is required")]);
    expect(errorsFor(page(["| Stacking | whatever |"]))).toEqual([
      expect.stringContaining('Stacking "whatever" is not allowed'),
    ]);
    expect(errorsFor(page(["| Stacking | refresh |"], ""))).toEqual([expect.stringContaining("Effect is required")]);
  });

  it("accepts every declared stacking rule, in any casing or spelling", () => {
    for (const stacking of CONDITION_STACKING) {
      expect(valid(page([`| Stacking | ${stacking.toUpperCase()} |`])).stacking).toBe(stacking);
    }
  });

  it("rejects an ID that belongs to a different kind of Codex record", () => {
    // `wte.genus.slowed` on a condition page resolves as a Genus ability
    // everywhere else in the app: the page would look fine and nothing would
    // ever find it.
    expect(errorsFor(page(["| Stacking | refresh |", "| ID | wte.genus.slowed |"]))).toEqual([
      expect.stringContaining("is a genus id, not a condition id"),
    ]);
    expect(errorsFor(page(["| Stacking | refresh |", "| ID | not-an-id |"]))).toEqual([
      expect.stringContaining("not a well-formed Codex id"),
    ]);
    expect(errorsFor(page(["| Stacking | refresh |", "| Overrides | wte..slowed |"]))).toEqual([
      expect.stringContaining("Overrides"),
    ]);
  });

  it("ignores metadata that only appears inside comments or fenced examples", () => {
    const md = [
      "# How To Write A Condition",
      "",
      "<!-- | Type | Condition | -->",
      "",
      "```",
      "| Type | Condition |",
      "| Stacking | stack |",
      "```",
    ].join("\n");

    expect(parseConditionPage(md, "how-to")).toBeNull();
  });
});

describe("the Conditions registry", () => {
  it("resolves a tag by name, alias, slug or id, whatever its casing", () => {
    const condition = valid(page(["| Stacking | refresh |", "| Aliases | Hobbled; Mired |"]));
    setCodexConditions([condition]);

    for (const tag of ["Slowed", "slowed", "  SLOWED ", "Hobbled", "mired", "wte.condition.slowed"]) {
      expect(resolveCondition(tag)?.id).toBe("wte.condition.slowed");
    }
    // An undefined tag is a real answer: it stays a plain pip the Curator rules on.
    expect(resolveCondition("Blighted")).toBeNull();
    expect(isKnownCondition("")).toBe(false);
  });

  it("lets a campaign definition win the name an official one holds", () => {
    const official = valid(page(["| Stacking | refresh |"]));
    const fork: CodexCondition = {
      ...official,
      id: "campaign.ashen-sun.condition.slowed",
      scope: "campaign",
      stacking: "extend",
      effect: "At this table, two applications add their rounds together.",
    };
    // Registered official-first, exactly as the loader orders them.
    setCodexConditions([official, fork]);

    expect(resolveCondition("Slowed")).toMatchObject({ scope: "campaign", stacking: "extend" });
    // And the reverse order must not flip it: scope decides, not file order.
    setCodexConditions([fork, official]);
    expect(resolveCondition("Slowed")).toMatchObject({ scope: "campaign", stacking: "extend" });
    expect(activeCodexConditions()).toHaveLength(2);
  });

  it("is replaced atomically, so a campaign switch cannot leave a stale rule behind", () => {
    setCodexConditions([valid(page(["| Stacking | refresh |"]))]);
    setCodexConditions([]);

    expect(resolveCondition("Slowed")).toBeNull();
    expect(activeCodexConditions()).toEqual([]);
  });
});

describe("the shipped Conditions corpus", () => {
  const files = fs
    .readdirSync(RULES)
    .filter((file) => file.startsWith("Condition_") && file.endsWith(".md"))
    .map((file) => ({ stem: file.replace(/\.md$/, ""), md: fs.readFileSync(path.join(RULES, file), "utf8") }));

  it("ships every condition the prose scanner already recognizes", () => {
    const parsed = files.map((file) => {
      const result = parseConditionPage(file.md, file.stem);
      expect(result, `${file.stem} must parse as a condition`).toMatchObject({ ok: true });
      if (!result?.ok) throw new Error(`${file.stem} did not parse`);
      return result.condition;
    });

    // The ledger's closed alternation stays a SCANNER; this page set is the
    // definition. Every word the scanner can tag must therefore have a page to
    // resolve to — otherwise the VTT applies a tag with no rule behind it.
    setCodexConditions(parsed);
    for (const word of CONDITION_WORDS) {
      expect(isKnownCondition(word), `${word} needs a Conditions page`).toBe(true);
    }
    // …and the page set is allowed to be larger. Blighted is written in stacks
    // all over the corpus and is exactly the case a closed parser list cannot
    // grow to cover.
    expect(isKnownCondition("Blighted")).toBe(true);
    expect(resolveCondition("Blighted")?.stacking).toBe("stack");
  });

  it("pins a permanent condition id and a unique name on every shipped page", () => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const file of files) {
      const result = parseConditionPage(file.md, file.stem);
      if (!result?.ok) throw new Error(`${file.stem} did not parse`);
      const { id, name } = result.condition;
      expect(parseId(id), `${file.stem} must pin a well-formed id`).toMatchObject({ scope: "wte", kind: "condition" });
      expect(ids.has(id), `${id} is declared twice`).toBe(false);
      expect(names.has(name.toLowerCase()), `${name} is declared twice`).toBe(false);
      ids.add(id);
      names.add(name.toLowerCase());
    }
    expect(ids.size).toBeGreaterThanOrEqual(25);
  });

  it("says what the corpus already says about the conditions the corpus defines", () => {
    // Anchored, Blighted and Displaced are not new words. Combat.md spells
    // Anchored out in full, and the Asternem/Greahtias'kin abilities state
    // exactly what Blighted and Displaced do to whoever they hit. A page that
    // contradicts the ability applying it is worse than no page: the Curator
    // reads the rule here, the player reads the prose there, and they disagree
    // at the table. Both sides are asserted, so rewriting the source prose
    // fails here rather than leaving the definition quietly stale.
    const effect = (stem: string): string => {
      const file = files.find((f) => f.stem === stem);
      if (!file) throw new Error(`${stem}.md is missing`);
      const parsed = parseConditionPage(file.md, stem);
      if (!parsed?.ok) throw new Error(`${stem} did not parse`);
      return parsed.condition.effect;
    };
    const source = (file: string): string => fs.readFileSync(path.join(RULES, file), "utf8");

    const combat = source("Combat.md");
    expect(combat).toContain("Anchoring is <b>never voluntary</b>");
    expect(combat).toContain("Cannot move more than 5 ft; movement attempts trigger reactions");
    expect(combat).toContain("Anchored creatures automatically gain Quicktime chances when attacked in melee");
    const anchored = effect("Condition_Anchored");
    for (const beat of ["never voluntary", "5 ft", "Action Priority", "Quicktime", "Break Check"]) {
      expect(anchored, `Combat.md states ${JSON.stringify(beat)} about Anchored`).toContain(beat);
    }

    const asternem = source("Asternem.md");
    expect(asternem).toContain("Displaced, causing them to take double damage from all sources");
    expect(asternem).toContain('becomes Displaced, applying the "Blighted" condition');
    expect(asternem).toContain("any healing they receive during this time is reduced by half");
    expect(effect("Condition_Displaced")).toContain("double damage");
    // The direction is the part that was wrong: displacing a target applies
    // Blighted. Blighted stacks do not add up to Displaced.
    expect(effect("Condition_Displaced")).toContain("Blighted");
    expect(effect("Condition_Blighted")).not.toMatch(/becomes Displaced/i);
    expect(effect("Condition_Blighted")).toMatch(/\bhalf|\bhalved\b/i);
  });

  it("uses each stacking rule at least once, so none of them is theoretical", () => {
    const used = new Set(
      files.map((file) => {
        const result = parseConditionPage(file.md, file.stem);
        if (!result?.ok) throw new Error(`${file.stem} did not parse`);
        return result.condition.stacking;
      })
    );
    expect([...used].sort()).toEqual([...CONDITION_STACKING].sort());
  });
});

// The provenance line. Sixteen of the shipped pages carry rule text an agent
// drafted during Phase 1, because the corpus NAMES those conditions and never
// defines one of them: Character_States.md is an empty MediaWiki shell, the
// Glossary has no condition entries, and the Guide's entry is a promise of rules
// ("Conditions have specific effects on actions") rather than a rule. The other
// eleven are transcriptions of prose that does exist — Combat.md on Anchored,
// Asternem.md on Blighted and Displaced, Stygians.md on Stinous, and so on.
//
// Both kinds render identically, so without this marker a Curator opening
// Condition_Weakened.md cannot tell it apart from Condition_Stinous.md, which is
// their own setting quoted back at them. Deleting the drafted pages is not the
// alternative: CONDITION_WORDS tags those conditions in play and a tag with no
// page behind it resolves to nothing at all. So they stay, labelled.
describe("provisional conditions say so on the page", () => {
  /** Rule text drafted to fill a gap — awaiting the Curator's own rule. */
  const PROVISIONAL = [
    "Blinded", "Charmed", "Deafened", "Disoriented", "Frozen", "Grappled",
    "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone",
    "Stunned", "Suppressed", "Unconscious", "Weakened",
  ];
  /** Rule text transcribed from a page of the Curator's corpus. */
  const TRANSCRIBED = [
    "Anchored", "Bleeding", "Blighted", "Burning", "Displaced", "Exhausted",
    "Frightened", "Restrained", "Silenced", "Slowed", "Stinous",
  ];

  const read = (name: string): string => fs.readFileSync(path.join(RULES, `Condition_${name}.md`), "utf8");
  const shipped = fs
    .readdirSync(RULES)
    .filter((file) => file.startsWith("Condition_") && file.endsWith(".md"))
    .map((file) => file.replace(/^Condition_|\.md$/g, ""));

  it("classifies every shipped page as one or the other", () => {
    // A twenty-eighth page added without a verdict is the failure this catches:
    // it would ship unlabelled and read as canon by default.
    expect([...shipped].sort()).toEqual([...PROVISIONAL, ...TRANSCRIBED].sort());
  });

  it("marks each drafted page in the text a reader actually sees", () => {
    for (const name of PROVISIONAL) {
      const md = read(name);
      expect(md, `${name} must carry the notice`).toContain("## Provisional");
      // Not in an HTML comment. The Stacking explainer already lives in one and
      // is invisible in the reader — that is precisely the hiding place to avoid.
      expect(md.replace(/<!--[\s\S]*?-->/g, ""), `${name}'s notice must survive comment stripping`)
        .toContain("Placeholder — not yet a W.T.E rule.");
    }
  });

  it("uses one identical notice everywhere, so deleting it is mechanical", () => {
    const notice = (md: string) => md.slice(md.indexOf("## Provisional"), md.indexOf("## Effect"));
    const first = notice(read(PROVISIONAL[0]));
    expect(first).not.toBe("");
    for (const name of PROVISIONAL) expect(notice(read(name)), name).toBe(first);
  });

  it("leaves the Curator's own transcriptions unmarked", () => {
    for (const name of TRANSCRIBED) {
      expect(read(name), `${name} is transcribed from the corpus`).not.toContain("## Provisional");
    }
  });

  it("keeps the notice out of the rule the engine reads", () => {
    // The marker is page furniture. If it leaked into `effect` it would be
    // applied as mechanics — and would follow the condition into every tooltip,
    // outcome line and campaign snapshot that carries the rule text.
    for (const name of PROVISIONAL) {
      const parsed = parseConditionPage(read(name), `Condition_${name}`);
      expect(parsed?.ok, `${name} must still parse`).toBe(true);
      if (!parsed?.ok) continue;
      expect(parsed.condition.name).toBe(name);
      expect(parsed.condition.effect).not.toMatch(/provisional|placeholder/i);
    }
  });
});
