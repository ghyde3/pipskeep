/**
 * Economy tests (spec §6.3): canAfford / spend over resource bundles.
 * Spend is exact, all-or-nothing, typed on refusal, and can never
 * produce a negative balance.
 */

import { describe, expect, it } from "vitest";
import { canAfford, spend } from "./index";

describe("canAfford", () => {
  it("checks every entry of the bundle against the balances", () => {
    expect(canAfford({ wood: 15, fiber: 10 }, { wood: 15, fiber: 10 })).toBe(true);
    expect(canAfford({ wood: 20, fiber: 20 }, { wood: 15, fiber: 10 })).toBe(true);
    expect(canAfford({ wood: 14, fiber: 10 }, { wood: 15, fiber: 10 })).toBe(false);
    expect(canAfford({ wood: 15 }, { wood: 15, fiber: 1 })).toBe(false);
  });

  it("treats an empty bundle as free and missing balances as zero", () => {
    expect(canAfford({}, {})).toBe(true);
    expect(canAfford({}, { wood: 1 })).toBe(false);
    expect(canAfford({}, { wood: 0 })).toBe(true);
  });
});

describe("spend", () => {
  it("deducts the bundle EXACTLY and leaves other resources alone", () => {
    const result = spend({ wood: 20, fiber: 15, berry: 3 }, { wood: 15, fiber: 10 });
    expect(result).toEqual({
      ok: true,
      resources: { wood: 5, fiber: 5, berry: 3 },
    });
  });

  it("is all-or-nothing with a typed per-resource shortfall", () => {
    const before = { wood: 10, shell: 12 };
    const result = spend(before, { wood: 20, shell: 12, driftwood: 6 });
    expect(result).toEqual({
      ok: false,
      missing: { wood: 10, driftwood: 6 },
    });
    // Nothing was deducted and the input record was not mutated.
    expect(before).toEqual({ wood: 10, shell: 12 });
  });

  it("never goes negative: an exact spend lands on 0, not below", () => {
    const result = spend({ wood: 15, fiber: 10 }, { wood: 15, fiber: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resources).toEqual({ wood: 0, fiber: 0 });
    expect(Object.values(result.resources).every((n) => n >= 0)).toBe(true);
  });

  it("ignores zero-amount entries and never mutates the input", () => {
    const before = { wood: 5 };
    const result = spend(before, { wood: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resources).toEqual({ wood: 5 });
    expect(before).toEqual({ wood: 5 });
  });
});
