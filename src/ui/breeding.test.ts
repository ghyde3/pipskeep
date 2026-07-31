import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../content/tuning";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipState } from "../core/pips/types";
import { combineForBreeding } from "../core/pips/breeding";
import { createRng } from "../core/rng";
import { createNewGame } from "../core/state";
import type { GameAction, GameState } from "../core/state";
import {
  BREED_REFUSAL_COPY,
  buildBreedPreview,
  buildBreedRoster,
  buildPartnerOptions,
  createBreedingView,
} from "./breeding";
import { installFakeDom } from "./fakeDom";
import type { FakeElement } from "./fakeDom";

const cfg = contentTuning.lifecycle.lineage;

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mossy",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      personalityId: "curious",
      shiny: false,
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: { hunger: 90, cleanliness: 90, happiness: 90, energy: 90 },
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    level: cfg.breedMinLevel,
    ...overrides,
  };
}

describe("buildBreedRoster / buildPartnerOptions", () => {
  it("lists every roster Pip", () => {
    const state = {
      pips: { a: makePip({ id: "a" }), b: makePip({ id: "b", name: "Pip" }) },
      rosterOrder: ["a", "b"],
    };
    const roster = buildBreedRoster(state);
    expect(roster.map((p) => p.pipId)).toEqual(["a", "b"]);
    expect(roster[0]?.levelLabel).toContain(String(cfg.breedMinLevel));
  });

  it("marks a partner eligible when both clear every gate", () => {
    const state = {
      pips: { a: makePip({ id: "a" }), b: makePip({ id: "b" }) },
      rosterOrder: ["a", "b"],
    };
    const options = buildPartnerOptions(state, "a", 0);
    expect(options).toHaveLength(1);
    expect(options[0]?.eligible).toBe(true);
    expect(options[0]?.refusalCopy).toBeNull();
  });

  it("carries the EXACT real refusal reason for an ineligible partner (a Pipling)", () => {
    const state = {
      pips: {
        a: makePip({ id: "a" }),
        b: makePip({ id: "b", lifeStage: LifeStage.Pipling }),
      },
      rosterOrder: ["a", "b"],
    };
    const options = buildPartnerOptions(state, "a", 0);
    expect(options[0]?.eligible).toBe(false);
    expect(options[0]?.refusalCopy).toBe(BREED_REFUSAL_COPY.notAdult);
  });

  it("never offers the Pip herself as a partner", () => {
    const state = { pips: { a: makePip({ id: "a" }) }, rosterOrder: ["a"] };
    expect(buildPartnerOptions(state, "a", 0)).toHaveLength(0);
  });

  it("every BreedRefusalReason has warm, non-blaming copy (no 'she failed to…')", () => {
    for (const text of Object.values(BREED_REFUSAL_COPY)) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/fail|blame|wrong/i);
    }
  });
});

describe("buildBreedPreview — structural, never a roll", () => {
  it("names both species when parents differ, one when they match", () => {
    const a = makePip({ id: "a" });
    const b = makePip({ id: "b", speciesId: "cloudpip", genome: { ...a.genome, speciesId: "cloudpip" } });
    const same = makePip({ id: "c" });
    expect(buildBreedPreview(a, b).speciesNames.length).toBe(2);
    expect(buildBreedPreview(a, same).speciesNames.length).toBe(1);
  });

  it("reports no shiny possibility unless a parent is shiny", () => {
    const a = makePip({ id: "a" });
    const b = makePip({ id: "b" });
    expect(buildBreedPreview(a, b).shinyPossible).toBe(false);
    const shinyA = { ...a, genome: { ...a.genome, shiny: true } };
    expect(buildBreedPreview(shinyA, b).shinyPossible).toBe(true);
    expect(buildBreedPreview(shinyA, b).shinyChancePct).toBeGreaterThan(0);
  });

  it("the approximate level matches the REAL combineForBreeding formula exactly", () => {
    for (const [levelA, levelB] of [[3, 3], [5, 9], [10, 10], [3, 4]] as const) {
      const a = makePip({ id: "a", level: levelA });
      const b = makePip({ id: "b", level: levelB });
      const preview = buildBreedPreview(a, b);
      const rng = createRng(1).stream("lineage");
      const real = combineForBreeding(a, b, rng, contentTuning);
      expect(preview.approxLevel).toBe(real.level);
      expect(preview.generation).toBe(real.generation);
    }
  });
});

// ---------------------------------------------------------------------------
// DOM wiring
// ---------------------------------------------------------------------------

function baseState(overrides: Partial<GameState> = {}): GameState {
  const game = createNewGame(9, 0);
  return { ...game, ...overrides };
}

function recordedDispatch(): { dispatch(a: GameAction): void; actions: GameAction[] } {
  const actions: GameAction[] = [];
  return { dispatch: (a) => actions.push(a), actions };
}

describe("createBreedingView — DOM wiring", () => {
  it("walks pick-A → pick-B → preview → Start a clutch, dispatching BREED_PIPS exactly once", () => {
    const dom = installFakeDom();
    try {
      const a = makePip({ id: "a", name: "Mossy" });
      const b = makePip({ id: "b", name: "Pip" });
      const state = baseState({ pips: { a, b }, rosterOrder: ["a", "b"], activePipId: "a" });
      const { dispatch, actions } = recordedDispatch();
      const view = createBreedingView({ dispatch, getState: () => state, clock: { now: () => 11 } });
      const root = view.el as unknown as FakeElement;

      view.open();
      expect(view.isOpen).toBe(true);
      const rows = root.querySelectorAll(".pk-breed-row");
      expect(rows.length).toBe(2);
      rows[0]?.click();

      const partnerRows = root.querySelectorAll(".pk-breed-row");
      expect(partnerRows.length).toBe(1);
      partnerRows[0]?.click();

      const go = root.querySelector(".pk-breed-send") as FakeElement;
      expect(go).not.toBeNull();
      go.click();

      expect(actions).toEqual([{ type: "BREED_PIPS", aId: "a", bId: "b", at: 11 }]);
    } finally {
      dom.uninstall();
    }
  });

  // THE BLOCKER THIS ROUND SHIPPED, found by playing and invisible to the
  // test above — which walks the whole flow without ever calling `sync()`.
  // `main.ts` syncs this view from the one shared store subscription, and
  // the live ticker dispatches a TICK up to once a SECOND, so in the real
  // app a `sync()` lands between the partner tap and the "Start a clutch"
  // tap essentially always. The partner used to live only as an argument to
  // `renderPreview`, so that re-render rebuilt the partner PICKER and threw
  // the preview away: the button was unreachable and breeding — this
  // round's entire succession mechanic — could not be used at all.
  it("keeps the preview through a sync() — the per-second re-render must not eat the pair", () => {
    const dom = installFakeDom();
    try {
      const a = makePip({ id: "a", name: "Mossy" });
      const b = makePip({ id: "b", name: "Pip" });
      const state = baseState({ pips: { a, b }, rosterOrder: ["a", "b"], activePipId: "a" });
      const { dispatch, actions } = recordedDispatch();
      const view = createBreedingView({ dispatch, getState: () => state, clock: { now: () => 11 } });
      const root = view.el as unknown as FakeElement;

      view.open();
      root.querySelectorAll(".pk-breed-row")[0]?.click();
      root.querySelectorAll(".pk-breed-row")[0]?.click();
      expect(root.querySelector(".pk-breed-send")).not.toBeNull();

      // A tick arrives (a NEW state object, as the real reducer always
      // produces) — and the preview has to still be there afterwards.
      view.sync({ ...state });
      const go = root.querySelector(".pk-breed-send") as FakeElement;
      expect(go, "the preview was destroyed by a routine re-render").not.toBeNull();
      expect(root.querySelector(".pk-breed-heading")?.textContent).toBe("Mossy & Pip");

      go.click();
      expect(actions).toEqual([{ type: "BREED_PIPS", aId: "a", bId: "b", at: 11 }]);
    } finally {
      dom.uninstall();
    }
  });

  it('"Not this pair" goes back to the partner list, and survives a sync too', () => {
    const dom = installFakeDom();
    try {
      const a = makePip({ id: "a", name: "Mossy" });
      const b = makePip({ id: "b", name: "Pip" });
      const state = baseState({ pips: { a, b }, rosterOrder: ["a", "b"], activePipId: "a" });
      const { dispatch } = recordedDispatch();
      const view = createBreedingView({ dispatch, getState: () => state, clock: { now: () => 0 } });
      const root = view.el as unknown as FakeElement;

      view.open();
      root.querySelectorAll(".pk-breed-row")[0]?.click();
      root.querySelectorAll(".pk-breed-row")[0]?.click();
      (root.querySelector(".pk-breed-cancel") as FakeElement).click();

      // Back on the partner list, with the first Pip still chosen...
      expect(root.querySelector(".pk-breed-send")).toBeNull();
      expect(root.querySelectorAll(".pk-breed-row").length).toBe(1);
      // ...and a tick does not bounce it forward again.
      view.sync({ ...state });
      expect(root.querySelector(".pk-breed-send")).toBeNull();
      expect(root.querySelectorAll(".pk-breed-row").length).toBe(1);
    } finally {
      dom.uninstall();
    }
  });

  it("shows the empty state with fewer than two Pips in the roster", () => {
    const dom = installFakeDom();
    try {
      const a = makePip({ id: "a" });
      const state = baseState({ pips: { a }, rosterOrder: ["a"], activePipId: "a" });
      const { dispatch } = recordedDispatch();
      const view = createBreedingView({ dispatch, getState: () => state, clock: { now: () => 0 } });
      view.open();
      const root = view.el as unknown as FakeElement;
      const empty = root.querySelector(".pk-breed-empty");
      expect(empty?.textContent).toContain("only one Pip");
    } finally {
      dom.uninstall();
    }
  });

  it("close() and the backdrop both hide the sheet", () => {
    const dom = installFakeDom();
    try {
      const a = makePip({ id: "a" });
      const b = makePip({ id: "b" });
      const state = baseState({ pips: { a, b }, rosterOrder: ["a", "b"], activePipId: "a" });
      const { dispatch } = recordedDispatch();
      const view = createBreedingView({ dispatch, getState: () => state, clock: { now: () => 0 } });
      view.open();
      view.close();
      expect(view.isOpen).toBe(false);
    } finally {
      dom.uninstall();
    }
  });
});
