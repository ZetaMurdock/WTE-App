// @vitest-environment happy-dom
//
// The WIRE, tested through the real sheet.
//
// `ActionsTable` can grow a perfect innate row and a character still see none
// of it, because whether the sheet HANDS it that list is one prop in one line
// of CharacterSheet. Every other test in this feature renders the table
// directly and passes `innate` itself, so deleting `innate={racial}` from the
// sheet leaves the whole suite green and the feature gone. This file is the
// only thing standing between that edit and a release.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterRecord } from "../../lib/characters";
import { emptySheet } from "../../lib/sheetCodec";

/** A Salaris: four SubDermin innates plus the variant's own two abilities. */
const REC: CharacterRecord = {
  id: "wire-salaris",
  campaignId: "camp-1",
  name: "Ulis",
  createdAt: 1,
  updatedAt: 2,
  sheet: { ...emptySheet(), rank: 3, speciesId: "subdermin", variantName: "Salaris" },
};
/** The sheet reads its character from SQLite, which no test has. Only the read
 *  is replaced — everything the sheet then DOES with that record, including the
 *  `usableRacial` call this file exists to check, is the shipping code. */
vi.mock("../../lib/characters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/characters")>()),
  getCharacter: async () => REC,
  updateCharacter: async () => {},
}));

import { NetProvider } from "../../net/NetContext";
import { usableRacial } from "../../game/wte";
import { CharacterSheet } from "./CharacterSheet";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

async function openActionsTab() {
  await act(async () => {
    root.render(
      <NetProvider>
        <CharacterSheet characterId={REC.id} campaignId="camp-1" curator={false} onBack={() => {}} onChanged={() => {}} />
      </NetProvider>
    );
  });
  // The record arrives from an async read; the sheet renders a placeholder first.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const tab = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Actions");
  if (!tab) throw new Error("the sheet never rendered its Actions tab");
  await act(async () => tab.click());
}

const rowTitles = () => [...host.querySelectorAll(".act-title")].map((el) => el.textContent ?? "");

describe("the character sheet hands its innates to the Actions table", () => {
  it("lists every feature `usableRacial` returns for this character", async () => {
    await openActionsTab();
    const expected = usableRacial(REC.sheet.speciesId, REC.sheet.variantName).map((a) => a.name);
    expect(expected.length).toBeGreaterThan(0);
    for (const name of expected) expect(rowTitles()).toContain(name);
  });

  it("marks them as innates rather than as genus abilities", async () => {
    await openActionsTab();
    const subs = [...host.querySelectorAll(".act-sub")].map((el) => el.textContent ?? "");
    expect(subs.filter((s) => s.startsWith("Innate")).length).toBe(usableRacial("subdermin", "Salaris").length);
  });
});
