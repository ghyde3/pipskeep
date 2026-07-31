/**
 * AILMENTS — the warm warning surface (spec §16 v1.5, docs/lifecycle-
 * bible.md §3–§4, §7.1–§7.2, promise 1: "loss is never a surprise").
 *
 * Three things live in this one module because they are one story — a
 * Pip is only ever ailing because of a door the player opened, and this
 * file is both the door's sign and the sickroom:
 *
 *  1. `pipStatusBadge` — the SEAM `docs/lifecycle-bible.md §9.5` asks
 *     round 2G's `ui/topBar.ts` to call: pure, DOM-free, `{ kind, ring?,
 *     label }` for the roster chip's ring/tint. Ailing beats ready beats
 *     Elder (bible: the actionable thing always outranks the passive
 *     one) — `core/pips/lifecycle.ts` owns "ready"/Elder's own truth
 *     (`readyToRetire`, `pipSeason`), this file only reads it.
 *  2. THE AILMENT CARD (`open`/`close`) — which Pip, what they have, how
 *     long in human time (never a clock: `ailmentCountdownLabel`'s bands
 *     are literal hours from bible §3.4, not a tuning knob — retuning
 *     the countdown length re-labels automatically), and the one real
 *     lever, a poultice. Never a red alert: warm amber → dusk-rose ring,
 *     no numbers on the card itself.
 *  3. THE RISK CONFIRM (`requestExpedition`) — shield one (bible §7.1):
 *     before a Pip leaves for a biome that can make her ill, the player
 *     reads the risk in words, with the exact percentage one tap away
 *     ("no hidden risk, ever"). Degrades to a plain dispatch for a safe
 *     trail, so the integrate stage can route EVERY send through this one
 *     function without special-casing quick trips.
 *
 * Pure controller + dumb DOM, same shape as `sanctuary.ts` (a sibling
 * module I also own): every model builder is state → data, unit-tested
 * without a DOM.
 */

import "./lifecycle.css";
import { tuning as contentTuning, HOUR_MS } from "../content/tuning";
import { ailments as contentAilments, POULTICE_ITEM_ID } from "../content/ailments";
import type { AilmentId } from "../content/ailments";
import { expeditions as contentExpeditions } from "../content/expeditions";
import { foods as contentFoods } from "../content/foods";
import type { PipId, PipState } from "../core/pips/types";
import { ailmentForExpedition, ailmentStage } from "../core/pips/ailment";
import type { AilmentStage } from "../core/pips/ailment";
import { contractReductionFor } from "../core/pips/level";
import { pipSeason } from "../core/pips/lifecycle";
import type { Clock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import { buildPortraitEl } from "./pipdex";
import type { PortraitVisual } from "./pipdex";
import { sound } from "../app/sound";

// ---------------------------------------------------------------------------
// Pure model layer
// ---------------------------------------------------------------------------

/** Bible §3.4's band table, verbatim — literal hours, not a tuning knob:
 * this is copy pacing, not balance, the same reasoning `sanctuary.ts`'s
 * `formatResidencySince` hardcodes its own day thresholds for. Never a
 * clock, never a number (the copy lint's `COUNTDOWN_SHAPED` regex would
 * catch a regression here). */
export function ailmentCountdownLabel(remainingMs: number, name: string): string {
  const hours = remainingMs / HOUR_MS;
  if (hours >= 48) return "A few days of tending left.";
  if (hours >= 24) return "About two days of tending left.";
  if (hours >= 12) return "About a day of tending left.";
  return `${name} needs you today.`;
}

/** Warm-amber → dusk-rose, never red (bible §3.4/§4: "a worried pet, not
 * a fire"). Deepens as the stage worsens. */
export function ailmentRingColors(stage: AilmentStage): { from: string; to: string } {
  switch (stage) {
    case "settling":
      return { from: "#f6c65b", to: "#f2a659" };
    case "worsening":
      return { from: "#f2a659", to: "#e0895f" };
    case "grave":
      return { from: "#e0895f", to: "#c97b8a" };
  }
}

export type PipStatusKind = "ailing" | "elder" | "ready" | null;

/** SEAM (docs/lifecycle-bible.md §9.5) for round 2G's `ui/topBar.ts`: the
 * roster chip's ring/tint, one call, pure. Ailing always wins (it is the
 * one that asks for action); a Pip can be BOTH ready-to-retire and Elder
 * at once (Elder is a season inside the run-up to `readyToRetire`), so
 * "ready" is checked before the season word. */
export interface PipStatusBadge {
  readonly kind: PipStatusKind;
  /** 0–1, remaining fraction — only present for `"ailing"`. */
  readonly ring?: number;
  readonly label: string;
}

export function pipStatusBadge(pip: PipState): PipStatusBadge {
  if (pip.ailment != null) {
    const ailment = pip.ailment;
    const ring = ailment.totalMs > 0 ? Math.max(0, Math.min(1, ailment.remainingMs / ailment.totalMs)) : 0;
    return { kind: "ailing", ring, label: ailmentCountdownLabel(ailment.remainingMs, pip.name) };
  }
  if (pip.readyToRetire === true) {
    return { kind: "ready", label: `${pip.name} is ready for the Long Meadow, whenever you are.` };
  }
  if (pipSeason(pip) === "elder") {
    return { kind: "elder", label: `${pip.name} is getting on in years.` };
  }
  return { kind: null, label: "" };
}

/** The ailing Pip most worth showing first — smallest remaining fraction
 * (closest to grave), ties broken by roster order. `null` when nobody is
 * ailing. */
export function mostUrgentAilingPipId(state: Pick<GameState, "pips" | "rosterOrder">): PipId | null {
  let best: { id: PipId; fraction: number } | null = null;
  for (const id of state.rosterOrder) {
    const pip = state.pips[id];
    if (pip?.ailment == null) continue;
    const fraction = pip.ailment.totalMs > 0 ? pip.ailment.remainingMs / pip.ailment.totalMs : 0;
    if (best === null || fraction < best.fraction) best = { id, fraction };
  }
  return best?.id ?? null;
}

export interface AilmentCardModel {
  readonly pipId: PipId;
  readonly name: string;
  readonly ailmentName: string;
  readonly flavor: string;
  readonly stage: AilmentStage;
  readonly ring: number;
  readonly ringColors: { readonly from: string; readonly to: string };
  readonly countdownLabel: string;
  readonly portraitVisual: PortraitVisual;
  readonly poulticeCount: number;
  readonly needsAllHighForFreeChance: boolean;
  /**
   * ROUND 2H — the hint under the buttons, and now a TRUE one. The free
   * daily cure is wired (`core/pips/ailment.ts`'s `applyDevotedCare`,
   * called from the live TICK arm), so this card may finally promise it;
   * the round's first cut printed the promise against no reducer at all,
   * and a player who did exactly what it said for two days lost the Pip
   * anyway.
   *
   * When a need is short, the copy NAMES IT — "there's a free chance" is
   * only actionable if the player can tell what is standing in the way.
   */
  readonly freeChanceHint: string;
  /**
   * Where poultices come from. Shown whenever the satchel has none — the
   * cure existed, dropped generously on all three deep trails, and the
   * game said so nowhere: in the Satchel it read as the worst food in the
   * game ("+0 Hunger"), and on this card as a disabled button. A recovery
   * path gated on knowledge the game never gives is not a recovery path.
   */
  readonly poulticeSourceHint: string | null;
  /** Shield six (bible §7.6): the Long Meadow freezes the countdown, for
   * as long as the player needs. Offered here because this card is where
   * a frightened player actually is. */
  readonly pauseHint: string;
}

/** Bible §3.5's devoted-care route, in the player's words. Names the
 * shortest need when one is short, so the hint is a next action rather
 * than a rule. */
export function freeChanceHint(pip: PipState, floor: number): string {
  let lowestId: string | null = null;
  let lowest = Infinity;
  for (const [id, value] of Object.entries(pip.needs)) {
    if (value < lowest) {
      lowest = value;
      lowestId = id;
    }
  }
  if (lowest >= floor) {
    return `Every need is high — ${pip.name} gets a free chance to shake this off each day, and one is on the way.`;
  }
  return `Bring every need up — ${NEED_WORDS[lowestId ?? ""] ?? "everything"} most of all — and ${pip.name} gets a free chance to shake this off each day.`;
}

const NEED_WORDS: Readonly<Record<string, string>> = {
  hunger: "a good meal",
  cleanliness: "a wash",
  happiness: "some company",
  energy: "a proper rest",
};

/** `null` when the Pip does not resolve or is not currently ailing —
 * defensive; the caller should not have offered the tap. */
export function buildAilmentCardModel(
  state: Pick<GameState, "pips" | "inventory">,
  pipId: PipId,
): AilmentCardModel | null {
  const pip = state.pips[pipId];
  if (pip === undefined || pip.ailment == null) return null;
  const ailment = pip.ailment;
  const def = contentAilments[ailment.id as AilmentId] as
    | (typeof contentAilments)[AilmentId]
    | undefined;
  const stage = ailmentStage(ailment);
  const ring = ailment.totalMs > 0 ? Math.max(0, Math.min(1, ailment.remainingMs / ailment.totalMs)) : 0;
  const floor = contentTuning.lifecycle.ailments.devotedCareNeedFloor;
  return {
    pipId,
    name: pip.name,
    ailmentName: def?.name ?? ailment.id,
    flavor: def?.flavor ?? "",
    stage,
    ring,
    ringColors: ailmentRingColors(stage),
    countdownLabel: ailmentCountdownLabel(ailment.remainingMs, pip.name),
    portraitVisual: {
      speciesId: pip.genome.speciesId,
      paletteId: pip.evolved?.variantId ?? pip.genome.palette,
      pattern: pip.genome.pattern,
      shiny: pip.genome.shiny,
    },
    poulticeCount: state.inventory[POULTICE_ITEM_ID] ?? 0,
    needsAllHighForFreeChance: Object.values(pip.needs).every((n) => n >= floor),
    freeChanceHint: freeChanceHint(pip, floor),
    poulticeSourceHint:
      (state.inventory[POULTICE_ITEM_ID] ?? 0) > 0 ? null : POULTICE_SOURCE_HINT,
    pauseHint: `Not ready? Send ${pip.name} to the Long Meadow — nothing gets worse while they're there, and you can ask them home any time.`,
  };
}

/** Named from the registry, so adding or renaming a risky biome can never
 * leave this copy stale (the same generated-not-authored discipline
 * `ui/itemsSheet.ts`'s `foodEffectLine` uses). */
export const POULTICE_SOURCE_HINT = `Poultices turn up on the deep trails — ${riskyBiomeNames().join(", ")}.`;

function riskyBiomeNames(): readonly string[] {
  const names: string[] = [];
  for (const def of Object.values(contentAilments)) {
    const expedition =
      contentExpeditions[def.fromExpeditionId as keyof typeof contentExpeditions];
    if (expedition !== undefined) names.push(expedition.name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// THE RISK CONFIRM (bible §7.1) — pure model
// ---------------------------------------------------------------------------

function pct(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}

export interface RiskConfirmModel {
  readonly pipId: PipId;
  readonly pipName: string;
  readonly expeditionId: string;
  readonly expeditionName: string;
  readonly riskCopy: string;
  readonly isRisky: boolean;
  readonly ailmentName: string | null;
  readonly baseChancePct: number;
  readonly effectiveChancePct: number;
  readonly immune: boolean;
  /**
   * ROUND 2H — SHIELD TWO (docs/lifecycle-bible.md §7.2), "take the long
   * way round": the universal, legible opt-out of ALL danger, at an
   * honest cost. Offered only where there is danger to opt out of (and
   * never to a Pip who is already immune — she has nothing to avoid).
   *
   * Without this, risk is mandatory rather than opt-in: per spec v1.3
   * §6.1 the deep trails are the SOLE source of their biome's species and
   * foods, so completing the Album would have required accepting
   * unmitigated risk with no lever at all. The bible's central claim —
   * "every loss in PipsKeep is downstream of a choice the player made
   * twice" — is only true once this exists.
   */
  readonly carefulOffered: boolean;
  readonly carefulLabel: string;
  readonly carefulDetail: string;
}

/** `true` when a completed trip to `expeditionId` can ever roll an
 * ailment — the exact test `content/ailments.ts`'s registry answers by
 * construction (quick trips carry no entry at all). The integrate stage
 * can use this to decide whether a send needs `requestExpedition`'s
 * confirm step at all, though `requestExpedition` itself degrades safely
 * either way. */
export function isRiskyExpedition(expeditionId: string): boolean {
  return ailmentForExpedition(contentAilments, expeditionId) !== undefined;
}

/** `null` when the expedition id does not resolve (defensive). */
export function buildRiskConfirmModel(pip: PipState, expeditionId: string): RiskConfirmModel | null {
  const expedition = contentExpeditions[expeditionId as keyof typeof contentExpeditions];
  if (expedition === undefined) return null;
  const def = ailmentForExpedition(contentAilments, expeditionId);
  const immune = def !== undefined && (pip.scars?.includes(def.id) ?? false);
  const levelReduction = def !== undefined ? contractReductionFor(pip) : 0;
  const resistance = def !== undefined ? Math.max(0, Math.min(1, pip.resistances?.[def.id] ?? 0)) : 0;
  const baseChance = def?.contractChance ?? 0;
  const effectiveChance = immune
    ? 0
    : Math.max(0, baseChance * (1 - levelReduction) * (1 - resistance));
  const shields = contentTuning.lifecycle.shields;
  const longerPct = Math.round((shields.carefulRouteDurationMultiplier - 1) * 100);
  const lessPct = Math.round((1 - shields.carefulRouteLootMultiplier) * 100);
  return {
    pipId: pip.id,
    pipName: pip.name,
    expeditionId,
    expeditionName: expedition.name,
    riskCopy: expedition.riskCopy,
    isRisky: def !== undefined,
    ailmentName: def !== undefined ? (contentAilments[def.id as AilmentId]?.name ?? def.id) : null,
    baseChancePct: pct(baseChance),
    effectiveChancePct: pct(effectiveChance),
    immune,
    carefulOffered: def !== undefined && !immune,
    carefulLabel: "Take the long way round",
    carefulDetail: `Slower by about ${longerPct}%, and they'll bring back roughly ${lessPct}% less — but nothing can follow them home.`,
  };
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface AilmentViewDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  clock: Clock;
}

export interface AilmentView {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(pipId: PipId): void;
  close(): void;
  sync(state: GameState): void;
  /**
   * THE SEND SEAM (bible §7.1/§7.2) — call this instead of dispatching
   * `ASSIGN_EXPEDITION` directly from the expedition picker (`focusView.ts`,
   * not a file this module owns). Degrades to a plain dispatch for a safe
   * trail (`isRiskyExpedition` false) so every send can route through here
   * uniformly. Risky trails show the confirm; the dispatch happens on
   * Confirm, from the SAME `at` the tap occurred.
   */
  requestExpedition(pipId: PipId, expeditionId: string): void;
}

export function createAilmentView(deps: AilmentViewDeps): AilmentView {
  const root = document.createElement("div");
  root.className = "pk-ailment-root";

  // --- The floating "someone's poorly" chip ---
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "pk-ailment-chip";
  chip.title = "Check on them";
  chip.setAttribute("aria-label", "A Pip needs tending");
  const chipGlyph = document.createElement("span");
  chipGlyph.className = "pk-ailment-chip-glyph";
  chipGlyph.textContent = "♥";
  chip.appendChild(chipGlyph);

  // --- The ailment card ---
  const wrap = document.createElement("div");
  wrap.className = "pk-ailment-wrap";
  const backdrop = document.createElement("div");
  backdrop.className = "pk-ailment-backdrop";
  const panel = document.createElement("div");
  panel.className = "pk-ailment";
  wrap.append(backdrop, panel);

  // --- The risk confirm — its own overlay (mirrors sanctuary.ts's
  // retire confirm: reachable from a picker this module does not own,
  // and must work whether or not the card above is open) ---
  const riskWrap = document.createElement("div");
  riskWrap.className = "pk-ailment-risk-wrap";
  const riskBackdrop = document.createElement("div");
  riskBackdrop.className = "pk-ailment-risk-backdrop";
  const riskPanel = document.createElement("div");
  riskPanel.className = "pk-ailment-risk";
  riskWrap.append(riskBackdrop, riskPanel);

  root.append(chip, wrap, riskWrap);

  let isOpen = false;
  let openPipId: PipId | null = null;
  let lastState: GameState | null = null;
  let cardMessage: string | null = null;

  function closeCard(): void {
    isOpen = false;
    openPipId = null;
    cardMessage = null;
    wrap.classList.remove("pk-ailment-wrap--open");
  }
  backdrop.addEventListener("click", closeCard);

  let riskExpanded = false;
  let riskModel: RiskConfirmModel | null = null;
  /** SHIELD TWO's checkbox state, reset to OFF on every open: the safe
   * option is a deliberate choice each time, never a sticky setting the
   * player forgot they left on and then wondered why trips got slow. */
  let riskCareful = false;
  function closeRisk(): void {
    riskModel = null;
    riskExpanded = false;
    riskCareful = false;
    riskWrap.classList.remove("pk-ailment-risk-wrap--open");
  }
  riskBackdrop.addEventListener("click", closeRisk);

  function renderChip(state: GameState): void {
    const visible = mostUrgentAilingPipId(state) !== null;
    chip.classList.toggle("pk-ailment-chip--visible", visible);
  }

  function renderCard(): void {
    panel.replaceChildren();
    if (openPipId === null) return;
    const state = deps.getState();
    const model = buildAilmentCardModel(state, openPipId);
    if (model === null) {
      closeCard();
      return;
    }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pk-ailment-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => {
      sound("ui.tap");
      closeCard();
    });
    panel.appendChild(closeBtn);

    const ring = document.createElement("div");
    ring.className = "pk-ailment-ring";
    ring.style.setProperty("--pk-ring-from", model.ringColors.from);
    ring.style.setProperty("--pk-ring-to", model.ringColors.to);
    ring.style.setProperty("--pk-ring-frac", String(model.ring));
    ring.appendChild(buildPortraitEl(model.portraitVisual, "small"));
    panel.appendChild(ring);

    const name = document.createElement("div");
    name.className = "pk-ailment-name";
    name.textContent = `${model.name} · ${model.ailmentName}`;
    panel.appendChild(name);

    const flavor = document.createElement("div");
    flavor.className = "pk-ailment-flavor";
    flavor.textContent = model.flavor;
    panel.appendChild(flavor);

    const countdown = document.createElement("div");
    countdown.className = "pk-ailment-countdown";
    countdown.textContent = model.countdownLabel;
    panel.appendChild(countdown);

    if (cardMessage !== null) {
      const msg = document.createElement("div");
      msg.className = "pk-ailment-message";
      msg.textContent = cardMessage;
      panel.appendChild(msg);
    }

    const actions = document.createElement("div");
    actions.className = "pk-ailment-actions";

    const poulticeBtn = document.createElement("button");
    poulticeBtn.type = "button";
    poulticeBtn.className = "pk-ailment-poultice";
    poulticeBtn.textContent =
      model.poulticeCount > 0
        ? `Give a ${contentFoods.poultice.name} (${model.poulticeCount})`
        : `No ${contentFoods.poultice.name} on hand`;
    poulticeBtn.disabled = model.poulticeCount <= 0;
    poulticeBtn.addEventListener("click", () => {
      sound("ui.tap");
      const pipBefore = deps.getState().pips[model.pipId];
      const attemptsBefore = pipBefore?.ailment?.cureAttempts ?? 0;
      deps.dispatch({
        type: "GIVE_ITEM",
        pipId: model.pipId,
        itemId: POULTICE_ITEM_ID,
        at: deps.clock.now(),
      });
      const after = deps.getState();
      const pipAfter = after.pips[model.pipId];
      if (pipAfter === undefined || pipAfter.ailment == null) {
        cardMessage = `It worked. ${model.name} is on the mend.`;
      } else if ((pipAfter.ailment.cureAttempts ?? 0) > attemptsBefore) {
        cardMessage = `Didn't take this time — still worth trying again.`;
      } else {
        cardMessage = null;
      }
      renderCard();
    });
    actions.appendChild(poulticeBtn);

    // Where poultices come from — shown only when there are none to give,
    // i.e. exactly when the disabled button above is a dead end.
    if (model.poulticeSourceHint !== null) {
      const source = document.createElement("div");
      source.className = "pk-ailment-hint pk-ailment-hint--source";
      source.textContent = model.poulticeSourceHint;
      actions.appendChild(source);
    }

    const hint = document.createElement("div");
    hint.className = "pk-ailment-hint";
    if (model.needsAllHighForFreeChance) hint.classList.add("pk-ailment-hint--ready");
    hint.textContent = model.freeChanceHint;
    actions.appendChild(hint);

    // Shield six: the escape hatch, offered where the fright is.
    const pause = document.createElement("div");
    pause.className = "pk-ailment-hint pk-ailment-hint--pause";
    pause.textContent = model.pauseHint;
    actions.appendChild(pause);

    panel.appendChild(actions);
  }

  function renderRisk(): void {
    riskPanel.replaceChildren();
    const model = riskModel;
    if (model === null) return;

    const heading = document.createElement("div");
    heading.className = "pk-ailment-risk-heading";
    heading.textContent = `Send ${model.pipName} to ${model.expeditionName}?`;
    riskPanel.appendChild(heading);

    const copy = document.createElement("div");
    copy.className = "pk-ailment-risk-copy";
    copy.textContent = model.riskCopy;
    riskPanel.appendChild(copy);

    if (model.isRisky) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "pk-ailment-risk-expand";
      toggle.textContent = riskExpanded ? "Hide the details" : "Tell me more";
      toggle.addEventListener("click", () => {
        sound("ui.tap");
        riskExpanded = !riskExpanded;
        renderRisk();
      });
      riskPanel.appendChild(toggle);

      if (riskExpanded) {
        const detail = document.createElement("div");
        detail.className = "pk-ailment-risk-detail";
        // The reassurance names BOTH real levers, because until this
        // round both had to actually exist for the sentence to be true:
        // the free daily chance (wired now) and the poultices the deep
        // trails themselves drop.
        detail.textContent = model.immune
          ? `${model.pipName} has already come through ${model.ailmentName ?? "this"} once — she can't catch it again.`
          : `About ${model.effectiveChancePct}% chance of coming home with ${model.ailmentName ?? "something"}. ` +
            `If it happens you'll see it coming days ahead, and good care alone gives a free chance to shake it off every day. ` +
            `A Poultice makes it likelier still — the deep trails drop them.`;
        riskPanel.appendChild(detail);
      }

      // SHIELD TWO — the opt-out, on the same card as the disclosure.
      if (model.carefulOffered) {
        const careful = document.createElement("button");
        careful.type = "button";
        careful.className = "pk-ailment-risk-careful";
        careful.setAttribute("role", "switch");
        careful.setAttribute("aria-checked", riskCareful ? "true" : "false");
        careful.classList.toggle("pk-ailment-risk-careful--on", riskCareful);
        const mark = document.createElement("span");
        mark.className = "pk-ailment-risk-careful-mark";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = riskCareful ? "✓" : "";
        const label = document.createElement("span");
        label.className = "pk-ailment-risk-careful-label";
        label.textContent = model.carefulLabel;
        careful.append(mark, label);
        careful.addEventListener("click", () => {
          sound("ui.tap");
          riskCareful = !riskCareful;
          renderRisk();
        });
        riskPanel.appendChild(careful);

        const carefulDetail = document.createElement("div");
        carefulDetail.className = "pk-ailment-risk-careful-detail";
        carefulDetail.textContent = model.carefulDetail;
        riskPanel.appendChild(carefulDetail);
      }
    }

    const actions = document.createElement("div");
    actions.className = "pk-ailment-risk-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "pk-ailment-risk-cancel";
    cancel.textContent = "Not yet";
    cancel.addEventListener("click", () => {
      sound("ui.tap");
      closeRisk();
    });

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "pk-ailment-risk-send";
    confirm.textContent = riskCareful ? "Off the long way" : "Send them off";
    confirm.addEventListener("click", () => {
      sound("ui.tap");
      deps.dispatch({
        type: "ASSIGN_EXPEDITION",
        pipId: model.pipId,
        expeditionId: model.expeditionId,
        at: deps.clock.now(),
        ...(riskCareful ? { careful: true } : {}),
      });
      closeRisk();
    });

    actions.append(cancel, confirm);
    riskPanel.appendChild(actions);
  }

  chip.addEventListener("click", () => {
    sound("ui.tap");
    const target = mostUrgentAilingPipId(deps.getState());
    if (target !== null) view.open(target);
  });

  const view: AilmentView = {
    el: root,
    get isOpen(): boolean {
      return isOpen;
    },
    open(pipId: PipId): void {
      const state = deps.getState();
      lastState = state;
      if (buildAilmentCardModel(state, pipId) === null) return; // defensive
      openPipId = pipId;
      isOpen = true;
      cardMessage = null;
      sound("ui.sheet");
      renderCard();
      wrap.classList.add("pk-ailment-wrap--open");
    },
    close: closeCard,
    sync(state: GameState): void {
      const prev = lastState;
      lastState = state;
      renderChip(state);
      if (isOpen && prev !== state) renderCard();
    },
    requestExpedition(pipId: PipId, expeditionId: string): void {
      const state = deps.getState();
      const pip = state.pips[pipId];
      if (pip === undefined) return; // defensive
      if (!isRiskyExpedition(expeditionId)) {
        deps.dispatch({ type: "ASSIGN_EXPEDITION", pipId, expeditionId, at: deps.clock.now() });
        return;
      }
      const model = buildRiskConfirmModel(pip, expeditionId);
      if (model === null) return; // defensive — unknown expedition id
      riskModel = model;
      riskExpanded = false;
      sound("ui.sheet");
      renderRisk();
      riskWrap.classList.add("pk-ailment-risk-wrap--open");
    },
  };

  return view;
}
