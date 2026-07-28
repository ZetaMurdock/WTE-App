import { describe, expect, it } from "vitest";
import { newNote } from "../models/note";
import { newSequence } from "../models/sequence";

// Notes and Sequences were global: `campaignId: null` was HARDCODED in both
// factories, so the campaign_id column was always NULL, and neither list query had
// a WHERE clause. Every campaign showed every other campaign's notes and Sequences,
// and archiving a campaign left them behind unreachable.
describe("a new note belongs to the campaign it was made in", () => {
  it("carries the campaign id it was given", () => {
    expect(newNote(null, null, "c-ashen").campaignId).toBe("c-ashen");
  });

  it("is unfiled when no campaign is active, rather than silently global", () => {
    expect(newNote(null, null).campaignId).toBeNull();
  });

  it("does not overwrite the id with a hardcoded null", () => {
    // The factory used to set campaignId: null AFTER everything else, which is why
    // passing one in would have had no effect.
    const n = newNote("Pressure_Engine", "a quote", "c-1");
    expect(n.campaignId).toBe("c-1");
    expect(n.attachedTo).toBe("Pressure_Engine");
    expect(n.quote).toBe("a quote");
  });
});

describe("a new Sequence belongs to the campaign it was made in", () => {
  it("carries the campaign id it was given", () => {
    expect(newSequence("Opening Moves", "c-ashen").campaignId).toBe("c-ashen");
  });

  it("is unfiled when no campaign is active", () => {
    expect(newSequence("Loose Sequence").campaignId).toBeNull();
  });

  it("keeps its other fields intact", () => {
    const s = newSequence("Titled", "c-2");
    expect(s.title).toBe("Titled");
    expect(s.campaignId).toBe("c-2");
    expect(s.scripts).toEqual([]);
  });
});
