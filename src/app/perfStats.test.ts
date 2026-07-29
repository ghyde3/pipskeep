import { describe, expect, it } from "vitest";
import {
  createFrameStats,
  DEFAULT_RING_CAPACITY,
  SPIKE_THRESHOLD_MS,
} from "./perfStats";

describe("perfStats — rAF delta ring buffer (spec §1 budgets)", () => {
  it("starts empty: zeroed snapshot, no crash", () => {
    const stats = createFrameStats();
    expect(stats.snapshot()).toEqual({
      frames: 0,
      avgFps: 0,
      avgFrameMs: 0,
      p95FrameMs: 0,
      maxFrameMs: 0,
      totalFrames: 0,
      spikeCount: 0,
    });
  });

  it("rejects a non-positive or fractional capacity", () => {
    expect(() => createFrameStats(0)).toThrow();
    expect(() => createFrameStats(-5)).toThrow();
    expect(() => createFrameStats(2.5)).toThrow();
  });

  it("computes avg fps and frame time from recorded deltas", () => {
    const stats = createFrameStats(10);
    for (let i = 0; i < 6; i++) stats.record(16.666_67);
    const s = stats.snapshot();
    expect(s.frames).toBe(6);
    expect(s.avgFrameMs).toBeCloseTo(16.666_67, 3);
    expect(s.avgFps).toBeCloseTo(60, 1);
  });

  it("p95 is nearest-rank over the window; max is the worst frame", () => {
    const stats = createFrameStats(100);
    // 95 fast frames + 5 slow ones → p95 lands exactly on the boundary.
    for (let i = 0; i < 95; i++) stats.record(10);
    for (let i = 0; i < 5; i++) stats.record(40);
    const s = stats.snapshot();
    // rank ⌈100·0.95⌉ = 95 → the 95th smallest of [10×95, 40×5] is 10.
    expect(s.p95FrameMs).toBe(10);
    expect(s.maxFrameMs).toBe(40);
    // One more slow frame pushes the p95 rank into the slow tail.
    stats.record(40); // ring wraps: evicts one 10 (window now 94×10, 6×40)
    expect(stats.snapshot().p95FrameMs).toBe(40);
  });

  it("p95 of a tiny sample is the max (honest, not interpolated)", () => {
    const stats = createFrameStats(10);
    stats.record(10);
    stats.record(30);
    expect(stats.snapshot().p95FrameMs).toBe(30);
  });

  it("ring wraparound keeps only the newest `capacity` frames", () => {
    const stats = createFrameStats(4);
    for (const d of [100, 100, 100, 100, 10, 10, 10, 10]) stats.record(d);
    const s = stats.snapshot();
    expect(s.frames).toBe(4);
    expect(s.maxFrameMs).toBe(10); // all 100s evicted
    expect(s.totalFrames).toBe(8); // …but the lifetime count remembers
  });

  it("spike count is cumulative and survives wraparound", () => {
    const stats = createFrameStats(2, SPIKE_THRESHOLD_MS);
    stats.record(51); // spike
    stats.record(16);
    stats.record(16); // evicts the 51 from the ring…
    stats.record(200); // spike
    const s = stats.snapshot();
    expect(s.spikeCount).toBe(2); // …but not from the tally
    expect(s.maxFrameMs).toBe(200);
  });

  it("exactly-threshold frames are not spikes (budget is '> 50ms')", () => {
    const stats = createFrameStats(8);
    stats.record(SPIKE_THRESHOLD_MS);
    expect(stats.snapshot().spikeCount).toBe(0);
    stats.record(SPIKE_THRESHOLD_MS + 0.001);
    expect(stats.snapshot().spikeCount).toBe(1);
  });

  it("drops garbage deltas (negative, NaN, Infinity) without recording", () => {
    const stats = createFrameStats(8);
    stats.record(-1);
    stats.record(Number.NaN);
    stats.record(Number.POSITIVE_INFINITY);
    expect(stats.snapshot().frames).toBe(0);
    expect(stats.snapshot().totalFrames).toBe(0);
  });

  it("default capacity holds ~3s of 60fps frames", () => {
    expect(DEFAULT_RING_CAPACITY).toBe(180);
  });
});
