import { describe, expect, it } from "vitest";
import { tuning as contentTuning } from "../content/tuning";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipState } from "../core/pips/types";
import type { LineageEggSeed, LossOutcome } from "../core/pips/ailment";
import type { SanctuaryRecord } from "../core/sanctuary";
import { createNewGame } from "../core/state";
import type { GameAction, GameState } from "../core/state";
import {
  MOURNING_WINDOW_MS,
  buildLineageBoardModel,
  buildLossEulogy,
  buildLoyalTurnModel,
  buildRetirementReadyModel,
  createMemorialView,
  isMourning,
  lineageHintFor,
  wordifyNumber,
} from "./memorial";
import { installFakeDom } from "./fakeDom";
import type { FakeElement } from "./fakeDom";

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mossy",
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
    needs: { hunger: 80, cleanliness: 80, happiness: 80, energy: 80 },
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

describe("wordifyNumber — spelled out, never a digit (bible §4: never a clock)", () => {
  it("spells small numbers correctly", () => {
    expect(wordifyNumber(0)).toBe("zero");
    expect(wordifyNumber(1)).toBe("one");
    expect(wordifyNumber(11)).toBe("eleven");
    expect(wordifyNumber(20)).toBe("twenty");
    expect(wordifyNumber(21)).toBe("twenty-one");
    expect(wordifyNumber(41)).toBe("forty-one");
    expect(wordifyNumber(92)).toBe("ninety-two");
    expect(wordifyNumber(100)).toBe("one hundred");
    expect(wordifyNumber(101)).toBe("one hundred and one");
  });

  it("never emits a digit for any input in a realistic lifetime range", () => {
    for (let n = 0; n <= 400; n += 7) {
      expect(wordifyNumber(n)).not.toMatch(/\d/);
    }
  });
});

describe("isMourning — the round-2G seam", () => {
  it("false with no loss outcome yet", () => {
    expect(isMourning({ lastLossOutcome: null }, 0)).toBe(false);
  });

  it("false for a cured outcome (only a true loss or the Loyal Turn mourns)", () => {
    const cured: LossOutcome = { kind: "cured", pipId: "p", at: 0, ailmentId: "brambleburr", route: "poultice" };
    expect(isMourning({ lastLossOutcome: cured }, 100)).toBe(false);
  });

  it("true immediately after a loss, false once the window passes", () => {
    const lost: LossOutcome = {
      kind: "lost",
      pipId: "p",
      at: 1000,
      ailmentId: "brambleburr",
      fromExpeditionId: "bramblewick",
    };
    expect(isMourning({ lastLossOutcome: lost }, 1000)).toBe(true);
    expect(isMourning({ lastLossOutcome: lost }, 1000 + MOURNING_WINDOW_MS - 1)).toBe(true);
    expect(isMourning({ lastLossOutcome: lost }, 1000 + MOURNING_WINDOW_MS + 1)).toBe(false);
  });

  it("true for the Loyal Turn too", () => {
    const loyal: LossOutcome = { kind: "loyalTurn", pipId: "p", at: 0, ailmentId: "chillshake" };
    expect(isMourning({ lastLossOutcome: loyal }, 500)).toBe(true);
  });
});

describe("buildLossEulogy — assembled from the Pip's own frozen history", () => {
  function residentRecord(overrides: Partial<PipState> = {}): SanctuaryRecord {
    return {
      pip: makePip({
        lifeMs: 11 * contentTuning.retention.dayMs,
        mastery: { meadow: 41, forest: 2 },
        scars: ["brambleburr"],
        ...overrides,
      }),
      retiredAt: 0,
      retiredFromKeepLevel: 1,
      visits: 0,
      reason: "lost",
    };
  }

  it("names the Pip, its title, and its days/trips in words", () => {
    const eulogy = buildLossEulogy(residentRecord(), "bramblewick");
    expect(eulogy.name).toBe("Mossy");
    expect(eulogy.title).toBe("of the Brambles");
    expect(eulogy.bodyParagraph).toContain("eleven day");
    expect(eulogy.bodyParagraph).toContain("Meadow");
    expect(eulogy.bodyParagraph).toContain("forty-one time");
    expect(eulogy.bodyParagraph).not.toMatch(/\d/);
  });

  it("names the egg's biome from the ailment's own source, not the top mastery biome", () => {
    const eulogy = buildLossEulogy(residentRecord(), "bramblewick");
    expect(eulogy.eggLine).toContain("Bramblewick");
  });

  it("has no title when the Pip carries no scar", () => {
    const eulogy = buildLossEulogy(residentRecord({ scars: [] }), "bramblewick");
    expect(eulogy.title).toBeNull();
  });

  it("still produces a body paragraph for a Pip with no mastery trips at all", () => {
    const eulogy = buildLossEulogy(residentRecord({ mastery: {} }), "bramblewick");
    expect(eulogy.bodyParagraph).toContain("Mossy was with you");
    expect(eulogy.bodyParagraph).not.toContain("undefined");
  });

  it("never reads as urgency/guilt copy (the codebase's own lint pattern)", () => {
    const eulogy = buildLossEulogy(residentRecord(), "bramblewick");
    for (const text of [eulogy.bodyParagraph, eulogy.eggLine]) {
      expect(text).not.toMatch(/missed you|don't lose|hurry|last chance|expires? in/i);
    }
  });
});

describe("buildLoyalTurnModel / buildRetirementReadyModel — never announce a shield", () => {
  it("the Loyal Turn copy never says the word 'shield', 'grace', or 'protected'", () => {
    const pip = makePip({ scars: ["chillshake"] });
    const model = buildLoyalTurnModel(pip);
    expect(model.bodyParagraph).not.toMatch(/shield|grace|protected/i);
  });

  it("retirement-ready reads as a reward, not a countdown, and never says 'died'", () => {
    const pip = makePip({ lifeMs: 13 * contentTuning.retention.dayMs, mastery: { shore: 92 } });
    const model = buildRetirementReadyModel(pip);
    expect(model.bodyParagraph).toContain("ninety-two trip");
    expect(model.bodyParagraph).toContain("thirteen day");
    expect(model.homeBiomeName).toBe("Shore");
    expect(model.bodyParagraph).not.toMatch(/died|dead/i);
  });
});

describe("buildLineageBoardModel / lineageHintFor", () => {
  function seed(overrides: Partial<LineageEggSeed> = {}): LineageEggSeed {
    return {
      pipId: "pip-1",
      name: "Mossy",
      genome: {
        speciesId: "mosspip",
        palette: "fern",
        pattern: "plain",
        accessorySlots: 1,
        personalityId: "curious",
        shiny: false,
      },
      expeditionId: "bramblewick",
      level: 5,
      scars: [],
      generation: 1,
      seededAt: 0,
      misses: 0,
      ...overrides,
    };
  }

  it("builds one row per seed, with the biome's real name", () => {
    const model = buildLineageBoardModel({ lineageEggs: [seed()] });
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]?.biomeName).toBe("Bramblewick");
    expect(model.rows[0]?.parentName).toBe("Mossy");
  });

  it("is empty (never throws) when lineageEggs is absent (pre-2H fixture precedent)", () => {
    expect(buildLineageBoardModel({ lineageEggs: undefined }).rows).toHaveLength(0);
  });

  it("lineageHintFor finds the right seed for a biome and is null otherwise", () => {
    expect(lineageHintFor([seed({ expeditionId: "snowdrift" })], "snowdrift")).toContain("Mossy");
    expect(lineageHintFor([seed({ expeditionId: "snowdrift" })], "meadow")).toBeNull();
    expect(lineageHintFor(undefined, "meadow")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DOM wiring
// ---------------------------------------------------------------------------

function baseState(overrides: Partial<GameState> = {}): GameState {
  const game = createNewGame(5, 0);
  return { ...game, ...overrides };
}

function recordedDispatch(): { dispatch(a: GameAction): void; actions: GameAction[] } {
  const actions: GameAction[] = [];
  return { dispatch: (a) => actions.push(a), actions };
}

describe("createMemorialView — DOM wiring", () => {
  it("opens the full-screen loss moment on a lastLossOutcome transition to 'lost'", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip();
      const record: SanctuaryRecord = {
        pip,
        retiredAt: 0,
        retiredFromKeepLevel: 1,
        visits: 0,
        reason: "lost",
      };
      const prev = baseState({
        pips: { [pip.id]: pip },
        rosterOrder: [pip.id],
        activePipId: pip.id,
        lastLossOutcome: null,
      });
      const next: GameState = {
        ...prev,
        pips: {},
        rosterOrder: [],
        sanctuary: { pips: { [pip.id]: record }, order: [pip.id] },
        lastLossOutcome: {
          kind: "lost",
          pipId: pip.id,
          at: 10,
          ailmentId: "brambleburr",
          fromExpeditionId: "bramblewick",
        },
      };

      const { dispatch } = recordedDispatch();
      const view = createMemorialView({ dispatch, getState: () => next, clock: { now: () => 0 } });
      const root = view.el as unknown as FakeElement;
      view.sync(prev);
      view.sync(next);

      const lossEl = root.querySelector(".pk-loss") as FakeElement;
      expect(lossEl.className).toContain("pk-loss--open");
      expect(root.querySelector(".pk-loss-name")?.textContent).toBe("Mossy");
    } finally {
      dom.uninstall();
    }
  });

  it("advances from beat one to beat two, then closes — never re-dispatches anything", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip();
      const record: SanctuaryRecord = { pip, retiredAt: 0, retiredFromKeepLevel: 1, visits: 0, reason: "lost" };
      const prev = baseState({ pips: { [pip.id]: pip }, rosterOrder: [pip.id], activePipId: pip.id });
      const next: GameState = {
        ...prev,
        pips: {},
        rosterOrder: [],
        sanctuary: { pips: { [pip.id]: record }, order: [pip.id] },
        lastLossOutcome: { kind: "lost", pipId: pip.id, at: 5, ailmentId: "brambleburr", fromExpeditionId: "bramblewick" },
      };
      const { dispatch, actions } = recordedDispatch();
      const view = createMemorialView({ dispatch, getState: () => next, clock: { now: () => 0 } });
      const root = view.el as unknown as FakeElement;
      view.sync(prev);
      view.sync(next);

      const sayGoodbye = root.querySelector(".pk-loss-btn") as FakeElement;
      sayGoodbye.click();
      const goBack = root.querySelector(".pk-loss-btn") as FakeElement;
      expect(goBack).not.toBeNull();
      goBack.click();

      const lossEl = root.querySelector(".pk-loss") as FakeElement;
      expect(lossEl.className).not.toContain("pk-loss--open");
      expect(actions).toHaveLength(0); // the loss moment never dispatches anything
    } finally {
      dom.uninstall();
    }
  });

  it("shows the Loyal Turn card for a 'loyalTurn' transition, distinct from a loss", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip();
      const prev = baseState({ pips: { [pip.id]: pip }, rosterOrder: [pip.id], activePipId: pip.id });
      const next: GameState = {
        ...prev,
        lastLossOutcome: { kind: "loyalTurn", pipId: pip.id, at: 3, ailmentId: "chillshake" },
      };
      const { dispatch } = recordedDispatch();
      const view = createMemorialView({ dispatch, getState: () => next, clock: { now: () => 0 } });
      const root = view.el as unknown as FakeElement;
      view.sync(prev);
      view.sync(next);
      expect(root.querySelector(".pk-loss-name")?.textContent).toBe("Mossy came through it.");
    } finally {
      dom.uninstall();
    }
  });

  it("auto-shows the retirement-ready card on a readyToRetire edge transition, and 'Walk her over' dispatches RETIRE_PIP", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip();
      const prev = baseState({ pips: { [pip.id]: pip }, rosterOrder: [pip.id], activePipId: pip.id });
      const readyPip = { ...pip, readyToRetire: true };
      const next: GameState = { ...prev, pips: { [pip.id]: readyPip } };
      const { dispatch, actions } = recordedDispatch();
      const view = createMemorialView({ dispatch, getState: () => next, clock: { now: () => 77 } });
      const root = view.el as unknown as FakeElement;
      view.sync(prev);
      view.sync(next);

      const wrap = root.querySelector(".pk-retireready-wrap") as FakeElement;
      expect(wrap.className).toContain("pk-retireready-wrap--open");

      const walk = root.querySelector(".pk-retireready-send") as FakeElement;
      walk.click();
      expect(actions).toEqual([{ type: "RETIRE_PIP", pipId: pip.id, at: 77 }]);
    } finally {
      dom.uninstall();
    }
  });

  it("'Not today' costs nothing and never dispatches", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip();
      const prev = baseState({ pips: { [pip.id]: pip }, rosterOrder: [pip.id], activePipId: pip.id });
      const readyPip = { ...pip, readyToRetire: true };
      const next: GameState = { ...prev, pips: { [pip.id]: readyPip } };
      const { dispatch, actions } = recordedDispatch();
      const view = createMemorialView({ dispatch, getState: () => next, clock: { now: () => 1 } });
      const root = view.el as unknown as FakeElement;
      view.sync(prev);
      view.sync(next);

      const notToday = root.querySelector(".pk-retireready-cancel") as FakeElement;
      notToday.click();
      expect(actions).toHaveLength(0);
      const wrap = root.querySelector(".pk-retireready-wrap") as FakeElement;
      expect(wrap.className).not.toContain("pk-retireready-wrap--open");
    } finally {
      dom.uninstall();
    }
  });

  it("the lineage board opens on demand and wires 'Send someone' to the onSendToExpedition seam", () => {
    const dom = installFakeDom();
    try {
      const seed: LineageEggSeed = {
        pipId: "lost-1",
        name: "Pebble",
        genome: {
          speciesId: "mosspip",
          palette: "fern",
          pattern: "plain",
          accessorySlots: 1,
          personalityId: "hardworking",
          shiny: false,
        },
        expeditionId: "snowdrift",
        level: 4,
        scars: [],
        generation: 1,
        seededAt: 0,
        misses: 0,
      };
      const state = baseState({ lineageEggs: [seed] });
      let requested: string | null = null;
      const { dispatch } = recordedDispatch();
      const view = createMemorialView({
        dispatch,
        getState: () => state,
        clock: { now: () => 0 },
        onSendToExpedition: (id) => {
          requested = id;
        },
      });
      view.openLineageBoard();
      const root = view.el as unknown as FakeElement;
      const sendBtn = root.querySelector(".pk-lineage-send") as FakeElement;
      sendBtn.click();
      expect(requested).toBe("snowdrift");
    } finally {
      dom.uninstall();
    }
  });
});
