/**
 * Tween utility tests (render/tween.ts is pure logic — the one piece of
 * render/ that unit-tests per spec §1 "Vitest for all logic modules").
 */

import { describe, expect, it } from "vitest";
import {
  TweenRunner,
  easeIn,
  easeOut,
  easeOutBack,
  elastic,
  linear,
  squashStretch,
} from "./tween";

describe("eases", () => {
  it("all map 0 → 0 and 1 → 1", () => {
    for (const ease of [linear, easeIn, easeOut, easeOutBack, elastic]) {
      expect(ease(0)).toBeCloseTo(0, 10);
      expect(ease(1)).toBeCloseTo(1, 10);
    }
  });

  it("easeOut front-loads progress; easeIn back-loads it", () => {
    expect(easeOut(0.3)).toBeGreaterThan(0.3);
    expect(easeIn(0.3)).toBeLessThan(0.3);
  });
});

describe("TweenRunner", () => {
  it("advances a tween to completion and reports eased progress", () => {
    const runner = new TweenRunner();
    const seen: number[] = [];
    let completed = 0;
    runner.add({
      durationMs: 100,
      ease: linear,
      onUpdate: (t) => seen.push(t),
      onComplete: () => (completed += 1),
    });
    runner.update(40);
    runner.update(40);
    runner.update(40);
    expect(seen).toEqual([0.4, 0.8, 1]);
    expect(completed).toBe(1);
    expect(runner.active).toBe(0);
  });

  it("honours delayMs before progressing", () => {
    const runner = new TweenRunner();
    const seen: number[] = [];
    runner.add({
      durationMs: 100,
      delayMs: 50,
      ease: linear,
      onUpdate: (t) => seen.push(t),
    });
    runner.update(40); // still inside the delay
    expect(seen).toEqual([]);
    runner.update(60); // 50ms delay + 50ms progress
    expect(seen).toEqual([0.5]);
  });

  it("chains sequence steps without losing leftover frame time", () => {
    const runner = new TweenRunner();
    const log: string[] = [];
    runner.sequence([
      {
        durationMs: 50,
        ease: linear,
        onUpdate: (t) => log.push(`a${t}`),
        onComplete: () => log.push("a-done"),
      },
      {
        durationMs: 50,
        ease: linear,
        onUpdate: (t) => log.push(`b${t}`),
        onComplete: () => log.push("b-done"),
      },
    ]);
    // 80ms: step a completes (50) and step b receives the 30ms remainder.
    runner.update(80);
    expect(log).toEqual(["a1", "a-done", "b0.6"]);
    runner.update(20);
    expect(log).toEqual(["a1", "a-done", "b0.6", "b1", "b-done"]);
  });

  it("cancel() stops all further callbacks including onComplete", () => {
    const runner = new TweenRunner();
    let updates = 0;
    let completed = 0;
    const handle = runner.add({
      durationMs: 100,
      onUpdate: () => (updates += 1),
      onComplete: () => (completed += 1),
    });
    runner.update(50);
    handle.cancel();
    runner.update(100);
    expect(updates).toBe(1);
    expect(completed).toBe(0);
    expect(handle.done).toBe(true);
    expect(runner.active).toBe(0);
  });

  it("after() fires exactly once at its delay", () => {
    const runner = new TweenRunner();
    let fired = 0;
    runner.after(100, () => (fired += 1));
    runner.update(99);
    expect(fired).toBe(0);
    runner.update(1);
    expect(fired).toBe(1);
    runner.update(500);
    expect(fired).toBe(1);
  });

  it("zero-duration steps complete on the first update", () => {
    const runner = new TweenRunner();
    const seen: number[] = [];
    runner.add({ durationMs: 0, onUpdate: (t) => seen.push(t) });
    runner.update(16);
    expect(seen).toEqual([1]);
  });
});

describe("squashStretch", () => {
  it("deforms mid-cycle and restores the base scale exactly at the end", () => {
    const runner = new TweenRunner();
    const target = { scale: { x: 1, y: 1 } };
    squashStretch(runner, target, { amount: 0.2, cycleMs: 100, cycles: 1 });
    runner.update(50); // peak of the sine
    expect(target.scale.x).toBeCloseTo(1.2, 5);
    expect(target.scale.y).toBeCloseTo(0.8, 5);
    runner.update(50);
    expect(target.scale.x).toBe(1);
    expect(target.scale.y).toBe(1);
  });

  it("runs the requested number of pulses (multi-munch)", () => {
    const runner = new TweenRunner();
    const target = { scale: { x: 1, y: 1 } };
    // Pulses alternate wide-flat / tall-thin; count |deviation| peaks.
    let pulses = 0;
    let wasDeformed = false;
    squashStretch(runner, target, { amount: 0.2, cycleMs: 100, cycles: 3 });
    for (let i = 0; i < 60; i++) {
      runner.update(5);
      const deformed = Math.abs(target.scale.x - 1) > 0.15;
      if (deformed && !wasDeformed) pulses += 1;
      wasDeformed = deformed;
    }
    expect(pulses).toBe(3);
    expect(target.scale.x).toBe(1);
    expect(target.scale.y).toBe(1);
  });

  it("respects a non-1 base scale", () => {
    const runner = new TweenRunner();
    const target = { scale: { x: 0.7, y: 0.7 } };
    squashStretch(runner, target, {
      amount: 0.1,
      cycleMs: 100,
      baseX: 0.7,
      baseY: 0.7,
    });
    runner.update(50);
    expect(target.scale.x).toBeCloseTo(0.7 * 1.1, 5);
    runner.update(50);
    expect(target.scale.x).toBe(0.7);
  });
});
