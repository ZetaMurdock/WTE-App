import { describe, expect, it } from "vitest";
import {
  BIO_LABEL_MAX,
  addBioField,
  moveBioField,
  numOf,
  parseBioFields,
  removeBioField,
  renameBioField,
  setBioValue,
  stepBioField,
} from "./bioFields";

describe("modular bio fields", () => {
  it("adds each kind with a sensible starting value", () => {
    let l = addBioField([], "Favourite food", "text");
    expect(l[0]).toMatchObject({ label: "Favourite food", value: "", kind: "text" });
    l = addBioField(l, "Age", "number");
    expect(l[1]).toMatchObject({ label: "Age", value: "0", kind: "number" });
    l = addBioField(l, "Times arrested", "counter");
    expect(l[2]).toMatchObject({ value: "0", kind: "counter" });
    expect(l).toHaveLength(3);
  });

  it("refuses a blank label and trims/caps a long one", () => {
    expect(addBioField([], "   ", "text")).toEqual([]);
    const long = addBioField([], "x".repeat(200), "text");
    expect(long[0].label).toHaveLength(BIO_LABEL_MAX);
    expect(addBioField([], "  Age  ", "number")[0].label).toBe("Age");
  });

  it("gives every field a distinct id", () => {
    let l = addBioField([], "A", "text");
    l = addBioField(l, "B", "text");
    expect(l[0].id).not.toBe(l[1].id);
  });

  it("sets, renames and removes", () => {
    let l = addBioField([], "Age", "number");
    const id = l[0].id;
    l = setBioValue(l, id, "34");
    expect(l[0].value).toBe("34");
    l = renameBioField(l, id, "Apparent age");
    expect(l[0].label).toBe("Apparent age");
    expect(renameBioField(l, id, "  ")[0].label).toBe("Apparent age"); // blank refused
    expect(removeBioField(l, id)).toEqual([]);
  });

  it("steps a counter, and lets it go negative — a debt is worth tracking", () => {
    let l = addBioField([], "Favours owed", "counter");
    const id = l[0].id;
    l = stepBioField(l, id, 1);
    l = stepBioField(l, id, 1);
    expect(numOf(l[0].value)).toBe(2);
    l = stepBioField(l, id, -5);
    expect(numOf(l[0].value)).toBe(-3);
  });

  it("never steps a text field", () => {
    const l = addBioField([], "Callsign", "text");
    expect(stepBioField(l, l[0].id, 1)[0].value).toBe("");
  });

  it("reorders, and clamps at the ends", () => {
    let l = addBioField(addBioField([], "A", "text"), "B", "text");
    const [a, b] = [l[0].id, l[1].id];
    l = moveBioField(l, b, -1);
    expect(l.map((f) => f.label)).toEqual(["B", "A"]);
    expect(moveBioField(l, l[0].id, -1)).toEqual(l); // already leftmost
    expect(moveBioField(l, l[1].id, 1)).toEqual(l); // already rightmost
    expect(moveBioField(l, "nope", 1)).toEqual(l);
    expect(a).not.toBe(b);
  });

  it("reads a hand-edited blob without throwing, dropping what makes no sense", () => {
    const parsed = parseBioFields([
      { label: "Age", value: 34, kind: "number" },
      { label: "", value: "x", kind: "text" }, // unlabelled -> dropped
      { label: "Bad kind", value: "7", kind: "nonsense" }, // -> text
      "not an object",
      null,
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ label: "Age", value: "34", kind: "number" });
    expect(parsed[1].kind).toBe("text");
    expect(parsed[0].id).toBeTruthy();
    expect(parseBioFields(null)).toEqual([]);
    expect(parseBioFields("nope")).toEqual([]);
  });

  it("coerces a non-numeric value on a number field to a number", () => {
    const parsed = parseBioFields([{ label: "Age", value: "thirty", kind: "number" }]);
    expect(parsed[0].value).toBe("0");
  });

  it("numOf survives junk", () => {
    expect(numOf("34")).toBe(34);
    expect(numOf("-3")).toBe(-3);
    expect(numOf("")).toBe(0);
    expect(numOf("abc")).toBe(0);
  });
});
