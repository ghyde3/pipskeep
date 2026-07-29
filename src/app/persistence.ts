/**
 * IndexedDB persistence (spec §8) — the thin Phase 2 wiring. Hardening
 * (corrupt-save "Start Fresh" flow, export/import UI, write-failure
 * handling) is Phase 3.
 *
 * - IndexedDB only, via `idb` (spec §8: no localStorage fallback).
 * - One record: the latest SaveBlob under a fixed key. History/slots are
 *   out of scope for MVP.
 * - Autosave: debounced AUTOSAVE_DEBOUNCE_MS after any dispatch, plus an
 *   immediate flush on `visibilitychange` → hidden (spec §8).
 * - Testability: the idb handle, the timer functions, and the visibility
 *   source are all injectable (`PersistenceDeps`), so the debounce logic
 *   unit-tests against FakeClock-driven fake timers and an in-memory
 *   SaveStore — no browser needed. Defaults are the real thing.
 *
 * Intended boot sequence for the render builder (src/app/main.ts):
 *
 *   const clock = new SystemClock();
 *   const loaded = await loadPipskeep();                    // before the store exists
 *   const initial = loaded.save
 *     ? loaded.save.state
 *     : createNewGame(seed, clock.now());
 *   const store = createStore(rootReducer, initial);
 *   if (loaded.save) {
 *     store.dispatch({ type: "CATCHUP", savedAt: loaded.save.savedAt, now: clock.now() });
 *   }
 *   const persistence = await initPersistence(store, clock, { preloaded: loaded });
 *
 * `preloaded` lets initPersistence report `{ loaded, savedAt }` without
 * reading IndexedDB a second time; omit it and initPersistence loads on
 * its own.
 */

import { openDB } from "idb";
import type { Clock } from "../core/clock";
import type { Store } from "../core/store";
import type { GameAction, GameState } from "../core/state";
import { toSaveBlob } from "../core/save/serialize";
import type { SaveBlob, SaveBlobError } from "../core/save/serialize";
import { migrate } from "../core/save/migrate";

/** Spec §8: autosave on every state-mutating action, debounced 2s. A
 * persistence-contract constant, not gameplay tuning — hence here and
 * not in content/tuning.ts. */
export const AUTOSAVE_DEBOUNCE_MS = 2_000;

export const DB_NAME = "pipskeep";
export const DB_VERSION = 1;
export const SAVES_STORE = "saves";
export const LATEST_SAVE_KEY = "latest";

/** The minimal key-value seam over IndexedDB. Tests inject an in-memory
 * implementation; production uses `openSaveStore()`. */
export interface SaveStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

/** Open (creating if needed) the real IndexedDB-backed SaveStore. */
export async function openSaveStore(): Promise<SaveStore> {
  const db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(upgradeDb) {
      if (!upgradeDb.objectStoreNames.contains(SAVES_STORE)) {
        upgradeDb.createObjectStore(SAVES_STORE);
      }
    },
  });
  return {
    get: (key) => db.get(SAVES_STORE, key),
    async put(key, value) {
      await db.put(SAVES_STORE, value, key);
    },
  };
}

export interface LoadResult {
  /** The migrated + validated save, or null (nothing stored / corrupt). */
  readonly save: SaveBlob | null;
  /** Set when a blob existed but failed migration/validation — Phase 3's
   * "Start Fresh + export the broken blob" flow consumes this pair. */
  readonly error?: SaveBlobError;
  /** The raw broken blob, for the export-before-wipe path. */
  readonly raw?: unknown;
}

/** Read + migrate + validate the latest save. Never throws on bad data —
 * corrupt blobs come back as `{ save: null, error, raw }`. */
export async function loadPipskeep(saveStore?: SaveStore): Promise<LoadResult> {
  const target = saveStore ?? (await openSaveStore());
  const raw = await target.get(LATEST_SAVE_KEY);
  if (raw === undefined || raw === null) {
    return { save: null };
  }
  const result = migrate(raw);
  if (!result.ok) {
    return { save: null, error: result.error, raw };
  }
  return { save: result.save };
}

/** Serialize the store's current state and write it immediately.
 * `savedAt` is stamped from the injected Clock (spec §2 rule 2). */
export async function savePipskeepNow(
  store: Store<GameState, GameAction>,
  clock: Clock,
  saveStore?: SaveStore,
): Promise<SaveBlob> {
  const target = saveStore ?? (await openSaveStore());
  const blob = toSaveBlob(store.getState(), clock.now());
  await target.put(LATEST_SAVE_KEY, blob);
  return blob;
}

/** Injectable setTimeout/clearTimeout pair (tests drive a fake). */
export interface TimerHost {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The slice of `document` the hidden-flush needs (tests inject a stub;
 * `null` disables visibility wiring entirely, e.g. under node). */
export interface VisibilityHost {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface PersistenceDeps {
  readonly saveStore?: SaveStore;
  readonly timers?: TimerHost;
  readonly visibility?: VisibilityHost | null;
  /** Result of an earlier `loadPipskeep()` call, so initPersistence can
   * report `loaded`/`savedAt` without a second IndexedDB read. */
  readonly preloaded?: LoadResult;
}

export interface Persistence {
  /** True when a valid save existed at init. */
  readonly loaded: boolean;
  /** The loaded save's `savedAt` — feed it to the CATCHUP action. */
  readonly savedAt?: number;
  /** The loaded blob itself, for the render builder. */
  readonly save?: SaveBlob;
  /** Load-failure detail when a blob existed but was corrupt. */
  readonly loadError?: SaveBlobError;
  /** Flush now (cancels any pending debounce). */
  saveNow(): Promise<SaveBlob>;
  /** Unhook the store subscription and visibility listener. */
  dispose(): void;
}

const defaultTimers: TimerHost = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as number),
};

function defaultVisibility(): VisibilityHost | null {
  return typeof document === "undefined" ? null : document;
}

/**
 * Load the latest save and wire autosave onto the store: every dispatch
 * (re)arms a AUTOSAVE_DEBOUNCE_MS trailing debounce; going hidden flushes
 * immediately and disarms it.
 */
export async function initPersistence(
  store: Store<GameState, GameAction>,
  clock: Clock,
  deps: PersistenceDeps = {},
): Promise<Persistence> {
  const saveStore = deps.saveStore ?? (await openSaveStore());
  const timers = deps.timers ?? defaultTimers;
  const visibility =
    deps.visibility === undefined ? defaultVisibility() : deps.visibility;

  const loaded = deps.preloaded ?? (await loadPipskeep(saveStore));

  let pending: unknown = null;
  let disposed = false;

  const cancelPending = (): void => {
    if (pending !== null) {
      timers.clearTimeout(pending);
      pending = null;
    }
  };

  const flush = (): Promise<SaveBlob> => {
    cancelPending();
    return savePipskeepNow(store, clock, saveStore);
  };

  const flushSilently = (): void => {
    // Fire-and-forget path (timer / visibility). Phase 3 hardening turns
    // write failures into UI; for now they only reach the console.
    void flush().catch((failure: unknown) => {
      console.error("PipsKeep autosave failed", failure);
    });
  };

  const unsubscribe = store.subscribe(() => {
    if (disposed) return;
    cancelPending();
    pending = timers.setTimeout(() => {
      pending = null;
      flushSilently();
    }, AUTOSAVE_DEBOUNCE_MS);
  });

  const onVisibilityChange = (): void => {
    if (!disposed && visibility?.visibilityState === "hidden") {
      flushSilently();
    }
  };
  visibility?.addEventListener("visibilitychange", onVisibilityChange);

  return {
    loaded: loaded.save !== null,
    ...(loaded.save !== null ? { savedAt: loaded.save.savedAt, save: loaded.save } : {}),
    ...(loaded.error !== undefined ? { loadError: loaded.error } : {}),
    saveNow: flush,
    dispose(): void {
      disposed = true;
      cancelPending();
      unsubscribe();
      visibility?.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
