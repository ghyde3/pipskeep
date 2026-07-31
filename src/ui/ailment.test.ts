import { describe, expect, it } from "vitest";
import { tuning as contentTuning, HOUR_MS } from "../content/tuning";
import { ailments as contentAilments, POULTICE_ITEM_ID } from "../content/ailments";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { AilmentState, PipState } from "../core/pips/types";
import { expeditions as contentExpeditions, RISKY_TRAIL_COPY, SAFE_TRAIL_COPY } from "../content/expeditions";
import { createNewGame } from "../core/state";
import type { GameAction, GameState } from "../core/state";
import {
  ailmentCountdownLabel,
  ailmentRingColors,
  buildAilmentCardModel,
  buildRiskConfirmModel,
  createAilmentView,
  freeChanceHint,
  isRiskyExpedition,
  POULTICE_SOURCE_HINT,
  mostUrgentAilingPipId,
  pipStatusBadge,
} from "./ailment";
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

function ailmentOf(id: keyof typeof contentAilments, remainingMs: number): AilmentState {
  const def = contentAilments[id];
  return {
    id: def.id,
    contractedAt: 0,
    fromExpeditionId: def.fromExpeditionId,
    remainingMs,
    totalMs: def.totalMs,
    cureAttempts: 0,
  };
}

describe("ailmentCountdownLabel — bible §3.4's bands, never a clock", () => {
  it("bands remaining time into the four documented phrases", () => {
    expect(ailmentCountdownLabel(60 * HOUR_MS, "Mossy")).toBe("A few days of tending left.");
    expect(ailmentCountdownLabel(48 * HOUR_MS, "Mossy")).toBe("A few days of tending left.");
    expect(ailmentCountdownLabel(30 * HOUR_MS, "Mossy")).toBe("About two days of tending left.");
    expect(ailmentCountdownLabel(15 * HOUR_MS, "Mossy")).toBe("About a day of tending left.");
    expect(ailmentCountdownLabel(5 * HOUR_MS, "Mossy")).toBe("Mossy needs you today.");
    expect(ailmentCountdownLabel(0, "Mossy")).toBe("Mossy needs you today.");
  });

  it("never contains a clock-shaped number or the codebase's urgency phrasing", () => {
    for (const ms of [0, 1, 3 * HOUR_MS, 13 * HOUR_MS, 25 * HOUR_MS, 90 * HOUR_MS]) {
      const label = ailmentCountdownLabel(ms, "Pip");
      expect(label).not.toMatch(/\d+\s*:\s*\d+/);
      expect(label).not.toMatch(/hurry|last chance|expires? in/i);
    }
  });
});

describe("ailmentRingColors — warm amber to dusk-rose, never red", () => {
  it("gives every stage a distinct pair, none of them red", () => {
    const settling = ailmentRingColors("settling");
    const worsening = ailmentRingColors("worsening");
    const grave = ailmentRingColors("grave");
    for (const c of [settling, worsening, grave]) {
      expect(c.from.toLowerCase()).not.toBe("#ff0000");
      expect(c.to.toLowerCase()).not.toBe("#ff0000");
    }
    expect(settling).not.toEqual(worsening);
    expect(worsening).not.toEqual(grave);
  });
});

describe("pipStatusBadge — the round-2G seam (bible §9.5)", () => {
  it("is null for a plain healthy young Pip", () => {
    expect(pipStatusBadge(makePip()).kind).toBeNull();
  });

  it("reports ailing with a ring fraction and a human label", () => {
    const pip = makePip({ ailment: ailmentOf("brambleburr", 20 * HOUR_MS) });
    const badge = pipStatusBadge(pip);
    expect(badge.kind).toBe("ailing");
    expect(badge.ring).toBeCloseTo(20 / 48, 5);
    expect(badge.label.length).toBeGreaterThan(0);
  });

  it("reports ready when readyToRetire, even for a non-Elder Pip", () => {
    const pip = makePip({ readyToRetire: true });
    expect(pipStatusBadge(pip).kind).toBe("ready");
  });

  it("ailing always outranks ready and elder", () => {
    const pip = makePip({
      readyToRetire: true,
      ailment: ailmentOf("chillshake", 10 * HOUR_MS),
    });
    expect(pipStatusBadge(pip).kind).toBe("ailing");
  });

  it("reports elder for a Pip deep into its lifespan with no other flag", () => {
    const lifespanMs = contentTuning.lifecycle.lifespan.baseMs;
    const pip = makePip({ lifeMs: Math.floor(lifespanMs * 0.9) });
    expect(pipStatusBadge(pip).kind).toBe("elder");
  });
});

describe("mostUrgentAilingPipId — closest to grave wins", () => {
  it("picks the smallest remaining fraction among ailing Pips", () => {
    const state = {
      pips: {
        a: makePip({ id: "a", ailment: ailmentOf("brambleburr", 40 * HOUR_MS) }),
        b: makePip({ id: "b", ailment: ailmentOf("chillshake", 5 * HOUR_MS) }),
        c: makePip({ id: "c" }),
      },
      rosterOrder: ["a", "b", "c"],
    };
    expect(mostUrgentAilingPipId(state)).toBe("b");
  });

  it("is null when nobody is ailing", () => {
    const state = { pips: { a: makePip({ id: "a" }) }, rosterOrder: ["a"] };
    expect(mostUrgentAilingPipId(state)).toBeNull();
  });
});

describe("buildAilmentCardModel", () => {
  it("null when the Pip is not ailing (defensive)", () => {
    expect(buildAilmentCardModel({ pips: { p: makePip() }, inventory: {} }, "p")).toBeNull();
  });

  it("carries the poultice count from inventory and the ailment's own copy", () => {
    const pip = makePip({ ailment: ailmentOf("lanternfever", 20 * HOUR_MS) });
    const model = buildAilmentCardModel(
      { pips: { [pip.id]: pip }, inventory: { [POULTICE_ITEM_ID]: 2 } },
      pip.id,
    );
    expect(model?.ailmentName).toBe(contentAilments.lanternfever.name);
    expect(model?.poulticeCount).toBe(2);
    expect(model?.stage).toBe("worsening");
  });

  it("flags the free daily chance only when every need clears the floor", () => {
    const floor = contentTuning.lifecycle.ailments.devotedCareNeedFloor;
    const high = makePip({
      ailment: ailmentOf("brambleburr", 40 * HOUR_MS),
      needs: { hunger: floor, cleanliness: floor, happiness: floor, energy: floor },
    });
    const low = makePip({
      ailment: ailmentOf("brambleburr", 40 * HOUR_MS),
      needs: { hunger: floor - 1, cleanliness: floor, happiness: floor, energy: floor },
    });
    expect(buildAilmentCardModel({ pips: { [high.id]: high }, inventory: {} }, high.id)?.needsAllHighForFreeChance).toBe(true);
    expect(buildAilmentCardModel({ pips: { [low.id]: low }, inventory: {} }, low.id)?.needsAllHighForFreeChance).toBe(false);
  });
});

describe("isRiskyExpedition — exactly the biomes with an ailment entry", () => {
  it("is safe for the three quick trails and risky for the three deep ones", () => {
    expect(isRiskyExpedition("meadow")).toBe(false);
    expect(isRiskyExpedition("forest")).toBe(false);
    expect(isRiskyExpedition("shore")).toBe(false);
    expect(isRiskyExpedition("bramblewick")).toBe(true);
    expect(isRiskyExpedition("snowdrift")).toBe(true);
    expect(isRiskyExpedition("lanterngrotto")).toBe(true);
  });
});

describe("buildRiskConfirmModel", () => {
  it("carries the shipped risk copy and a positive effective chance for a fresh Pip", () => {
    const pip = makePip();
    const model = buildRiskConfirmModel(pip, "bramblewick");
    expect(model?.isRisky).toBe(true);
    expect(model?.riskCopy).toBe(RISKY_TRAIL_COPY);
    expect(model?.baseChancePct).toBeGreaterThan(0);
    expect(model?.effectiveChancePct).toBeGreaterThan(0);
    expect(model?.immune).toBe(false);
  });

  it("is not risky for a safe trail, and carries the safe-trail copy", () => {
    const pip = makePip();
    const model = buildRiskConfirmModel(pip, "meadow");
    expect(model?.isRisky).toBe(false);
    expect(model?.riskCopy).toBe(SAFE_TRAIL_COPY);
    expect(model?.ailmentName).toBeNull();
    expect(model?.effectiveChancePct).toBe(0);
  });

  it("reports immune (0% effective) for a Pip already scarred against it", () => {
    const pip = makePip({ scars: ["brambleburr"] });
    const model = buildRiskConfirmModel(pip, "bramblewick");
    expect(model?.immune).toBe(true);
    expect(model?.effectiveChancePct).toBe(0);
  });

  it("null for an unknown expedition id (defensive)", () => {
    expect(buildRiskConfirmModel(makePip(), "nowhere")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DOM wiring
// ---------------------------------------------------------------------------

function baseState(overrides: Partial<GameState> = {}): GameState {
  const game = createNewGame(3, 0);
  return { ...game, ...overrides };
}

function recordedDispatch(): { dispatch(a: GameAction): void; actions: GameAction[] } {
  const actions: GameAction[] = [];
  return { dispatch: (a) => actions.push(a), actions };
}

describe("createAilmentView — DOM wiring", () => {
  it("the warning chip is hidden with nobody ailing, and visible once someone is", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip();
      let state = baseState({ pips: { [pip.id]: pip }, rosterOrder: [pip.id], activePipId: pip.id });
      const { dispatch } = recordedDispatch();
      const view = createAilmentView({ dispatch, getState: () => state, clock: { now: () => 0 } });
      const root = view.el as unknown as FakeElement;
      view.sync(state);
      const chip = root.querySelector(".pk-ailment-chip") as FakeElement;
      expect(chip.className).not.toContain("pk-ailment-chip--visible");

      const ailing = { ...pip, ailment: ailmentOf("brambleburr", 10 * HOUR_MS) };
      state = { ...state, pips: { [pip.id]: ailing } };
      view.sync(state);
      expect(chip.className).toContain("pk-ailment-chip--visible");
    } finally {
      dom.uninstall();
    }
  });

  it("open() paints the card, and giving a poultice with none in inventory does nothing", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip({ ailment: ailmentOf("brambleburr", 40 * HOUR_MS) });
      const state = baseState({
        pips: { [pip.id]: pip },
        rosterOrder: [pip.id],
        activePipId: pip.id,
        inventory: {},
      });
      const { dispatch, actions } = recordedDispatch();
      const view = createAilmentView({ dispatch, getState: () => state, clock: { now: () => 0 } });
      const root = view.el as unknown as FakeElement;
      view.open(pip.id);
      expect(view.isOpen).toBe(true);
      const btn = root.querySelector(".pk-ailment-poultice") as FakeElement;
      expect(btn.disabled).toBe(true);
      expect(actions).toHaveLength(0);
    } finally {
      dom.uninstall();
    }
  });

  it("giving a poultice with one in inventory dispatches GIVE_ITEM", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip({ ailment: ailmentOf("brambleburr", 40 * HOUR_MS) });
      const state = baseState({
        pips: { [pip.id]: pip },
        rosterOrder: [pip.id],
        activePipId: pip.id,
        inventory: { [POULTICE_ITEM_ID]: 1 },
      });
      const { dispatch, actions } = recordedDispatch();
      const view = createAilmentView({ dispatch, getState: () => state, clock: { now: () => 42 } });
      const root = view.el as unknown as FakeElement;
      view.open(pip.id);
      const btn = root.querySelector(".pk-ailment-poultice") as FakeElement;
      expect(btn.disabled).toBe(false);
      btn.click();
      expect(actions).toEqual([
        { type: "GIVE_ITEM", pipId: pip.id, itemId: POULTICE_ITEM_ID, at: 42 },
      ]);
    } finally {
      dom.uninstall();
    }
  });

  it("requestExpedition dispatches straight through for a safe trail", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip();
      const state = baseState({ pips: { [pip.id]: pip }, rosterOrder: [pip.id], activePipId: pip.id });
      const { dispatch, actions } = recordedDispatch();
      const view = createAilmentView({ dispatch, getState: () => state, clock: { now: () => 5 } });
      view.requestExpedition(pip.id, "meadow");
      expect(actions).toEqual([
        { type: "ASSIGN_EXPEDITION", pipId: pip.id, expeditionId: "meadow", at: 5 },
      ]);
    } finally {
      dom.uninstall();
    }
  });

  it("requestExpedition opens a confirm for a risky trail and only dispatches on Confirm", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip();
      const state = baseState({ pips: { [pip.id]: pip }, rosterOrder: [pip.id], activePipId: pip.id });
      const { dispatch, actions } = recordedDispatch();
      const view = createAilmentView({ dispatch, getState: () => state, clock: { now: () => 9 } });
      const root = view.el as unknown as FakeElement;
      view.requestExpedition(pip.id, "bramblewick");
      expect(actions).toHaveLength(0);
      const riskWrap = root.querySelector(".pk-ailment-risk-wrap") as FakeElement;
      expect(riskWrap.className).toContain("pk-ailment-risk-wrap--open");

      const send = root.querySelector(".pk-ailment-risk-send") as FakeElement;
      send.click();
      expect(actions).toEqual([
        { type: "ASSIGN_EXPEDITION", pipId: pip.id, expeditionId: "bramblewick", at: 9 },
      ]);
      expect(riskWrap.className).not.toContain("pk-ailment-risk-wrap--open");
    } finally {
      dom.uninstall();
    }
  });

  it("Cancel on the risk confirm never dispatches", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip();
      const state = baseState({ pips: { [pip.id]: pip }, rosterOrder: [pip.id], activePipId: pip.id });
      const { dispatch, actions } = recordedDispatch();
      const view = createAilmentView({ dispatch, getState: () => state, clock: { now: () => 9 } });
      const root = view.el as unknown as FakeElement;
      view.requestExpedition(pip.id, "snowdrift");
      const cancel = root.querySelector(".pk-ailment-risk-cancel") as FakeElement;
      cancel.click();
      expect(actions).toHaveLength(0);
    } finally {
      dom.uninstall();
    }
  });
});

// ---------------------------------------------------------------------------
// ROUND 2H FIX PASS — the card promised a free daily chance against no
// reducer at all, and pointed nowhere for the only cure that did work.
// ---------------------------------------------------------------------------

describe("the free-chance hint is TRUE, and actionable when it isn't yet earned", () => {
  const floor = contentTuning.lifecycle.ailments.devotedCareNeedFloor;

  it("confirms the chance is coming when every need clears the floor", () => {
    const pip = makePip({ needs: { hunger: 100, cleanliness: 100, happiness: 100, energy: 100 } });
    const hint = freeChanceHint(pip, floor);
    expect(hint).toMatch(/free chance/i);
    expect(hint).toContain(pip.name);
    expect(hint).not.toMatch(/bring every need up/i);
  });

  // "There's a free chance" is only actionable if the player can tell what
  // is standing in the way of it.
  it("NAMES the shortest need when one is short", () => {
    const cases: readonly [keyof PipState["needs"], RegExp][] = [
      ["hunger", /meal/i],
      ["cleanliness", /wash/i],
      ["happiness", /company/i],
      ["energy", /rest/i],
    ];
    for (const [need, phrase] of cases) {
      const needs = { hunger: 100, cleanliness: 100, happiness: 100, energy: 100 };
      needs[need] = 10;
      const hint = freeChanceHint(makePip({ needs }), floor);
      expect(hint, `${need} short`).toMatch(phrase);
      expect(hint).toMatch(/free chance/i);
    }
  });
});

describe("the Poultice is discoverable (the only working cure was undiscoverable)", () => {
  it("the card points at where poultices come from when the satchel has none", () => {
    const pip = makePip({ ailment: ailmentOf("brambleburr", 20 * HOUR_MS) });
    const model = buildAilmentCardModel({ pips: { [pip.id]: pip }, inventory: {} }, pip.id);
    expect(model?.poulticeSourceHint).toBe(POULTICE_SOURCE_HINT);
  });

  it("...and says nothing about sourcing when one is already in hand", () => {
    const pip = makePip({ ailment: ailmentOf("brambleburr", 20 * HOUR_MS) });
    const model = buildAilmentCardModel(
      { pips: { [pip.id]: pip }, inventory: { [POULTICE_ITEM_ID]: 2 } },
      pip.id,
    );
    expect(model?.poulticeSourceHint).toBeNull();
  });

  it("the hint names every deep trail that actually drops them", () => {
    for (const def of Object.values(contentAilments)) {
      const expedition = (
        contentExpeditions as Readonly<Record<string, { name: string; lootTable: readonly { itemId: string }[] }>>
      )[def.fromExpeditionId];
      expect(expedition).toBeDefined();
      // ...and the claim is true: that trail's loot table really has one.
      expect(expedition?.lootTable.some((e) => e.itemId === POULTICE_ITEM_ID)).toBe(true);
      expect(POULTICE_SOURCE_HINT).toContain(expedition?.name);
    }
  });

  it("the card offers the Long Meadow pause — the only escape hatch a frightened player has", () => {
    const pip = makePip({ ailment: ailmentOf("brambleburr", 20 * HOUR_MS) });
    const model = buildAilmentCardModel({ pips: { [pip.id]: pip }, inventory: {} }, pip.id);
    expect(model?.pauseHint).toMatch(/long meadow/i);
    expect(model?.pauseHint).toMatch(/nothing gets worse/i);
  });
});

describe("SHIELD TWO — the risk confirm offers the careful route", () => {
  it("offers it on every risky trail, with both halves of the cost stated", () => {
    for (const def of Object.values(contentAilments)) {
      const model = buildRiskConfirmModel(makePip(), def.fromExpeditionId);
      expect(model?.carefulOffered, def.fromExpeditionId).toBe(true);
      expect(model?.carefulLabel).toMatch(/long way round/i);
      expect(model?.carefulDetail).toMatch(/slower/i);
      expect(model?.carefulDetail).toMatch(/less/i);
      expect(model?.carefulDetail).toMatch(/nothing can follow them home/i);
    }
  });

  it("does not offer it where there is nothing to opt out of", () => {
    for (const safe of ["meadow", "forest", "shore"]) {
      expect(buildRiskConfirmModel(makePip(), safe)?.carefulOffered).toBe(false);
    }
    // ...nor to a Pip who is already immune — she has nothing to avoid.
    const scarred = makePip({ scars: ["brambleburr"] });
    expect(buildRiskConfirmModel(scarred, "bramblewick")?.carefulOffered).toBe(false);
  });
});

describe("SHIELD TWO — the toggle actually reaches the reducer (DOM)", () => {
  function openRisk(): {
    root: FakeElement;
    actions: GameAction[];
    dom: ReturnType<typeof installFakeDom>;
  } {
    const dom = installFakeDom();
    const pip = makePip();
    const state = baseState({
      pips: { [pip.id]: pip },
      rosterOrder: [pip.id],
      activePipId: pip.id,
      keep: { level: 4, placements: {} },
    });
    const { dispatch, actions } = recordedDispatch();
    const view = createAilmentView({ dispatch, getState: () => state, clock: { now: () => 0 } });
    const root = view.el as unknown as FakeElement;
    view.requestExpedition(pip.id, "bramblewick");
    return { root, actions, dom };
  }

  it("sends the ORDINARY route when the switch is left alone", () => {
    const { root, actions, dom } = openRisk();
    try {
      (root.querySelector(".pk-ailment-risk-send") as FakeElement).click();
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ type: "ASSIGN_EXPEDITION", expeditionId: "bramblewick" });
      expect((actions[0] as { careful?: boolean }).careful).toBeUndefined();
    } finally {
      dom.uninstall();
    }
  });

  it("sends the CAREFUL route once the switch is on — the opt-out is reachable, not just modelled", () => {
    const { root, actions, dom } = openRisk();
    try {
      const toggle = root.querySelector(".pk-ailment-risk-careful") as FakeElement;
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      toggle.click();
      const after = root.querySelector(".pk-ailment-risk-careful") as FakeElement;
      expect(after.getAttribute("aria-checked")).toBe("true");
      (root.querySelector(".pk-ailment-risk-send") as FakeElement).click();
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        type: "ASSIGN_EXPEDITION",
        expeditionId: "bramblewick",
        careful: true,
      });
    } finally {
      dom.uninstall();
    }
  });

  it("a SAFE trail skips the confirm entirely and never shows the switch", () => {
    const dom = installFakeDom();
    try {
      const pip = makePip();
      const state = baseState({
        pips: { [pip.id]: pip },
        rosterOrder: [pip.id],
        activePipId: pip.id,
      });
      const { dispatch, actions } = recordedDispatch();
      const view = createAilmentView({ dispatch, getState: () => state, clock: { now: () => 0 } });
      const root = view.el as unknown as FakeElement;
      view.requestExpedition(pip.id, "meadow");
      expect(actions).toHaveLength(1); // dispatched straight through
      expect((actions[0] as { careful?: boolean }).careful).toBeUndefined();
      expect(root.querySelector(".pk-ailment-risk-careful")).toBeNull();
    } finally {
      dom.uninstall();
    }
  });
});
