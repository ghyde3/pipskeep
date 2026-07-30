/**
 * THE MILESTONE RIBBON (docs/progression-bible.md §6) — the owner's ask,
 * verbatim: "Need better notification when milestones are completed."
 * Today (`ui/dailies.ts`) a milestone auto-banks into the SAME 3.6-second
 * text-only toast stack as "someone brought something home" — seven of
 * them fire in a new player's first hour, indistinguishable from an
 * expedition return. This module is the real moment: a wider, taller,
 * non-blocking card (never a modal — bible §10.1's "at most ONE blocking
 * surface" is already spent on the Doorstep/reveal), its `+N XP` chip
 * flying toward the Keep XP bar, confetti, and a dedicated sound.
 *
 * THIS MODULE NEVER DISPATCHES `CLAIM_MILESTONE`. Banking stays exactly
 * where round 2C's review put it — `ui/dailies.ts`'s `initDailiesUi`,
 * which auto-claims the instant a milestone is earned (bible: "rewards
 * that need no choice auto-bank… there is nothing to forget"). This
 * module only WATCHES `state.milestones.earned` and celebrates; the
 * integrator decides whether `dailies.ts`'s own toast for the same event
 * stays, is silenced, or is removed (see this task's report — it is not
 * this module's file to edit).
 *
 * WHY DETECTION READS `milestones.earned`, NOT A "claimable" STATUS DIFF:
 * `ui/dailies.ts`'s own subscription re-dispatches `CLAIM_MILESTONE`
 * synchronously inside its own listener callback, which (per
 * `core/store.ts`) re-enters `dispatch` and re-notifies every subscriber
 * BEFORE the original notify pass reaches later-registered listeners.
 * A detector built on "did status flip from claimable to earned between
 * MY prev/next" can therefore observe the state skip straight from
 * "locked" to "earned" without ever showing "claimable" — a real, subtle
 * race, not a hypothetical one. Watching `earned`'s own keys directly
 * (`newlyEarnedMilestoneIds`) sidesteps it entirely: `earned` is
 * append-only and keyed by id, so no dispatch ordering can make a newly-
 * earned id invisible to a diff against it, however many nested
 * dispatches land between two of this module's own invocations.
 *
 * BATCHING (bible §6.2 "two or more at once — one ribbon, never a
 * chain"): a burst of milestones earned by one player action normally
 * arrives as several back-to-back SYNCHRONOUS `CLAIM_MILESTONE` dispatches
 * (dailies.ts's `bankEarnedMilestones` loop), so this module accumulates
 * newly-earned ids and flushes them as ONE batch on the next microtask —
 * after that synchronous burst has finished, before anything the player
 * can perceive as a delay.
 *
 * Split like every other `ui/` module: pure detection/batching/queueing
 * below (unit-tested), a dumb DOM ribbon shell after it.
 */

import "./progression.css";
import type { GameAction, GameState } from "../core/state";
import type { Store } from "../core/store";
import { MILESTONES } from "../content/milestones";
import type { MilestoneDef } from "../content/milestones";
import { buildMilestoneRows } from "./dailies";
import { hasOpenBlockingSurface } from "./levelUp";
import type { BlockingSurfaceQuery } from "./levelUp";
import type { XpBarHandle } from "./xpBar";
import { sound } from "../app/sound";
import { burstConfetti } from "./confetti";

// ---------------------------------------------------------------------------
// PURE — detection (race-proof; see module doc)
// ---------------------------------------------------------------------------

/** Every id present in `state.milestones.earned` that is NOT in
 * `knownEarnedIds` — the append-only-map diff that sidesteps the
 * claimable-status race described in the module doc. Order matches
 * `Object.keys` (insertion order — the order `CLAIM_MILESTONE` dispatches
 * landed in). */
export function newlyEarnedMilestoneIds(
  knownEarnedIds: ReadonlySet<string>,
  state: Pick<GameState, "milestones">,
): readonly string[] {
  const ids: string[] = [];
  for (const id of Object.keys(state.milestones.earned)) {
    if (!knownEarnedIds.has(id)) ids.push(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// PURE — the batch model (what the ribbon actually shows)
// ---------------------------------------------------------------------------

export interface MilestoneCelebrationEntry {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly rewardLabel: string;
  readonly xp: number;
}

export interface MilestoneCelebrationBatch {
  readonly entries: readonly MilestoneCelebrationEntry[];
  readonly totalXp: number;
}

/** Builds the ribbon's content for a set of newly-earned ids from a
 * state snapshot — reuses `ui/dailies.ts`'s `buildMilestoneRows` for
 * name/blurb/reward text (the same labels the Nook's Milestones section
 * shows, so the ribbon can never say something different from the row it
 * points at) and `content/milestones.ts`'s `xp` field for the chip. Ids
 * with no matching row (defensive — should not happen) are dropped rather
 * than rendering a blank entry. */
export function buildMilestoneCelebrationBatch(
  ids: readonly string[],
  state: GameState,
  registry: readonly MilestoneDef[] = MILESTONES,
): MilestoneCelebrationBatch {
  if (ids.length === 0) return { entries: [], totalXp: 0 };
  const rows = buildMilestoneRows(state, undefined, registry);
  const xpById = new Map(registry.map((def) => [def.id, def.xp ?? 0]));
  const entries: MilestoneCelebrationEntry[] = [];
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (row === undefined) continue;
    entries.push({
      id,
      name: row.name,
      blurb: row.blurb,
      rewardLabel: row.rewardLabel,
      xp: xpById.get(id) ?? 0,
    });
  }
  const totalXp = entries.reduce((sum, e) => sum + e.xp, 0);
  return { entries, totalXp };
}

// ---------------------------------------------------------------------------
// PURE — the queue (one ribbon on stage at a time, never a chain)
// ---------------------------------------------------------------------------

export interface RibbonQueueState {
  readonly pending: readonly MilestoneCelebrationBatch[];
  readonly showing: MilestoneCelebrationBatch | null;
}

export const EMPTY_RIBBON_QUEUE: RibbonQueueState = { pending: [], showing: null };

export function enqueueRibbon(
  queue: RibbonQueueState,
  batch: MilestoneCelebrationBatch,
): RibbonQueueState {
  if (batch.entries.length === 0) return queue;
  return { ...queue, pending: [...queue.pending, batch] };
}

/** Same shape as `levelUp.ts`'s `advanceLevelUpQueue` (never more than one
 * ribbon showing; a same-reference no-op when there is nothing to do, so
 * it is safe to call on every store tick to drain the queue the instant
 * the reveal queue empties and the Doorstep closes). */
export function advanceRibbonQueue(
  queue: RibbonQueueState,
  blocked: boolean,
): RibbonQueueState {
  if (queue.showing !== null || blocked || queue.pending.length === 0) return queue;
  const [next, ...rest] = queue.pending;
  if (next === undefined) return queue;
  return { pending: rest, showing: next };
}

export function dismissRibbon(queue: RibbonQueueState): RibbonQueueState {
  if (queue.showing === null) return queue;
  return { ...queue, showing: null };
}

/** Bible §6.3: the ribbon queues behind the Doorstep AND the whole loot-
 * reveal queue draining (not merely "the modal is closed right now") —
 * `state.pendingReveals` is real GameState, so this half of the check
 * needs no DOM sniffing; `hasOpenBlockingSurface` (levelUp.ts) covers the
 * Doorstep/reveal-modal-open half via the same DOM signal that module
 * already established. */
export function isMilestoneRibbonBlocked(
  state: Pick<GameState, "pendingReveals">,
  blockingRoot: BlockingSurfaceQuery = document,
): boolean {
  return state.pendingReveals.length > 0 || hasOpenBlockingSurface(blockingRoot);
}

// ---------------------------------------------------------------------------
// DOM — the dumb ribbon shell
// ---------------------------------------------------------------------------

const RIBBON_DWELL_MS = 5000;
const FLY_CHIP_MS = 750;

export interface MilestoneRibbonDeps {
  onOpen(): void;
  /** Optional: when provided, the `+N XP` chip visually flies toward the
   * bar's own fill track instead of just floating off the ribbon. Both
   * modules are this task's own, so this coupling is intentional (bible
   * §6.2: "the single most load-bearing animation in the round"). */
  xpBar?: Pick<XpBarHandle, "anchorRect">;
}

export interface MilestoneRibbon {
  readonly el: HTMLElement;
  show(batch: MilestoneCelebrationBatch): void;
  hide(): void;
  isShowing(): boolean;
}

function flyXpChip(amount: number, fromEl: HTMLElement, xpBar?: Pick<XpBarHandle, "anchorRect">): void {
  if (amount <= 0) return;
  const fromRect = fromEl.getBoundingClientRect();
  const toRect = xpBar?.anchorRect() ?? null;
  const fly = document.createElement("div");
  fly.className = "pk-ribbon-flychip";
  fly.textContent = `+${amount} XP`;
  fly.style.left = `${fromRect.left + fromRect.width / 2}px`;
  fly.style.top = `${fromRect.top}px`;
  const dx = toRect !== null ? toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2) : 0;
  const dy = toRect !== null ? toRect.top - fromRect.top : -60;
  fly.style.setProperty("--pk-fly-dx", `${dx}px`);
  fly.style.setProperty("--pk-fly-dy", `${dy}px`);
  document.body.appendChild(fly);
  requestAnimationFrame(() => fly.classList.add("pk-ribbon-flychip--go"));
  window.setTimeout(() => fly.remove(), FLY_CHIP_MS);
}

export function createMilestoneRibbon(deps: MilestoneRibbonDeps): MilestoneRibbon {
  const el = document.createElement("div");
  el.className = "pk-ribbon";
  el.setAttribute("aria-live", "polite");

  const top = document.createElement("div");
  top.className = "pk-ribbon-top";
  const title = document.createElement("span");
  title.className = "pk-ribbon-title";
  const xpChip = document.createElement("span");
  xpChip.className = "pk-ribbon-xp";
  top.append(title, xpChip);

  const blurb = document.createElement("div");
  blurb.className = "pk-ribbon-blurb";

  const reward = document.createElement("div");
  reward.className = "pk-ribbon-reward";

  el.append(top, blurb, reward);

  let showing = false;
  let dismissTimer: number | null = null;

  const hide = (): void => {
    if (!showing) return;
    showing = false;
    el.classList.remove("pk-ribbon--open");
    if (dismissTimer !== null) {
      window.clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  };

  el.addEventListener("click", () => {
    hide();
    deps.onOpen();
  });
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      hide();
      deps.onOpen();
    }
  });

  return {
    el,
    show(batch: MilestoneCelebrationBatch): void {
      const single = batch.entries.length === 1;
      const first = batch.entries[0];
      title.textContent =
        single && first !== undefined ? first.name : `${batch.entries.length} new milestones`;
      xpChip.textContent = `+${batch.totalXp} XP →`;
      if (single && first !== undefined) {
        blurb.textContent = first.blurb;
        blurb.hidden = false;
        reward.textContent = `⟡ ${first.rewardLabel}`;
        reward.hidden = false;
      } else {
        blurb.textContent = batch.entries.map((e) => e.name).join(" · ");
        blurb.hidden = false;
        reward.hidden = true;
      }

      showing = true;
      el.classList.add("pk-ribbon--open");
      sound("milestone.ribbon");
      burstConfetti();
      flyXpChip(batch.totalXp, xpChip, deps.xpBar);

      dismissTimer = window.setTimeout(() => {
        hide();
      }, RIBBON_DWELL_MS);
    },
    hide,
    isShowing: () => showing,
  };
}

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

export interface InitMilestoneCelebrationDeps {
  /** Optional when `host` is supplied. */
  readonly mount?: HTMLElement;
  readonly store: Store<GameState, GameAction>;
  /** Opens the Nook's Milestones section — the integrator's seam, since
   * this module does not own `ui/dailies.ts` or `ui/navMenu.ts`. */
  onOpenMilestones(): void;
  /** See `MilestoneRibbonDeps.xpBar`. */
  readonly xpBar?: Pick<XpBarHandle, "anchorRect">;
  readonly registry?: readonly MilestoneDef[];
  /**
   * ROUND 2F — INJECTED SO THE WIRING IS TESTABLE. A review mutation kept
   * `knownEarned.add(id)` and deleted `pendingIds.push(...newIds)` from the
   * subscription below, and the whole suite stayed green: newly-earned
   * milestones were detected and remembered, and the ribbon never appeared.
   * That is the round's answer to the owner's "need better notification when
   * milestones are completed", disconnectable in one line — because every pure
   * helper around it was tested while the connection itself was "verified
   * manually in the browser".
   *
   * Defaults to the real `createMilestoneRibbon`, so production is unchanged.
   */
  createRibbon?(deps: MilestoneRibbonDeps): MilestoneRibbonStage;
  /** Defaults to `#ui`, falling back to `mount`. */
  readonly host?: RibbonHost;
  /** Blocking-surface probe, defaulting to the real
   * `isMilestoneRibbonBlocked` against the live DOM. */
  isBlocked?(state: GameState): boolean;
}

/** Somewhere to hang the ribbon — `HTMLElement` satisfies it; a controller test
 * passes a one-method stub (vitest runs in `node` here, and jsdom is outside
 * the spec §1 dependency allowlist). */
export interface RibbonHost {
  appendChild(el: unknown): unknown;
}

/** What the CONTROLLER needs from a ribbon — narrower than `MilestoneRibbon`
 * (whose `el` is a real `HTMLElement`), so a controller test can supply a fake
 * stage. `MilestoneRibbon` satisfies this structurally. */
export interface MilestoneRibbonStage {
  readonly el: { remove?(): void };
  show(batch: MilestoneCelebrationBatch): void;
  hide(): void;
  isShowing(): boolean;
}

export interface MilestoneCelebrationUi {
  dispose(): void;
}

export function initMilestoneCelebrationUi(
  deps: InitMilestoneCelebrationDeps,
): MilestoneCelebrationUi {
  const registry = deps.registry ?? MILESTONES;
  const makeRibbon = deps.createRibbon ?? createMilestoneRibbon;
  const blocked = deps.isBlocked ?? ((state: GameState): boolean =>
    isMilestoneRibbonBlocked(state));
  let queue: RibbonQueueState = EMPTY_RIBBON_QUEUE;
  let latestState = deps.store.getState();
  const knownEarned = new Set(Object.keys(latestState.milestones.earned));
  let pendingIds: string[] = [];
  let flushScheduled = false;

  const ribbon = makeRibbon({
    onOpen: deps.onOpenMilestones,
    xpBar: deps.xpBar,
  });
  const root: RibbonHost =
    deps.host ??
    (typeof document === "undefined"
      ? (deps.mount as RibbonHost)
      : (document.getElementById("ui") ?? (deps.mount as RibbonHost)));
  root.appendChild(ribbon.el);

  function tryAdvance(): void {
    const advanced = advanceRibbonQueue(queue, blocked(latestState));
    if (advanced === queue) return;
    queue = advanced;
    if (queue.showing !== null) ribbon.show(queue.showing);
  }

  function flush(): void {
    flushScheduled = false;
    if (pendingIds.length === 0) return;
    const ids = pendingIds;
    pendingIds = [];
    const batch = buildMilestoneCelebrationBatch(ids, latestState, registry);
    queue = enqueueRibbon(queue, batch);
    tryAdvance();
  }

  const unsubscribe = deps.store.subscribe((state) => {
    latestState = state;
    const newIds = newlyEarnedMilestoneIds(knownEarned, state);
    if (newIds.length > 0) {
      for (const id of newIds) knownEarned.add(id);
      pendingIds.push(...newIds);
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flush);
      }
    }
    // Drains the queue the instant the reveal queue/Doorstep clears, same
    // "recheck on every tick" trick `levelUp.ts` uses.
    tryAdvance();
  });

  return {
    dispose(): void {
      unsubscribe();
      ribbon.hide();
      ribbon.el.remove?.();
    },
  };
}
