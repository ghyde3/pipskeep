/**
 * The Keep-chip rapid-tap counter and its controller.
 *
 * What it gates is a PURELY COSMETIC scene moment (render/keepScene.ts
 * `playParade`): dispatch-free, state-free beyond the roster the scene
 * already renders, and present in production builds. Because it must
 * never be able to touch gameplay, the controller's dependency surface
 * is the entire enforcement mechanism: `ParadeTapDeps` is `now()` +
 * `start()` and NOTHING else — no store, no dispatch, no state getter
 * can even be passed in. Tests pin this by construction.
 *
 * Trigger rule: PARADE_TAP_COUNT taps on the Keep-level chip inside a
 * sliding PARADE_TAP_WINDOW_MS window. `paradeTapStep` is the pure step
 * function (old tap list + a new tap's timestamp → new tap list +
 * whether the streak fired); the counter resets on fire so every parade
 * needs a fresh streak. Timestamps come from the caller's clock — no
 * Date.now() here (repo purity rule).
 */

/** Taps needed inside the window. */
export const PARADE_TAP_COUNT = 7;

/** Sliding window the streak must fit inside (~4s). */
export const PARADE_TAP_WINDOW_MS = 4_000;

export interface ParadeTapOptions {
  readonly count?: number;
  readonly windowMs?: number;
}

export interface ParadeTapStep {
  /** Tap timestamps still inside the window (empty after a trigger). */
  readonly taps: readonly number[];
  /** True exactly when this tap completed the streak. */
  readonly triggered: boolean;
}

/**
 * Advance the tap streak by one tap at `at`. Pure: same inputs, same
 * output. Stale taps (older than the window) and future taps (a clock
 * that jumped backwards — debug skew, never trust timestamps) are
 * dropped before counting; a trigger consumes the whole streak.
 */
export function paradeTapStep(
  taps: readonly number[],
  at: number,
  options: ParadeTapOptions = {},
): ParadeTapStep {
  const count = options.count ?? PARADE_TAP_COUNT;
  const windowMs = options.windowMs ?? PARADE_TAP_WINDOW_MS;
  const kept = taps.filter((t) => t <= at && at - t < windowMs);
  kept.push(at);
  if (kept.length >= count) {
    return { taps: [], triggered: true };
  }
  return { taps: kept, triggered: false };
}

/**
 * Everything the counter is ALLOWED to reach. Deliberately tiny — see
 * module doc: no dispatch, no store, no state. Do not widen this
 * interface; its narrowness is the no-gameplay guarantee.
 */
export interface ParadeTapDeps {
  /** Injected clock read (the app's shared OffsetClock in production). */
  now(): number;
  /** Fire the cosmetic moment (the scene hook). Called once per streak. */
  start(): void;
}

export interface ParadeTapCounter {
  /** Register one chip tap. Returns true when this tap triggered. */
  tap(): boolean;
}

/** Stateful wrapper around `paradeTapStep` for the DOM wiring. */
export function createParadeTapCounter(
  deps: ParadeTapDeps,
  options: ParadeTapOptions = {},
): ParadeTapCounter {
  let taps: readonly number[] = [];
  return {
    tap(): boolean {
      const step = paradeTapStep(taps, deps.now(), options);
      taps = step.taps;
      if (step.triggered) deps.start();
      return step.triggered;
    },
  };
}
