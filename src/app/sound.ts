/**
 * THE sound seam — `sound(slotId)`, called from render/ and ui/ at every
 * juicy moment in the game.
 *
 * ROUND 2A SCOPE CHANGE (amends spec §12, owner-approved): sound was a
 * deferred no-op seam; it is now REAL. The implementation is procedural
 * WebAudio synthesis in ./audio/ — no samples, no base64 blobs, and no
 * new dependencies (the §1 allowlist still reads pixi.js + idb). Not one
 * call site changed: the seam did exactly the job it was designed for.
 *
 * Shape of the thing:
 *
 *   sound("care.feed")            ← call sites, unchanged since Phase 2
 *        │
 *        ▼
 *   this module (mute state, autoplay unlock, preference persistence)
 *        │
 *        ▼
 *   audio/engine.ts → audio/schedule.ts → Web Audio nodes
 *
 * Three rules this module exists to enforce:
 *
 * 1. IT IS ALWAYS SAFE TO CALL. Before `initSound()`, after a context
 *    failure, in a node test with no `window` — `sound()` is a no-op that
 *    cannot throw. Audio is the least important thing in the game and is
 *    never allowed to break anything else.
 * 2. NOTHING HAPPENS BEFORE A GESTURE. Browsers block AudioContexts
 *    created outside a user gesture, so the context is built inside the
 *    first pointerdown/keydown — captured on the way DOWN the tree, so
 *    the tap that unlocks audio is also the tap you hear.
 * 3. RANDOMNESS COMES FROM core/rng, NEVER Math.random. The pitch jitter
 *    and the noise buffer run off a dedicated `audio-jitter` stream that
 *    is deliberately NOT part of GameState: presentation must never
 *    perturb a gameplay cursor (spec §2 rule 3), and "which micro-detune
 *    did that blip get" is not a fact a save has any business carrying.
 *
 * The mute preference lives in IndexedDB under its own key, through the
 * SAME key-value seam the save uses (app/persistence.ts's `SaveStore`) —
 * so it survives reloads, honours spec §8's "IndexedDB only, no
 * localStorage", and needs no save-version bump or migration.
 */

import { createRng } from "../core/rng";
import { createAudioEngine } from "./audio/engine";
import type { AudioEngine } from "./audio/engine";
import type { AudioContextFactory, AudioContextLike } from "./audio/types";
import type { CuePlan } from "./audio/plan";

/** Known slot ids (open set — new juice may add slots freely; unknown
 * ids get audio/palette.ts's DEFAULT_CUE rather than silence). */
export type SoundSlotId =
  | "care.feed"
  | "care.clean"
  | "care.play"
  | "care.pet"
  | "care.rest"
  | "care.wake"
  | "care.give"
  | "care.refuse"
  | "ui.tap"
  | "ui.sheet"
  | "notify.toast"
  | (string & {});

/** The slice of app/persistence.ts's `SaveStore` the preference needs.
 * Structural on purpose: this module imports nothing from persistence,
 * so `sound()` stays free of idb, the store, and the save format. */
export interface SoundPrefStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

/** IndexedDB key for the sound preference (its own record — the save
 * blob under `latest` is untouched). */
export const SOUND_PREF_KEY = "pref-sound";

/** Sound is ON for a new player: the palette is the point. */
export const SOUND_DEFAULT_MUTED = false;

/** Salt so the audio stream can never collide with a gameplay stream
 * even when a save's seed is small. */
const AUDIO_SEED_SALT = 0x50495053; // "PIPS"

const AUDIO_STREAM = "audio-jitter";

/** Stored preference record. Anything else in the slot is ignored. */
interface SoundPref {
  readonly muted: boolean;
}

function readPref(raw: unknown): boolean | null {
  if (typeof raw !== "object" || raw === null) return null;
  const muted = (raw as Partial<SoundPref>).muted;
  return typeof muted === "boolean" ? muted : null;
}

/** The events that count as "the player touched the page". */
const GESTURE_EVENTS = ["pointerdown", "touchstart", "keydown"] as const;

export interface GestureHost {
  addEventListener(
    type: string,
    listener: () => void,
    options?: { capture?: boolean; passive?: boolean },
  ): void;
  removeEventListener(
    type: string,
    listener: () => void,
    options?: { capture?: boolean },
  ): void;
}

export interface InitSoundOptions {
  /** Where the mute preference is stored. Omit → preference is
   * session-only (still works, just not remembered). */
  readonly prefs?: SoundPrefStore;
  /** Save seed, so two saves get subtly different jitter. */
  readonly seed?: number;
  /** Override for tests. Production: a real AudioContext. */
  readonly createContext?: AudioContextFactory;
  /** Gesture source. Defaults to `window`; null disables the wiring. */
  readonly gestureHost?: GestureHost | null;
}

export interface SoundController {
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  /** Flip and persist. Returns the new muted state. */
  toggle(): boolean;
  /** Notified on every change (the mute button re-renders from this). */
  subscribe(listener: (muted: boolean) => void): () => void;
  /** True once a user gesture has built the AudioContext. */
  isReady(): boolean;
  /** Play a slot directly — the same path `sound()` takes. Returns the
   * scheduled plan, or null when refused (muted / locked / cooldown). */
  play(slot: SoundSlotId): CuePlan | null;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Module state — one engine per page
// ---------------------------------------------------------------------------

let engine: AudioEngine | null = null;

/**
 * THE seam. A no-op until `initSound()` has run, and incapable of
 * throwing afterwards.
 */
export function sound(slotId: SoundSlotId): void {
  if (engine === null) return;
  try {
    engine.play(slotId);
  } catch {
    // Audio never breaks the game. The engine already latches its own
    // failures; this is the belt to that pair of braces.
  }
}

/** Compile-time proof that the real Web Audio API satisfies the seam in
 * ./audio/types.ts. Without this the structural interfaces could drift
 * from the browser's and only the browser would notice. */
type Assert<T extends true> = T;
type _SeamMatchesWebAudio = Assert<
  AudioContext extends AudioContextLike ? true : false
>;

/** The browser's AudioContext, including old-Safari's prefixed name. */
function defaultContextFactory(): AudioContextLike {
  const scope = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (Ctor === undefined) {
    throw new Error("Web Audio is unavailable in this browser");
  }
  return new Ctor();
}

function defaultGestureHost(): GestureHost | null {
  return typeof window === "undefined" ? null : (window as GestureHost);
}

/**
 * Build the engine, restore the mute preference, and arm the autoplay
 * unlock. Safe to call once per page; a second call disposes the first.
 * Never rejects — a browser without Web Audio just plays the game silent.
 */
export async function initSound(
  options: InitSoundOptions = {},
): Promise<SoundController> {
  const stored = await options.prefs
    ?.get(SOUND_PREF_KEY)
    .catch(() => undefined);
  let muted = readPref(stored) ?? SOUND_DEFAULT_MUTED;

  const rng = createRng((options.seed ?? 0) ^ AUDIO_SEED_SALT).stream(
    AUDIO_STREAM,
  );

  engine?.dispose();
  const created = createAudioEngine({
    createContext: options.createContext ?? defaultContextFactory,
    rng,
    muted,
  });
  engine = created;

  const listeners = new Set<(muted: boolean) => void>();
  const gestureHost =
    options.gestureHost === undefined
      ? defaultGestureHost()
      : options.gestureHost;

  const detachGestures = (): void => {
    if (gestureHost === null) return;
    for (const type of GESTURE_EVENTS) {
      gestureHost.removeEventListener(type, onGesture, { capture: true });
    }
  };

  function onGesture(): void {
    created.unlock();
    if (created.isReady()) detachGestures();
  }

  if (gestureHost !== null) {
    for (const type of GESTURE_EVENTS) {
      // CAPTURE phase: this runs before the button handler that calls
      // sound(), so the very first tap is audible rather than swallowed.
      gestureHost.addEventListener(type, onGesture, {
        capture: true,
        passive: true,
      });
    }
  }

  const persist = (): void => {
    void options.prefs?.put(SOUND_PREF_KEY, { muted }).catch(() => {
      // A preference that fails to save is not worth a UI moment.
    });
  };

  const controller: SoundController = {
    isMuted: () => muted,

    setMuted(next: boolean): void {
      if (next === muted) return;
      muted = next;
      created.setMuted(next);
      persist();
      for (const listener of listeners) listener(muted);
    },

    toggle(): boolean {
      controller.setMuted(!muted);
      return muted;
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },

    isReady: () => created.isReady(),

    play: (slot) => created.play(slot),

    dispose(): void {
      detachGestures();
      listeners.clear();
      created.dispose();
      if (engine === created) engine = null;
    },
  };

  return controller;
}

/** Tear the seam back down to a no-op (tests, hot reload). */
export function resetSound(): void {
  engine?.dispose();
  engine = null;
}
