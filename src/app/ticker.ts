/**
 * Live game loop (spec §2 app/): requestAnimationFrame-driven, but
 * dispatches TICK at most once per TICK_INTERVAL_MS — the needs
 * simulation is cheap and time-derived, so once a second is plenty.
 *
 * Visibility (spec §4.5 spirit): the loop pauses while the document is
 * hidden — no background ticking — and on return dispatches a CATCHUP
 * over the hidden window (savedAt = the state's lastTickAt, i.e. exactly
 * where the needs simulation stopped), then resumes ticking. Long
 * absences therefore go through the same §4.5 segmented pass whether the
 * tab was closed or just backgrounded.
 *
 * Time comes from the injected Clock (spec §2 rule 2); this module never
 * calls Date.now().
 */

import type { Clock } from "../core/clock";
import type { Store } from "../core/store";
import type { GameAction, GameState } from "../core/state";

export const TICK_INTERVAL_MS = 1000;

export interface Ticker {
  stop(): void;
}

export function startTicker(
  store: Store<GameState, GameAction>,
  clock: Clock,
  doc: Document = document,
): Ticker {
  let rafId: number | null = null;
  let lastDispatchAt = clock.now();

  const loop = (): void => {
    rafId = requestAnimationFrame(loop);
    const now = clock.now();
    if (now - lastDispatchAt >= TICK_INTERVAL_MS) {
      lastDispatchAt = now;
      store.dispatch({ type: "TICK", at: now });
    }
  };

  const pause = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const resume = (): void => {
    if (rafId !== null) return;
    lastDispatchAt = clock.now();
    rafId = requestAnimationFrame(loop);
  };

  const onVisibility = (): void => {
    if (doc.hidden) {
      pause();
      return;
    }
    // Catch up over the hidden window before live ticking resumes.
    const savedAt = store.getState().lastTickAt;
    store.dispatch({ type: "CATCHUP", savedAt, now: clock.now() });
    resume();
  };

  doc.addEventListener("visibilitychange", onVisibility);
  resume();

  return {
    stop(): void {
      doc.removeEventListener("visibilitychange", onVisibility);
      pause();
    },
  };
}
