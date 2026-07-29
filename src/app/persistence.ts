/**
 * IndexedDB persistence (spec §8), hardened in Phase 3: corrupt-save
 * load returns typed errors that route to the recovery flow
 * (src/app/bootRoute.ts + src/ui/recovery.ts), broken blobs are
 * quarantined before any overwrite, and export/import lives in the
 * debug menu (src/ui/debugMenu.ts).
 *
 * - IndexedDB only, via `idb` (spec §8: no localStorage fallback).
 * - One record: the latest SaveBlob under a fixed key. History/slots are
 *   out of scope for MVP.
 * - Autosave: an ANCHORED debounce — the first unsaved dispatch arms a
 *   AUTOSAVE_DEBOUNCE_MS timer and later dispatches leave it alone, so
 *   every action reaches disk at most AUTOSAVE_DEBOUNCE_MS after it
 *   happened. (A re-arming debounce would starve forever under the 1 Hz
 *   TICK stream and turn "kill tab loses ≤ 2s" into "loses everything".)
 * - Immediate flush on `visibilitychange` → hidden AND on `pagehide`
 *   (Safari does not reliably fire visibilitychange when a tab closes;
 *   pagehide is the lifecycle event it does fire).
 * - The Phase 3 gate bound, provably: worst case is the tab dying in the
 *   instant before an armed timer fires — the actions inside that not-
 *   yet-flushed window are < AUTOSAVE_DEBOUNCE_MS (2s) old. Everything
 *   older is already on disk, and hidden/pagehide flushes shrink the
 *   common cases to ~0.
 * - Testability: the idb handle, the timer functions, and the
 *   visibility/pagehide sources are all injectable (`PersistenceDeps`),
 *   so the debounce logic unit-tests against FakeClock-driven fake
 *   timers and an in-memory SaveStore — no browser needed. Defaults are
 *   the real thing.
 *
 * Boot sequence (what src/app/main.ts actually does):
 *
 *   const clock = new OffsetClock();   // the ONE app clock (appClock.ts)
 *   const loaded = await loadPipskeep();                    // before the store exists
 *   // routeBoot(loaded, …): corrupt blob → recovery modal, boot halts.
 *   const initial = loaded.save
 *     ? loaded.save.state
 *     : createNewGame(seed, clock.now());
 *   const store = createStore(rootReducer, initial);
 *   if (loaded.save) {
 *     store.dispatch({ type: "CATCHUP", savedAt: loaded.save.savedAt, now: clock.now() });
 *   }
 *   const persistence = await initPersistence(store, clock, { preloaded: loaded });
 *
 * The clock must be the shared OffsetClock, never a private SystemClock —
 * a second clock would escape the debug menu's time skew and violate
 * appClock.ts's "ONE OffsetClock instance" contract.
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
/** Corrupt blobs are stashed under `quarantine-<timestamp>` before any
 * new save can overwrite LATEST_SAVE_KEY (spec §8: never silently wipe —
 * starting fresh must never destroy the evidence). */
export const QUARANTINE_KEY_PREFIX = "quarantine-";

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
  /** Set when a blob existed but failed migration/validation — the §8
   * "Start Fresh + export the broken blob" flow consumes this pair.
   * `save: null` WITHOUT `loadError` means nothing was stored at all
   * (fresh install); the two cases take different boot paths. */
  readonly loadError?: SaveBlobError;
  /** The raw broken blob exactly as storage produced it, for the
   * download-and-quarantine path. Present iff `loadError` is. */
  readonly rawBlob?: unknown;
}

/** Read + migrate + validate the latest save. Never throws on bad data —
 * corrupt blobs come back as `{ save: null, loadError, rawBlob }`. */
export async function loadPipskeep(saveStore?: SaveStore): Promise<LoadResult> {
  const target = saveStore ?? (await openSaveStore());
  const raw = await target.get(LATEST_SAVE_KEY);
  if (raw === undefined || raw === null) {
    return { save: null };
  }
  const result = migrate(raw);
  if (!result.ok) {
    return { save: null, loadError: result.error, rawBlob: raw };
  }
  return { save: result.save };
}

/**
 * Stash a corrupt blob under its own `quarantine-<timestamp>` key, byte
 * -for-byte as storage produced it. MUST complete before anything
 * overwrites LATEST_SAVE_KEY — initPersistence enforces this by
 * quarantining before it arms the first autosave. Returns the key used
 * (suffixed on the rare same-millisecond collision).
 */
export async function quarantineCorruptSave(
  rawBlob: unknown,
  at: number,
  saveStore?: SaveStore,
): Promise<string> {
  const target = saveStore ?? (await openSaveStore());
  let key = `${QUARANTINE_KEY_PREFIX}${at}`;
  for (let n = 2; (await target.get(key)) !== undefined; n++) {
    key = `${QUARANTINE_KEY_PREFIX}${at}-${n}`;
  }
  await target.put(key, rawBlob);
  return key;
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

/** The slice of `window` the pagehide flush needs. Safari fires pagehide
 * (not visibilitychange) when a tab is closed or navigated away, so the
 * flush listens to both hosts (tests inject a stub; `null` disables). */
export interface PageHideHost {
  addEventListener(type: "pagehide", listener: () => void): void;
  removeEventListener(type: "pagehide", listener: () => void): void;
}

export interface PersistenceDeps {
  readonly saveStore?: SaveStore;
  readonly timers?: TimerHost;
  readonly visibility?: VisibilityHost | null;
  readonly pageHide?: PageHideHost | null;
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
  /** Where the corrupt blob was stashed (set iff one was quarantined). */
  readonly quarantineKey?: string;
  /** Flush now (cancels any pending debounce). */
  saveNow(): Promise<SaveBlob>;
  /** Unhook the store subscription and visibility/pagehide listeners. */
  dispose(): void;
}

const defaultTimers: TimerHost = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as number),
};

function defaultVisibility(): VisibilityHost | null {
  return typeof document === "undefined" ? null : document;
}

function defaultPageHide(): PageHideHost | null {
  return typeof window === "undefined" ? null : window;
}

/**
 * Load the latest save and wire autosave onto the store: the FIRST
 * dispatch after a completed save arms a AUTOSAVE_DEBOUNCE_MS timer
 * (later dispatches do NOT push it back — anchored, so no dispatch waits
 * longer than the debounce); going hidden or pagehiding flushes
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
  const pageHide =
    deps.pageHide === undefined ? defaultPageHide() : deps.pageHide;

  const loaded = deps.preloaded ?? (await loadPipskeep(saveStore));

  // Evidence preservation (spec §8): if the stored blob was corrupt, it
  // is quarantined HERE — before the store subscription can arm a single
  // autosave — so no overwrite of LATEST_SAVE_KEY can ever destroy it.
  // If this put fails, initPersistence fails: better no autosave at all
  // than an autosave that wipes the only copy of a broken save.
  let quarantineKey: string | undefined;
  if (loaded.save === null && loaded.loadError !== undefined) {
    quarantineKey = await quarantineCorruptSave(
      loaded.rawBlob,
      clock.now(),
      saveStore,
    );
  }

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
    // Fire-and-forget path (timer / visibility). Write failures reach the
    // console only — deliberate: spec §8 requires UI for LOAD failure
    // (the recovery flow) and says nothing about write failure. Surfacing
    // write failures to the player is Phase 6 polish, if ever.
    void flush().catch((failure: unknown) => {
      console.error("PipsKeep autosave failed", failure);
    });
  };

  const unsubscribe = store.subscribe(() => {
    if (disposed) return;
    // Anchored, not re-armed: only the FIRST unsaved dispatch sets the
    // timer. Under the ticker's 1 Hz TICK stream a re-arming debounce
    // would never fire; anchoring guarantees every action is on disk at
    // most AUTOSAVE_DEBOUNCE_MS after it happened (the Phase 3 gate's
    // "kill-tab-mid-session loses ≤ 2s of actions" bound).
    if (pending !== null) return;
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

  // Safari kill-tab path: pagehide fires where visibilitychange may not.
  const onPageHide = (): void => {
    if (!disposed) flushSilently();
  };
  pageHide?.addEventListener("pagehide", onPageHide);

  return {
    loaded: loaded.save !== null,
    ...(loaded.save !== null ? { savedAt: loaded.save.savedAt, save: loaded.save } : {}),
    ...(loaded.loadError !== undefined ? { loadError: loaded.loadError } : {}),
    ...(quarantineKey !== undefined ? { quarantineKey } : {}),
    saveNow: flush,
    dispose(): void {
      disposed = true;
      cancelPending();
      unsubscribe();
      visibility?.removeEventListener("visibilitychange", onVisibilityChange);
      pageHide?.removeEventListener("pagehide", onPageHide);
    },
  };
}
