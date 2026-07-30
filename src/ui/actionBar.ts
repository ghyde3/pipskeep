/**
 * Bottom action bar (spec §10): big thumb-friendly Feed / Clean / Play /
 * Pet / Rest / Items buttons with pressed states, disabled looks, and a
 * live countdown ring while Clean/Pet cool down (spec §5: 60s / 30s).
 *
 * Dumb DOM (spec §2 rule 4): reads state, dispatches actions, never
 * mutates. Cooldown progress needs wall time, which comes from the
 * injected Clock via `tick(now)` — no Date.now() here.
 */

import type { Clock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import { PipActivity } from "../core/pips/types";
import type { PipState } from "../core/pips/types";
import { canReceiveCare } from "../core/pips/machine";
import { tuning } from "../content/tuning";
import { FOOD_IDS } from "../content/foods";
import { sound } from "../app/sound";

export interface ActionBarDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  clock: Clock;
  openItems(): void;
}

export interface ActionBar {
  readonly el: HTMLElement;
  sync(state: GameState): void;
  /** Per-frame: cooldown rings + countdown numbers. */
  tick(now: number): void;
}

// ---------------------------------------------------------------------------
// ROUND 2F — WHY THE CARE BAR IS GREY, AND THE ONE-TAP WAY OUT
//
// Measured on a 14h and a 20h return with a Pip clocked in at the Gathering
// Station: Feed / Clean / Play / Pet / Rest all disabled at opacity 0.45, with
// NO explanation on the bar and no affordance. Tap count from cold open to a
// care action was THREE — "Come in", then another Pip's portrait in the roster
// strip (discoverable only by first tapping a dead button and getting nothing),
// then Feed. And staffing a station before closing the app is exactly the
// behaviour the game teaches, so this is the DEFAULT day-2 state, not an edge
// case.
//
// Two pure helpers below, so both the reason and the escape hatch are testable
// without a DOM.
// ---------------------------------------------------------------------------

/** Warm, specific reason the active Pip cannot take care right now, or null
 * when it can. Never scolds the player — the Pip is busy, not the player wrong
 * (spec §15.5 / §4.4's tone rule). */
export function careUnavailableReason(pip: PipState): string | null {
  if (canReceiveCare(pip)) return null;
  switch (pip.activity) {
    case PipActivity.OnExpedition:
      return `${pip.name} is out on the trail.`;
    case PipActivity.Returning:
      return `${pip.name} is on the way home.`;
    case PipActivity.AssignedJob:
      return `${pip.name} is busy working.`;
    default:
      return `${pip.name} can't be fussed over just now.`;
  }
}

/** The first OTHER roster Pip who can take care right now, in roster order —
 * the target of the bar's one-tap switch. Null when nobody is free (in which
 * case the bar states the reason and offers nothing, which is honest). */
export function firstCareablePipId(state: GameState): string | null {
  for (const pipId of state.rosterOrder) {
    if (pipId === state.activePipId) continue;
    const pip = state.pips[pipId];
    if (pip !== undefined && canReceiveCare(pip)) return pipId;
  }
  return null;
}

type ButtonId = "feed" | "clean" | "play" | "pet" | "rest" | "items";

/** Accessible names for the six care buttons (a11y — spec §10 big
 * thumb-friendly buttons must also read right to assistive tech).
 * Exported for tests. Rest flips to the wake label while Resting. */
export const ACTION_ARIA_LABELS: Readonly<Record<ButtonId, string>> = {
  feed: "Feed this Pip",
  clean: "Clean this Pip",
  play: "Play with this Pip",
  pet: "Pet this Pip",
  rest: "Tuck this Pip in to rest",
  items: "Open the items satchel",
};

export const REST_WAKE_ARIA_LABEL = "Wake this Pip up";

interface ButtonEls {
  button: HTMLButtonElement;
  label: HTMLElement;
  ring: HTMLElement;
  ringText: HTMLElement;
}

/** First food id with stock, in registry order — the Feed button's pick.
 * (The Items sheet offers explicit choices.) */
export function firstStockedFoodId(state: GameState): string | null {
  for (const id of FOOD_IDS) {
    if ((state.inventory[id] ?? 0) > 0) return id;
  }
  return null;
}

export function createActionBar(deps: ActionBarDeps): ActionBar {
  const el = document.createElement("div");
  el.className = "pk-actionbar";

  // The reason pill: shown ONLY while the whole care bar is disabled. When
  // another Pip is free it is a BUTTON that switches to them, which turns the
  // 3-tap day-2 path into 2 and makes the roster strip discoverable without
  // having to tap a dead button first.
  const reason = document.createElement("button");
  reason.type = "button";
  reason.className = "pk-actionbar-reason";
  reason.hidden = true;
  let reasonTarget: string | null = null;
  reason.addEventListener("click", () => {
    if (reasonTarget === null) return;
    sound("ui.tap");
    deps.dispatch({ type: "SET_ACTIVE_PIP", pipId: reasonTarget });
  });
  el.appendChild(reason);

  const buttons = {} as Record<ButtonId, ButtonEls>;

  const make = (id: ButtonId, text: string, onTap: () => void): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pk-action";
    button.dataset["action"] = id;
    // Explicit accessible name (a11y): without it the cooldown ring's
    // countdown digits pollute the computed name ("12 Clean") and the
    // buttons read as unnamed/garbled to assistive tech.
    button.setAttribute("aria-label", ACTION_ARIA_LABELS[id]);
    const ring = document.createElement("span");
    ring.className = "pk-ring";
    ring.setAttribute("aria-hidden", "true"); // decorative countdown
    const ringText = document.createElement("span");
    ringText.className = "pk-ring-text";
    ring.appendChild(ringText);
    const label = document.createElement("span");
    label.className = "pk-action-label";
    label.textContent = text;
    button.append(ring, label);
    button.addEventListener("click", () => {
      if (button.disabled) return;
      sound("ui.tap");
      onTap();
    });
    buttons[id] = { button, label, ring, ringText };
    el.appendChild(button);
  };

  const at = (): number => deps.clock.now();
  const activePipId = (): string => deps.getState().activePipId;

  make("feed", "Feed", () => {
    const state = deps.getState();
    const foodId = firstStockedFoodId(state);
    if (foodId === null) return;
    deps.dispatch({ type: "FEED", pipId: activePipId(), foodId, at: at() });
  });
  make("clean", "Clean", () => {
    deps.dispatch({ type: "CLEAN", pipId: activePipId(), at: at() });
  });
  make("play", "Play", () => {
    deps.dispatch({ type: "PLAY", pipId: activePipId(), at: at() });
  });
  make("pet", "Pet", () => {
    deps.dispatch({ type: "PET", pipId: activePipId(), at: at() });
  });
  make("rest", "Rest", () => {
    deps.dispatch({ type: "REST_TOGGLE", pipId: activePipId(), at: at() });
  });
  make("items", "Items", () => {
    deps.openItems();
  });

  /** Remaining cooldown ms for an action, 0 when ready. */
  const cooldownLeft = (
    state: GameState,
    action: "clean" | "pet",
    now: number,
  ): number => {
    const lastUsed = state.cooldowns[state.activePipId]?.[action];
    if (lastUsed === undefined) return 0;
    const total =
      action === "clean" ? tuning.care.clean.cooldownMs : tuning.care.pet.cooldownMs;
    const elapsed = now - lastUsed;
    // Clock moved backwards — mirror core's onCooldown and show it as ready
    // rather than rendering an hours-long countdown.
    if (elapsed < 0) return 0;
    return Math.max(0, total - elapsed);
  };

  const syncCooldownButton = (
    id: "clean" | "pet",
    state: GameState,
    now: number,
    careOk: boolean,
  ): void => {
    const els = buttons[id];
    const left = cooldownLeft(state, id, now);
    const total =
      id === "clean" ? tuning.care.clean.cooldownMs : tuning.care.pet.cooldownMs;
    if (left > 0) {
      els.button.disabled = true;
      els.button.classList.add("pk-action--cooldown");
      const pct = ((total - left) / total) * 360;
      els.ring.style.setProperty("--pk-ring-deg", `${pct}deg`);
      els.ringText.textContent = `${Math.ceil(left / 1000)}`;
    } else {
      els.button.disabled = !careOk;
      els.button.classList.remove("pk-action--cooldown");
      els.ringText.textContent = "";
    }
  };

  let lastState: GameState | null = null;

  const apply = (state: GameState, now: number): void => {
    const pip = state.pips[state.activePipId];
    if (pip === undefined) return;
    const careOk = canReceiveCare(pip);

    // Say WHY, and offer the way out.
    const why = careUnavailableReason(pip);
    if (why === null) {
      reason.hidden = true;
      reasonTarget = null;
    } else {
      reasonTarget = firstCareablePipId(state);
      const freeName =
        reasonTarget === null ? null : (state.pips[reasonTarget]?.name ?? null);
      reason.hidden = false;
      reason.textContent =
        freeName === null ? why : `${why} Fuss over ${freeName} instead?`;
      reason.disabled = reasonTarget === null;
      reason.setAttribute(
        "aria-label",
        freeName === null ? why : `${why} Switch to ${freeName}.`,
      );
    }
    // The greyed buttons themselves carry the reason too, so assistive tech and
    // a long-press tooltip both explain the dead bar rather than leaving it mute.
    for (const id of ["feed", "clean", "play", "pet", "rest"] as const) {
      buttons[id].button.title = why ?? "";
    }

    buttons.feed.button.disabled = !careOk || firstStockedFoodId(state) === null;
    buttons.play.button.disabled = !careOk;
    buttons.rest.button.disabled = !careOk;
    buttons.items.button.disabled = false;
    const resting = pip.activity === PipActivity.Resting;
    buttons.rest.label.textContent = resting ? "Wake" : "Rest";
    buttons.rest.button.setAttribute(
      "aria-label",
      resting ? REST_WAKE_ARIA_LABEL : ACTION_ARIA_LABELS.rest,
    );
    syncCooldownButton("clean", state, now, careOk);
    syncCooldownButton("pet", state, now, careOk);
  };

  return {
    el,
    sync(state: GameState): void {
      lastState = state;
      apply(state, deps.clock.now());
    },
    tick(now: number): void {
      if (lastState !== null) apply(lastState, now);
    },
  };
}
