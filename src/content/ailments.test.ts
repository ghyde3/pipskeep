/**
 * Ailment registry shape guard (docs/lifecycle-bible.md §3), the content-
 * side sibling of `expeditions.test.ts`/`foods.test.ts`: pins the AUTHORED
 * numbers (names, flavor, countdowns, incidence) against the bible's own
 * table, independent of `core/pips/ailment.test.ts` and
 * `core/state.ailments.test.ts` (which exercise the real registry through
 * the mechanic, not its own shape). `content/validate.test.ts` covers the
 * cross-registry INVARIANTS (cure item exists, countdown exceeds the
 * offline cap, biome danger agrees with `riskCopy`); this file is the
 * plain "did we author what the bible says" pin.
 */

import { describe, expect, it } from "vitest";
import { AILMENT_IDS, ailments, POULTICE_ITEM_ID } from "./ailments";
import { expeditions, RISKY_TRAIL_COPY, SAFE_TRAIL_COPY } from "./expeditions";
import { foods } from "./foods";
import { tuning, HOUR_MS } from "./tuning";

describe("ailment registry shape (bible §3.2)", () => {
  it("ships exactly the three ailments the bible names", () => {
    expect([...AILMENT_IDS].sort()).toEqual(
      ["brambleburr", "chillshake", "lanternfever"].sort(),
    );
    expect(Object.keys(ailments).sort()).toEqual([...AILMENT_IDS].sort());
  });

  it("every registry entry's id matches its own key (no copy-paste id drift)", () => {
    for (const [key, def] of Object.entries(ailments)) {
      expect(def.id, key).toBe(key);
    }
  });

  it("each ailment is bound to exactly one deep trail, and only a deep trail (bible §3.2 table)", () => {
    const EXPECTED: Readonly<Record<(typeof AILMENT_IDS)[number], string>> = {
      brambleburr: "bramblewick",
      chillshake: "snowdrift",
      lanternfever: "lanterngrotto",
    };
    for (const id of AILMENT_IDS) {
      expect(ailments[id].fromExpeditionId, id).toBe(EXPECTED[id]);
    }
  });

  it("countdown lengths (rated ms) match the bible's table exactly: 48h / 42h / 36h", () => {
    expect(ailments.brambleburr.totalMs).toBe(48 * HOUR_MS);
    expect(ailments.chillshake.totalMs).toBe(42 * HOUR_MS);
    expect(ailments.lanternfever.totalMs).toBe(36 * HOUR_MS);
  });

  it("every countdown exceeds offlineRateCapMs — promise 2's inequality, restated per-ailment", () => {
    for (const id of AILMENT_IDS) {
      expect(ailments[id].totalMs, id).toBeGreaterThan(tuning.offlineRateCapMs);
    }
  });

  it("Lanternfever is exactly the shipped minimum (36h = tuning.lifecycle.ailments.minDurationMs)", () => {
    expect(ailments.lanternfever.totalMs).toBe(tuning.lifecycle.ailments.minDurationMs);
  });

  it("per-biome incidence matches the bible's table: 5% / 7% / 10%, rising with risk", () => {
    expect(ailments.brambleburr.contractChance).toBeCloseTo(0.05, 5);
    expect(ailments.chillshake.contractChance).toBeCloseTo(0.07, 5);
    expect(ailments.lanternfever.contractChance).toBeCloseTo(0.1, 5);
    // The riskiest trail (Lanterngrotto, the top of the ladder) carries the
    // highest incidence — the danger scales with how deep the player goes.
    expect(ailments.lanternfever.contractChance).toBeGreaterThan(
      ailments.chillshake.contractChance,
    );
    expect(ailments.chillshake.contractChance).toBeGreaterThan(
      ailments.brambleburr.contractChance,
    );
  });

  it("every ailment carries real, warm flavor text — a worry, not a horror (spec §15.5)", () => {
    // Tone guard: cozy-world words, never clinical/horror ones (bible's own
    // "an ailing Pip is a worry, not a horror" instruction).
    const FORBIDDEN_WORDS = [
      "die",
      "death",
      "dead",
      "kill",
      "disease",
      "infect",
      "symptom",
      "terminal",
      "fatal",
    ];
    for (const id of AILMENT_IDS) {
      const flavor = ailments[id].flavor;
      expect(flavor.trim().length, id).toBeGreaterThan(10);
      const lower = flavor.toLowerCase();
      for (const word of FORBIDDEN_WORDS) {
        expect(lower.includes(word), `${id}: "${flavor}" contains "${word}"`).toBe(false);
      }
    }
  });

  it("names read cozy-world, not clinical (spec §0 vocabulary discipline)", () => {
    expect(ailments.brambleburr.name).toBe("Brambleburr");
    expect(ailments.chillshake.name).toBe("Chillshake");
    expect(ailments.lanternfever.name).toBe("Lanternfever");
  });
});

describe("the cure item (bible §3.5)", () => {
  it("POULTICE_ITEM_ID resolves to a real, registered item", () => {
    expect(POULTICE_ITEM_ID).toBe("poultice");
    expect(foods[POULTICE_ITEM_ID]).toBeDefined();
  });

  it("the Poultice is findable: it drops (weight 4) on all three deep trails it can cure", () => {
    for (const id of AILMENT_IDS) {
      const expeditionId = ailments[id].fromExpeditionId as keyof typeof expeditions;
      const entry = expeditions[expeditionId]!.lootTable.find(
        (row: { itemId: string }) => row.itemId === POULTICE_ITEM_ID,
      );
      expect(entry, `${expeditionId} loot table`).toBeDefined();
      expect(entry!.weight).toBe(4);
    }
  });
});

describe("biome danger agrees with the ailment pool (bible §7.1, restated per-expedition)", () => {
  it("every dangerous biome's own ailment references it back (fromExpeditionId round-trips)", () => {
    const dangerousIds = new Set(Object.values(ailments).map((a) => a.fromExpeditionId));
    for (const id of dangerousIds) {
      const expeditionId = id as keyof typeof expeditions;
      expect(expeditions[expeditionId], id).toBeDefined();
      expect(expeditions[expeditionId]!.riskCopy).toBe(RISKY_TRAIL_COPY);
    }
  });

  it("the first two biomes (Meadow, Forest) are SAFE — the anti-brutality rule", () => {
    expect(expeditions.meadow.riskCopy).toBe(SAFE_TRAIL_COPY);
    expect(expeditions.forest.riskCopy).toBe(SAFE_TRAIL_COPY);
  });

  it("every quick trip (Meadow, Forest, Shore) is safe; every deep trip carries risk", () => {
    expect(expeditions.meadow.riskCopy).toBe(SAFE_TRAIL_COPY);
    expect(expeditions.forest.riskCopy).toBe(SAFE_TRAIL_COPY);
    expect(expeditions.shore.riskCopy).toBe(SAFE_TRAIL_COPY);
    expect(expeditions.bramblewick.riskCopy).toBe(RISKY_TRAIL_COPY);
    expect(expeditions.snowdrift.riskCopy).toBe(RISKY_TRAIL_COPY);
    expect(expeditions.lanterngrotto.riskCopy).toBe(RISKY_TRAIL_COPY);
  });
});
