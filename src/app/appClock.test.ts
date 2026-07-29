/**
 * OffsetClock tests: the offset math itself, and the skew → TICK
 * integration the debug menu relies on — skewing the shared clock and
 * dispatching TICK must produce EXACTLY the decay the skipped time
 * would have produced (Phase 1 exactness, driven through the app clock).
 * Composed over FakeClock throughout, as production composes over
 * SystemClock.
 */

import { describe, expect, it } from "vitest";
import { FakeClock } from "../core/clock";
import { HOUR_MS, tuning } from "../content/tuning";
import { createStore } from "../core/store";
import { createNewGame, rootReducer } from "../core/state";
import type { StarterContent } from "../core/state";
import { applyNeedsDelta } from "../core/pips/needs";
import { OffsetClock } from "./appClock";

describe("OffsetClock math", () => {
  it("with no skew, now() mirrors the wrapped clock", () => {
    const inner = new FakeClock(5_000);
    const clock = new OffsetClock(inner);
    expect(clock.now()).toBe(5_000);
    expect(clock.offsetMs()).toBe(0);
    inner.advance(250);
    expect(clock.now()).toBe(5_250);
  });

  it("skew() adds to now() and accumulates across calls", () => {
    const inner = new FakeClock(1_000);
    const clock = new OffsetClock(inner);
    clock.skew(HOUR_MS);
    expect(clock.now()).toBe(1_000 + HOUR_MS);
    expect(clock.offsetMs()).toBe(HOUR_MS);
    clock.skew(6 * HOUR_MS);
    clock.skew(24 * HOUR_MS);
    expect(clock.offsetMs()).toBe(31 * HOUR_MS);
    expect(clock.now()).toBe(1_000 + 31 * HOUR_MS);
  });

  it("negative skew un-skews; the wrapped clock keeps moving underneath", () => {
    const inner = new FakeClock(0);
    const clock = new OffsetClock(inner);
    clock.skew(HOUR_MS);
    clock.skew(-HOUR_MS);
    expect(clock.offsetMs()).toBe(0);
    inner.advance(42);
    expect(clock.now()).toBe(42);
  });

  it("honors an initial offset", () => {
    const clock = new OffsetClock(new FakeClock(100), 900);
    expect(clock.now()).toBe(1_000);
    expect(clock.offsetMs()).toBe(900);
  });
});

/** Pin the starter personality so decay multipliers are exact known
 * numbers (curious: hunger ×1.0 — the ±0 assertion below). */
const CURIOUS_ONLY: StarterContent = {
  speciesId: "mosspip",
  palettes: ["fern"],
  patterns: ["plain"],
  accessorySlots: 1,
  personalityIds: ["curious"],
  startingInventory: { berry: 3 },
};

describe("skew → TICK integration (the debug menu's fast-forward)", () => {
  it("skewing +6h then TICKing at clock.now() applies exactly 6h of decay", () => {
    const inner = new FakeClock(10_000);
    const clock = new OffsetClock(inner);
    const store = createStore(
      rootReducer,
      createNewGame(7, clock.now(), CURIOUS_ONLY),
    );
    const before = store.getState().pips["pip-1"];
    expect(before).toBeDefined();
    if (before === undefined) return;

    clock.skew(6 * HOUR_MS);
    store.dispatch({ type: "TICK", at: clock.now() });

    const after = store.getState().pips["pip-1"];
    // Exactness contract: identical to applyNeedsDelta over 6 hours…
    expect(after?.needs).toStrictEqual(applyNeedsDelta(before, 6).needs);
    // …and in plain numbers: hunger 60 − 6h × 6/h × 1.0 (curious, adult,
    // idle) = 24, ±0.
    expect(after?.needs.hunger).toBe(
      60 - 6 * -tuning.needDecayPerHour.hunger,
    );
    expect(store.getState().lastTickAt).toBe(10_000 + 6 * HOUR_MS);
  });

  it("consecutive skews decay piecewise to the same place as one big skew", () => {
    const makeGame = () =>
      createStore(rootReducer, createNewGame(7, 0, CURIOUS_ONLY));

    // 1h + 2h + 3h keeps every need above the floor (no Sulking, no
    // clamping), so this is a real linearity check, not 0 === 0.
    const piecewise = makeGame();
    const clockA = new OffsetClock(new FakeClock(0));
    for (const hours of [1, 2, 3]) {
      clockA.skew(hours * HOUR_MS);
      piecewise.dispatch({ type: "TICK", at: clockA.now() });
    }

    const oneShot = makeGame();
    const clockB = new OffsetClock(new FakeClock(0));
    clockB.skew(6 * HOUR_MS);
    oneShot.dispatch({ type: "TICK", at: clockB.now() });

    const a = piecewise.getState().pips["pip-1"];
    const b = oneShot.getState().pips["pip-1"];
    for (const need of ["hunger", "cleanliness", "happiness", "energy"] as const) {
      expect(a?.needs[need]).toBeCloseTo(b?.needs[need] ?? Number.NaN, 10);
    }
    expect(a?.needs.hunger).toBe(24); // 60 − 6h × 6/h, above the floor
    expect(piecewise.getState().lastTickAt).toBe(6 * HOUR_MS);
  });
});
