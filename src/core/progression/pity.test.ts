import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../../content/tuning";
import { createRng } from "../rng";
import { rollGenome } from "../pips/genome";
import type { GenomeSpeciesRegistry } from "../pips/genome";
import {
  guaranteedDrawPool,
  isPityGuaranteed,
  pityThresholdFor,
  rarestTierInPool,
  updatePityCounter,
} from "./pity";
import type { PitySpeciesEntry } from "./pity";

const meadowPool: readonly PitySpeciesEntry[] = [
  { id: "mosspip", rarity: "common" },
  { id: "cloudpip", rarity: "uncommon" },
];

const bramblewickPool: readonly PitySpeciesEntry[] = [
  { id: "mosspip", rarity: "common" },
  { id: "pebblepip", rarity: "common" },
];

const grottoPool: readonly PitySpeciesEntry[] = [
  { id: "emberpip", rarity: "uncommon" },
  { id: "lanternpip", rarity: "rare" },
];

describe("rarestTierInPool", () => {
  it("picks the rarest tier present, not the first entry", () => {
    expect(rarestTierInPool(meadowPool)).toBe("uncommon");
    expect(rarestTierInPool(grottoPool)).toBe("rare");
  });

  it("a common-only pool's rarest tier is common", () => {
    expect(rarestTierInPool(bramblewickPool)).toBe("common");
  });

  it("empty pool is null (defensive)", () => {
    expect(rarestTierInPool([])).toBeNull();
  });
});

describe("pityThresholdFor — per the bible's table", () => {
  it("uncommon pools get threshold 8", () => {
    expect(pityThresholdFor(meadowPool, contentTuning)).toBe(8);
  });

  it("rare pools get threshold 6", () => {
    expect(pityThresholdFor(grottoPool, contentTuning)).toBe(6);
  });

  it("common-only pools get NO pity (null) — nothing rarer to chase", () => {
    expect(pityThresholdFor(bramblewickPool, contentTuning)).toBeNull();
  });
});

describe("updatePityCounter", () => {
  it("increments on a hatch that missed the rarest tier", () => {
    expect(updatePityCounter(3, "common", "uncommon")).toBe(4);
  });

  it("resets to 0 on a hatch that hit the rarest tier", () => {
    expect(updatePityCounter(7, "uncommon", "uncommon")).toBe(0);
  });

  it("never moves for a pool with no pity (rarestTier null)", () => {
    expect(updatePityCounter(5, "common", null)).toBe(5);
  });
});

describe("isPityGuaranteed — fires EXACTLY at the threshold, and resets after", () => {
  it("is false below the threshold, true at and above it", () => {
    const threshold = pityThresholdFor(meadowPool, contentTuning);
    expect(threshold).toBe(8);
    expect(isPityGuaranteed(7, threshold)).toBe(false);
    expect(isPityGuaranteed(8, threshold)).toBe(true);
    expect(isPityGuaranteed(9, threshold)).toBe(true);
  });

  it("simulated: 8 misses in a row guarantee the 9th hatch, and the counter resets after payout", () => {
    let counter = 0;
    const threshold = pityThresholdFor(meadowPool, contentTuning);
    for (let i = 0; i < 8; i++) {
      expect(isPityGuaranteed(counter, threshold)).toBe(false);
      counter = updatePityCounter(counter, "common", "uncommon"); // miss every time
    }
    expect(isPityGuaranteed(counter, threshold)).toBe(true);
    // Payout: next hatch narrows to the rarest tier and MUST hit it —
    // the counter resets on that hatch.
    counter = updatePityCounter(counter, "uncommon", "uncommon");
    expect(counter).toBe(0);
    expect(isPityGuaranteed(counter, threshold)).toBe(false);
  });

  it("never guaranteed for a no-pity pool, no matter how high the counter climbs", () => {
    const threshold = pityThresholdFor(bramblewickPool, contentTuning);
    expect(isPityGuaranteed(1000, threshold)).toBe(false);
  });

  it("only ever moves UP on a miss and to 0 on a payout — updatePityCounter has no third behaviour", () => {
    // Round-2C review: this test used to assert a LOCAL LITERAL (`let counter
    // = 5; expect(counter).toBe(5)`) and call no production code at all, so it
    // passed unconditionally and would have kept passing if a decay path were
    // added tomorrow. It now drives the real function exhaustively.
    const threshold = pityThresholdFor(meadowPool, contentTuning);
    expect(threshold).not.toBeNull();
    // A long run of misses only ever climbs — and keeps climbing past the
    // threshold (a counter parked above it is harmless, never rolled back).
    let counter = 0;
    for (let i = 1; i <= 40; i++) {
      const before = counter;
      counter = updatePityCounter(counter, "common", "uncommon");
      expect(counter, `miss ${i}`).toBe(before + 1);
    }
    expect(counter).toBe(40);
    // A payout is the ONLY thing that reduces it, and it goes straight to 0.
    expect(updatePityCounter(counter, "uncommon", "uncommon")).toBe(0);
    // And for a pool with no pity, the counter is inert in BOTH directions —
    // never incremented, never reset, whatever rarity is handed in.
    for (const rarity of ["common", "uncommon", "rare"]) {
      expect(updatePityCounter(5, rarity, null), rarity).toBe(5);
    }
  });
});

describe("guaranteedDrawPool — kindness tiebreak prefers uncaught", () => {
  it("prefers not-yet-caught species at the rarest tier", () => {
    const caught = new Set(["emberpip"]);
    const pool = guaranteedDrawPool(grottoPool, "rare", (id) => caught.has(id));
    // Only lanternpip is rare, and it's uncaught — trivially preferred.
    expect(pool.map((e) => e.id)).toEqual(["lanternpip"]);
  });

  it("falls back to every rarest-tier entry when all are already caught", () => {
    const allCaught = new Set(["lanternpip"]);
    const pool = guaranteedDrawPool(grottoPool, "rare", (id) => allCaught.has(id));
    expect(pool.map((e) => e.id)).toEqual(["lanternpip"]);
  });

  it("never returns empty even with no caught predicate supplied", () => {
    const pool = guaranteedDrawPool(grottoPool, "rare");
    expect(pool.length).toBeGreaterThan(0);
  });
});

describe("pity hatch cursor parity — the hard constraint", () => {
  it("a pity-narrowed hatch and an ordinary hatch consume the SAME number of rolls (rngState identical after each)", () => {
    const fullRegistry: GenomeSpeciesRegistry = {
      mosspip: {
        id: "mosspip",
        rarity: "common",
        sprite: { palettes: ["fern"], patterns: ["plain"] },
      },
      cloudpip: {
        id: "cloudpip",
        rarity: "uncommon",
        sprite: { palettes: ["nimbus"], patterns: ["puff"] },
      },
    };
    const narrowedRegistry: GenomeSpeciesRegistry = {
      cloudpip: fullRegistry.cloudpip as GenomeSpeciesRegistry[string],
    };

    const rngA = createRng(42);
    const streamA = rngA.stream("egg");
    rollGenome(streamA, { species: fullRegistry });
    const cursorAfterOrdinary = rngA.getState()["egg"];

    const rngB = createRng(42);
    const streamB = rngB.stream("egg");
    rollGenome(streamB, { species: narrowedRegistry });
    const cursorAfterPity = rngB.getState()["egg"];

    expect(cursorAfterPity).toBe(cursorAfterOrdinary);
  });
});
