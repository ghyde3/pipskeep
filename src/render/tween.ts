/**
 * Tiny tween utility (spec §11: "Animation via lightweight tween
 * utility") — zero dependencies, driven externally by `update(dtMs)` from
 * the render ticker so it stays trivially testable in node.
 *
 * Design: a tween is a list of sequential steps; each step eases 0→1 over
 * its duration and reports the eased value to `onUpdate`. Multi-step
 * sequences (jump → fall → land) are first-class so care animations
 * (spec §10.1.3) read as data. The squash-and-stretch helper (spec §11
 * "squash-and-stretch on actions") layers a volume-ish-preserving scale
 * wave on any `{ scale: { x, y } }` target — which Pixi containers
 * structurally satisfy without this module importing Pixi.
 */

export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;

/** Cubic ease-in — slow start (falls, wind-ups). */
export const easeIn: Ease = (t) => t * t * t;

/** Cubic ease-out — fast start, soft landing (most UI/juice motion). */
export const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3);

export const easeInOut: Ease = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Overshoots past 1 then settles — poppy arrivals. */
export const easeOutBack: Ease = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Springy wobble into place (spec §11 "bounce on hatch"-grade juice). */
export const elastic: Ease = (t) => {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/** One step of a tween: eases 0→1 over `durationMs` after `delayMs`. */
export interface TweenStep {
  readonly durationMs: number;
  readonly ease?: Ease;
  readonly delayMs?: number;
  /** Receives the EASED progress in [0, 1]. */
  readonly onUpdate?: (eased: number) => void;
  readonly onComplete?: () => void;
}

export interface TweenHandle {
  readonly done: boolean;
  /** Stop immediately; no further callbacks fire (incl. onComplete). */
  cancel(): void;
}

interface ActiveTween {
  steps: readonly TweenStep[];
  stepIndex: number;
  /** Elapsed ms within the current step (including its delay). */
  elapsedMs: number;
  done: boolean;
  cancelled: boolean;
}

/**
 * Owns and advances tweens. The scene calls `update(dtMs)` once per frame;
 * everything else registers via `add`/`sequence`.
 */
export class TweenRunner {
  private tweens: ActiveTween[] = [];

  /** Single-step tween. */
  add(step: TweenStep): TweenHandle {
    return this.sequence([step]);
  }

  /** Steps run back-to-back; the handle covers the whole chain. */
  sequence(steps: readonly TweenStep[]): TweenHandle {
    const tween: ActiveTween = {
      steps,
      stepIndex: 0,
      elapsedMs: 0,
      done: steps.length === 0,
      cancelled: false,
    };
    this.tweens.push(tween);
    return {
      get done() {
        return tween.done;
      },
      cancel() {
        tween.cancelled = true;
        tween.done = true;
      },
    };
  }

  /** Convenience: fire a callback after `delayMs` (a zero-length step). */
  after(delayMs: number, fn: () => void): TweenHandle {
    return this.add({ durationMs: 0, delayMs, onComplete: fn });
  }

  /** Number of live (not done) tweens — scenes use this to pause idle
   * breathing while a care animation owns the rig. */
  get active(): number {
    return this.tweens.length;
  }

  update(dtMs: number): void {
    if (this.tweens.length === 0) return;
    for (const tween of this.tweens) {
      let budget = dtMs;
      // A step's leftover time flows into the next step so chains never
      // drift by a frame per step.
      while (!tween.done && budget >= 0) {
        const step = tween.steps[tween.stepIndex];
        if (step === undefined) {
          tween.done = true;
          break;
        }
        const delay = step.delayMs ?? 0;
        const total = delay + step.durationMs;
        tween.elapsedMs += budget;
        budget = 0;
        const inStep = tween.elapsedMs - delay;
        if (inStep < 0) break; // still delayed
        const t =
          step.durationMs <= 0 ? 1 : Math.min(1, inStep / step.durationMs);
        step.onUpdate?.((step.ease ?? linear)(t));
        if (tween.cancelled) break;
        if (t < 1) break; // mid-step — wait for the next frame
        step.onComplete?.();
        if (tween.cancelled) break;
        budget = tween.elapsedMs - total;
        tween.elapsedMs = 0;
        tween.stepIndex += 1;
        if (tween.stepIndex >= tween.steps.length) tween.done = true;
      }
    }
    this.tweens = this.tweens.filter((t) => !t.done);
  }

  /** Drop everything (scene teardown / sprite rebuild). */
  clear(): void {
    for (const t of this.tweens) t.cancelled = true;
    this.tweens = [];
  }
}

/** Anything with a mutable 2D scale — Pixi containers qualify. */
export interface SquashTarget {
  scale: { x: number; y: number };
}

export interface SquashOptions {
  /** Peak deviation from base scale (0.18 → 118% wide / 82% tall). */
  readonly amount?: number;
  /** Duration of ONE squash cycle. */
  readonly cycleMs?: number;
  /** Number of cycles (3 = munch-munch-munch). */
  readonly cycles?: number;
  readonly baseX?: number;
  readonly baseY?: number;
  readonly onComplete?: () => void;
}

/**
 * Squash-and-stretch: `cycles` alternating deformation pulses —
 * wide-and-flat, then tall-and-thin, then wide again… (sine half-waves,
 * which reads as chewing/bouncing) — returning to exactly the base scale
 * at the end (integer cycles ⇒ sin ends at 0).
 */
export function squashStretch(
  runner: TweenRunner,
  target: SquashTarget,
  options: SquashOptions = {},
): TweenHandle {
  const amount = options.amount ?? 0.16;
  const cycles = Math.max(1, Math.round(options.cycles ?? 1));
  const cycleMs = options.cycleMs ?? 160;
  const baseX = options.baseX ?? 1;
  const baseY = options.baseY ?? 1;
  return runner.add({
    durationMs: cycleMs * cycles,
    ease: linear,
    onUpdate: (t) => {
      const wave = Math.sin(Math.PI * cycles * t);
      target.scale.x = baseX * (1 + amount * wave);
      target.scale.y = baseY * (1 - amount * wave);
    },
    onComplete: () => {
      target.scale.x = baseX;
      target.scale.y = baseY;
      options.onComplete?.();
    },
  });
}
