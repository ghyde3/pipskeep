/**
 * THE KEEP TIER-UP MOMENT (docs/progression-bible.md §1.2/§6.3) — the
 * owner's ask for "a better reason to build" and "the bar leads somewhere
 * named" cashed out as a real celebration: the new tier's number, its
 * headline unlock BY NAME (straight from `content/keep.ts`'s `unlocks`,
 * never re-authored copy that could drift from what actually unlocked —
 * ruling #5's "written to state vs visible to the player" applies to
 * copy-drift too), confetti, and a distinct sound.
 *
 * TRIGGER: `state.lastLevelUp` (core/state.ts) — set exactly once per
 * successful `PURCHASE_KEEP_LEVEL` tap, never while away (bible §1.2: "the
 * Keep never levels up while you are away… the tap IS the celebration").
 *
 * THE QUEUEING CONTRACT (this round's stacking hazard, restated for tier-
 * ups): the Doorstep and the loot-reveal queue are the two surfaces
 * `docs/progression-bible.md` §6.3 says a tier-up "can never collide
 * with" — and although a tier-up is structurally safe by construction
 * (§6.3: `PURCHASE_KEEP_LEVEL` only ever fires from a tap inside the
 * upgrade card, reachable only after the Doorstep is dismissed), this
 * module still enforces it defensively rather than trusting that
 * invariant to hold forever: `hasOpenBlockingSurface()` reads the DOM for
 * `.pk-doorstep--open` / `.pk-reveal--open` (owned by `ui/welcome.ts` /
 * `ui/lootReveal.ts` respectively — neither module exposes an `isOpen()`
 * seam across the module boundary, and this task is expressly forbidden
 * from editing either file, so the class names those modules already
 * toggle are the one honest cross-module signal available). A tier-up
 * that lands while either is open QUEUES — it does not stack a sixth
 * modal, and it does not skip the moment; it waits, silently, and plays
 * the instant both are gone. Multiple queued tier-ups (e.g. a veteran
 * save's v8 migration backfill handing out several tiers' worth of XP at
 * once, bible §8.4) play ONE AT A TIME, never overlapping.
 *
 * Split like every other `ui/` module: pure queue/copy logic below (unit-
 * tested), a dumb DOM banner shell after it.
 */

import "./progression.css";
import type { GameAction, GameState, LevelUpOutcome } from "../core/state";
import type { Store } from "../core/store";
import { keepLevels } from "../content/keep";
import type { KeepLevelDef } from "../content/keep";
import { LEVEL_UP_TOASTS, LEVEL_UP_TOAST_FALLBACK } from "./keepUpgrade";
import { sound } from "../app/sound";
import { burstConfetti } from "./confetti";

// ---------------------------------------------------------------------------
// PURE — the queue
// ---------------------------------------------------------------------------

export interface LevelUpQueueState {
  /** Outcomes waiting for their turn — oldest first. */
  readonly pending: readonly LevelUpOutcome[];
  /** The one currently on stage, or null between/before celebrations. */
  readonly showing: LevelUpOutcome | null;
}

export const EMPTY_LEVEL_UP_QUEUE: LevelUpQueueState = { pending: [], showing: null };

export function enqueueLevelUp(
  queue: LevelUpQueueState,
  outcome: LevelUpOutcome,
): LevelUpQueueState {
  return { ...queue, pending: [...queue.pending, outcome] };
}

/**
 * Pops the oldest pending outcome onto the stage — but ONLY when nothing
 * is already showing (never replace an in-progress celebration) and
 * nothing is blocking (the Doorstep / loot reveal contract above). Safe
 * to call on every tick: it is a same-reference no-op whenever there is
 * nothing to advance, which is what makes "recheck after every store
 * update" a correct way to drain the queue the instant a blocking surface
 * closes, without this module needing a callback from that surface.
 */
export function advanceLevelUpQueue(
  queue: LevelUpQueueState,
  blocked: boolean,
): LevelUpQueueState {
  if (queue.showing !== null || blocked || queue.pending.length === 0) return queue;
  const [next, ...rest] = queue.pending;
  if (next === undefined) return queue;
  return { pending: rest, showing: next };
}

/** Clears the stage — the next `advanceLevelUpQueue` call may then pop the
 * next pending outcome (if any) immediately. */
export function dismissLevelUp(queue: LevelUpQueueState): LevelUpQueueState {
  if (queue.showing === null) return queue;
  return { ...queue, showing: null };
}

// ---------------------------------------------------------------------------
// PURE — the cross-module "is a blocking surface open" signal
// ---------------------------------------------------------------------------

/** The minimal structural slice of `Document`/`Element` this needs — kept
 * tiny so a unit test can hand in a fake without jsdom. */
export interface BlockingSurfaceQuery {
  querySelector(selectors: string): unknown;
}

/**
 * True while the Doorstep or the loot-reveal modal is on screen. Reads
 * the DOM rather than importing `ui/welcome.ts` / `ui/lootReveal.ts`
 * because (a) this task does not own either file, and (b) neither exposes
 * its open/closed flag outside its own module — the CSS classes those
 * modules already toggle on open/close (`.pk-doorstep--open`,
 * `.pk-reveal--open`, see `ui/welcome.ts` / `ui/lootReveal.ts`) are the
 * one honest, decoupled signal.
 */
export function hasOpenBlockingSurface(root: BlockingSurfaceQuery = document): boolean {
  return root.querySelector(".pk-doorstep--open, .pk-reveal--open") !== null;
}

// ---------------------------------------------------------------------------
// PURE — copy, generated from content (never hand-authored prose that
// could drift from what actually unlocked — see the module doc)
// ---------------------------------------------------------------------------

/** "The Keep is Level 5" — the banner's one headline, every tier. */
export function levelUpHeadline(toLevel: number): string {
  return `The Keep is Level ${toLevel}`;
}

/**
 * The warm one-sentence flavour under the headline ("The Keep grew! The
 * Beacon is lit…"). Hand-authored per tier in `ui/keepUpgrade.ts`, which
 * owns all of the ladder's player-facing copy — this module just renders
 * it, the same way it renders `content/keep.ts`'s unlock list.
 *
 * ROUND 2F integration: before the banner existed, `diffPhase5` fired this
 * as a post-purchase toast. Keeping BOTH meant two announcements, two
 * confetti bursts and two `keep.levelup` sounds per tap, so the toast was
 * retired and its copy folded in here.
 */
export function levelUpFlavor(toLevel: number): string {
  return LEVEL_UP_TOASTS[toLevel] ?? LEVEL_UP_TOAST_FALLBACK;
}

/** The unlock lines for the tier just reached, straight from
 * `content/keep.ts` — the same list the upgrade card sold before the
 * purchase, so the banner can never promise something the tap didn't
 * actually grant. */
export function levelUpUnlockLines(
  toLevel: number,
  levelDefs: readonly KeepLevelDef[] = keepLevels,
): readonly string[] {
  return levelDefs.find((def) => def.level === toLevel)?.unlocks ?? [];
}

// ---------------------------------------------------------------------------
// DOM — the dumb banner shell
// ---------------------------------------------------------------------------

const AUTO_DISMISS_MS = 4000;

export interface LevelUpBanner {
  readonly el: HTMLElement;
  show(outcome: LevelUpOutcome, levelDefs: readonly KeepLevelDef[]): void;
  hide(): void;
  isShowing(): boolean;
}

export function createLevelUpBanner(onDismiss: () => void): LevelUpBanner {
  const el = document.createElement("div");
  el.className = "pk-levelup";
  el.setAttribute("aria-live", "polite");
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");

  const headline = document.createElement("div");
  headline.className = "pk-levelup-headline";
  const flavor = document.createElement("div");
  flavor.className = "pk-levelup-flavor";
  const list = document.createElement("ul");
  list.className = "pk-levelup-unlocks";
  el.append(headline, flavor, list);

  let showing = false;
  let dismissTimer: number | null = null;

  const hide = (): void => {
    if (!showing) return;
    showing = false;
    el.classList.remove("pk-levelup--open");
    if (dismissTimer !== null) {
      window.clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  };

  const dismissNow = (): void => {
    hide();
    onDismiss();
  };
  el.addEventListener("click", dismissNow);
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      dismissNow();
    }
  });

  return {
    el,
    show(outcome, levelDefs): void {
      headline.textContent = `✦ ${levelUpHeadline(outcome.toLevel)} ✦`;
      flavor.textContent = levelUpFlavor(outcome.toLevel);
      list.replaceChildren();
      for (const line of levelUpUnlockLines(outcome.toLevel, levelDefs)) {
        const li = document.createElement("li");
        li.textContent = line;
        list.appendChild(li);
      }
      showing = true;
      el.classList.add("pk-levelup--open");
      sound("keep.levelup");
      burstConfetti();
      dismissTimer = window.setTimeout(() => {
        hide();
        onDismiss();
      }, AUTO_DISMISS_MS);
    },
    hide,
    isShowing: () => showing,
  };
}

// ---------------------------------------------------------------------------
// The controller — store subscription + queue, tying the two halves
// ---------------------------------------------------------------------------

/** Somewhere to hang the banner. `HTMLElement` satisfies it; a test passes a
 * one-method stub, which is what lets the CONTROLLER be tested without a DOM
 * (this repo's vitest environment is `node` — jsdom is outside the spec §1
 * dependency allowlist). */
export interface BannerHost {
  appendChild(el: unknown): unknown;
}

/** What the CONTROLLER needs from a banner — deliberately narrower than
 * `LevelUpBanner` (whose `el` is a real `HTMLElement`), so a controller test can
 * supply a fake stage. `LevelUpBanner` satisfies this structurally. */
export interface LevelUpStage {
  readonly el: { remove?(): void };
  show(outcome: LevelUpOutcome, levelDefs: readonly KeepLevelDef[]): void;
  hide(): void;
  isShowing(): boolean;
}

export interface InitLevelUpUiDeps {
  /** Optional when `host` is supplied. */
  readonly mount?: HTMLElement;
  readonly store: Store<GameState, GameAction>;
  readonly levelDefs?: readonly KeepLevelDef[];
  /**
   * ROUND 2F — INJECTED SO THE WIRING IS TESTABLE. A review mutation removed
   * the single line `queue = enqueueLevelUp(queue, state.lastLevelUp)` from the
   * subscription below and the whole suite stayed green: detection ran, the
   * banner never appeared. Every pure helper around it was thoroughly tested
   * (`levelUpHeadline`, the queue, `hasOpenBlockingSurface`) — the one line
   * that connects detection to the stage was not, because the controller was
   * "verified manually in the browser", and manual verification does not
   * survive a refactor.
   *
   * Defaults to the real `createLevelUpBanner`, so nothing about production
   * behaviour changes.
   */
  createBanner?(onDismiss: () => void): LevelUpStage;
  /** Defaults to `#ui`, falling back to `mount`. */
  readonly host?: BannerHost;
  /** Blocking-surface probe, defaulting to the real DOM query. Injectable so a
   * controller test can exercise the "queues behind the Doorstep" path. */
  isBlocked?(): boolean;
}

export interface LevelUpUi {
  dispose(): void;
}

export function initLevelUpUi(deps: InitLevelUpUiDeps): LevelUpUi {
  const levelDefs = deps.levelDefs ?? keepLevels;
  const makeBanner = deps.createBanner ?? createLevelUpBanner;
  const blocked = deps.isBlocked ?? ((): boolean => hasOpenBlockingSurface());
  let queue: LevelUpQueueState = EMPTY_LEVEL_UP_QUEUE;

  const banner = makeBanner(() => {
    queue = dismissLevelUp(queue);
    tryAdvance();
  });
  const root: BannerHost =
    deps.host ??
    (typeof document === "undefined"
      ? (deps.mount as BannerHost)
      : (document.getElementById("ui") ?? (deps.mount as BannerHost)));
  root.appendChild(banner.el);

  function tryAdvance(): void {
    const advanced = advanceLevelUpQueue(queue, blocked());
    if (advanced === queue) return;
    queue = advanced;
    if (queue.showing !== null) banner.show(queue.showing, levelDefs);
  }

  let prevLastLevelUp = deps.store.getState().lastLevelUp;
  const unsubscribe = deps.store.subscribe((state) => {
    if (state.lastLevelUp !== prevLastLevelUp && state.lastLevelUp !== null) {
      queue = enqueueLevelUp(queue, state.lastLevelUp);
    }
    prevLastLevelUp = state.lastLevelUp;
    // Re-attempt on EVERY update (not just new tier-ups): this is what
    // drains a queued celebration the moment the Doorstep/reveal closes,
    // riding the app's own ≤1/s TICK cadence rather than needing a
    // callback from either module (see hasOpenBlockingSurface's doc).
    tryAdvance();
  });

  return {
    dispose(): void {
      unsubscribe();
      banner.hide();
      banner.el.remove?.();
    },
  };
}
