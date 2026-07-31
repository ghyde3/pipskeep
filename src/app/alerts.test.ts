/**
 * In-app alert derivation (spec §10). Pure decisions, so these run in node
 * with no DOM and no booted app.
 *
 * The load-bearing case is "Resting while still sulking": round 2A made
 * sulking-ness a flag orthogonal to `activity` so a Pip could nap its way
 * out of a 0-Energy sulk. Anything reporting sulks by comparing
 * `activity === Sulking` misses that Pip entirely — the one the player most
 * needs to hear about.
 */

import { describe, expect, it } from "vitest";
import { collectAlerts, NEED_ALERT_BELOW } from "./alerts";
import type { AlertsStateSlice } from "./alerts";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";

function needs(overrides: Partial<PipNeeds> = {}): PipNeeds {
  return { hunger: 80, cleanliness: 80, happiness: 80, energy: 80, ...overrides };
}

function pip(overrides: Partial<PipState> = {}): PipState {
  const personalityId = "curious";
  return {
    id: "pip-1",
    name: "Moss",
    speciesId: "mosspip",
    personalityId,
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      personalityId,
      shiny: false,
    },
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
    sulking: false,
    ...overrides,
  } as PipState;
}

function slice(p: PipState): AlertsStateSlice {
  return { pips: { [p.id]: p }, rosterOrder: [p.id] };
}

const sulkKinds = (alerts: readonly { kind: string }[]) =>
  alerts.filter((a) => a.kind === "sulking");

describe("sulking alerts read the flag, not the activity", () => {
  it("fires for the classic activity === Sulking crossing", () => {
    const alerts = collectAlerts(
      slice(pip()),
      slice(pip({ activity: PipActivity.Sulking, needs: needs({ energy: 0 }) })),
    );
    expect(sulkKinds(alerts)).toHaveLength(1);
    expect(sulkKinds(alerts)[0]!.kind).toBe("sulking");
  });

  // THE ROUND-2A GAP: a Pip that began a nap from Sulking (or was napping
  // when an unrelated need floored) keeps activity === Resting with the flag
  // set. The old activity comparison stayed silent here.
  it("fires for a Pip that is Resting while still sulking", () => {
    const alerts = collectAlerts(
      slice(pip({ activity: PipActivity.Resting })),
      slice(
        pip({
          activity: PipActivity.Resting,
          sulking: true,
          needs: needs({ hunger: 0 }),
        }),
      ),
    );
    expect(sulkKinds(alerts)).toHaveLength(1);
  });

  it("does not re-fire while the Pip stays sulking (downward crossings only)", () => {
    const sulky = pip({ activity: PipActivity.Resting, sulking: true });
    expect(sulkKinds(collectAlerts(slice(sulky), slice(sulky)))).toHaveLength(0);
  });

  it("does not fire when a napping sulk resolves back to plain Resting", () => {
    const alerts = collectAlerts(
      slice(pip({ activity: PipActivity.Resting, sulking: true })),
      slice(pip({ activity: PipActivity.Resting, sulking: false })),
    );
    expect(sulkKinds(alerts)).toHaveLength(0);
  });

  it("announces a Pip that arrives already sulking (absent from prev)", () => {
    const arriving = pip({ id: "pip-2", name: "Wren", sulking: true });
    const alerts = collectAlerts(
      { pips: {}, rosterOrder: [] },
      { pips: { "pip-2": arriving }, rosterOrder: ["pip-2"] },
    );
    expect(sulkKinds(alerts)).toHaveLength(1);
  });
});

describe("need-low alerts fire on downward crossings only", () => {
  it("fires just below the threshold, not at it", () => {
    const above = collectAlerts(
      slice(pip()),
      slice(pip({ needs: needs({ hunger: NEED_ALERT_BELOW }) })),
    );
    expect(above.filter((a) => a.kind === "needLow")).toHaveLength(0);

    const below = collectAlerts(
      slice(pip()),
      slice(pip({ needs: needs({ hunger: NEED_ALERT_BELOW - 1 }) })),
    );
    expect(below.filter((a) => a.kind === "needLow")).toHaveLength(1);
  });

  it("does not re-fire while a need stays low", () => {
    const low = pip({ needs: needs({ hunger: 5 }) });
    const alerts = collectAlerts(slice(low), slice(pip({ needs: needs({ hunger: 3 }) })));
    expect(alerts).toHaveLength(0);
  });
});
