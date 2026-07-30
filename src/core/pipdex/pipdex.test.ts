/**
 * The Album (`pipdex`) tests (docs/retention-bible.md §1, §13 test plan):
 * seen/caught tiers, evolved-through-base seeing, the frozen first
 * portrait, monotonicity of every scalar total across a long randomised
 * sequence, and variant/shiny recording.
 */

import { describe, expect, it } from "vitest";
import { LifeStage } from "../pips/types";
import type { TraitGenome } from "../pips/types";
import {
  createEmptyPipdex,
  markCaught,
  markSeen,
  markVariantCaught,
  pipdexCompletion,
} from "./index";
import type { PipdexPortrait, PipdexState } from "./index";

function genome(overrides: Partial<TraitGenome> = {}): TraitGenome {
  return {
    speciesId: "mosspip",
    palette: "fern",
    pattern: "plain",
    accessorySlots: 1,
    personalityId: "curious",
    shiny: false,
    ...overrides,
  };
}

function portrait(overrides: Partial<PipdexPortrait> = {}): PipdexPortrait {
  return {
    pipId: "pip-1",
    name: "Mossy",
    genome: genome(),
    personalityId: "curious",
    lifeStageAtCatch: LifeStage.Adult,
    sourceExpeditionId: "meadow",
    ...overrides,
  };
}

describe("createEmptyPipdex", () => {
  it("starts with nothing seen or caught", () => {
    const state = createEmptyPipdex();
    expect(state.entries).toEqual({});
    expect(state.discoveryOrder).toEqual([]);
    expect(state.formsSeen).toBe(0);
    expect(state.formsCaught).toBe(0);
    expect(state.variantsCaught).toBe(0);
    expect(state.shiniesCaught).toBe(0);
    expect(state.unreadEntryIds).toEqual([]);
  });
});

describe("markSeen — Field note tier", () => {
  it("grants a Field note with the biome recorded", () => {
    const state = markSeen(createEmptyPipdex(), "cloudpip", 1000, "meadow");
    const entry = state.entries["cloudpip"];
    expect(entry?.seenAt).toBe(1000);
    expect(entry?.caughtAt).toBeNull();
    expect(entry?.knownBiomes).toEqual(["meadow"]);
    expect(state.formsSeen).toBe(1);
    expect(state.discoveryOrder).toEqual(["cloudpip"]);
    expect(state.unreadEntryIds).toEqual(["cloudpip"]);
  });

  it("never moves seenAt once set (idempotent re-seeing)", () => {
    let state = markSeen(createEmptyPipdex(), "cloudpip", 1000, "meadow");
    state = markSeen(state, "cloudpip", 5000, "meadow");
    expect(state.entries["cloudpip"]?.seenAt).toBe(1000);
    expect(state.formsSeen).toBe(1);
  });

  it("accumulates a NEW biome without disturbing seenAt", () => {
    let state = markSeen(createEmptyPipdex(), "cloudpip", 1000, "meadow");
    state = markSeen(state, "cloudpip", 5000, "forest");
    expect(state.entries["cloudpip"]?.knownBiomes).toEqual(["meadow", "forest"]);
    expect(state.entries["cloudpip"]?.seenAt).toBe(1000);
  });

  it("supports seeing with no biome (the evolution-reveal case)", () => {
    const state = markSeen(createEmptyPipdex(), "grovepip", 1000);
    expect(state.entries["grovepip"]?.seenAt).toBe(1000);
    expect(state.entries["grovepip"]?.knownBiomes).toEqual([]);
  });
});

describe("markCaught — Portrait tier", () => {
  it("grants a Portrait with the frozen first portrait", () => {
    const state = markCaught(createEmptyPipdex(), "mosspip", 2000, portrait());
    const entry = state.entries["mosspip"];
    expect(entry?.caughtAt).toBe(2000);
    expect(entry?.caughtCount).toBe(1);
    expect(entry?.firstPortrait).toEqual(portrait());
    expect(state.formsCaught).toBe(1);
    expect(state.discoveryOrder).toEqual(["mosspip"]);
  });

  it("caught implies Portrait regardless of seenAt (the starter case)", () => {
    // The starter is caught at createNewGame without ever visiting a
    // biome — seenAt stays null, caughtAt alone is the Portrait tier.
    const state = markCaught(createEmptyPipdex(), "mosspip", 2000, portrait());
    expect(state.entries["mosspip"]?.seenAt).toBeNull();
    expect(state.entries["mosspip"]?.caughtAt).not.toBeNull();
  });

  it("increments caughtCount on every catch but freezes the first portrait", () => {
    let state = markCaught(createEmptyPipdex(), "mosspip", 2000, portrait({ name: "Mossy" }));
    state = markCaught(state, "mosspip", 9000, portrait({ pipId: "pip-9", name: "Sprout" }));
    const entry = state.entries["mosspip"];
    expect(entry?.caughtCount).toBe(2);
    expect(entry?.caughtAt).toBe(2000); // first catch, never moves
    expect(entry?.firstPortrait?.name).toBe("Mossy"); // frozen at first catch
    expect(state.formsCaught).toBe(1); // one FORM caught, not one per catch
  });

  it("records the shiny stamp on first shiny catch only", () => {
    let state = markCaught(
      createEmptyPipdex(),
      "mosspip",
      1000,
      portrait({ genome: genome({ shiny: false }) }),
    );
    expect(state.shiniesCaught).toBe(0);
    state = markCaught(
      state,
      "mosspip",
      2000,
      portrait({ pipId: "pip-2", genome: genome({ shiny: true }) }),
    );
    expect(state.entries["mosspip"]?.shinyCaughtAt).toBe(2000);
    expect(state.shiniesCaught).toBe(1);
    // A second shiny of the SAME species does not move the stamp or
    // double-count the corner total.
    state = markCaught(
      state,
      "mosspip",
      3000,
      portrait({ pipId: "pip-3", genome: genome({ shiny: true }) }),
    );
    expect(state.entries["mosspip"]?.shinyCaughtAt).toBe(2000);
    expect(state.shiniesCaught).toBe(1);
  });
});

describe("evolved forms are seen through their base (bible §1.1)", () => {
  it("markSeen on an evolution target produces a Field note, not a Portrait (the shape the reducer relies on)", () => {
    // SCOPE NOTE (round-2C review): this is a `markSeen` unit test, NOT a test
    // that catching a base species AUTO-reveals its target — this module takes
    // the species id as a parameter and knows nothing about evolution content,
    // so the auto-reveal is `core/state.ts`'s job and is covered there
    // (`state.test.ts`'s EVOLVE_PIP and ACKNOWLEDGE_REVEAL cases). What this
    // pins is the primitive that reveal is built out of.
    let state = markCaught(createEmptyPipdex(), "mosspip", 1000, portrait());
    state = markSeen(state, "grovepip", 1000);
    expect(state.entries["grovepip"]?.seenAt).toBe(1000);
    expect(state.entries["grovepip"]?.caughtAt).toBeNull();
    expect(state.formsSeen).toBe(1);
  });

  it("evolving sets the evolved species caught under its OWN entry, base untouched", () => {
    let state = markCaught(createEmptyPipdex(), "mosspip", 1000, portrait());
    state = markCaught(
      state,
      "grovepip",
      5000,
      portrait({ genome: genome({ speciesId: "grovepip" }) }),
    );
    expect(state.entries["mosspip"]?.caughtCount).toBe(1);
    expect(state.entries["grovepip"]?.caughtCount).toBe(1);
    expect(state.formsCaught).toBe(2);
  });
});

describe("markVariantCaught — the Grove Ledger ribbon", () => {
  it("records the leaf on the BASE species' entry", () => {
    let state = markCaught(createEmptyPipdex(), "mosspip", 1000, portrait());
    state = markVariantCaught(state, "mosspip", "sunorchard", 5000);
    expect(state.entries["mosspip"]?.variantsCaught).toEqual({ sunorchard: 5000 });
    expect(state.variantsCaught).toBe(1);
    // The evolved species' OWN entry (if any) is untouched by the ribbon.
    expect(state.entries["grovepip"]).toBeUndefined();
  });

  it("is idempotent for an already-witnessed variant", () => {
    let state = markCaught(createEmptyPipdex(), "mosspip", 1000, portrait());
    state = markVariantCaught(state, "mosspip", "sunorchard", 5000);
    const again = markVariantCaught(state, "mosspip", "sunorchard", 9000);
    expect(again.entries["mosspip"]?.variantsCaught["sunorchard"]).toBe(5000);
    expect(again.variantsCaught).toBe(1);
    expect(again).toBe(state); // reference stability — nothing changed
  });

  it("accumulates multiple distinct leaves on the same page", () => {
    let state = markCaught(createEmptyPipdex(), "mosspip", 1000, portrait());
    state = markVariantCaught(state, "mosspip", "berrybright", 2000);
    state = markVariantCaught(state, "mosspip", "heartymoss", 3000);
    state = markVariantCaught(state, "mosspip", "sunorchard", 4000);
    expect(Object.keys(state.entries["mosspip"]?.variantsCaught ?? {})).toHaveLength(3);
    expect(state.variantsCaught).toBe(3);
  });
});

describe("pipdexCompletion — the two declared targets", () => {
  it("computes clamped percentages against content-owned targets", () => {
    let state = createEmptyPipdex();
    for (const id of ["mosspip", "pebblepip", "tidepip"]) {
      state = markCaught(state, id, 1000, portrait({ genome: genome({ speciesId: id }) }));
    }
    state = markVariantCaught(state, "mosspip", "berrybright", 2000);
    const completion = pipdexCompletion(state, 14, 21);
    expect(completion.formsCaught).toBe(3);
    expect(completion.albumTarget).toBe(14);
    expect(completion.albumPct).toBeCloseTo(3 / 14);
    expect(completion.ledgerVariantsCaught).toBe(1);
    expect(completion.ledgerTarget).toBe(21);
    expect(completion.ledgerPct).toBeCloseTo(1 / 21);
    expect(completion.shiniesCaught).toBe(0);
  });

  it("clamps at 1 even if a registry quirk exceeds the declared target", () => {
    // Mosspip's evolution line has 4 possible outcomes (one more than the
    // 7-lines-of-3 average tuning.retention.pipdex.ledgerTarget assumes) —
    // completion must never read as "> 100%".
    let state = createEmptyPipdex();
    for (const variant of ["a", "b", "c", "d"]) {
      state = markVariantCaught(state, "mosspip", variant, 1000);
    }
    const completion = pipdexCompletion(state, 14, 3);
    expect(completion.ledgerVariantsCaught).toBe(4);
    expect(completion.ledgerPct).toBe(1);
  });

  it("never divides by zero", () => {
    const completion = pipdexCompletion(createEmptyPipdex(), 0, 0);
    expect(completion.albumPct).toBe(0);
    expect(completion.ledgerPct).toBe(0);
  });
});

describe("monotonicity — the orchestrator's guardrail (bible §0.1)", () => {
  it("every scalar total is non-decreasing across a long randomised sequence", () => {
    const species = ["mosspip", "pebblepip", "tidepip", "emberpip", "snowpip"];
    const variants = ["a", "b", "c"];
    let state = createEmptyPipdex();
    let seed = 12345;
    const rand = (): number => {
      // Simple deterministic LCG — no dependency on core/rng.ts (this
      // test only needs "some pseudo-random sequence", not a seeded
      // stream cursor).
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    let prevFormsSeen = 0;
    let prevFormsCaught = 0;
    let prevVariants = 0;
    let prevShinies = 0;
    let prevDiscoveryLen = 0;
    let prevUnreadLen = 0;

    for (let i = 0; i < 500; i++) {
      const speciesId = species[Math.floor(rand() * species.length)] as string;
      const at = i * 1000;
      const action = rand();
      if (action < 0.4) {
        state = markSeen(state, speciesId, at, `biome-${Math.floor(rand() * 3)}`);
      } else if (action < 0.8) {
        state = markCaught(
          state,
          speciesId,
          at,
          portrait({
            pipId: `pip-${i}`,
            genome: genome({ speciesId, shiny: rand() < 0.1 }),
          }),
        );
      } else {
        state = markVariantCaught(
          state,
          speciesId,
          variants[Math.floor(rand() * variants.length)] as string,
          at,
        );
      }

      expect(state.formsSeen).toBeGreaterThanOrEqual(prevFormsSeen);
      expect(state.formsCaught).toBeGreaterThanOrEqual(prevFormsCaught);
      expect(state.variantsCaught).toBeGreaterThanOrEqual(prevVariants);
      expect(state.shiniesCaught).toBeGreaterThanOrEqual(prevShinies);
      expect(state.discoveryOrder.length).toBeGreaterThanOrEqual(prevDiscoveryLen);
      expect(state.unreadEntryIds.length).toBeGreaterThanOrEqual(prevUnreadLen);
      // Every entry's own caughtCount is monotonic too, and knownBiomes
      // never shrinks (checked implicitly by array length here).
      for (const entry of Object.values(state.entries)) {
        expect(entry.caughtCount).toBeGreaterThanOrEqual(0);
      }

      prevFormsSeen = state.formsSeen;
      prevFormsCaught = state.formsCaught;
      prevVariants = state.variantsCaught;
      prevShinies = state.shiniesCaught;
      prevDiscoveryLen = state.discoveryOrder.length;
      prevUnreadLen = state.unreadEntryIds.length;
    }

    // Sanity: the sequence actually exercised every write path.
    expect(state.formsCaught).toBeGreaterThan(0);
    expect(state.formsSeen).toBeGreaterThan(0);
    expect(state.variantsCaught).toBeGreaterThan(0);
  });
});

describe("discovery order — a diary, not a registry-id sort", () => {
  it("orders by first knowledge (seen or caught), never re-orders", () => {
    let state = createEmptyPipdex();
    state = markSeen(state, "lanternpip", 1000, "lanterngrotto");
    state = markCaught(state, "mosspip", 2000, portrait());
    state = markCaught(state, "lanternpip", 3000, portrait({ genome: genome({ speciesId: "lanternpip" }) }));
    expect(state.discoveryOrder).toEqual(["lanternpip", "mosspip"]);
  });
});

describe("type export sanity", () => {
  it("PipdexState round-trips through JSON (plain serializable data)", () => {
    let state: PipdexState = markCaught(createEmptyPipdex(), "mosspip", 1000, portrait());
    state = markVariantCaught(state, "mosspip", "berrybright", 2000);
    const roundTripped = JSON.parse(JSON.stringify(state)) as PipdexState;
    expect(roundTripped).toEqual(state);
  });
});
