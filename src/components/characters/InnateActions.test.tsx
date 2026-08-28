// @vitest-environment happy-dom
//
// Innate features as ABILITIES on the sheet, across species.
//
// The Bio tab has always printed these as flat prose — name, em dash, effect —
// so a Salaris knew Iudicius resolved on a Mental Check — Capacity and had
// nowhere on the sheet to make it. The Actions table is where a character acts,
// and `usableRacial` is what the VTT already builds its racial group from, so
// the fix is one list read by both surfaces rather than a second treatment.
//
// Two failures this file exists to catch:
//   • a species page that resolves "Always · Automatic" growing a roll button —
//     61 of the 111 rows `usableRacial` can return are passives, and a d20 the
//     rules never asked for is worse than no button at all;
//   • the sheet and the VTT drifting about the same ability. They read one
//     parse; the parity case below asserts they still do.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetProvider } from "../../net/NetContext";
import { SPECIES, usableRacial, zeroAttributes, zeroSpecialties, type UsableAbility } from "../../game/wte";
import { abilityUnderstanding, declaresNoRoll } from "../../game/abilityUnderstanding";
import { officialAbilityCatalog } from "../../game/abilityCatalog";
import { characterActionSet, characterRollAxisStats } from "../../vtt/data/characterAbilities";
import { VttAbilitiesPanel } from "../../vtt/VttAbilitiesPanel";
import type { CharacterRecord } from "../../lib/characters";
import { ActionsTable } from "./ActionsTable";

/** One character, built the way the sheet and the VTT both read it. */
function record(speciesId: string, variantName?: string, innateChoice?: string[]): CharacterRecord {
  const attributes = zeroAttributes();
  attributes.wis = 12;
  attributes.int = 12;
  attributes.phy = 12;
  attributes.dex = 12;
  const specialties = zeroSpecialties();
  specialties.mf = 20;
  specialties.bal = 20;
  return {
    id: `innate-${speciesId}-${variantName ?? "base"}`,
    campaignId: "table",
    name: "Innate Tester",
    createdAt: 0,
    updatedAt: 0,
    sheet: { attributes, specialties, rank: 3, speciesId, variantName, innateChoice },
  } as unknown as CharacterRecord;
}

/** The innate rows the SHEET hands its Actions table, for one character. */
function sheetInnate(rec: CharacterRecord): UsableAbility[] {
  const s = rec.sheet;
  return usableRacial(s.speciesId, s.variantName, s.variantOption, s.innateChoice);
}

function one(speciesId: string, variantName: string | undefined, name: string): UsableAbility {
  const found = usableRacial(speciesId, variantName).find((a) => a.name === name);
  if (!found) throw new Error(`${speciesId}/${variantName ?? "innate"} no longer carries "${name}"`);
  return found;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

/** Render a sheet holding only innates, and open the row named. */
async function openInnate(innate: UsableAbility[], name: string, rec?: CharacterRecord) {
  await act(async () =>
    root.render(
      <NetProvider>
        <ActionsTable
          weapons={[]}
          genus={[]}
          ciphers={[]}
          innate={innate}
          atk={0}
          phyMod={0}
          dexMod={0}
          // The VTT's own stats builder, so a Roll Axis chip the sheet draws is
          // keyed off the same numbers the VTT would key it off.
          rollAxisStats={rec ? characterRollAxisStats(rec) : undefined}
          onRoll={vi.fn()}
          onSpend={vi.fn()}
          ssLeft={99}
          onManage={vi.fn()}
        />
      </NetProvider>
    )
  );
  const row = [...host.querySelectorAll<HTMLButtonElement>("button.act-row")].find(
    (r) => r.querySelector(".act-title")?.textContent === name
  );
  if (!row) throw new Error(`The Actions table never rendered an innate row for "${name}"`);
  await act(async () => row.click());
  return row;
}

const texts = (selector: string) => [...host.querySelectorAll(selector)].map((el) => el.textContent?.trim() ?? "");

describe("an innate whose page names a check the character makes", () => {
  it("arms it, instead of printing the sentence that describes it", async () => {
    // Oriyu · Vesul Exovertntiu — "opposed Control + Inspiration check".
    await openInnate([one("oriyu", undefined, "Vesul Exovertntiu")], "Vesul Exovertntiu");
    expect(texts(".roll-btn")).toEqual(["Control check"]);
  });
});

describe("an innate that deals damage", () => {
  it("offers the dice and the save its target answers with", async () => {
    // SubDermin · Forsaken Touch — "Damage: 1d10 Entropy … Resolution: Endurance save, half".
    // Its page now DECLARES that resolution, so the chip reads the Roll Axis
    // route the block names rather than the words the prose parser lifted; the
    // "half" the prose promised rides the declared step, which is the half the
    // sentence used to lose entirely.
    await openInnate([one("subdermin", undefined, "Forsaken Touch")], "Forsaken Touch");
    expect(texts(".roll-btn.dmg")).toEqual(["1d10 Entropy"]);
    expect(texts(".act-save-chip")).toEqual(["vs Physical Save — Recovery"]);
  });
});

describe("an innate whose only resolution is the target's", () => {
  it("shows the save and arms nothing — the sheet has no target to ask", async () => {
    // Oriyu · Qerran · Interitus — "unwilling creatures make a Physical Save —
    // Recovery". The exemplar used to be Primed Instinct, which is the opposite
    // case and was the bug: that page gives the VENARIAN the Mental Save —
    // Perception, and the parser handed it to the target. Primed Instinct now
    // declares `Save (self)` and so belongs under the heading below, not here.
    await openInnate([one("oriyu", "Qerran", "Interitus")], "Interitus");
    expect(texts(".act-save-chip")).toEqual(["vs Physical Save — Recovery"]);
    expect(texts(".roll-btn")).toEqual([]);
  });
});

describe("an innate whose resolution the CHARACTER makes", () => {
  it.each([
    ["insectoid", "Venarian", "Primed Instinct", "Mental Save — Perception (self)"],
    ["hyomen", "Spatians", "Space Modulation", "Physical Check — Density"],
    ["inderi", "AI'N", "Dilation", "Physical Check — Density"],
  ])("%s/%s — %s arms the roll rather than a chip aimed at nobody", async (species, variant, name, label) => {
    // The wrong-side class. Each of these pages gives the roll to the character
    // — "they may make a Mental Save — Perception", "on an AP Check failure" —
    // and the prose parser handed it to the target as a "vs" chip. A block whose
    // only line was a Ruling did not fix that: a Ruling arms nothing, so the
    // roll left the sheet entirely instead of changing sides. These assert the
    // button is BACK, and on the character.
    await openInnate([one(species, variant, name)], name);
    expect(texts(".roll-btn")).toEqual([label]);
    expect(texts(".act-save-chip")).toEqual([]);
  });
});

describe("a passive innate", () => {
  const passives: [string, string | undefined, string][] = [
    ["subdermin", undefined, "Radioactive Anatomy"],
    ["insectoid", undefined, "Eyeless"],
    ["voaulton", undefined, "Robotic Integration"],
  ];

  it.each(passives)("%s/%s — %s draws no roll at all", async (species, variant, name) => {
    // "Always · Automatic" is a rule, and a d20 offered beside it is this app
    // inventing a resolution the species page declined to write.
    const row = await openInnate([one(species, variant, name)], name);
    expect(texts(".roll-btn")).toEqual([]);
    expect(texts(".act-save-chip")).toEqual([]);
    expect(row.querySelector(".act-sub")?.textContent).toBe("Innate · Passive");
    expect(host.querySelector(".act-passive")).not.toBeNull();
  });

  it("does not mark a rollable innate passive", async () => {
    const row = await openInnate([one("subdermin", undefined, "Forsaken Touch")], "Forsaken Touch");
    expect(row.querySelector(".act-sub")?.textContent).toBe("Innate");
    expect(host.querySelector(".act-passive")).toBeNull();
  });

  it("says so on the CLOSED row, and says the same thing once it is open", async () => {
    // The row is read whether or not it is open purely so this line is right
    // before anyone clicks. Every other assertion in this file opens the row
    // first, which would keep passing if that early read were removed.
    //
    // Thi Voth is the row that proves the early read is load-bearing: its
    // header says "Resolution: Automatic" AND its prose deals 1d40 Spirit, so a
    // row that judged it on the header alone would label it a passive while
    // closed and stop the moment a player opened it — the label flickering on
    // click, which is how a reader learns not to trust it.
    await act(async () =>
      root.render(
        <NetProvider>
          <ActionsTable
            weapons={[]}
            genus={[]}
            ciphers={[]}
            innate={[
              one("subdermin", undefined, "Radioactive Anatomy"),
              one("subdermin", undefined, "Forsaken Touch"),
              one("seraph", undefined, "Thi Voth"),
            ]}
            atk={0}
            phyMod={0}
            dexMod={0}
            onRoll={vi.fn()}
            onSpend={vi.fn()}
            ssLeft={99}
            onManage={vi.fn()}
          />
        </NetProvider>
      )
    );
    expect(host.querySelector(".act-row-wrap.open")).toBeNull();
    expect(texts(".act-sub")).toEqual(["Innate · Passive", "Innate", "Innate"]);

    const thiVoth = [...host.querySelectorAll<HTMLButtonElement>("button.act-row")].find(
      (r) => r.querySelector(".act-title")?.textContent === "Thi Voth"
    )!;
    await act(async () => thiVoth.click());
    expect(texts(".act-sub")).toEqual(["Innate · Passive", "Innate", "Innate"]);
    expect(texts(".roll-btn.dmg")).toEqual(["1d40 Spirit"]);
    expect(host.querySelector(".act-passive")).toBeNull();
  });

  it("never calls a genus or a cipher passive", async () => {
    // `passive` is gated on the row's CATEGORY as well as on what was read.
    // Without that gate every closed genus row would claim to be a passive,
    // because a closed non-innate row is deliberately never read at all.
    //
    // "Always · Automatic" prose is used deliberately: with the gate gone, this
    // genus reads as a passive on both counts, which is the exact shape of the
    // bug. A genus is never a passive — an unreadable one falls back to a d20,
    // and both of those things cannot be true of one row.
    const lark: UsableAbility = {
      source: "genus",
      name: "Lark",
      ss: 5,
      effect: "Passive (Self) · Always · Automatic. It simply happens.",
    };
    await act(async () =>
      root.render(
        <NetProvider>
          <ActionsTable
            weapons={[]}
            genus={[lark]}
            ciphers={[{ ...lark, source: "cipher", name: "Weft" }]}
            innate={[]}
            atk={0}
            phyMod={0}
            dexMod={0}
            onRoll={vi.fn()}
            onSpend={vi.fn()}
            ssLeft={99}
            onManage={vi.fn()}
          />
        </NetProvider>
      )
    );
    expect(texts(".act-sub")).toEqual(["Genus", "Cipher"]);
    await act(async () => host.querySelector<HTMLButtonElement>("button.act-row")!.click());
    expect(texts(".act-sub")).toEqual(["Genus", "Cipher"]);
    expect(host.querySelector(".act-passive")).toBeNull();
    expect(texts(".roll-btn")).toEqual(["Roll d20"]);
  });
});

describe("an innate the sheet could not read, whose page names a roll anyway", () => {
  // The defect this block exists for: a caption is a CLAIM. "Passive — this
  // feature states no roll" beside Radiant Cascade, whose own header reads
  // "Resolution: END Check or Disadvantage on next roll", is this app writing a
  // rule the Oriyu page contradicts — and it is invisible, because the row that
  // says it looks exactly like the forty-two rows that say it truthfully.
  const unread: [string, string | undefined, string][] = [
    ["oriyu", "Radiant", "Radiant Cascade"],
    ["stygians", "Xeno", "Freakish Nature"],
    ["stygians", "Annunaki", "Melam Manifestation"],
    ["inderi", "AI'N", "Replication"],
    ["voaulton", "Re-Varant", "Resurrection"],
    ["voaulton", "Re-Varant", "Phylaction"],
  ];

  it.each(unread)("%s/%s — %s is never captioned as stating no roll", async (species, variant, name) => {
    const row = await openInnate([one(species, variant, name)], name);
    expect(row.querySelector(".act-sub")?.textContent).toBe("Innate");
    expect(host.querySelector(".act-passive")?.textContent).toBe(
      "No roll this sheet can arm — this feature's resolution is in its text above."
    );
    // Still no invented die: saying nothing was read is not licence to roll.
    expect(texts(".roll-btn")).toEqual([]);
  });

  it("says nothing at all where a page's own header declares it automatic", async () => {
    const row = await openInnate([one("subdermin", undefined, "Radioactive Anatomy")], "Radioactive Anatomy");
    expect(row.querySelector(".act-sub")?.textContent).toBe("Innate · Passive");
    expect(host.querySelector(".act-passive")?.textContent).toBe("Passive — this feature states no roll.");
  });
});

// The corpus guard. Every innate and variant ability of every species, checked
// against the one rule this feature must never break: the sheet may caption a
// feature "states no roll" only where the feature's own page said so.
describe("across the whole species corpus", () => {
  it("captions no feature as rollless unless its own page declares it", () => {
    const catalog = officialAbilityCatalog();
    const liars: string[] = [];
    for (const species of SPECIES) {
      for (const variant of [undefined, ...species.variants.map((v) => v.name)]) {
        for (const a of usableRacial(species.id, variant)) {
          // The row captions a feature "states no roll" only when the reader
          // found nothing AND the page declares it. The oracle below is
          // independent of both: the page's own declaration line, read for the
          // very words such a caption would have to be lying about.
          const captioned =
            abilityUnderstanding(a.effect, a.actions, catalog).actions.length === 0 && declaresNoRoll(a.effect);
          const namesARoll = /Check|Save|contest/i.test((a.effect ?? "").split(/\.\s/)[0]);
          if (captioned && namesARoll) liars.push(`${species.id}/${variant ?? "-"} :: ${a.name}`);
        }
      }
    }
    expect(liars).toEqual([]);
  });

  it("still recognises the passives, or the caption would be worth nothing", () => {
    // A predicate that answered false for everything would pass the guard above
    // and delete the feature. Most of the corpus IS automatic, and must read so.
    const catalog = officialAbilityCatalog();
    let captioned = 0;
    for (const species of SPECIES) {
      for (const a of usableRacial(species.id)) {
        if (abilityUnderstanding(a.effect, a.actions, catalog).actions.length === 0 && declaresNoRoll(a.effect)) captioned++;
      }
    }
    expect(captioned).toBeGreaterThanOrEqual(9);
  });
});

describe("a variant ability — SubDermin/Salaris, Iudicius", () => {
  const rec = record("subdermin", "Salaris");

  it("arms the character's own checks through the Roll Axis pipeline", async () => {
    await openInnate(sheetInnate(rec), "Iudicius", rec);
    // The page's own words: "Make a Mental Check — Capacity (Intelligence)".
    // Asserted by containment, not as the whole list: this ability also renders
    // a `Physical Check — Power` group that the shared prose parser reads off
    // its Resolution header with no subject named, and pinning the exact array
    // here would make correcting that side a failure of the sheet's wiring.
    expect(texts(".act-axis-label")).toContain("Mental Check — Capacity");
    expect(host.querySelectorAll(".roll-btn.axis").length).toBeGreaterThan(0);
  });

  it("keys the target's save DV to this character rather than reprinting the page's", async () => {
    await openInnate(sheetInnate(rec), "Iudicius", rec);
    // 21 + this character's Capacity check modifier, not the page's printed DV.
    expect(texts(".act-save-chip")).toContain("vs Physical Save — Evasion · DV 27");
  });
});

describe("an innate whose self roll and target roll share a label", () => {
  it("still tells them apart — Hyomen, Peak Evolution", async () => {
    // Both halves are real: "Upon failing an Adaption check, you may force an
    // automatic success" is the character's, "force one creature in your
    // vicinity to make the identical Adaption check" is the target's. Two
    // buttons reading "Adaption check" would be unusable; the target's side is
    // a chip that says "vs", and only the character's side is armed.
    await openInnate([one("hyomen", undefined, "Peak Evolution")], "Peak Evolution");
    expect(texts(".roll-btn")).toEqual(["Adaption check"]);
    expect(texts(".act-save-chip")).toEqual(["vs Adaption check"]);
  });
});

describe("what an innate costs", () => {
  async function renderInnate(innate: UsableAbility[], onSpend: (n: number) => void) {
    await act(async () =>
      root.render(
        <NetProvider>
          <ActionsTable
            weapons={[]}
            genus={[]}
            ciphers={[]}
            innate={innate}
            atk={0}
            phyMod={0}
            dexMod={0}
            onRoll={vi.fn()}
            onSpend={onSpend}
            ssLeft={99}
            onManage={vi.fn()}
          />
        </NetProvider>
      )
    );
  }
  const useButton = () =>
    [...host.querySelectorAll<HTMLButtonElement>(".act-actions button.ghost-btn")].find((b) =>
      /^Use /.test(b.textContent ?? "")
    );

  it("prints no price and offers no spend for a feature that names none", async () => {
    // `usableRacial` gives every row `ss: 0`. A "0 SS" price — or a Use button
    // that called onSpend(0) — would state a rule no species page writes.
    const onSpend = vi.fn();
    await renderInnate([one("subdermin", undefined, "Forsaken Touch")], onSpend);
    expect(texts(".act-cost")).toEqual(["—"]);
    await act(async () => host.querySelector<HTMLButtonElement>("button.act-row")!.click());
    expect(useButton()).toBeUndefined();
    expect(onSpend).not.toHaveBeenCalled();
  });

  it("honours a price an innate's own Actions block declares", async () => {
    // Nothing in the shipped corpus prices an innate, but the substrate lets a
    // page do it — and a declared price must reach the button rather than be
    // swallowed by "innates are free".
    const onSpend = vi.fn();
    await renderInnate([{ ...one("subdermin", undefined, "Forsaken Touch"), actions: "- Cost: 3 SS" }], onSpend);
    await act(async () => host.querySelector<HTMLButtonElement>("button.act-row")!.click());
    expect(useButton()?.textContent).toBe("Use −3 SS");
    await act(async () => useButton()!.click());
    expect(onSpend).toHaveBeenCalledWith(3);
  });
});

describe("the Innate filter", () => {
  it("narrows the table to species features", async () => {
    await openInnate(sheetInnate(record("subdermin", "Salaris")), "Iudicius");
    const chip = [...host.querySelectorAll<HTMLButtonElement>(".act-toolbar .chip")].find((c) => c.textContent === "Innate");
    expect(chip).toBeDefined();
    await act(async () => chip!.click());
    expect(texts(".act-sub").length).toBeGreaterThan(0);
    expect(texts(".act-sub").every((t) => t.startsWith("Innate"))).toBe(true);
  });

  it("holds up for a character with no species at all", async () => {
    // `usableRacial(undefined)` is empty, and every caller that predates this
    // feature passes no `innate` prop whatsoever. Neither may become a crash or
    // a row: a half-built character still has to open their Actions tab.
    expect(usableRacial(undefined)).toEqual([]);
    await act(async () =>
      root.render(
        <NetProvider>
          <ActionsTable
            weapons={[]}
            genus={[]}
            ciphers={[]}
            atk={0}
            phyMod={0}
            dexMod={0}
            onRoll={vi.fn()}
            onSpend={vi.fn()}
            ssLeft={0}
            onManage={vi.fn()}
          />
        </NetProvider>
      )
    );
    const chip = [...host.querySelectorAll<HTMLButtonElement>(".act-toolbar .chip")].find((c) => c.textContent === "Innate")!;
    await act(async () => chip.click());
    expect(host.querySelectorAll(".act-row").length).toBe(0);
    expect(host.querySelector(".list-empty")).not.toBeNull();
  });
});

// Parity, PROVEN rather than asserted.
//
// The cheap version of this test reads `usableRacial` twice and compares the
// result to itself: it passes the day someone rewrites how the sheet DRAWS an
// innate, which is the drift anyone would actually care about. So this renders
// both surfaces — the sheet's Actions table and the VTT's abilities dock — and
// compares what each one puts in front of a player for the same feature.
//
// One difference is known and deliberate, and is NOT asserted here: a feature
// neither surface could read a roll out of still gets a "Use" chip in the dock,
// where this sheet shows none. See the passive block above for why the sheet
// declines. Everything that resolves to real dice or a real target save must
// match exactly, and that is what follows.
describe("sheet and VTT put the same things in front of a player", () => {
  const cases: [string, string | undefined][] = [
    ["subdermin", "Salaris"],
    ["oriyu", undefined],
    ["insectoid", "Venarian"],
    ["seraph", undefined],
    ["hyomen", "Spatians"],
    ["voaulton", "Droid"],
    ["mirga", "Scnial"],
    ["inderi", "Aeor"],
    ["stygians", "Annunaki"],
  ];

  /** Every innate row of the sheet's table, opened, keyed by ability name. */
  async function fromSheet(rec: CharacterRecord) {
    const innate = sheetInnate(rec);
    await act(async () =>
      root.render(
        <NetProvider>
          <ActionsTable
            weapons={[]}
            genus={[]}
            ciphers={[]}
            innate={innate}
            atk={0}
            phyMod={0}
            dexMod={0}
            rollAxisStats={characterRollAxisStats(rec)}
            onRoll={vi.fn()}
            onSpend={vi.fn()}
            ssLeft={99}
            onManage={vi.fn()}
          />
        </NetProvider>
      )
    );
    const drawn: Record<string, { damage: string[]; saves: string[] }> = {};
    for (const a of innate) {
      const row = [...host.querySelectorAll<HTMLButtonElement>("button.act-row")].find(
        (r) => r.querySelector(".act-title")?.textContent === a.name
      );
      if (!row) throw new Error(`the sheet drew no row for "${a.name}"`);
      await act(async () => row.click());
      const wrap = row.parentElement!;
      drawn[a.name] = {
        damage: [...wrap.querySelectorAll(".roll-btn.dmg")].map((el) => el.textContent ?? ""),
        saves: [...wrap.querySelectorAll(".act-save-chip")].map((el) => el.textContent ?? ""),
      };
      await act(async () => row.click());
    }
    return drawn;
  }

  /** The same features from the dock, which shows them one at a time behind a
   *  select — so the select is stepped, exactly as a Curator would. */
  async function fromVtt(rec: CharacterRecord) {
    await act(async () =>
      root.render(
        <VttAbilitiesPanel
          character={rec}
          characters={[{ id: rec.id, name: rec.name }]}
          onPickCharacter={() => {}}
          onArmRoll={() => {}}
          onUseAbility={() => {}}
          onClose={() => {}}
        />
      )
    );
    const select = host.querySelector<HTMLSelectElement>(".vtt2-abil-racial select");
    if (!select) throw new Error("the dock drew no racial picker");
    const drawn: Record<string, { damage: string[]; saves: string[] }> = {};
    for (const option of [...select.options]) {
      await act(async () => {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const card = host.querySelector<HTMLLIElement>("li.vtt2-abil-card");
      if (!card) throw new Error(`the dock drew no card for "${option.textContent}"`);
      drawn[option.textContent ?? ""] = {
        // The dock arms damage as a chip labelled with the same action label
        // the sheet puts on its damage button.
        damage: [...card.querySelectorAll(".vtt2-abil-arm .vtt2-abil-armsrc")]
          .map((el) => el.textContent ?? "")
          .filter((label) => /\d*d\d+|Heal/.test(label)),
        saves: [...card.querySelectorAll(".vtt2-abil-savechip")].map((el) => el.textContent ?? ""),
      };
    }
    return drawn;
  }

  it.each(cases)("%s/%s", async (speciesId, variantName) => {
    const rec = record(speciesId, variantName);
    const sheet = await fromSheet(rec);
    const dock = await fromVtt(rec);
    // Same features, same order, on both surfaces.
    expect(Object.keys(sheet)).toEqual(Object.keys(dock));
    expect(Object.keys(sheet).length).toBeGreaterThan(0);
    for (const name of Object.keys(sheet)) {
      // Dice: the same expressions, or one surface is rolling something the
      // other never offered.
      expect(sheet[name].damage, `${name} damage`).toEqual(dock[name].damage);
      // Target-side saves, DV included: the two surfaces key the DV off the same
      // character, so a mismatch means a table got two numbers for one roll.
      expect(sheet[name].saves, `${name} saves`).toEqual(dock[name].saves);
    }
  });

  it.each(cases)("%s/%s reads one understanding, not two", (speciesId, variantName) => {
    // The data leg, kept because it localises a drift the render comparison can
    // only report as "these two rows look different".
    const catalog = officialAbilityCatalog();
    const rec = record(speciesId, variantName);
    const sheetRows = sheetInnate(rec);
    const vttRows = characterActionSet(rec).racial;
    expect(sheetRows.length).toBeGreaterThan(0);
    expect(sheetRows.map((a) => a.name)).toEqual(vttRows.map((a) => a.name));
    for (const [i, a] of sheetRows.entries()) {
      expect(abilityUnderstanding(a.effect, a.actions, catalog).actions).toEqual(
        abilityUnderstanding(vttRows[i].effect, vttRows[i].actions, catalog).actions
      );
    }
  });
});
