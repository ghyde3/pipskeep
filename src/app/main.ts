/**
 * Bootstrap (spec §2 app/): Pixi v8 world + DOM UI overlay + store +
 * persistence + live ticker — the Phase 2 first playable.
 *
 * Boot order (matches src/app/persistence.ts's documented sequence):
 *   1. loadPipskeep() — before the store exists. Three outcomes:
 *      valid save → load + CATCHUP; nothing stored → fresh game; corrupt
 *      blob → the §8 recovery modal (Download broken save / Start Fresh)
 *      and boot HALTS until the player decides — never a silent wipe.
 *   2. Store from the loaded state, or createNewGame (seed generation is
 *      app-layer: crypto, with a clock-bits fallback — core never rolls
 *      its own seed). ALL app-layer time comes from the one shared
 *      OffsetClock (src/app/appClock.ts), so the dev debug menu's time
 *      skew moves the whole world at once.
 *   3. If a save loaded: dispatch CATCHUP over the absence (spec §4.5).
 *      The "While you were away…" sheet is Phase 4 — for now the summary
 *      goes to console.info.
 *   4. initPersistence wires the debounced autosave (spec §8). On the
 *      recovery path it also quarantines the broken blob under its own
 *      idb key before the first autosave can overwrite it.
 *   5. Scene + UI subscribe to the store; ticker dispatches TICK ≤ 1/s.
 *
 * This module owns the seams between layers: it watches state diffs to
 * trigger care animations / speech bubbles (from `lastCareOutcome`) and
 * in-app alerts (need < 25, Sulking) through the notify(event) seam
 * (spec §10 — in-app only for MVP).
 */

import { Application } from "pixi.js";
import { validateContent } from "../content/validate";
import type { Clock } from "../core/clock";
import { createStore } from "../core/store";
import { createNewGame, rootReducer } from "../core/state";
import type { GameState } from "../core/state";
import { NEED_IDS, PipActivity } from "../core/pips/types";
import { createKeepScene } from "../render/keepScene";
import { initUi, notify } from "../ui";
import { showRecoveryModal } from "../ui/recovery";
import { OffsetClock } from "./appClock";
import { routeBoot } from "./bootRoute";
import { initPersistence, loadPipskeep, openSaveStore } from "./persistence";
import type { LoadResult, SaveStore } from "./persistence";
import { startTicker } from "./ticker";

/** In-app alert threshold (spec §10: "need < 25"). UI copy trigger, not
 * gameplay tuning — the Sulking floor and mood thresholds own gameplay. */
const NEED_ALERT_BELOW = 25;

const NEED_ALERT_COPY: Readonly<Record<string, (name: string) => string>> = {
  hunger: (name) => `${name}'s tummy is rumbling…`,
  cleanliness: (name) => `${name} is getting a bit mossy. The bad kind.`,
  happiness: (name) => `${name} could use some fun.`,
  energy: (name) => `${name} is running on fumes.`,
};

/** App-layer seed roll: crypto when available, clock bits otherwise.
 * (Randomness INSIDE the game goes through core/rng — this only picks
 * which deterministic universe a brand-new save lives in.) */
function generateSeed(clock: Clock): number {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const word = crypto.getRandomValues(new Uint32Array(1))[0];
    if (word !== undefined) return word >>> 0;
  }
  return clock.now() >>> 0;
}

/** Fire need-low / Sulking toasts on downward crossings only. */
function watchAlerts(prev: GameState, next: GameState): void {
  for (const id of next.rosterOrder) {
    const before = prev.pips[id];
    const after = next.pips[id];
    if (after === undefined) continue;
    for (const need of NEED_IDS) {
      const was = before?.needs[need] ?? 100;
      const now = after.needs[need];
      if (now < NEED_ALERT_BELOW && was >= NEED_ALERT_BELOW) {
        const copy = NEED_ALERT_COPY[need];
        if (copy !== undefined) {
          notify({ kind: "needLow", message: copy(after.name) });
        }
      }
    }
    if (
      after.activity === PipActivity.Sulking &&
      before?.activity !== PipActivity.Sulking
    ) {
      notify({
        kind: "sulking",
        message: `${after.name} is sulking. One good care session fixes it.`,
      });
    }
  }
}

/** Which inventory item a FEED/GIVE_ITEM consumed — colors the morsel. */
function consumedItem(prev: GameState, next: GameState): string | undefined {
  if (prev.inventory === next.inventory) return undefined;
  for (const [id, count] of Object.entries(prev.inventory)) {
    if ((next.inventory[id] ?? 0) < count) return id;
  }
  return undefined;
}

async function boot(): Promise<void> {
  // Content registries are validated loudly at boot in dev mode (spec §3).
  if (import.meta.env.DEV) {
    validateContent();
  }

  // ONE app clock (src/app/appClock.ts): system time plus the debug
  // menu's skewable offset. Every app-layer timestamp flows through it.
  const clock = new OffsetClock();

  // --- Persistence-first boot (spec §8) --- one idb connection, shared
  // by load, autosave, and the debug menu's corrupt-save button.
  const saveStore = await openSaveStore();
  const loaded = await loadPipskeep(saveStore);

  // The corrupt-vs-missing-vs-valid decision lives in routeBoot
  // (src/app/bootRoute.ts) so it is testable without Pixi. Corrupt blob:
  // recovery modal, NOT a silent new game (spec §8) — boot halts there;
  // the fresh game exists only after the explicit Start Fresh click, and
  // initPersistence quarantines the broken blob before its first
  // autosave can overwrite it. Missing save = new install → no ceremony.
  await routeBoot(loaded, {
    showRecovery: ({ loadError, rawBlob, onStartFresh }) => {
      console.error("PipsKeep save failed to load", loadError);
      showRecoveryModal({
        mount: document.body,
        loadError,
        rawBlob,
        exportedAt: clock.now(),
        onStartFresh,
      });
    },
    startGame: (routed) => startGame(clock, saveStore, routed),
  });
}

/** The rest of boot: store, Pixi world, UI, ticker. `loaded.save` null
 * here always means "start a new game" — the corrupt case was already
 * routed through the recovery modal above. */
async function startGame(
  clock: OffsetClock,
  saveStore: SaveStore,
  loaded: LoadResult,
): Promise<void> {
  const freshGame = loaded.save === null;
  const initial: GameState =
    loaded.save !== null
      ? loaded.save.state
      : createNewGame(generateSeed(clock), clock.now());
  const store = createStore(rootReducer, initial);
  if (loaded.save !== null) {
    store.dispatch({
      type: "CATCHUP",
      savedAt: loaded.save.savedAt,
      now: clock.now(),
    });
  }
  const persistence = await initPersistence(store, clock, {
    saveStore,
    preloaded: loaded,
  });

  // --- Pixi world ---
  const app = new Application();
  await app.init({
    background: "#eef7ea", // matches keepPalette.skyBottom
    resizeTo: window,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const mount = document.getElementById("app");
  if (!mount) {
    throw new Error("PipsKeep: #app mount point missing from index.html");
  }
  mount.appendChild(app.canvas);

  const scene = createKeepScene(app.screen.width, app.screen.height);
  app.stage.addChild(scene.view);
  scene.resize(app.screen.width, app.screen.height);
  window.addEventListener("resize", () => {
    scene.resize(window.innerWidth, window.innerHeight);
  });

  // --- DOM UI overlay ---
  const ui = initUi({
    mount: document.body,
    store,
    clock,
    getBubbleAnchor: () => scene.getBubbleAnchor(),
  });

  // --- Store → scene/UI reactions ---
  let prevState = store.getState();
  scene.sync(prevState);
  ui.sync(prevState);

  store.subscribe((state) => {
    const prev = prevState;
    prevState = state;
    scene.sync(state);
    ui.sync(state);
    watchAlerts(prev, state);

    if (state.lastCareOutcome !== prev.lastCareOutcome && state.lastCareOutcome !== null) {
      scene.playCareOutcome(state.lastCareOutcome, consumedItem(prev, state));
      ui.showOutcome(state.lastCareOutcome);
    }
    if (state.lastCatchup !== prev.lastCatchup && state.lastCatchup !== null) {
      // Phase 4 builds the "While you were away…" sheet from this. Skip
      // sub-second absences (quick tab flicks fire a CATCHUP per §4.5,
      // but a zero-length summary is console noise, not news).
      if (state.lastCatchup.elapsedMs >= 1000) {
        console.info("PipsKeep — while you were away:", state.lastCatchup);
      }
    }
  });

  // --- Debug menu (spec §14, dev builds only) ---
  // Dynamic import inside the DEV guard: the production build replaces
  // `import.meta.env.DEV` with false, dead-code-eliminates this branch,
  // and never emits a debug-menu chunk (verified by grepping dist/).
  if (import.meta.env.DEV) {
    const { initDebugMenu } = await import("../ui/debugMenu");
    initDebugMenu({
      mount: document.body,
      store,
      clock,
      saveStore,
      persistence,
    });
  }

  // --- Loops ---
  app.ticker.add((ticker) => {
    scene.update(ticker.deltaMS);
    ui.update();
  });
  startTicker(store, clock);

  // A gentle first nudge (spec §10.1 step 3; full onboarding is Phase 6).
  if (freshGame) {
    window.setTimeout(() => {
      notify({ kind: "info", message: "Pips get hungry! Try feeding them." });
    }, 1200);
  }
}

void boot();
