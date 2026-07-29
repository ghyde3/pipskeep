/**
 * Phase 4 wiring — pure effect-diff tests (node), driven through the REAL
 * reducer so the paths exercised are the ones the game ships: live
 * expedition returns raise a toast + the reveal cue; eggs flipping to
 * Pipping raise the tease; a meaningful CATCHUP suppresses per-event
 * toasts (the away sheet tells that story); the roster-cap hatch refusal
 * surfaces the core's friendly message; and the egg-tap seam dispatches
 * HATCH_EGG with the app clock's timestamp.
 */

import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../core/clock";
import { createStore } from "../core/store";
import type { Store } from "../core/store";
import { createNewGame, rootReducer } from "../core/state";
import type { GameAction, GameState } from "../core/state";
import { HOUR_MS, tuning } from "../content/tuning";
import { ROSTER_FULL_MESSAGE } from "../content/eggs";
import { emitEggTap, setEggTapHandler } from "../render/eggTap";
import { diffPhase4, wireEggTaps } from "./phase4";

const T0 = 1_000_000;
const MEADOW_MS = tuning.expeditions.meadow.durationMs;
const INCUBATION_MS = tuning.eggs.incubationMsDefault;

function makeStore(seed = 7): Store<GameState, GameAction> {
  return createStore(rootReducer, createNewGame(seed, T0));
}

/** Dispatch and return the {prev, next} pair for diffing. */
function step(
  store: Store<GameState, GameAction>,
  action: GameAction,
): { prev: GameState; next: GameState } {
  const prev = store.getState();
  store.dispatch(action);
  return { prev, next: store.getState() };
}

/** Spawn `count` Pipping eggs via the debug action + a settling TICK. */
function spawnPippingEggs(
  store: Store<GameState, GameAction>,
  count: number,
  at: number,
): void {
  for (let i = 0; i < count; i++) {
    store.dispatch({ type: "DEBUG_SPAWN_EGG", at });
  }
  store.dispatch({ type: "TICK", at: at + INCUBATION_MS });
}

afterEach(() => setEggTapHandler(null));

describe("diffPhase4 — live expedition return", () => {
  it("a completed trip raises the return toast and the reveal cue", () => {
    const store = makeStore();
    store.dispatch({
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    expect(store.getState().lastAssignOutcome?.ok).toBe(true);

    const { prev, next } = step(store, { type: "TICK", at: T0 + MEADOW_MS });
    expect(next.pendingReveals).toHaveLength(1);

    const effects = diffPhase4(prev, next);
    expect(effects.revealArrived).toBe(true);
    expect(effects.catchup).toBeNull();
    expect(effects.toasts).toHaveLength(1);
    expect(effects.toasts[0]?.kind).toBe("expeditionReturn");
    expect(effects.toasts[0]?.message).toContain("Mosspip");
    expect(effects.toasts[0]?.message).toContain("Meadow");
  });

  it("a tick with nothing due produces no effects", () => {
    const store = makeStore();
    const { prev, next } = step(store, { type: "TICK", at: T0 + 1_000 });
    const effects = diffPhase4(prev, next);
    expect(effects.toasts).toHaveLength(0);
    expect(effects.revealArrived).toBe(false);
    expect(effects.catchup).toBeNull();
  });
});

describe("diffPhase4 — egg Pipping tease", () => {
  it("an incubation completing live raises the tapping toast", () => {
    const store = makeStore();
    store.dispatch({ type: "DEBUG_SPAWN_EGG", at: T0 });
    const { prev, next } = step(store, {
      type: "TICK",
      at: T0 + INCUBATION_MS,
    });
    expect(next.eggs[0]?.state).toBe("pipping");

    const effects = diffPhase4(prev, next);
    expect(effects.toasts).toHaveLength(1);
    expect(effects.toasts[0]?.kind).toBe("eggPipping");
    expect(effects.toasts[0]?.message).toContain("tapping");
  });

  it("several eggs pipping at once tease as one plural toast", () => {
    const store = makeStore();
    store.dispatch({ type: "DEBUG_SPAWN_EGG", at: T0 });
    store.dispatch({ type: "DEBUG_SPAWN_EGG", at: T0 });
    const { prev, next } = step(store, {
      type: "TICK",
      at: T0 + INCUBATION_MS,
    });
    const effects = diffPhase4(prev, next);
    expect(effects.toasts).toHaveLength(1);
    expect(effects.toasts[0]?.kind).toBe("eggPipping");
    expect(effects.toasts[0]?.message).toContain("eggs");
  });
});

describe("diffPhase4 — meaningful catch-up defers to the away sheet", () => {
  it("returns settled during a long CATCHUP cue the sheet, not toasts", () => {
    const store = makeStore();
    store.dispatch({
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    const { prev, next } = step(store, {
      type: "CATCHUP",
      savedAt: T0,
      now: T0 + 4 * HOUR_MS,
    });
    expect(next.pendingReveals).toHaveLength(1);

    const effects = diffPhase4(prev, next);
    expect(effects.catchup).not.toBeNull();
    expect(effects.catchup?.elapsedMs).toBe(4 * HOUR_MS);
    expect(effects.revealArrived).toBe(true);
    expect(effects.toasts).toHaveLength(0); // the sheet tells this story
  });

  it("a CATCHUP below the meaningful threshold still toasts normally", () => {
    const store = makeStore();
    store.dispatch({
      type: "ASSIGN_EXPEDITION",
      pipId: "pip-1",
      expeditionId: "meadow",
      at: T0,
    });
    const { prev, next } = step(store, {
      type: "CATCHUP",
      savedAt: T0,
      now: T0 + MEADOW_MS + 1_000,
    });
    // Raise the bar via the injectable threshold: this absence includes a
    // return but is NOT sheet-worthy, so the toast must fire.
    const effects = diffPhase4(prev, next, {
      meaningfulCatchupMs: 10 * HOUR_MS,
    });
    expect(effects.toasts.some((t) => t.kind === "expeditionReturn")).toBe(true);
    expect(effects.catchup).not.toBeNull();
  });
});

describe("diffPhase4 — roster-cap hatch refusal (spec §7.4)", () => {
  it("surfaces the core's friendly message as an info toast; egg untouched", () => {
    const store = makeStore();
    spawnPippingEggs(store, tuning.rosterCap, T0);
    // Hatch up to the cap (starter + 2 = rosterCap of 3).
    for (let i = 0; i < tuning.rosterCap - 1; i++) {
      store.dispatch({
        type: "HATCH_EGG",
        eggId: `egg-${i + 1}`,
        at: T0 + INCUBATION_MS + 1,
      });
      expect(store.getState().lastHatchOutcome?.ok).toBe(true);
    }

    const lastEggId = `egg-${tuning.rosterCap}`;
    const { prev, next } = step(store, {
      type: "HATCH_EGG",
      eggId: lastEggId,
      at: T0 + INCUBATION_MS + 2,
    });
    expect(next.lastHatchOutcome?.ok).toBe(false);
    expect(next.eggs.some((egg) => egg.id === lastEggId)).toBe(true); // waits forever

    const effects = diffPhase4(prev, next);
    expect(effects.toasts).toHaveLength(1);
    expect(effects.toasts[0]?.kind).toBe("info");
    expect(effects.toasts[0]?.message).toBe(ROSTER_FULL_MESSAGE);
  });

  it("structural refusals (tap on a non-Pipping egg) stay silent", () => {
    const store = makeStore();
    store.dispatch({ type: "DEBUG_SPAWN_EGG", at: T0 }); // still Incubating
    const { prev, next } = step(store, {
      type: "HATCH_EGG",
      eggId: "egg-1",
      at: T0 + 1,
    });
    expect(next.lastHatchOutcome?.ok).toBe(false);
    expect(diffPhase4(prev, next).toasts).toHaveLength(0);
  });
});

describe("egg tap seam → HATCH_EGG", () => {
  it("wireEggTaps dispatches HATCH_EGG with the tapped id at clock.now()", () => {
    const clock = new FakeClock(42_000);
    const dispatched: GameAction[] = [];
    const store = {
      getState: () => createNewGame(1, T0),
      dispatch: (action: GameAction) => void dispatched.push(action),
      subscribe: () => () => {},
    } satisfies Store<GameState, GameAction>;

    wireEggTaps(store, clock);
    emitEggTap("egg-7");
    expect(dispatched).toStrictEqual([
      { type: "HATCH_EGG", eggId: "egg-7", at: 42_000 },
    ]);
  });

  it("a tap on a real Pipping egg hatches a Pipling through the reducer", () => {
    const clock = new FakeClock(T0 + INCUBATION_MS + 5);
    const store = makeStore();
    spawnPippingEggs(store, 1, T0);

    wireEggTaps(store, clock);
    emitEggTap("egg-1");

    const state = store.getState();
    expect(state.lastHatchOutcome).toMatchObject({
      ok: true,
      eggId: "egg-1",
      at: T0 + INCUBATION_MS + 5,
    });
    expect(state.eggs).toHaveLength(0);
    expect(state.rosterOrder).toHaveLength(2);
    const newborn = state.pips[state.rosterOrder[1]!];
    expect(newborn?.lifeStage).toBe("pipling");
  });

  it("unregistered taps are dropped silently", () => {
    setEggTapHandler(null);
    expect(() => emitEggTap("egg-1")).not.toThrow();
  });
});
