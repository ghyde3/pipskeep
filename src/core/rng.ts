/**
 * Seeded randomness (spec §2 rule 3).
 *
 * This file is the ONLY place in the repo allowed to produce randomness,
 * and even here nothing calls `Math.random()` — mulberry32 is fully
 * deterministic from its 32-bit state.
 *
 * Design:
 * - One `Rng` per save, created from the save's `seed`.
 * - Named streams (`rng.stream("expedition-loot")`) derive their initial
 *   state from `seed XOR fnv1a(name)`, so systems never perturb each
 *   other's sequences.
 * - Every stream's current 32-bit cursor is readable (`getState()`) and
 *   restorable (`createRngFromState(seed, state)`). Cursors live inside
 *   `GameState` and are serialized in the save — reloading never re-rolls
 *   or skips an outcome.
 */

const UINT32_RANGE = 4294967296; // 2 ** 32

/** FNV-1a 32-bit hash — deterministic stream-name → offset derivation. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A named, deterministic random stream. */
export interface RngStream {
  /** Next float in [0, 1). Advances the cursor. */
  next(): number;
  /** Integer in [0, maxExclusive). `maxExclusive` must be a positive integer. */
  int(maxExclusive: number): number;
  /** Uniformly random element of a non-empty array. */
  pick<T>(array: readonly T[]): T;
  /** True with probability `p` (0 → never, 1 → always). */
  chance(p: number): boolean;
  /** Current 32-bit cursor of this stream. */
  getState(): number;
}

export interface Rng {
  readonly seed: number;
  /** Get (or lazily create) the named stream. Same name → same stream object. */
  stream(name: string): RngStream;
  /**
   * Cursor snapshot of every stream touched so far, keyed by stream name.
   * Streams absent from the snapshot are untouched and re-derive
   * identically from the seed.
   */
  getState(): Record<string, number>;
}

class MulberryStream implements RngStream {
  private state: number;

  constructor(initialState: number) {
    this.state = initialState >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  }

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(
        `int(maxExclusive) requires a positive integer, got ${maxExclusive}`,
      );
    }
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new RangeError("pick() called with an empty array");
    }
    // Index is always in [0, array.length); noUncheckedIndexedAccess
    // widens the access to T | undefined, hence the assertion.
    return array[this.int(array.length)] as T;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  getState(): number {
    return this.state;
  }
}

/** Fresh RNG for a new save. All streams derive from `seed`. */
export function createRng(seed: number): Rng {
  return createRngFromState(seed, {});
}

/**
 * RNG restored from saved cursors. Streams named in `state` resume exactly
 * where they left off; unnamed streams derive fresh from `seed` (which is
 * also exactly what they would have been before the save).
 */
export function createRngFromState(
  seed: number,
  state: Readonly<Record<string, number>>,
): Rng {
  const seed32 = seed >>> 0;
  const streams = new Map<string, MulberryStream>();
  for (const [name, cursor] of Object.entries(state)) {
    streams.set(name, new MulberryStream(cursor));
  }
  return {
    seed: seed32,
    stream(name: string): RngStream {
      let s = streams.get(name);
      if (s === undefined) {
        s = new MulberryStream((seed32 ^ fnv1a(name)) >>> 0);
        streams.set(name, s);
      }
      return s;
    },
    getState(): Record<string, number> {
      const snapshot: Record<string, number> = {};
      for (const [name, s] of streams) {
        snapshot[name] = s.getState();
      }
      return snapshot;
    },
  };
}
