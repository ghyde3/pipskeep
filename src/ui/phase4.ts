/**
 * Phase 4 UI wiring (spec §6.1, §4.5, §7.2): connects the loot-reveal
 * modal, the "While you were away…" sheet, the Keep scene's egg-tap seam,
 * and the notify toasts to the store. app/main.ts calls
 * `initPhase4Ui(store, clock)` once at boot, after the base UI mounts.
 *
 * Split for node testability:
 * - PURE: `diffPhase4(prev, next)` — turns one state transition into a
 *   list of effects (toasts to fire, "a reveal arrived", "a catch-up
 *   summary landed"). All the copy and suppression rules live here: a
 *   MEANINGFUL catch-up suppresses per-event return/egg toasts because
 *   the away sheet tells that story instead.
 * - PURE-ish: `wireEggTaps(store, clock)` — registers the render seam
 *   handler that turns an egg tap into a HATCH_EGG dispatch.
 * - DOM: `initPhase4Ui` — mounts the modal + sheet, subscribes, and owns
 *   the flow: away sheet first (when the absence mattered), then the
 *   loot-reveal queue plays sequentially; live returns auto-open the
 *   reveal after a beat. `openLootReveal()` is exposed so other UI (top
 *   bar, focus view) can summon the moment for an already-waiting queue.
 */

import "./modals.css";
import type { Clock } from "../core/clock";
import type { Store } from "../core/store";
import type { GameAction, GameState } from "../core/state";
import type { CatchupSummary } from "../core/pips/catchup";
import { EggState } from "../core/eggs";
import { expeditions as contentExpeditions } from "../content/expeditions";
import { setEggTapHandler } from "../render/eggTap";
import { notify } from "./notify";
import type { NotifyEvent } from "./notify";
import {
  createLootRevealModal,
  createRevealQueueController,
} from "./lootReveal";
import { AWAY_SHEET_MIN_ELAPSED_MS, createAwaySheet, deriveAwaySheet } from "./awaySheet";

// ---------------------------------------------------------------------------
// Pure: state-transition → effects
// ---------------------------------------------------------------------------

export interface Phase4Effects {
  /** Toasts to fire, in order. */
  readonly toasts: readonly NotifyEvent[];
  /** New pending reveal(s) appeared — a completed trip wants its moment. */
  readonly revealArrived: boolean;
  /** A fresh CatchupSummary landed (the away sheet's cue), else null. */
  readonly catchup: CatchupSummary | null;
}

export interface Phase4DiffContent {
  readonly expeditionNames?: Readonly<Record<string, { readonly name: string }>>;
  /** Catch-ups at/above this are "meaningful": the away sheet tells the
   * story and per-event toasts stay quiet. */
  readonly meaningfulCatchupMs?: number;
}

function capitalize(id: string): string {
  return id.length === 0 ? id : id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Everything Phase 4 wants to DO about one state transition, as data.
 * Pure — the DOM wiring below just executes the list.
 */
export function diffPhase4(
  prev: GameState,
  next: GameState,
  content: Phase4DiffContent = {},
): Phase4Effects {
  const expeditionNames =
    content.expeditionNames ??
    (contentExpeditions as Readonly<Record<string, { name: string }>>);
  const meaningfulMs = content.meaningfulCatchupMs ?? AWAY_SHEET_MIN_ELAPSED_MS;

  const toasts: NotifyEvent[] = [];

  const catchup =
    next.lastCatchup !== prev.lastCatchup && next.lastCatchup !== null
      ? next.lastCatchup
      : null;
  const sheetWillTellIt = catchup !== null && catchup.elapsedMs >= meaningfulMs;

  // New reveals (live TICK returns, or returns settled during a CATCHUP).
  const revealArrived = next.pendingReveals.length > prev.pendingReveals.length;
  if (revealArrived && !sheetWillTellIt) {
    for (const reveal of next.pendingReveals.slice(prev.pendingReveals.length)) {
      const name = next.pips[reveal.pipId]?.name ?? "A Pip";
      const where =
        expeditionNames[reveal.expeditionId]?.name ??
        capitalize(reveal.expeditionId);
      toasts.push({
        kind: "expeditionReturn",
        message: `${name} is back from the ${where}!`,
      });
    }
  }

  // Eggs that just started Pipping (spec §7.2 — they wait for the tap).
  if (!sheetWillTellIt) {
    const prevStates = new Map(prev.eggs.map((egg) => [egg.id, egg.state]));
    let pipped = 0;
    for (const egg of next.eggs) {
      if (
        egg.state === EggState.Pipping &&
        prevStates.get(egg.id) !== EggState.Pipping
      ) {
        pipped += 1;
      }
    }
    if (pipped === 1) {
      toasts.push({
        kind: "eggPipping",
        message: "Your egg is pipping! Something is tapping from inside…",
      });
    } else if (pipped > 1) {
      toasts.push({
        kind: "eggPipping",
        message: "The eggs are tapping from the inside…",
      });
    }
  }

  // Roster-cap hatch refusal (spec §7.4): surface the core's friendly
  // message. Structural refusals (unknownEgg/notPipping) stay silent —
  // the UI should not have offered the tap.
  if (
    next.lastHatchOutcome !== prev.lastHatchOutcome &&
    next.lastHatchOutcome !== null &&
    !next.lastHatchOutcome.ok &&
    next.lastHatchOutcome.reason === "rosterFull" &&
    next.lastHatchOutcome.message !== undefined
  ) {
    toasts.push({ kind: "info", message: next.lastHatchOutcome.message });
  }

  return { toasts, revealArrived, catchup };
}

// ---------------------------------------------------------------------------
// Egg tap → HATCH_EGG
// ---------------------------------------------------------------------------

/** Register the scene's egg-tap seam: a tap on a Pipping egg dispatches
 * HATCH_EGG at the app clock's now. Core owns every refusal. */
export function wireEggTaps(
  store: Store<GameState, GameAction>,
  clock: Clock,
): void {
  setEggTapHandler((eggId) => {
    store.dispatch({ type: "HATCH_EGG", eggId, at: clock.now() });
  });
}

// ---------------------------------------------------------------------------
// DOM wiring
// ---------------------------------------------------------------------------

/** Beat between "the toast fired" and "the modal takes the stage". */
const REVEAL_AUTO_OPEN_DELAY_MS = 700;
/** Boot-time beat before an already-waiting queue starts playing. */
const REVEAL_BOOT_DELAY_MS = 900;

export interface Phase4UiDeps {
  /** Mount point; defaults to document.body. */
  readonly mount?: HTMLElement;
}

export interface Phase4Ui {
  /** Play the pending-reveal queue if anything is waiting (no-op while
   * the modal or the away sheet already has the stage). */
  openLootReveal(): void;
  dispose(): void;
}

export function initPhase4Ui(
  store: Store<GameState, GameAction>,
  clock: Clock,
  deps: Phase4UiDeps = {},
): Phase4Ui {
  const mount = deps.mount ?? document.body;
  const root = document.createElement("div");
  root.className = "pk-phase4";
  mount.appendChild(root);

  const controller = createRevealQueueController({
    getState: () => store.getState(),
    dispatch: (action) => store.dispatch(action),
    now: () => clock.now(),
  });

  const modal = createLootRevealModal({
    mount: root,
    onCollect: () => {
      const nextScript = controller.collectAndNext();
      if (nextScript !== null) {
        modal.play(nextScript);
      } else {
        modal.close();
      }
    },
  });

  const openLootReveal = (): void => {
    if (modal.isOpen() || sheet.isOpen()) return;
    const script = controller.openScript();
    if (script !== null) modal.play(script);
  };

  const sheet = createAwaySheet({
    mount: root,
    onDismiss: () => openLootReveal(),
  });

  wireEggTaps(store, clock);

  const maybeShowSheet = (summary: CatchupSummary, state: GameState): void => {
    if (modal.isOpen() || sheet.isOpen()) return;
    const model = deriveAwaySheet(summary, state);
    if (model !== null) sheet.show(model);
  };

  let prev = store.getState();
  const unsubscribe = store.subscribe((state) => {
    const before = prev;
    prev = state;
    const effects = diffPhase4(before, state);
    for (const toast of effects.toasts) {
      // diffPhase4 is pure (data only) — the tap action is wiring-layer.
      // Return toasts open the loot reveal (ui.css's .pk-toast--tap
      // affordance; the top bar's "!" chip is the persistent fallback).
      notify(
        toast.kind === "expeditionReturn"
          ? { ...toast, onTap: openLootReveal }
          : toast,
      );
    }
    if (effects.catchup !== null) maybeShowSheet(effects.catchup, state);
    if (effects.revealArrived) {
      window.setTimeout(openLootReveal, REVEAL_AUTO_OPEN_DELAY_MS);
    }
  });

  // Boot: main dispatches CATCHUP before this UI mounts, so the summary
  // is already sitting in state — evaluate it now rather than waiting
  // for a diff that already happened.
  const initial = store.getState();
  if (initial.lastCatchup !== null) {
    maybeShowSheet(initial.lastCatchup, initial);
  }
  if (!sheet.isOpen() && initial.pendingReveals.length > 0) {
    window.setTimeout(openLootReveal, REVEAL_BOOT_DELAY_MS);
  }

  return {
    openLootReveal,
    dispose(): void {
      unsubscribe();
      setEggTapHandler(null);
      root.remove();
    },
  };
}
