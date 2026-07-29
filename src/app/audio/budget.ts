/**
 * The musicality guards, as pure bookkeeping.
 *
 * Two failure modes this exists to prevent:
 *
 *   1. MACHINE-GUNNING. `sound("ui.tap")` fires on every tap, and a
 *      player mashing a Pip can produce twenty in a second. Twenty
 *      identical blips is not a sound effect, it is a buzzer. Each slot
 *      carries a cooldown; plays inside it are dropped, not queued
 *      (queueing just moves the buzzer later).
 *   2. MUD. Overlapping cues sum, and enough of them turn the master
 *      limiter into a permanent duck. A global voice cap bounds how much
 *      can be ringing at once.
 *
 * Priority 2 cues (hatches, level-ups, evolution, the parade) ignore the
 * voice cap — a once-a-session moment must never be eaten by a burst of
 * chatter. They still respect their own cooldown, so one moment cannot
 * fire twice.
 *
 * All times are SECONDS on the audio clock (`ctx.currentTime`), which is
 * the only timebase that matters for scheduling. Nothing here reads a
 * clock itself: `at` is always passed in, so tests drive it directly.
 */

/** Simultaneously-ringing oscillators/sources before droppable cues get
 * refused. ~18 keeps a dense moment (fanfare + toast + taps) intact
 * while stopping a runaway pile-up. */
export const DEFAULT_MAX_VOICES = 18;

export interface VoiceBudget {
  /** False when this slot played too recently. */
  canPlay(slot: string, at: number, cooldownSec: number): boolean;
  /** Room for `cost` more voices at `at`? Priority 2 always says yes. */
  hasRoom(at: number, cost: number, priority: number): boolean;
  /** Record an admitted cue: starts its cooldown and books its voices. */
  commit(slot: string, at: number, end: number, cost: number): void;
  /** Voices still ringing at `at` (prunes expired entries). */
  activeVoices(at: number): number;
  /** Forget everything (context loss / re-init). */
  reset(): void;
}

interface Booking {
  readonly end: number;
  readonly cost: number;
}

export function createVoiceBudget(
  maxVoices: number = DEFAULT_MAX_VOICES,
): VoiceBudget {
  const lastPlayed = new Map<string, number>();
  let bookings: Booking[] = [];

  const prune = (at: number): number => {
    let total = 0;
    const kept: Booking[] = [];
    for (const booking of bookings) {
      if (booking.end > at) {
        kept.push(booking);
        total += booking.cost;
      }
    }
    bookings = kept;
    return total;
  };

  return {
    canPlay(slot, at, cooldownSec) {
      const last = lastPlayed.get(slot);
      if (last === undefined) return true;
      // `at < last` means the clock went backwards (a fresh context after
      // a suspend). Treat that as "no history" rather than locking the
      // slot out until the audio clock catches up again.
      if (at < last) return true;
      return at - last >= cooldownSec;
    },

    hasRoom(at, cost, priority) {
      if (priority >= 2) return true;
      return prune(at) + cost <= maxVoices;
    },

    commit(slot, at, end, cost) {
      lastPlayed.set(slot, at);
      bookings.push({ end, cost });
    },

    activeVoices(at) {
      return prune(at);
    },

    reset() {
      lastPlayed.clear();
      bookings = [];
    },
  };
}
