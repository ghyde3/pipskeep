/**
 * Phase 5 UI wiring (spec §9 placement, §6.2 Gathering, §6.3 economy,
 * §4.6 evolution): the Build affordance + bottom sheet, the Keep-level
 * chip + upgrade card, placement mode (the Keep scene's
 * enterPlacementMode/exitPlacementMode render hooks), the evolve-confirm
 * bubble on pip taps, and the celebration/production toasts.
 * app/main.ts calls `initPhase5Ui` once at boot, after the base UI
 * mounts (the phase4 pattern).
 *
 * Split for node testability:
 * - PURE: `diffPhase5(prev, next)` — one state transition → the list of
 *   effects (toasts, confetti bursts, sound slots). Level-ups, Cozy
 *   Bunks, evolutions, job outcomes, and BATCHED gathering production
 *   pops all decide their copy here. A transition that also carries a
 *   fresh CatchupSummary stays quiet about production — the away sheet
 *   tells that story (the diffPhase4 suppression rule).
 * - DOM: `initPhase5Ui` — mounts the chrome, drives the scene's
 *   placement mode (enterPlacementMode/exitPlacementMode — the scene
 *   snaps + validity-tints and only reports VALID tile taps; the UI
 *   dispatches and decides when to exit), registers the pip-tap seam
 *   (render/pipTap.ts, the eggTap pattern), subscribes, and executes
 *   the effect lists.
 */

import type { Clock } from "../core/clock";
import type { Store } from "../core/store";
import type { GameAction, GameState } from "../core/state";
import type { PlacementId } from "../core/keep";
import { species as contentSpecies } from "../content/species";
import { jobs as contentJobs } from "../content/jobs";
import { pickSpeciesLine } from "../content/speciesLines";
import { setPipTapHandler } from "../render/pipTap";
import { sound } from "../app/sound";
import { notify } from "./notify";
import type { NotifyEvent } from "./notify";
import { burstConfetti } from "./confetti";
import { createParadeTapCounter } from "./parade";
import { findBuildItem, resourceDisplayName } from "./buildMode";
import { createBuildSheet } from "./buildSheet";
import {
  LEVEL_UP_TOASTS,
  LEVEL_UP_TOAST_FALLBACK,
  ROSTER_UPGRADE_TOAST,
  createUpgradeCard,
} from "./keepUpgrade";
import { formatDurationShort } from "./focusView";

// ---------------------------------------------------------------------------
// Pure: state-transition → effects
// ---------------------------------------------------------------------------

/** Toast copy for structural job blocks (the world said no, not the pip
 * — spec §15.5 warm, never guilt). Sulking is NOT here: the pip voices
 * that one itself through the focus view's refusal line. */
export const JOB_BLOCK_COPY: Readonly<Record<string, string>> = {
  occupied: "One Pip per station — someone's already on it.",
  busy: "This Pip has their paws full right now.",
  unknownStation: "That station seems to have wandered off the plan.",
  unknownPip: "Hmm — who? The Keep has no record of that Pip.",
  notAssigned: "They weren't on the clock anyway.",
};

export interface Phase5Effects {
  readonly toasts: readonly NotifyEvent[];
  /** Celebration bursts to fire (level-up, bunks, evolution). */
  readonly confettiBursts: number;
  /** sound(slotId) seam calls, in order (spec §12: no-op hooks). */
  readonly sounds: readonly string[];
}

/**
 * Gathering production carried by this transition, batched: item id →
 * amount gained. Null when the transition carries no NEW production —
 * or when a fresh CatchupSummary landed in the same transition (the
 * "While you were away…" sheet already tells that story; spec §4.5).
 * Production is recognized by a job's `lastProducedAt` advancing, so
 * unrelated count changes (loot acknowledge, purchases, Feed) never
 * toast. Gains are read from BOTH pools: produced foods (Berries) land
 * in the inventory, everything else in resources (spec §6.3 routing).
 */
export function diffJobProduction(
  prev: GameState,
  next: GameState,
): Readonly<Record<string, number>> | null {
  if (next.lastCatchup !== prev.lastCatchup) return null;
  let produced = false;
  for (const [pipId, job] of Object.entries(next.jobs)) {
    const before = prev.jobs[pipId];
    if (before !== undefined && job.lastProducedAt > before.lastProducedAt) {
      produced = true;
      break;
    }
  }
  if (!produced) return null;
  const gains: Record<string, number> = {};
  for (const [pool, before] of [
    [next.inventory, prev.inventory],
    [next.resources, prev.resources],
  ] as const) {
    for (const [id, count] of Object.entries(pool)) {
      const delta = count - (before[id] ?? 0);
      if (delta > 0) gains[id] = (gains[id] ?? 0) + delta;
    }
  }
  return Object.keys(gains).length > 0 ? gains : null;
}

/** "Berry ×2, Fiber ×1" — satchel-chip language, batched. */
export function formatGains(gains: Readonly<Record<string, number>>): string {
  return Object.entries(gains)
    .map(([id, count]) => `${resourceDisplayName(id)} ×${count}`)
    .join(", ");
}

/** Everything Phase 5 wants to DO about one state transition, as data. */
export function diffPhase5(prev: GameState, next: GameState): Phase5Effects {
  const toasts: NotifyEvent[] = [];
  const sounds: string[] = [];
  let confettiBursts = 0;

  // Keep level-up (spec §9): celebratory toast + confetti + sound.
  if (next.keep.level > prev.keep.level) {
    toasts.push({
      kind: "info",
      message: LEVEL_UP_TOASTS[next.keep.level] ?? LEVEL_UP_TOAST_FALLBACK,
    });
    confettiBursts += 1;
    sounds.push("keep.levelup");
  }

  // Cozy Bunks (spec §7.4).
  if (next.rosterUpgradePurchased && !prev.rosterUpgradePurchased) {
    toasts.push({ kind: "info", message: ROSTER_UPGRADE_TOAST });
    confettiBursts += 1;
    sounds.push("keep.bunks");
  }

  // Evolution moment (spec §4.6 — player-witnessed, so celebrate loud).
  if (
    next.lastEvolveOutcome !== prev.lastEvolveOutcome &&
    next.lastEvolveOutcome !== null &&
    next.lastEvolveOutcome.ok
  ) {
    const outcome = next.lastEvolveOutcome;
    const name = next.pips[outcome.pipId]?.name ?? "Your Pip";
    const target =
      contentSpecies[outcome.toSpeciesId]?.name ?? outcome.toSpeciesId;
    toasts.push({
      kind: "info",
      message: `${name} shimmered head to toe — say hello to a ${target}!`,
    });
    confettiBursts += 1;
    sounds.push("pip.evolve");
  }

  // Job outcomes (spec §6.2): a warm confirmation on assign; structural
  // blocks get their copy; the sulking refusal line is the focus view's.
  if (
    next.lastJobOutcome !== prev.lastJobOutcome &&
    next.lastJobOutcome !== null
  ) {
    const outcome = next.lastJobOutcome;
    if (outcome.action === "assignJob" && outcome.ok) {
      const name = next.pips[outcome.pipId]?.name ?? "Your Pip";
      const interval = contentJobs[outcome.jobId]?.intervalMs;
      toasts.push({
        kind: "info",
        message:
          interval !== undefined
            ? `${name} is on gathering duty — first haul in ${formatDurationShort(interval)}.`
            : `${name} is on gathering duty.`,
      });
      sounds.push("job.assign");
    } else if (
      outcome.action === "assignJob" &&
      !outcome.ok &&
      outcome.reason !== "sulking"
    ) {
      const copy = JOB_BLOCK_COPY[outcome.reason];
      if (copy !== undefined) toasts.push({ kind: "info", message: copy });
    }
  }

  // Batched gathering production pop (spec §6.2 — sparingly, no spam).
  const gains = diffJobProduction(prev, next);
  if (gains !== null) {
    toasts.push({
      kind: "info",
      message: `Fresh from the Gathering Station: ${formatGains(gains)}.`,
    });
    sounds.push("job.produce");
  }

  return { toasts, confettiBursts, sounds };
}

// ---------------------------------------------------------------------------
// DOM wiring
// ---------------------------------------------------------------------------

/** Extra live-toast throttle for production pops: never two inside this
 * window, however the tick boundaries land ("sparingly"). */
const PRODUCTION_TOAST_MIN_GAP_MS = 45_000;

/** Evolve bubble auto-dismiss (it reappears on the next tap). */
const EVOLVE_BUBBLE_TIMEOUT_MS = 9_000;

/** The slice of the Keep scene this module drives (spec §9 placement
 * hooks). Structural, so tests can stub it and ui/ never imports Pixi:
 * render/keepScene.ts's KeepScene satisfies it. The scene snaps to the
 * grid, tints the ghost by core-checked validity, and calls `onPlaced`
 * only for VALID tiles; the UI dispatches and exits. */
export interface PlacementScene {
  enterPlacementMode(
    itemId: string,
    onPlaced: (x: number, y: number) => void,
    opts?: { movePlacementId?: string },
  ): void;
  exitPlacementMode(): void;
  /** Cosmetic-only scene moment (see render/keepScene.ts playParade —
   * dispatch-free by contract; the Keep-chip tap streak triggers it). */
  playParade(): void;
}

export interface Phase5UiDeps {
  readonly mount: HTMLElement;
  readonly store: Store<GameState, GameAction>;
  readonly clock: Clock;
  /** The Keep scene's placement hooks (render/keepScene.ts). */
  readonly scene: PlacementScene;
  getBubbleAnchor(): { x: number; y: number };
  /** Open the Pip focus view (non-glowing pip tap, spec §10 two views). */
  openFocus(): void;
}

export interface Phase5Ui {
  dispose(): void;
}

export function initPhase5Ui(deps: Phase5UiDeps): Phase5Ui {
  const { store, clock } = deps;
  const root = document.createElement("div");
  root.className = "pk-phase5";
  deps.mount.appendChild(root);

  // --- Keep bar: the Keep-level chip + the Build button ---
  const keepBar = document.createElement("div");
  keepBar.className = "pk-keepbar";

  const keepChip = document.createElement("button");
  keepChip.type = "button";
  keepChip.className = "pk-keep-chip";
  keepChip.title = "The Keep";

  const buildBtn = document.createElement("button");
  buildBtn.type = "button";
  buildBtn.className = "pk-build-btn";
  buildBtn.textContent = "Build";
  buildBtn.title = "Build something for the Keep";

  keepBar.append(keepChip, buildBtn);
  root.appendChild(keepBar);

  // --- Placement mode (the scene's render hooks, spec §9) ---
  // While a ghost is live, this pill names the moment and carries the
  // thumb-friendly way out (the scene has no cancel affordance of its
  // own — the UI decides when placement mode ends).
  const placeBar = document.createElement("div");
  placeBar.className = "pk-placebar";
  const placeBarText = document.createElement("span");
  placeBarText.className = "pk-placebar-text";
  const placeBarCancel = document.createElement("button");
  placeBarCancel.type = "button";
  placeBarCancel.className = "pk-placebar-cancel";
  placeBarCancel.textContent = "Never mind";
  placeBar.append(placeBarText, placeBarCancel);
  root.appendChild(placeBar);

  const endPlacement = (): void => {
    deps.scene.exitPlacementMode();
    placeBar.classList.remove("pk-placebar--in");
    keepBar.classList.remove("pk-keepbar--hide");
  };
  placeBarCancel.addEventListener("click", () => {
    sound("ui.tap");
    endPlacement();
  });

  const beginPlacement = (label: string): void => {
    placeBarText.textContent = label;
    placeBar.classList.add("pk-placebar--in");
    // The pill owns the bottom thumb zone while the ghost is live.
    keepBar.classList.add("pk-keepbar--hide");
  };

  const startPlace = (itemId: string): void => {
    const def = findBuildItem(itemId);
    if (def === null) return;
    deps.scene.enterPlacementMode(itemId, (x, y) => {
      const before = store.getState();
      store.dispatch({ type: "PLACE_ITEM", itemId, x, y });
      const after = store.getState();
      endPlacement();
      if (after.keep.placements !== before.keep.placements) {
        sound("keep.place");
        notify({
          kind: "info",
          message: `${def.name} set down — the Keep approves.`,
        });
      } else {
        // The scene only reports core-valid tiles, so this is a race
        // (state moved between tap and dispatch). Stay warm about it.
        notify({
          kind: "info",
          message: "That spot didn't work out — pick another?",
        });
      }
    });
    beginPlacement(`Placing the ${def.name} — tap a green spot`);
  };

  const startMove = (placementId: PlacementId): void => {
    const state = store.getState();
    const placement = state.keep.placements[placementId];
    if (placement === undefined) return;
    const def = findBuildItem(placement.itemId);
    if (def === null) return;
    deps.scene.enterPlacementMode(
      placement.itemId,
      (x, y) => {
        const before = store.getState();
        store.dispatch({ type: "MOVE_ITEM", placementId, x, y });
        const after = store.getState();
        endPlacement();
        if (after.keep.placements !== before.keep.placements) {
          sound("keep.place");
          notify({ kind: "info", message: `${def.name} found a new home.` });
        }
      },
      { movePlacementId: placementId },
    );
    beginPlacement(`Moving the ${def.name} — tap its new spot`);
  };

  const removePlacement = (placementId: PlacementId): void => {
    const before = store.getState();
    const placement = before.keep.placements[placementId];
    if (placement === undefined) return;
    const name = findBuildItem(placement.itemId)?.name ?? placement.itemId;
    const worker = Object.entries(before.jobs).find(
      ([, job]) => job.stationPlacementId === placementId,
    );
    const workerName =
      worker !== undefined ? before.pips[worker[0]]?.name : undefined;
    store.dispatch({ type: "REMOVE_ITEM", placementId });
    const after = store.getState();
    if (after.keep.placements !== before.keep.placements) {
      sound("keep.remove");
      notify({
        kind: "info",
        message:
          workerName !== undefined
            ? `${name} tucked away — ${workerName} is off the clock. Materials returned.`
            : `${name} tucked away — materials returned.`,
      });
    }
  };

  // --- Build sheet + upgrade card ---
  const buildSheet = createBuildSheet({
    getState: () => store.getState(),
    startPlace,
    startMove,
    remove: removePlacement,
  });
  root.appendChild(buildSheet.el);
  buildBtn.addEventListener("click", () => {
    sound("ui.tap");
    // The keep bar sits above the upgrade card's backdrop (ui.css), so
    // Build stays reachable while the card is open — hand off cleanly.
    upgradeCard.close();
    buildSheet.open();
  });

  const upgradeCard = createUpgradeCard({
    dispatch: (action) => store.dispatch(action),
    getState: () => store.getState(),
  });
  root.appendChild(upgradeCard.el);
  // Rapid-tap streak on the Keep chip → the scene's cosmetic moment.
  // The counter's deps are now() + start() ONLY (ui/parade.ts — no
  // dispatch by construction); ui.css keeps the chip above the upgrade
  // card's backdrop so the streak isn't swallowed after the first tap.
  const paradeTaps = createParadeTapCounter({
    now: () => clock.now(),
    start: () => deps.scene.playParade(),
  });
  keepChip.addEventListener("click", () => {
    sound("ui.tap");
    if (paradeTaps.tap()) {
      upgradeCard.close(); // clear the stage — the roster has plans
      return;
    }
    upgradeCard.open();
  });

  // --- Evolve confirm bubble (spec §4.6: the tap is the moment) ---
  const evolveBubble = document.createElement("div");
  evolveBubble.className = "pk-evolve";
  const evolveText = document.createElement("div");
  evolveText.className = "pk-evolve-text";
  evolveText.textContent = "Something wants to change…";
  const evolveActions = document.createElement("div");
  evolveActions.className = "pk-evolve-actions";
  const evolveYes = document.createElement("button");
  evolveYes.type = "button";
  evolveYes.className = "pk-evolve-yes";
  evolveYes.textContent = "Evolve";
  const evolveNo = document.createElement("button");
  evolveNo.type = "button";
  evolveNo.className = "pk-evolve-no";
  evolveNo.textContent = "Not yet";
  evolveActions.append(evolveYes, evolveNo);
  evolveBubble.append(evolveText, evolveActions);
  root.appendChild(evolveBubble);

  let evolvePipId: string | null = null;
  let evolveTimer: number | null = null;

  const closeEvolveBubble = (): void => {
    evolvePipId = null;
    evolveBubble.classList.remove("pk-evolve--in");
    if (evolveTimer !== null) {
      window.clearTimeout(evolveTimer);
      evolveTimer = null;
    }
  };

  const openEvolveBubble = (pipId: string): void => {
    evolvePipId = pipId;
    // The species' own line for this moment (content bible §6.2/§8.2.5,
    // a fence exception) — falls back to the generic prompt for a
    // species missing from `speciesLines` (defensive; validate.ts
    // requires every species to have one).
    const pip = store.getState().pips[pipId];
    evolveText.textContent =
      (pip !== undefined ? pickSpeciesLine(pip.speciesId, pip.id) : null) ??
      "Something wants to change…";
    // Position ONCE at open. Pips wander (spec §9), but a bubble that
    // follows them slides out from under the player's thumb mid-press —
    // the buttons must hold still to be pressable.
    const anchor = deps.getBubbleAnchor();
    evolveBubble.style.left = `${anchor.x}px`;
    evolveBubble.style.top = `${Math.max(70, anchor.y - 8)}px`;
    evolveBubble.classList.add("pk-evolve--in");
    sound("pip.evolveOffer");
    if (evolveTimer !== null) window.clearTimeout(evolveTimer);
    evolveTimer = window.setTimeout(closeEvolveBubble, EVOLVE_BUBBLE_TIMEOUT_MS);
  };

  evolveYes.addEventListener("click", () => {
    const pipId = evolvePipId;
    closeEvolveBubble();
    if (pipId === null) return;
    sound("ui.tap");
    store.dispatch({ type: "EVOLVE_PIP", pipId, at: clock.now() });
  });
  evolveNo.addEventListener("click", () => {
    sound("ui.tap");
    closeEvolveBubble();
  });

  // --- Pip taps (the render/pipTap.ts seam — the eggTap pattern) ---
  setPipTapHandler((pipId) => {
    const state = store.getState();
    const pip = state.pips[pipId];
    if (pip === undefined) return;
    if (pip.readyToEvolve) {
      // The glow tap (spec §4.6): confirm before the moment. Select the
      // pip first so the bubble anchor (active pip's head) tracks it.
      if (pipId !== state.activePipId) {
        store.dispatch({ type: "SET_ACTIVE_PIP", pipId });
      }
      openEvolveBubble(pipId);
      return;
    }
    if (pipId !== state.activePipId) {
      // Activate/switch, as ever (spec §10) — the selector's tap rule.
      store.dispatch({ type: "SET_ACTIVE_PIP", pipId });
      return;
    }
    deps.openFocus();
  });

  // --- Store subscription: sync chrome, execute effect lists ---
  const syncChrome = (state: GameState): void => {
    keepChip.textContent = `Keep Lv ${state.keep.level}`;
    keepChip.setAttribute(
      "aria-label",
      `The Keep, level ${state.keep.level} — open upgrades`,
    );
    buildSheet.sync(state);
    upgradeCard.sync(state);
  };
  let prev = store.getState();
  syncChrome(prev);

  let lastProductionToastAt = -Infinity;

  const unsubscribe = store.subscribe((state) => {
    const before = prev;
    prev = state;
    syncChrome(state);

    // The bubble tracks its pip: gone or no longer glowing → close.
    if (
      evolvePipId !== null &&
      state.pips[evolvePipId]?.readyToEvolve !== true
    ) {
      closeEvolveBubble();
    }

    const effects = diffPhase5(before, state);
    for (const toast of effects.toasts) {
      // Throttle only the production pops; celebrations always land.
      if (toast.message.startsWith("Fresh from the")) {
        const now = clock.now();
        if (now - lastProductionToastAt < PRODUCTION_TOAST_MIN_GAP_MS) continue;
        lastProductionToastAt = now;
      }
      notify(toast);
    }
    for (const slot of effects.sounds) sound(slot);
    for (let i = 0; i < effects.confettiBursts; i++) burstConfetti(deps.mount);
  });

  return {
    dispose(): void {
      unsubscribe();
      setPipTapHandler(null);
      closeEvolveBubble();
      root.remove();
    },
  };
}
