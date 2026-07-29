/**
 * Frame-time statistics for the dev perf harness (?perf, spec §1
 * performance budgets).
 *
 * Pure logic, fully unit-tested: a fixed-capacity ring buffer of rAF
 * frame deltas plus derived stats. The DOM/rAF wiring lives in
 * perfMode.ts (dev-only, like debugMenu); this module never reads a
 * clock — callers feed it deltas they measured themselves.
 *
 * Stats reported against the spec §1 budgets:
 * - avg FPS + p95 frame time over the ring window (the "60 fps with
 *   5 pips + 30 decorations" budget);
 * - worst frame in the window;
 * - a CUMULATIVE count of spikes above `spikeThresholdMs` (default
 *   50 ms — the "no frame-time spikes > 50ms" budget), independent of
 *   the ring so a spike is never forgotten by wraparound.
 */

export interface FrameSnapshot {
  /** Frames currently held in the ring (≤ capacity). */
  readonly frames: number;
  /** Mean FPS over the ring window (0 while empty). */
  readonly avgFps: number;
  /** Mean frame time in ms over the ring window (0 while empty). */
  readonly avgFrameMs: number;
  /** 95th-percentile frame time in ms over the ring window. */
  readonly p95FrameMs: number;
  /** Worst frame time in ms over the ring window. */
  readonly maxFrameMs: number;
  /** Total frames recorded since construction (not just the window). */
  readonly totalFrames: number;
  /** Cumulative frames above the spike threshold since construction. */
  readonly spikeCount: number;
}

export interface FrameStats {
  /** Record one frame delta (ms between consecutive rAF timestamps). */
  record(deltaMs: number): void;
  snapshot(): FrameSnapshot;
}

export const DEFAULT_RING_CAPACITY = 180; // ~3s at 60fps
/** Spec §1: "No frame-time spikes > 50ms". */
export const SPIKE_THRESHOLD_MS = 50;

export function createFrameStats(
  capacity = DEFAULT_RING_CAPACITY,
  spikeThresholdMs = SPIKE_THRESHOLD_MS,
): FrameStats {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(`createFrameStats: capacity must be a positive integer, got ${capacity}`);
  }
  const ring = new Float64Array(capacity);
  let next = 0; // write index
  let filled = 0; // ≤ capacity
  let totalFrames = 0;
  let spikeCount = 0;

  return {
    record(deltaMs: number): void {
      if (!Number.isFinite(deltaMs) || deltaMs < 0) return; // clock hiccup — drop
      ring[next] = deltaMs;
      next = (next + 1) % capacity;
      if (filled < capacity) filled++;
      totalFrames++;
      if (deltaMs > spikeThresholdMs) spikeCount++;
    },

    snapshot(): FrameSnapshot {
      if (filled === 0) {
        return {
          frames: 0,
          avgFps: 0,
          avgFrameMs: 0,
          p95FrameMs: 0,
          maxFrameMs: 0,
          totalFrames,
          spikeCount,
        };
      }
      const window = Array.from(ring.subarray(0, filled)).sort((a, b) => a - b);
      let sum = 0;
      for (const d of window) sum += d;
      const avgFrameMs = sum / filled;
      // Nearest-rank p95 (1-based rank ⌈0.95·n⌉) — for n < 20 this is
      // simply the max, which is the honest answer for tiny samples.
      const p95Index = Math.min(filled - 1, Math.ceil(filled * 0.95) - 1);
      return {
        frames: filled,
        avgFps: avgFrameMs > 0 ? 1000 / avgFrameMs : 0,
        avgFrameMs,
        p95FrameMs: window[p95Index] as number,
        maxFrameMs: window[filled - 1] as number,
        totalFrames,
        spikeCount,
      };
    },
  };
}
