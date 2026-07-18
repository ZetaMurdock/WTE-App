import { describe, expect, it } from "vitest";
import { ATTR_KEYS, SPEC_KEYS, computeDerived, type Attributes, type Specialties } from "./wte";

function attrs(v = 3): Attributes {
  return Object.fromEntries(ATTR_KEYS.map((k) => [k, v])) as Attributes;
}
function specs(v = 10): Specialties {
  return Object.fromEntries(SPEC_KEYS.map((k) => [k, v])) as Specialties;
}

describe("derived overrides", () => {
  it("replace the computed value outright, leaving the rest alone", () => {
    const base = computeDerived(attrs(), specs());
    const over = computeDerived(attrs(), specs(), { overrides: { atk: 99, hpMax: 123 } });
    expect(over.atk).toBe(99);
    expect(over.hpMax).toBe(123);
    expect(over.ev).toBe(base.ev);
    expect(over.ss).toBe(base.ss);
  });
  it("absent/invalid overrides change nothing", () => {
    const base = computeDerived(attrs(), specs());
    const over = computeDerived(attrs(), specs(), { overrides: { atk: NaN as unknown as number } });
    expect(over.atk).toBe(base.atk);
    expect(over.hpMax).toBe(base.hpMax);
  });
});
