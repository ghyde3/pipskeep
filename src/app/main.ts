/**
 * Bootstrap (spec §2 app/): Pixi v8 world + DOM UI overlay + store +
 * persistence + live ticker — the Phase 2 first playable.
 *
 * Boot order (matches src/app/persistence.ts's documented sequence):
 *   1. loadPipskeep() — before the store exists. Three outcomes:
 *      valid save → load + CATCHUP; nothing stored → fresh game; corrupt
 *      blob → the §8 recovery modal (Download broken save / Start Fresh)
 *      and boot HALTS until the player decides — never a silent wipe.
 *   2. Store from the loaded state, or — new install — the onboarding
 *      ceremony (spec §10.1: title card → starter trio → pick) and THEN
 *      createNewGame with the chosen candidate (seed generation is
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
// PWA (spec §1): autoUpdate service-worker registration. The virtual
// module is provided by vite-plugin-pwa; in dev it is a harmless stub.
import { registerSW } from "virtual:pwa-register";
import { validateContent } from "../content/validate";
import { expeditions } from "../content/expeditions";
import { resolvePipPalette } from "../content/palette";
import type { Clock } from "../core/clock";
import { createStore } from "../core/store";
import {
  createNewGame,
  rollStarterCandidates,
  rootReducer,
} from "../core/state";
import type { GameState } from "../core/state";
import { collectAlerts, collectCraftAlerts } from "./alerts";
import type { PipState } from "../core/pips/types";
import { createKeepScene } from "../render/keepScene";
import { initUi, notify } from "../ui";
import { formatDurationShort } from "../ui/focusView";
// Phase 4 UI (loot reveal + "While you were away" sheet) — the parallel
// phase4 module. Intentionally a static import with NO fallback: if
// src/ui/phase4.ts is missing, the build fails loudly right here rather
// than silently shipping without the reveal moment.
import { initPhase4Ui } from "../ui/phase4";
// Phase 5 UI (Build sheet + placement, Keep-level upgrades, Gathering
// job UX, evolution taps) — same parallel-module pattern as phase4;
// static import so a missing module fails the build loudly.
import { initPhase5Ui } from "../ui/phase5";
// Phase 6 onboarding (spec §10.1): the new-game ceremony (title card →
// starter trio → pick) and the guided beats. Same parallel-module
// pattern as phase4/phase5 — a static import that fails the build
// loudly if the module goes missing.
import { initOnboarding, previewStarterNames, runStarterPick } from "../ui/onboarding";
// Round 2C dailies (docs/retention-bible.md §3/§4/§5) — same
// parallel-module, static-import pattern as phase4/phase5/onboarding.
import { initDailiesUi } from "../ui/dailies";
// Round 2C destinations: the Album (§1) and the Long Meadow (§2), plus the
// one thumb-zone menu that reaches them (see ui/navMenu.ts for why it is a
// menu and not three more floating buttons).
import { createPipdexView } from "../ui/pipdex";
import { createSanctuaryView } from "../ui/sanctuary";
import { createNavMenu } from "../ui/navMenu";
import { showRecoveryModal } from "../ui/recovery";
// Round 2F — THE PROGRESSION SPINE's three surfaces (docs/progression-
// bible.md §0.2/§1.2/§6). Same parallel-module, static-import pattern as
// phase4/phase5/onboarding/dailies: each owns all of its own DOM + CSS and
// mounts nothing until main.ts says where.
import { createXpBar } from "../ui/xpBar";
import { initLevelUpUi } from "../ui/levelUp";
import { initMilestoneCelebrationUi } from "../ui/milestoneCelebration";
// Round 2H — THE LIFECYCLE's four surfaces (spec §16 v1.5, docs/lifecycle-
// bible.md). Same parallel-module, static-import pattern as everything
// above: each owns all of its own DOM + CSS (ui/lifecycle.css) and mounts
// nothing until main.ts says where. Their five promises are enforced in
// core; these are the surfaces that make them VISIBLE, which is the whole
// difference between a mechanic and a dead feature (spec v1.3 §4.6's
// standing rule: "written to state" and "visible to the player" are
// separate acceptance criteria).
import { createPipLevelView } from "../ui/pipLevel";
import { createAilmentView } from "../ui/ailment";
import { createMemorialView } from "../ui/memorial";
import { createBreedingView } from "../ui/breeding";
// Round 2J — the Craft Table's recipe book (docs/economy-bible.md §3–§6.3).
// Same parallel-module, static-import pattern as everything above: owns its
// own DOM + CSS, mounts nothing until main.ts says where, reached from the
// Nook menu exactly like the Album/Long Meadow/Nursery.
import { createCraftingView } from "../ui/crafting";
import { setCraftTableTapHandler } from "../render/craftTap";
// Round 2A sound (amends spec §12): the `sound(slotId)` seam is no longer
// a no-op — app/audio/ synthesizes every cue procedurally. initSound is
// the only wiring the app needs; every call site was already in place.
import { initSound } from "./sound";
import { mountSoundToggle } from "../ui/soundToggle";
// Round 2I (docs/notifications-bible.md §3/§5) — the earned permission
// ask and the "Tap on the shoulder" settings sheet. Same parallel-module,
// static-import pattern as everything above: each owns all of its own
// DOM + CSS and mounts nothing until main.ts says where. Preferences are
// device-local (bible §8), loaded once here through the SAME IndexedDB
// seam `initSound` uses for `pref-sound` — no save-schema bump.
import { initNotificationPrefs } from "../ui/notificationPrefs";
// Round 2I scheduling half (docs/notifications-bible.md §2.3): arm on
// hide, recompute on wake, deliver through the notify() seam.
import { initPushNotifications } from "./push";
import { createNotificationAskFlow } from "../ui/notificationAsk";
import {
  createNotificationSettingsSheet,
  notificationsNookRow,
} from "../ui/notificationSettings";
import { OffsetClock } from "./appClock";
import { routeBoot } from "./bootRoute";
import { initPersistence, loadPipskeep, openSaveStore } from "./persistence";
import type { LoadResult, SaveStore } from "./persistence";
import { startTicker } from "./ticker";

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

/** Fire the toasts a state transition earns (decisions live in alerts.ts,
 * which reads sulking via `isSulking` so a Pip napping through a sulk is
 * still announced). */
function watchAlerts(prev: GameState, next: GameState): void {
  for (const alert of collectAlerts(prev, next)) notify(alert);
  // ROUND 2J FIX STAGE — "a craft finished" reaches the player. Silent on a
  // catch-up transition, where the Doorstep says it instead.
  for (const alert of collectCraftAlerts(prev, next)) notify(alert);
}

/** Display name for an expedition id (registry, with a safe fallback). */
function expeditionName(expeditionId: string): string {
  return (
    expeditions[expeditionId as keyof typeof expeditions]?.name ?? expeditionId
  );
}

/**
 * DOM-minimal send-off (spec §10.1.4 "trots off-screen with a wave"): a
 * tiny palette-matched blob hops from mid-screen off the right edge and
 * removes itself. The scene keeps rendering truth from state; this is a
 * transient flourish layered on top, not scene state.
 */
function playDepartureTrot(pip: PipState): void {
  const palette = resolvePipPalette(pip.speciesId, pip.genome.palette);
  const trot = document.createElement("div");
  trot.className = "pk-trot";
  trot.style.setProperty("--pk-accent", palette.accent);
  const blob = document.createElement("div");
  blob.className = "pk-trot-blob";
  blob.style.background = palette.body;
  blob.style.borderColor = palette.outline;
  trot.appendChild(blob);
  trot.addEventListener("animationend", (event) => {
    if (event.target === trot) trot.remove();
  });
  document.body.appendChild(trot);
  // Belt and braces: if animations are disabled, still clean up.
  window.setTimeout(() => trot.remove(), 4000);
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
  // PWA service worker (spec §1): cache-first assets, autoUpdate — a new
  // deploy refreshes in the background and applies on next launch.
  registerSW({ immediate: true });

  // Content registries are validated loudly at boot in dev mode (spec §3).
  if (import.meta.env.DEV) {
    validateContent();

    // Perf harness (?perf — dev-only, like the debug menu): renders the
    // spec §1 budget scenario (5 pips + 30 decorations) from a synthetic
    // state with an fps overlay, INSTEAD of the real game. It never opens
    // IndexedDB, so the real save cannot be touched. Dynamic import inside
    // the DEV guard → tree-shaken out of production builds.
    if (new URLSearchParams(window.location.search).has("perf")) {
      const { startPerfMode } = await import("./perfMode");
      await startPerfMode();
      return;
    }
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

  // --- Sound (Round 2A: the §12 seam is real now) ---
  // FIRST, deliberately: browsers only allow an AudioContext to start
  // inside a user gesture, and the onboarding ceremony's taps are the
  // first gestures a new player makes. Init here and the very first tap
  // both unlocks audio and is itself audible; init after the ceremony and
  // the whole of onboarding plays in silence. Nothing is scheduled by
  // this call — it restores the mute preference (from the SAME IndexedDB
  // store as the save, under its own key: no save-version bump) and arms
  // the unlock listener. The toggle button mounts later, once #ui exists.
  // Failures are swallowed: a browser without Web Audio plays the game
  // silently rather than not at all.
  const soundController = await initSound({
    prefs: saveStore,
    seed: loaded.save?.state.seed ?? 0,
  }).catch((error: unknown) => {
    console.warn("PipsKeep sound unavailable", error);
    return null;
  });

  let initial: GameState;
  if (loaded.save !== null) {
    initial = loaded.save.state;
  } else {
    // New-game ceremony (spec §10.1.1, replaces the silent createNewGame):
    // title card → the deterministic starter trio → the player's pick.
    // The pick is NOT skippable (a save cannot exist without a Pip);
    // boot waits here, then continues under the goodbye overlay so the
    // chosen Pip is landing in the Keep as the curtain lifts.
    const seed = generateSeed(clock);
    const choice = await runStarterPick({
      mount: document.body,
      candidates: rollStarterCandidates(seed),
      // ROUND 2D item 1 — the literal three names createNewGame will roll
      // below, previewed read-only and index-aligned with the candidates
      // (see previewStarterNames' doc for why this is safe and why the
      // cursor advances identically whichever card the player taps).
      previewNames: previewStarterNames(seed),
    });
    initial = createNewGame(seed, clock.now(), undefined, choice);
  }
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

  // --- Notifications (round 2I, docs/notifications-bible.md §3/§5/§8) ---
  // Preferences are device-local (own IndexedDB key, same seam as
  // pref-sound) — loaded once here, same async pattern as sound above.
  const notifyPrefsCtl = await initNotificationPrefs(saveStore);

  // `notifySettings` is declared as a `const` below and referenced from
  // `notificationAsk`'s `setPrefs` closure — safe (the closure only RUNS
  // after both exist), the same forward-reference-through-closure trick
  // the Nook menu's own rows use throughout this file.
  const notificationAsk = createNotificationAskFlow({
    mount: document.body,
    getPrefs: () => notifyPrefsCtl.get(),
    setPrefs: (next) => {
      notifyPrefsCtl.set(next);
      notifySettings.refresh();
    },
    isOnboardingActive: () => !store.getState().onboarding.completed,
  });

  const notifySettings = createNotificationSettingsSheet({
    mount: document.body,
    getPrefs: () => notifyPrefsCtl.get(),
    setPrefs: (next) => {
      notifyPrefsCtl.set(next);
      notifySettings.refresh();
    },
    getPermissionState: () => notificationAsk.permissionState(),
    onRequestAsk: () => notificationAsk.showManually(),
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

  // --- Phase 4 UI (loot reveal + away sheet) ---
  // Exactly ONE call, before the overlay so the reveal seam exists when
  // the top bar's "!" chip and the return toast wire up to it.
  const phase4 = initPhase4Ui(store, clock);

  // --- Round 2C destinations: the Album + the Long Meadow ---
  // Created BEFORE the UI overlay because the focus view's "Send to the
  // Long Meadow" button dispatches into the sanctuary view's confirm
  // dialog, so `initUi` needs the seam to hand down. Both are dumb
  // controllers over the store (`ui/pipdex.ts`, `ui/sanctuary.ts`); they
  // mount their own DOM here and get synced in the subscription below.
  const pipdexView = createPipdexView({ getState: () => store.getState() });
  const sanctuaryView = createSanctuaryView({
    dispatch: (a) => store.dispatch(a),
    getState: () => store.getState(),
    clock,
  });
  document.body.append(pipdexView.el, sanctuaryView.el);

  // --- Round 2H lifecycle surfaces (spec §16 v1.5) ---
  // Created BEFORE the UI overlay for the same reason the sanctuary view is:
  // three of the seams below are affordances that live inside the focus view
  // (a Pip's own page) but whose dialogs, copy and dispatches belong here.
  //
  // `openExpeditionPicker` is a forward reference through a mutable binding
  // (the `hideKeepStrip` pattern above) because the lineage board's "Send
  // someone" button reaches into the focus view, which `initUi` creates a few
  // lines below. Nothing calls it synchronously during any constructor.
  let openExpeditionPicker: ((expeditionId: string) => void) | null = null;

  const pipLevelView = createPipLevelView({ getState: () => store.getState() });
  // THE SEND SEAM: `ailmentView.requestExpedition` replaces the focus view's
  // direct ASSIGN_EXPEDITION dispatch (wired through `initUi` below). A safe
  // trail passes straight through to the same dispatch; a risky one shows the
  // confirm first. This is promise 1 ("loss is never a surprise") at the only
  // moment it can be kept — BEFORE the player sends someone into danger.
  // Forward declaration, same `let`-then-assign pattern
  // `openExpeditionPicker` above uses: the ailment card's "Make one"
  // affordance reaches into the crafting sheet, which is created a few
  // lines below. Nothing calls it during any constructor.
  let openCraftingSheet: (() => void) | null = null;
  const ailmentView = createAilmentView({
    dispatch: (a) => store.dispatch(a),
    getState: () => store.getState(),
    clock,
    // ⚠️ ROUND 2J FIX STAGE — the load-bearing discoverability seam
    // (docs/economy-bible.md §6.3). Before this, a player with an ill Pip
    // and an empty Satchel was told to go and run the trail that made the
    // Pip ill; the recipe book was reachable only from the Nook menu, and
    // only if they already suspected crafting was the answer.
    onOpenCrafting: () => openCraftingSheet?.(),
  });
  const memorialView = createMemorialView({
    dispatch: (a) => store.dispatch(a),
    getState: () => store.getState(),
    clock,
    onSendToExpedition: (expeditionId) => openExpeditionPicker?.(expeditionId),
  });
  const breedingView = createBreedingView({
    dispatch: (a) => store.dispatch(a),
    getState: () => store.getState(),
    clock,
  });
  // Round 2J — the Craft Table's recipe book, reached from the Nook menu
  // (see the navMenu wiring below) rather than from any lifecycle seam, so
  // it is created and mounted here alongside its siblings for the same
  // "exists before initUi/navMenu need it" reason.
  const craftingView = createCraftingView({
    dispatch: (a) => store.dispatch(a),
    getState: () => store.getState(),
    clock,
  });
  openCraftingSheet = () => {
    ui.closeSurfaces();
    craftingView.open();
  };
  // ROUND 2J FIX STAGE — tapping the bench in the Keep opens its book
  // (economy-bible §6.3: "a recipe sheet opened from the Craft Table AND
  // from the nav menu" — only the nav route shipped). Same module-level
  // seam the egg tap uses; the scene holds no reference to the UI.
  setCraftTableTapHandler(() => openCraftingSheet?.());
  document.body.append(
    pipLevelView.el,
    ailmentView.el,
    memorialView.el,
    breedingView.el,
    craftingView.el,
  );

  // --- DOM UI overlay ---
  const ui = initUi({
    mount: document.body,
    store,
    clock,
    getBubbleAnchor: () => scene.getBubbleAnchor(),
    openReveal: () => phase4.openLootReveal(),
    // Round 2H seams the focus view offers but does not own (same split as
    // `openRetireConfirm` below — the affordance is on the Pip's page, the
    // dialog belongs to its own module):
    requestExpedition: (pipId, expeditionId) =>
      ailmentView.requestExpedition(pipId, expeditionId),
    openGrowth: (pipId) => pipLevelView.open(pipId),
    openAilment: (pipId) => ailmentView.open(pipId),
    openRetirementReady: (pipId) => memorialView.openRetirementReady(pipId),
    // The retire affordance lives in the focus view (that is where a Pip's
    // own page is), but the dialog, its copy and its dispatch belong to
    // ui/sanctuary.ts. The confirm sits ABOVE the focus view (z 26 vs 20,
    // see src/ui/layers.test.ts) deliberately: the focus view stays open
    // underneath, so cancelling returns the player exactly where they were.
    openRetireConfirm: (pipId) => sanctuaryView.openRetireConfirm(pipId),
  });

  // The mute button — one small speaker, mounted into the UI root now
  // that it exists (the module owns all of its own DOM and CSS).
  if (soundController !== null) {
    mountSoundToggle({ mount: document.body, controller: soundController });
  }

  // --- Phase 6 onboarding (guided beats, spec §10.1.3–.5) ---
  // Mounts nothing when onboarding is already completed (every migrated
  // save) — the module's early return is the existing-save bypass.
  initOnboarding({
    mount: document.body,
    store,
    say: (line) => ui.say(line),
    freshPick: freshGame,
  });

  // --- Phase 5 UI (Build/placement, Keep upgrades, jobs, evolution) ---
  // Drives the scene's placement mode (enterPlacementMode/
  // exitPlacementMode) and registers the render/pipTap.ts seam handler.
  //
  // `setChromeHidden` forwards to the Keep strip's own `setHidden` — but the
  // strip (`xpBar`, below) is created AFTER phase5 (it needs `phase5.
  // openUpgrades`/`openBuild` to wire its own taps), so this is a forward
  // reference through a mutable binding rather than a circular constructor
  // dependency. `?? (() => {})` covers the brief window before `xpBar`
  // exists (nothing calls `setChromeHidden` synchronously during either
  // constructor, so this never actually fires against the no-op).
  let hideKeepStrip: ((hidden: boolean) => void) | null = null;
  const phase5 = initPhase5Ui({
    mount: document.body,
    store,
    clock,
    scene,
    getBubbleAnchor: () => scene.getBubbleAnchor(),
    openFocus: () => ui.openFocus(),
    setChromeHidden: (hidden) => hideKeepStrip?.(hidden),
  });

  // --- Round 2C dailies (streak/bounties/milestones, docs/retention-
  // bible.md) --- self-contained, same mounting pattern as
  // mountSoundToggle above: its own floating entry button + sheet, no
  // edits to any other ui/ module. Also owns the session-lifecycle
  // dispatches the progression core flagged as "for the app layer"
  // (SET_DAY_OFFSET / SET_ACTIVE_EVENTS / REFRESH_BOUNTIES /
  // CLAIM_STREAK_REWARD, plus CLAIM_MILESTONE so milestone rewards auto-bank
  // like everything else) — all idempotent, safe at every boot and foreground
  // return. The Doorstep (src/ui/welcome.ts) is wired in by `initPhase4Ui`
  // above, at its away-sheet call site — do NOT add a second one here, or
  // §10.1's "at most ONE blocking surface on open" breaks.
  // `mountEntry: false` — the Nook menu below owns the thumb-zone entry
  // point now. The dailies module's own floating "☀" button landed on top
  // of the Phase 5 Keep bar's Build button at 375px (same left edge, a
  // lower z-index), so consolidating was a fix, not a preference.
  const dailies = initDailiesUi({
    mount: document.body,
    store,
    clock,
    mountEntry: false,
  });

  // --- The Keep strip (docs/progression-bible.md §0.2; round 2G hud-
  // redesign doc §2.4) ---
  //
  // WHERE IT LIVES, and why: `ui/xpBar.ts`'s `createXpBar` now returns the
  // whole fixed, bottom-anchored `.pk-keepstrip` (bar + Build button) —
  // round 2G is the round that decided the final placement, so the module
  // owns its own position and `main.ts` just appends it via `ui.
  // mountChrome`. Before this round it was a "mountable anywhere" bar
  // living inside the TOP bar, 489px from the Feed button that filled it.
  //
  // Synced from main.ts's own subscription (below) rather than `initXpBar`'s
  // convenience wrapper, so it uses the SAME single store subscription every
  // other view here does and cannot fall out of order with them.
  // The bar's own tap opens the Keep upgrade card (bible §1.2: "Tapping it
  // opens the upgrade card"); the folded-in Build icon opens the Build
  // sheet (round 2G — it used to float on its own, built inside phase5.ts).
  const xpBar = createXpBar({
    onOpenUpgrades: () => phase5.openUpgrades(),
    onOpenBuild: () => phase5.openBuild(),
  });
  hideKeepStrip = (hidden) => xpBar.setHidden(hidden);
  ui.mountChrome(xpBar.el);

  // The tier-up banner. Trigger is `state.lastLevelUp`, set once per
  // successful PURCHASE_KEEP_LEVEL tap; the module queues behind the
  // Doorstep and the loot reveal on its own (it watches for their open
  // classes) and plays multiple queued tier-ups one at a time — which is
  // what a migrated veteran gets on their first session back, since the v8
  // backfill can leave several tiers affordable at once.
  initLevelUpUi({ mount: document.body, store });

  // --- The Nook menu: the one way in to all three 2C destinations ---
  // ONE SURFACE AT A TIME is enforced here, in the only module that can see
  // all of them: every pick closes the others first. Without this, the
  // Album (z 22) simply painted over an open focus view (z 20) and the
  // player had two live overlays with two backdrops — the same "resolved by
  // z-index luck" bug the Phase 5 keep bar had.
  const navMenu = createNavMenu({
    mount: document.body,
    getState: () => store.getState(),
    onPick: (id) => {
      ui.closeSurfaces();
      pipdexView.close();
      sanctuaryView.close();
      dailies.close();
      // Round 2H's two destinations join the same one-surface-at-a-time
      // routine. The Nursery is always listed; "Someone to find" only
      // appears while a lineage egg is actually waiting (see navMenu.ts).
      pipLevelView.close();
      breedingView.close();
      memorialView.closeLineageBoard();
      // Round 2J: the Craft Table joins the same one-surface-at-a-time
      // routine — a Nook destination like every other one above.
      craftingView.close();
      // Round 2I's settings sheet joins the same routine (it is reached
      // via `onOpenNotifications` below, not this switch, but it must
      // still yield to any OTHER destination the player picks instead).
      notifySettings.close();
      if (id === "album") pipdexView.open();
      else if (id === "meadow") sanctuaryView.open();
      else if (id === "today") dailies.open();
      else if (id === "nursery") breedingView.open();
      else if (id === "crafting") craftingView.open();
      else if (id === "lineage") memorialView.openLineageBoard();
    },
    // ROUND 2H — SHIELD SIX (docs/lifecycle-bible.md §7.7). One dispatch,
    // no confirm dialog and no warning copy: a player reaching for "Pips
    // never fall ill" should get it immediately, and turning it back on is
    // free either way.
    onSetQuietKeep: (on) => {
      store.dispatch({ type: "SET_QUIET_KEEP", on, at: clock.now() });
    },
    // ROUND 2I (bible §5.1) — "Tap on the shoulder": a DESTINATION below
    // Quiet Keep, not a switch, so it goes through the SAME one-surface-
    // at-a-time routine `onPick` enforces above rather than toggling in
    // place.
    getNotifyRow: () => notificationsNookRow(notifyPrefsCtl.get(), notificationAsk.permissionState()),
    onOpenNotifications: () => {
      ui.closeSurfaces();
      pipdexView.close();
      sanctuaryView.close();
      dailies.close();
      pipLevelView.close();
      breedingView.close();
      memorialView.closeLineageBoard();
      craftingView.close();
      notifySettings.open();
    },
  });

  // The lineage board's "Send someone" button (bible §5.3 item 2): close the
  // board, open the picker on the Pip whose page it lands on. The focus view
  // owns the expedition list; this just gets the player there.
  openExpeditionPicker = () => {
    memorialView.closeLineageBoard();
    ui.openFocus();
  };

  // --- Round 2F: the milestone ribbon (progression bible §6.1) ---
  //
  // The owner's "need better notification when milestones are completed".
  // Non-blocking, batches several milestones that land on the same action
  // into ONE ribbon, and flies its `+N XP` chip into the bar created above —
  // which is why `xpBar` is passed in, and why it had to exist first.
  //
  // Tapping the ribbon opens the Nook's Milestones tab, and goes through
  // the same close-everything-else routine `navMenu`'s own `onPick` does:
  // ONE SURFACE AT A TIME is enforced in main.ts because main.ts is the only
  // module that can see all of them.
  //
  // `ui/dailies.ts` still BANKS each earned milestone (CLAIM_MILESTONE) —
  // this module only celebrates. That split is deliberate: the reward must
  // land whether or not anyone is watching a ribbon.
  initMilestoneCelebrationUi({
    mount: document.body,
    store,
    xpBar,
    onOpenMilestones: () => {
      ui.closeSurfaces();
      pipdexView.close();
      sanctuaryView.close();
      dailies.open("milestones");
    },
  });

  // --- Store → scene/UI reactions ---
  let prevState = store.getState();
  scene.sync(prevState);
  ui.sync(prevState);
  xpBar.sync(prevState);
  pipdexView.sync(prevState);
  sanctuaryView.sync(prevState);
  navMenu.sync(prevState);
  pipLevelView.sync(prevState);
  ailmentView.sync(prevState);
  memorialView.sync(prevState);
  breedingView.sync(prevState);
  craftingView.sync(prevState);

  store.subscribe((state) => {
    const prev = prevState;
    prevState = state;
    scene.sync(state);
    ui.sync(state);
    xpBar.sync(state);
    pipdexView.sync(state);
    sanctuaryView.sync(state);
    navMenu.sync(state);
    // Round 2H: the memorial view is DRIVEN by its sync — it watches
    // `lastLossOutcome` and the `readyToRetire` edge itself, so the loss
    // moment and the retirement card fire without main.ts diffing anything.
    // The ailment view's floating chip is likewise self-driving.
    pipLevelView.sync(state);
    ailmentView.sync(state);
    memorialView.sync(state);
    breedingView.sync(state);
    craftingView.sync(state);
    watchAlerts(prev, state);

    if (state.lastCareOutcome !== prev.lastCareOutcome && state.lastCareOutcome !== null) {
      scene.playCareOutcome(state.lastCareOutcome, consumedItem(prev, state));
      ui.showOutcome(state.lastCareOutcome);
    }

    // Send-off: a successful ASSIGN_EXPEDITION trots the pip off-screen
    // (spec §10.1.4). The focus view closes itself on the same diff.
    if (
      state.lastAssignOutcome !== prev.lastAssignOutcome &&
      state.lastAssignOutcome?.ok === true
    ) {
      const { pipId, expeditionId, durationMs } = state.lastAssignOutcome;
      const pip = state.pips[pipId];
      if (pip !== undefined) {
        playDepartureTrot(pip);
        notify({
          kind: "info",
          message: `${pip.name} trotted off to the ${expeditionName(expeditionId)} — back in ${formatDurationShort(durationMs)}!`,
        });
        // Round 2I (bible §3.2): the earned-ask's ONE trigger. The module
        // decides for itself whether this send actually qualifies (first
        // ever / re-ask window / already resolved / onboarding active) —
        // every successful send is reported, unconditionally.
        notificationAsk.onExpeditionSent({
          pipName: pip.name,
          biomeName: expeditionName(expeditionId),
          durationMs,
        });
      }
    }

    // Expedition-return toasts live in the phase4 module (diffPhase4):
    // it fires "X is back from the Y!" and auto-opens the loot reveal, so
    // main.ts adds nothing here. The top bar's "!" chip is the persistent
    // tap-to-open affordance for a still-waiting queue.

    if (state.lastCatchup !== prev.lastCatchup && state.lastCatchup !== null) {
      // The "While you were away…" sheet (phase4 module) renders this.
      // Keep the console echo for QA; skip sub-second absences (quick tab
      // flicks fire a CATCHUP per §4.5 — noise, not news).
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

  // --- Web Push scheduling (round 2I, docs/notifications-bible.md §2) ---
  // THE CALL THAT MAKES THE ROUND REAL. Everything upstream of this line —
  // src/core/notifications/ (plan + budget + ledger) and src/app/push.ts's
  // Tier-1 scheduler — is inert without it; a catalogue that is computed
  // and never delivered would have been the eighth dead feature.
  //
  // Deliberately LAST in boot: it attaches a `visibilitychange` listener,
  // and the ones registered before it (persistence's save flush,
  // ticker.ts's loop pause) must run first so that on hide the state is
  // already flushed and the loop already stopped before we derive due
  // moments from it.
  //
  // Every dependency is read live, never captured: `getState` returns
  // whatever the store holds at wake time (the bible's "never trust the
  // armed payload"), and `getPrefs` reads the same in-memory prefs object
  // the settings sheet mutates, so toggling a type off cancels its next
  // notification with no plumbing in between.
  const pushNotifications = initPushNotifications({
    clock,
    getState: () => store.getState(),
    getPrefs: () => notifyPrefsCtl.get(),
    getDayOffsetMs: () => store.getState().dayOffsetMs,
    serviceWorker:
      typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? navigator.serviceWorker
        : null,
    ledgerStore: saveStore,
  });
  // Dev-only escape hatch for the manual gate: the honest way to see a
  // notification is to hide the tab and wait, but a five-minute wait per
  // attempt makes the flow untestable by hand. Never referenced in
  // production (`import.meta.env.DEV` is replaced with `false` and the
  // branch is eliminated).
  if (import.meta.env.DEV) {
    (window as unknown as { pkPush?: unknown }).pkPush = pushNotifications;
  }

  // --- Loops ---
  app.ticker.add((ticker) => {
    scene.update(ticker.deltaMS);
    ui.update();
  });
  startTicker(store, clock);
}

void boot();
