/**
 * Accessory registry content tests (round 2D item 3): a real, non-trivial
 * pool; the "none" sentinel never collides with a real id; the roll pool's
 * weighting matches the module doc's documented 40%; `resolveAccessory`
 * collapses every "bare" spelling to `null` and every real id to its def.
 */

import { describe, expect, it } from "vitest";
import {
  ACCESSORY_IDS,
  ACCESSORY_ROLL_POOL,
  NO_ACCESSORY_ID,
  NO_ACCESSORY_WEIGHT,
  accessories,
  resolveAccessory,
} from "./accessories";
import { species } from "./species";

describe("accessory registry — round 2D item 3", () => {
  it("has more than a handful of accessories (leaf cap, scarf, flower, shell pauldron, lantern, and more)", () => {
    expect(ACCESSORY_IDS.length).toBeGreaterThanOrEqual(10);
  });

  it("ACCESSORY_IDS and the registry agree exactly", () => {
    expect(new Set(ACCESSORY_IDS)).toEqual(new Set(Object.keys(accessories)));
    expect(ACCESSORY_IDS.length).toBe(Object.keys(accessories).length);
  });

  it("has no duplicate ids", () => {
    expect(new Set(ACCESSORY_IDS).size).toBe(ACCESSORY_IDS.length);
  });

  it("every def's own id matches its registry key", () => {
    for (const [key, def] of Object.entries(accessories)) {
      expect(def.id).toBe(key);
    }
  });

  it("every accessory has a non-empty name and a valid-looking hex primary color", () => {
    for (const def of Object.values(accessories)) {
      expect(def.name.trim().length).toBeGreaterThan(0);
      expect(def.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      if (def.secondaryColor !== undefined) {
        expect(def.secondaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("speciesAffinity ids, where present, are real species", () => {
    for (const def of Object.values(accessories)) {
      for (const speciesId of def.speciesAffinity ?? []) {
        expect(species[speciesId], `${def.id} names unknown species "${speciesId}"`).toBeDefined();
      }
    }
  });

  it('"none" is never a real accessory id (the sentinel must stay reserved)', () => {
    expect(ACCESSORY_IDS).not.toContain(NO_ACCESSORY_ID);
    expect(accessories[NO_ACCESSORY_ID as keyof typeof accessories]).toBeUndefined();
  });

  it("the roll pool is exactly NO_ACCESSORY_WEIGHT nones plus one of each real id", () => {
    const nones = ACCESSORY_ROLL_POOL.filter((id) => id === NO_ACCESSORY_ID);
    expect(nones.length).toBe(NO_ACCESSORY_WEIGHT);
    expect(ACCESSORY_ROLL_POOL.length).toBe(NO_ACCESSORY_WEIGHT + ACCESSORY_IDS.length);
    for (const id of ACCESSORY_IDS) {
      expect(ACCESSORY_ROLL_POOL.filter((x) => x === id).length).toBe(1);
    }
  });

  it("documents a deliberate 'bare Pip' rate: common, but no longer the norm", () => {
    // ROUND 2D FIX STAGE — retuned from 40% to 25% (see NO_ACCESSORY_
    // WEIGHT's own doc). The band is asserted, not the exact number, so
    // adding accessories to the registry doesn't force a test edit; the
    // FLOOR is what matters (a bare Pip must stay completely normal —
    // it is still the single most likely outcome by a factor of three)
    // and so does the CEILING (the round exists because Pips were
    // interchangeable; accessories cannot be the rarest of the four
    // identity signals).
    const bareRate = NO_ACCESSORY_WEIGHT / ACCESSORY_ROLL_POOL.length;
    expect(bareRate).toBeGreaterThanOrEqual(0.15);
    expect(bareRate).toBeLessThanOrEqual(0.35);
    // …and still more likely than any single accessory.
    const oneAccessoryRate = 1 / ACCESSORY_ROLL_POOL.length;
    expect(bareRate).toBeGreaterThan(oneAccessoryRate);
  });
});

describe("resolveAccessory — every 'bare' spelling collapses to null", () => {
  it("undefined (never rolled) resolves to null", () => {
    expect(resolveAccessory(undefined)).toBeNull();
  });

  it("null (rolled against an empty pool) resolves to null", () => {
    expect(resolveAccessory(null)).toBeNull();
  });

  it('"none" (rolled against the real pool, came up bare) resolves to null', () => {
    expect(resolveAccessory(NO_ACCESSORY_ID)).toBeNull();
  });

  it("an unrecognized id resolves to null rather than throwing (defensive, matches resolvePipPalette)", () => {
    expect(resolveAccessory("not-a-real-accessory")).toBeNull();
  });

  it("every real id resolves to its own def", () => {
    for (const id of ACCESSORY_IDS) {
      expect(resolveAccessory(id)?.id).toBe(id);
    }
  });
});
