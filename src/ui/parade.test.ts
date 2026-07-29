/**
 * Keep-chip rapid-tap counter tests: the pure sliding-window step
 * function, the stateful counter, and the no-dispatch-by-construction
 * guarantee (the controller's whole dependency surface is now() +
 * start() — it cannot reach a store even in principle).
 */

import { describe, expect, it } from "vitest";
import {
  PARADE_TAP_COUNT,
  PARADE_TAP_WINDOW_MS,
  createParadeTapCounter,
  paradeTapStep,
} from "./parade";
import type { ParadeTapDeps } from "./parade";

describe("paradeTapStep — pure sliding-window streak", () => {
  it("triggers on the Nth tap when all land inside the window", () => {
    let taps: readonly number[] = [];
    for (let i = 0; i < PARADE_TAP_COUNT - 1; i++) {
      const step = paradeTapStep(taps, i * 100);
      expect(step.triggered).toBe(false);
      taps = step.taps;
    }
    const last = paradeTapStep(taps, (PARADE_TAP_COUNT - 1) * 100);
    expect(last.triggered).toBe(true);
    expect(last.taps).toEqual([]); // the streak is consumed
  });

  it("never triggers when the taps straddle the window", () => {
    // One tap every windowMs/(count-1) + 1ms: by each Nth tap the first
    // has just fallen out — the streak can never reach count.
    const gap = Math.floor(PARADE_TAP_WINDOW_MS / (PARADE_TAP_COUNT - 1)) + 1;
    let taps: readonly number[] = [];
    for (let i = 0; i < PARADE_TAP_COUNT * 3; i++) {
      const step = paradeTapStep(taps, i * gap);
      expect(step.triggered).toBe(false);
      taps = step.taps;
    }
  });

  it("drops stale taps but keeps the live tail of the streak", () => {
    // 3 early taps go stale; 4 recent ones + this tap = 5 < 7.
    const taps = [0, 10, 20, 5_000, 5_100, 5_200, 5_300];
    const step = paradeTapStep(taps, 5_400);
    expect(step.triggered).toBe(false);
    expect(step.taps).toEqual([5_000, 5_100, 5_200, 5_300, 5_400]);
  });

  it("drops future taps (clock skewed backwards) instead of counting them", () => {
    const step = paradeTapStep([9_999_999], 1_000);
    expect(step.taps).toEqual([1_000]);
    expect(step.triggered).toBe(false);
  });

  it("honors injected count/window options", () => {
    const first = paradeTapStep([], 0, { count: 2, windowMs: 50 });
    expect(first.triggered).toBe(false);
    expect(paradeTapStep(first.taps, 40, { count: 2, windowMs: 50 }).triggered).toBe(true);
    expect(paradeTapStep(first.taps, 60, { count: 2, windowMs: 50 }).triggered).toBe(false);
  });
});

describe("createParadeTapCounter — stateful wrapper", () => {
  function harness(): {
    counter: ReturnType<typeof createParadeTapCounter>;
    fired: () => number;
    advance: (ms: number) => void;
  } {
    let now = 0;
    let fired = 0;
    const counter = createParadeTapCounter({
      now: () => now,
      start: () => {
        fired += 1;
      },
    });
    return {
      counter,
      fired: () => fired,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("fires start() exactly once per completed streak, then resets", () => {
    const h = harness();
    for (let round = 1; round <= 2; round++) {
      for (let i = 0; i < PARADE_TAP_COUNT - 1; i++) {
        expect(h.counter.tap()).toBe(false);
        h.advance(100);
      }
      expect(h.counter.tap()).toBe(true);
      expect(h.fired()).toBe(round);
      h.advance(10_000); // stroll away; next round needs a fresh streak
    }
  });

  it("slow tapping never fires", () => {
    const h = harness();
    for (let i = 0; i < PARADE_TAP_COUNT * 2; i++) {
      expect(h.counter.tap()).toBe(false);
      h.advance(PARADE_TAP_WINDOW_MS);
    }
    expect(h.fired()).toBe(0);
  });

  it("takes no dispatch reference at all — enforced by construction", () => {
    // The deps type is the guarantee: now() + start() is the ENTIRE
    // surface. Drive a full streak through a Proxy that throws on any
    // other property access — if the controller ever grew a store,
    // dispatch, or state read, this test would explode.
    let now = 0;
    let started = 0;
    const deps = new Proxy({} as ParadeTapDeps, {
      get(_target, prop) {
        if (prop === "now") return () => now;
        if (prop === "start") return () => void (started += 1);
        throw new Error(
          `parade controller reached for forbidden dep ${String(prop)}`,
        );
      },
    });
    const counter = createParadeTapCounter(deps);
    for (let i = 0; i < PARADE_TAP_COUNT; i++) {
      counter.tap();
      now += 50;
    }
    expect(started).toBe(1);
  });
});
