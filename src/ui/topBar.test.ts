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
import { identitySubtitle, statusGlyph } from "./topBar";

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
