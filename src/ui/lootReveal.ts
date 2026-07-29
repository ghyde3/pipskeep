/**
 * Loot reveal moment (spec §6.1) — THE dopamine core. "Return produces a
 * loot reveal moment: modal with staged reveals, rare finds get extra
 * flair. This moment is the dopamine core — make it juicy."
 *
 * Split like debugMenu.ts / recovery.ts for node testability:
 *
 * - PURE: `buildRevealScript(reveal, pips)` turns one PendingReveal into a
 *   timed script — items flip in one by one with an accelerating-heartbeat
 *   stagger, uncommon/rare finds get a pregnant pause before and a longer
 *   hold after, and an egg is always last with the biggest lead-in. All
 *   timing constants exported so tests pin the sequencing exactly.
 * - PURE-ish: `createRevealQueueController` owns queue sequencing — it
 *   peeks the head of `state.pendingReveals`, and `collectAndNext()`
 *   dispatches ACKNOWLEDGE_REVEAL (the ONLY thing that moves loot into
 *   inventory/resources and starts egg incubation, per core) then peeks
 *   the next reveal so multiple pending reveals play back-to-back.
 * - DOM: `createLootRevealModal` renders a script — card flips, particle
 *   bursts, glow rings, the egg showstopper (screen-dim + spotlight +
 *   wobble + confetti), one warm summary line, and the Collect button.
 *   Tapping the card area mid-show fast-forwards: juice must never hold
 *   the player hostage.
 *
 * Sound: `sound(slotId)` no-op hooks per reveal beat (spec §12 seam).
 * Randomness: DOM sparkle jitter uses a fixed-seed core/rng stream (repo
 * rule — no Math.random outside core/rng; cosmetic cursors stay out of
 * GameState, same as render/keepScene.ts).
 */

import type { PendingReveal } from "../core/expeditions";
import type { GameAction } from "../core/state";
import { expeditions as contentExpeditions } from "../content/expeditions";
import { foods as contentFoods } from "../content/foods";
import { itemColors, itemFallbackColor } from "../content/palette";
import { createRng } from "../core/rng";
import { sound } from "../app/sound";

// ---------------------------------------------------------------------------
// Pure: reveal script
// ---------------------------------------------------------------------------

export type RevealTier = "common" | "uncommon" | "rare";

/**
 * Which items get the bigger flair (task: "commons quick, uncommon/rare
 * items get a pause + bigger flair"). UI presentation tiers, not gameplay
 * data — loot odds live in content/expeditions.ts. Unknown ids present as
 * common.
 *
 * ROUND 2B (content bible §8.2.3): food tiers now live on
 * `FoodDef.revealTier` — a content decision, not a `ui/` edit, so a new
 * food's ceremony is authored right next to the food itself. This map
 * keeps only the RESOURCE ids with no `FoodDef` of their own; Driftwood
 * is the Shore's semi-precious find. `resolveItemRevealTiers` merges the
 * two into the one lookup `buildRevealScript` reads.
 */
export const ITEM_REVEAL_TIERS: Readonly<Record<string, RevealTier>> = {
  driftwood: "uncommon",
};

/** Merge a food registry's `revealTier` fields on top of the resource-only
 * tiers above — the single source `buildRevealScript` defaults to. */
function resolveItemRevealTiers(
  foods: Readonly<Record<string, { readonly revealTier?: RevealTier }>>,
): Readonly<Record<string, RevealTier>> {
  const merged: Record<string, RevealTier> = { ...ITEM_REVEAL_TIERS };
  for (const [id, food] of Object.entries(foods)) {
    if (food.revealTier !== undefined) merged[id] = food.revealTier;
  }
  return merged;
}

/** First flip lands after this much anticipation. */
export const REVEAL_FIRST_FLIP_MS = 700;
/** Gap between consecutive common flips (the heartbeat). */
export const REVEAL_STEP_GAP_MS = 430;
/** Extra pregnant pause BEFORE an uncommon/rare flip. */
export const REVEAL_TIER_LEAD_MS = 550;
/** Extra hold AFTER an uncommon/rare flip (let the glow breathe). */
export const REVEAL_TIER_HOLD_MS = 500;
/** The showstopper lead-in before the egg reveal. */
export const REVEAL_EGG_LEAD_MS = 1000;
/** How long the egg gets the stage to itself. */
export const REVEAL_EGG_HOLD_MS = 1500;
/** Summary line + Collect button lag after the last beat. */
export const REVEAL_SUMMARY_LAG_MS = 260;

export interface RevealStepModel {
  readonly kind: "item" | "egg";
  /** Item id (`kind: "item"`) or null for the egg step. */
  readonly itemId: string | null;
  /** Player-facing label ("Berry", "Wood", "An egg?!"). */
  readonly label: string;
  /** Presentation tier; the egg step is its own showstopper (null). */
  readonly tier: RevealTier | null;
  /** When this step flips, ms after the modal opens. */
  readonly flipAtMs: number;
}

export interface RevealScript {
  readonly pipId: string;
  readonly pipName: string;
  readonly expeditionId: string;
  readonly expeditionName: string;
  readonly steps: readonly RevealStepModel[];
  readonly hasEgg: boolean;
  /** The single warm summary line (spec §15.5 tone). */
  readonly summaryLine: string;
  /** When the summary + Collect button appear, ms after open. */
  readonly readyAtMs: number;
}

/** Minimal view of the pip roster the script needs (GameState satisfies
 * it) — just names for the header copy. */
export type RevealPipsView = Readonly<Record<string, { readonly name: string }>>;

/** Registry views injectable for tests; default to the real content. */
export interface RevealContent {
  readonly expeditionNames?: Readonly<Record<string, { readonly name: string }>>;
  readonly tiers?: Readonly<Record<string, RevealTier>>;
}

function capitalize(id: string): string {
  return id.length === 0 ? id : id.charAt(0).toUpperCase() + id.slice(1);
}

/** Player-facing item label: food registry name, else capitalized id
 * (resources have no display registry yet — ids ARE the vocabulary). */
export function itemLabel(itemId: string): string {
  return (
    (contentFoods as Readonly<Record<string, { name: string }>>)[itemId]?.name ??
    capitalize(itemId)
  );
}

/** Warm summary copy (spec §15.5: warm, mischievous, opinionated). */
function summaryLine(
  pipName: string,
  expeditionName: string,
  itemCount: number,
  hasEgg: boolean,
): string {
  if (hasEgg && itemCount > 0) {
    return `${pipName} hauled home ${itemCount} treasure${
      itemCount === 1 ? "" : "s"
    } — and something round and full of promise.`;
  }
  if (hasEgg) {
    return `${pipName} found… an egg! The ${expeditionName} keeps its best secrets for the nosy.`;
  }
  if (itemCount === 0) {
    return `${pipName} came home with pockets full of stories and not much else. It happens.`;
  }
  if (itemCount === 1) {
    return `One treasure, carried home with enormous pride.`;
  }
  return `${itemCount} treasures, carried home with enormous pride.`;
}

/**
 * Build the timed reveal script for one completed trip. Deterministic —
 * no rng, no clock; every number derives from the exported constants so
 * the stagger is testable to the millisecond.
 */
export function buildRevealScript(
  reveal: PendingReveal,
  pips: RevealPipsView,
  content: RevealContent = {},
): RevealScript {
  const expeditionNames =
    content.expeditionNames ??
    (contentExpeditions as Readonly<Record<string, { name: string }>>);
  const tiers = content.tiers ?? resolveItemRevealTiers(contentFoods);

  const pipName = pips[reveal.pipId]?.name ?? "Your Pip";
  const expeditionName =
    expeditionNames[reveal.expeditionId]?.name ?? capitalize(reveal.expeditionId);

  const steps: RevealStepModel[] = [];
  let t = REVEAL_FIRST_FLIP_MS;
  for (const itemId of reveal.items) {
    const tier = tiers[itemId] ?? "common";
    if (tier !== "common") t += REVEAL_TIER_LEAD_MS;
    steps.push({ kind: "item", itemId, label: itemLabel(itemId), tier, flipAtMs: t });
    t += REVEAL_STEP_GAP_MS + (tier !== "common" ? REVEAL_TIER_HOLD_MS : 0);
  }

  const hasEgg = reveal.egg !== null;
  if (hasEgg) {
    t += REVEAL_EGG_LEAD_MS;
    steps.push({ kind: "egg", itemId: null, label: "An egg?!", tier: null, flipAtMs: t });
    t += REVEAL_EGG_HOLD_MS;
  }

  return {
    pipId: reveal.pipId,
    pipName,
    expeditionId: reveal.expeditionId,
    expeditionName,
    steps,
    hasEgg,
    summaryLine: summaryLine(pipName, expeditionName, reveal.items.length, hasEgg),
    readyAtMs: t + REVEAL_SUMMARY_LAG_MS,
  };
}

// ---------------------------------------------------------------------------
// Queue controller (node-testable — no DOM)
// ---------------------------------------------------------------------------

/** The slice of GameState the queue controller reads. */
export interface RevealQueueStateView {
  readonly pendingReveals: readonly PendingReveal[];
  readonly pips: RevealPipsView;
}

export interface RevealQueueControllerDeps {
  getState(): RevealQueueStateView;
  dispatch(action: GameAction): void;
  /** Injected clock read (the app Clock's now). */
  now(): number;
  readonly content?: RevealContent;
}

export interface RevealQueueController {
  /** Script for the current queue head, or null when nothing is pending.
   * Read-only — does not dispatch. */
  openScript(): RevealScript | null;
  /**
   * The player tapped Collect: dispatch ACKNOWLEDGE_REVEAL for the head
   * (loot lands, egg starts incubating, pip arrives home — all core's
   * business), then return the NEXT reveal's script so multiple pending
   * reveals play sequentially, or null when the queue is drained.
   */
  collectAndNext(): RevealScript | null;
}

export function createRevealQueueController(
  deps: RevealQueueControllerDeps,
): RevealQueueController {
  const headScript = (): RevealScript | null => {
    const state = deps.getState();
    const head = state.pendingReveals[0];
    if (head === undefined) return null;
    return buildRevealScript(head, state.pips, deps.content);
  };

  return {
    openScript: headScript,

    collectAndNext(): RevealScript | null {
      const state = deps.getState();
      if (state.pendingReveals.length === 0) return null;
      deps.dispatch({ type: "ACKNOWLEDGE_REVEAL", at: deps.now() });
      return headScript();
    },
  };
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface LootRevealModalDeps {
  readonly mount: HTMLElement;
  /** Collect tapped — the wiring calls collectAndNext() and either plays
   * the next script or closes the modal. */
  onCollect(): void;
}

export interface LootRevealModal {
  readonly el: HTMLElement;
  play(script: RevealScript): void;
  close(): void;
  isOpen(): boolean;
}

/** Cosmetic jitter for spark scatter (fixed seed; cursor not in
 * GameState — render-only juice, same rule as keepScene). */
const jitter = createRng(0x1007ea1).stream("reveal-juice");

const SPARK_COLORS: Readonly<Record<RevealTier, readonly string[]>> = {
  common: ["#f9d47d", "#ffffff", "#b7dda1"],
  uncommon: ["#f9d47d", "#8fd8e8", "#ffffff", "#f6a8b8"],
  rare: ["#f6b73c", "#b79ff0", "#ffffff", "#f27d9d"],
};

const CONFETTI_COLORS = [
  "#f6a8b8",
  "#f9d47d",
  "#b79ff0",
  "#8fd8e8",
  "#7cc283",
  "#ff8a5c",
];

/** A little burst of sparks centered on `x,y` (card-local px). */
function spawnSparks(
  layer: HTMLElement,
  x: number,
  y: number,
  colors: readonly string[],
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const s = document.createElement("span");
    s.className = "pk-spark";
    const angle = jitter.next() * Math.PI * 2;
    const dist = 26 + jitter.next() * 44;
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    s.style.setProperty("--dy", `${Math.sin(angle) * dist - 18}px`);
    s.style.setProperty("--bg", colors[jitter.int(colors.length)] ?? "#fff");
    s.style.setProperty("--dur", `${520 + jitter.int(260)}ms`);
    s.addEventListener("animationend", () => s.remove());
    layer.appendChild(s);
  }
}

/** Confetti rain across the card (big moments: rare finds, THE EGG). */
function spawnConfetti(layer: HTMLElement, count: number): void {
  for (let i = 0; i < count; i++) {
    const c = document.createElement("span");
    c.className = "pk-confetti";
    c.style.left = `${jitter.next() * 100}%`;
    c.style.setProperty("--bg", CONFETTI_COLORS[jitter.int(CONFETTI_COLORS.length)] ?? "#fff");
    c.style.setProperty("--dur", `${1400 + jitter.int(1100)}ms`);
    c.style.setProperty("--delay", `${jitter.int(320)}ms`);
    c.style.setProperty("--drift", `${(jitter.next() - 0.5) * 90}px`);
    c.style.setProperty("--spin", `${(jitter.next() - 0.5) * 900}deg`);
    c.addEventListener("animationend", () => c.remove());
    layer.appendChild(c);
  }
}

/** The speckled egg for the showstopper, as inline SVG (no assets). */
function eggSvg(): string {
  return `
    <svg viewBox="0 0 90 110" width="90" height="110" aria-hidden="true">
      <ellipse cx="45" cy="62" rx="34" ry="42" fill="#f8f1e0"
        stroke="#c9b892" stroke-width="3"/>
      <circle cx="34" cy="42" r="4" fill="#cdbb95"/>
      <circle cx="52" cy="34" r="3" fill="#cdbb95"/>
      <circle cx="58" cy="56" r="4.5" fill="#cdbb95"/>
      <circle cx="36" cy="66" r="3" fill="#cdbb95"/>
      <circle cx="48" cy="80" r="3.5" fill="#cdbb95"/>
      <ellipse cx="38" cy="50" rx="9" ry="13" fill="#ffffff" opacity="0.35"/>
    </svg>`;
}

export function createLootRevealModal(deps: LootRevealModalDeps): LootRevealModal {
  const el = document.createElement("div");
  el.className = "pk-reveal";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-reveal-backdrop";

  const card = document.createElement("div");
  card.className = "pk-reveal-card";

  const title = document.createElement("div");
  title.className = "pk-reveal-title";
  const sub = document.createElement("div");
  sub.className = "pk-reveal-sub";

  const itemsRow = document.createElement("div");
  itemsRow.className = "pk-reveal-items";

  const eggStage = document.createElement("div");
  eggStage.className = "pk-reveal-eggstage";
  eggStage.innerHTML = eggSvg();
  const eggCaption = document.createElement("div");
  eggCaption.className = "pk-reveal-eggcaption";
  eggStage.appendChild(eggCaption);

  const fxLayer = document.createElement("div");
  fxLayer.className = "pk-reveal-fx";

  const summary = document.createElement("div");
  summary.className = "pk-reveal-summary";

  const collect = document.createElement("button");
  collect.type = "button";
  collect.className = "pk-reveal-collect";
  collect.textContent = "Collect";

  card.append(title, sub, itemsRow, eggStage, summary, collect, fxLayer);
  el.append(backdrop, card);
  deps.mount.appendChild(el);

  let open = false;
  let done = false;
  let timers: number[] = [];
  let pendingFlips: (() => void)[] = [];

  const clearTimers = (): void => {
    for (const id of timers) window.clearTimeout(id);
    timers = [];
  };

  const schedule = (atMs: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, atMs));
  };

  /** Spark/confetti coordinates are card-local. */
  const centerOf = (target: HTMLElement): { x: number; y: number } => {
    const c = card.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    return { x: r.left - c.left + r.width / 2, y: r.top - c.top + r.height / 2 };
  };

  const flipItem = (cardEl: HTMLElement, tier: RevealTier): void => {
    if (cardEl.classList.contains("pk-reveal-item--in")) return;
    cardEl.classList.add("pk-reveal-item--in");
    sound(tier === "common" ? "reveal.flip" : "reveal.shine");
    const { x, y } = centerOf(cardEl);
    spawnSparks(fxLayer, x, y, SPARK_COLORS[tier], tier === "common" ? 7 : 13);
    if (tier === "rare") spawnConfetti(fxLayer, 16);
  };

  const flipEgg = (): void => {
    if (el.classList.contains("pk-reveal--eggmoment")) return;
    el.classList.add("pk-reveal--eggmoment");
    eggStage.classList.add("pk-reveal-eggstage--in");
    sound("reveal.egg");
    const { x, y } = centerOf(eggStage);
    spawnSparks(fxLayer, x, y, SPARK_COLORS.rare, 18);
    spawnConfetti(fxLayer, 36);
  };

  const finish = (): void => {
    if (done) return;
    done = true;
    summary.classList.add("pk-reveal-summary--in");
    collect.classList.add("pk-reveal-collect--in");
  };

  /** Fast-forward: flush every remaining beat instantly. Juice must never
   * hold the player hostage. */
  const fastForward = (): void => {
    if (done) return;
    clearTimers();
    for (const flip of pendingFlips) flip();
    pendingFlips = [];
    finish();
  };
  card.addEventListener("click", (event) => {
    if (event.target !== collect) fastForward();
  });

  collect.addEventListener("click", () => {
    if (!done) return;
    sound("reveal.collect");
    deps.onCollect();
  });

  const play = (script: RevealScript): void => {
    clearTimers();
    pendingFlips = [];
    done = false;
    open = true;

    el.classList.remove("pk-reveal--eggmoment");
    eggStage.classList.remove("pk-reveal-eggstage--in");
    summary.classList.remove("pk-reveal-summary--in");
    collect.classList.remove("pk-reveal-collect--in");
    itemsRow.replaceChildren();
    fxLayer.replaceChildren();

    title.textContent = `${script.pipName} is back!`;
    sub.textContent = `Treasures from the ${script.expeditionName}`;
    summary.textContent = script.summaryLine;
    eggStage.style.display = script.hasEgg ? "" : "none";
    eggCaption.textContent = "An egg?!";

    for (const step of script.steps) {
      if (step.kind === "egg") {
        pendingFlips.push(flipEgg);
        schedule(step.flipAtMs, flipEgg);
        continue;
      }
      const tier = step.tier ?? "common";
      const itemEl = document.createElement("div");
      itemEl.className = `pk-reveal-item pk-reveal-item--${tier}`;
      const swatch = document.createElement("span");
      swatch.className = "pk-reveal-swatch";
      swatch.style.background =
        itemColors[step.itemId ?? ""] ?? itemFallbackColor;
      const name = document.createElement("span");
      name.className = "pk-reveal-name";
      name.textContent = step.label;
      itemEl.append(swatch, name);
      itemsRow.appendChild(itemEl);
      const flip = (): void => flipItem(itemEl, tier);
      pendingFlips.push(flip);
      schedule(step.flipAtMs, flip);
    }

    schedule(script.readyAtMs, finish);

    if (!el.classList.contains("pk-reveal--open")) {
      sound("reveal.open");
      el.classList.add("pk-reveal--open");
    }
  };

  const close = (): void => {
    open = false;
    clearTimers();
    pendingFlips = [];
    el.classList.remove("pk-reveal--open", "pk-reveal--eggmoment");
  };

  return {
    el,
    play,
    close,
    isOpen: () => open,
  };
}
