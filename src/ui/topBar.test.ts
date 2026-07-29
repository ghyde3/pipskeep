/**
 * Top-bar controller tests (spec §10 active Pip selector) — the pure
 * helpers only: status glyph mapping per activity and the identity-row
 * subtitle. Selector switching itself is a reducer concern, covered by
 * the SET_ACTIVE_PIP tests in core/state.test.ts; the DOM shell here is
 * untested chrome (same pattern as debugMenu.test.ts).
 */

import { describe, expect, it } from "vitest";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import { identitySubtitle, satchelChips, statusGlyph } from "./topBar";

const needs = (): PipNeeds => ({
  hunger: 80,
  cleanliness: 80,
  happiness: 80,
  energy: 80,
});

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mosspip",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      accessorySlots: 1,
      personalityId: "curious",
      shiny: false,
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

describe("statusGlyph — tiny selector badges (spec §10)", () => {
  it("badges exactly the away/resting/sulking states", () => {
    expect(statusGlyph(PipActivity.OnExpedition)?.glyph).toBe("»");
    expect(statusGlyph(PipActivity.Returning)?.glyph).toBe("!");
    expect(statusGlyph(PipActivity.Resting)?.glyph).toBe("z");
    expect(statusGlyph(PipActivity.Sulking)?.glyph).toBe("…");
  });

  it("Idle pips carry no badge; working pips wear the basket (spec §6.2)", () => {
    expect(statusGlyph(PipActivity.Idle)).toBeNull();
    expect(statusGlyph(PipActivity.AssignedJob)?.glyph).toBe("🧺");
    expect(statusGlyph(PipActivity.AssignedJob)?.label).toBe("gathering away");
  });
});

describe("identitySubtitle — the active pip's one-line readout", () => {
  it("shows just the personality while the pip is around", () => {
    expect(identitySubtitle(makePip())).toBe("Curious");
  });

  it("appends the warm status while away / resting / sulking", () => {
    expect(
      identitySubtitle(makePip({ activity: PipActivity.OnExpedition })),
    ).toBe("Curious — off exploring");
    expect(identitySubtitle(makePip({ activity: PipActivity.Sulking }))).toBe(
      "Curious — sulking",
    );
  });

  it("falls back to the raw id for an unknown personality", () => {
    expect(identitySubtitle(makePip({ personalityId: "moody" }))).toBe("moody");
  });
});

describe("satchelChips — one unambiguous chip per item id", () => {
  it("merges inventory and resources so the same id can never twin", () => {
    // The Phase 5 bug: 'Berry ×7' (inventory food) AND 'Berry ×20'
    // (resource residue) as twin chips. Merged: one Berry chip, summed.
    const chips = satchelChips({
      inventory: { berry: 7, stew: 1 },
      resources: { berry: 20, wood: 4 },
    });
    expect(chips.filter((c) => c.id === "berry")).toHaveLength(1);
    expect(chips.find((c) => c.id === "berry")).toEqual({
      id: "berry",
      label: "Berry",
      count: 27,
    });
  });

  it("names foods from the registry and capitalizes plain resource ids", () => {
    const chips = satchelChips({
      inventory: { stew: 2 },
      resources: { wood: 3, driftwood: 1 },
    });
    expect(chips.map((c) => c.label)).toEqual(["Stew", "Wood", "Driftwood"]);
  });

  it("drops zero and negative counts", () => {
    const chips = satchelChips({
      inventory: { berry: 0 },
      resources: { wood: -2, fiber: 1 },
    });
    expect(chips).toEqual([{ id: "fiber", label: "Fiber", count: 1 }]);
  });

  it("keeps inventory (food) chips ahead of resource chips", () => {
    const chips = satchelChips({
      inventory: { berry: 1 },
      resources: { wood: 1 },
    });
    expect(chips.map((c) => c.id)).toEqual(["berry", "wood"]);
  });
});
