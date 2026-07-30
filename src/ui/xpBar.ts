/**
 * THE KEEP XP BAR (docs/progression-bible.md §0.2/§1) — the owner's
 * diagnosis, verbatim: "I think we need that visual progress bar for
 * experience, I think this is one of the major driving levers that we're
 * missing from the UI." This is that bar.
 *
 * ONE spine, belonging to the Keep (bible §0.1) — `state.keepXp` and
 * `state.keep.level` are the only two numbers this module reads. It never
 * dispatches anything; it is a pure readout, same shape as every other
 * `ui/` module (pure model builder + dumb DOM shell, spec §2).
 *
 * SELF-CONTAINED BY DESIGN: round 2G owns where this bar finally lives in
 * the layout (the task brief is explicit that this round must not decide
 * that). So this module mounts nothing by default — `createXpBar` builds
 * a detached `<div>` the caller appends wherever it likes, and `initXpBar`
 * is a convenience wrapper that also subscribes to a Store. Nothing here
 * assumes a position, a parent, or a z-index beyond its own rung in
 * `ui/layers.test.ts`.
 *
 * THE BAR-MOVEMENT GUARANTEE (bible §0.2) is a rendering promise, not just
 * a tuning one: every grant animates the fill with a 2px minimum advance
 * (`minAdvancePx` below — a plain arithmetic helper so it is unit-testable
 * without a DOM), and a `+N` chip floats up on every gain so a single Pet
 * at tier 12 — half a pixel of real fill — still reads as "the bar
 * acknowledged me".
 *
 * Past tier 12, `buildXpBarModel` switches to Renown (bible §1.7): the
 * chip reads `Lv 12 · Renown 3` and the bar keeps filling forever — the
 * one hard requirement being that the bar must never look full and dead.
 */

import "./progression.css";
import type { GameAction, GameState } from "../core/state";
import type { Store } from "../core/store";
import { tuning as contentTuning } from "../content/tuning";
import type { Tuning } from "../content/tuning";
import { keepLevels } from "../content/keep";
import type { KeepLevelDef } from "../content/keep";
import {
  isNextTierXpReady,
  renownBarProgress,
  renownLevelFor,
  tierBarProgress,
} from "../core/progression/xp";
import { renownFlairForLevel } from "../content/flair";
import { sound } from "../app/sound";

// ---------------------------------------------------------------------------
// PURE — the model and its small arithmetic helpers
// ---------------------------------------------------------------------------

export interface XpBarModel {
  /** `state.keep.level` — unchanged, still the single source of truth. */
  readonly level: number;
  /** 0 below tier 12; the Renown level once past it (bible §1.7). */
  readonly renownLevel: number;
  /** XP into the CURRENT bar (tier bar below 12, Renown bar at/above it). */
  readonly into: number;
  /** The current bar's span; 0 only if `levelXp` is malformed (defensive). */
  readonly span: number;
  /** `into / span`, clamped to [0, 1]. */
  readonly pct: number;
  /** The next tier's XP gate is already cleared (bible §1.2's "Ready"). */
  readonly ready: boolean;
  /** True once `level` is the top defined tier — the bar becomes Renown. */
  readonly atTopTier: boolean;
  /** "1,240 / 1,530" — always re-rendered so the numerals always change. */
  readonly numerals: string;
  /** "Lv 5" / "Lv 5 ▸ Ready" / "Lv 12 · Renown 3". */
  readonly levelLabel: string;
  /** The next tier's headline unlock, by NAME, straight from content's own
   * `headline` field — or null once there is no next tier.
   *
   * Reads `headline`, NOT `unlocks[0]`: keying it to array order made the
   * bar advertise `Next: +2 rows of ground` at tier 6 and `Next: +2 columns
   * of ground` at tier 8, i.e. it named a NUMBER for 2 of the 11 tiers when
   * naming the carrot is the label's only job (`content/keep.ts`'s
   * `headline` doc has the full note). */
  readonly nextTierName: string | null;
  /** Renown only: the flourish this Renown level minted, or the one the
   * next level will (bible §1.7 — "Renown grants flair only, forever").
   * Null below tier 12, so the bar's label logic stays a single branch. */
  readonly renownFlairName: string | null;
  /** Renown only: XP remaining to the next flourish — so the endgame bar
   * still has a named, reachable thing in front of it rather than a chip
   * that merely counts. */
  readonly renownNextIn: number;
}

/** "1,240" — thousands-grouped, never a bare `NaN`/negative from a stray
 * caller (defensive floor at 0). */
export function formatXpCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-US");
}

/** The pure per-tier / Renown calculator. Below tier 12 this is a thin
 * wrapper over `core/progression/xp.ts`'s already-tested
 * `tierBarProgress`/`isNextTierXpReady`; at/above it, Renown's own
 * arithmetic (bible §1.7: `xpPerLevel` past `levelXp[top]`). */
export function buildXpBarModel(
  state: Pick<GameState, "keepXp" | "keep">,
  tuning: Tuning = contentTuning,
  levelDefs: readonly KeepLevelDef[] = keepLevels,
): XpBarModel {
  const level = state.keep.level;
  const topTier = tuning.progression.levelXp.length;

  if (level < topTier) {
    const { into, span } = tierBarProgress(state.keepXp, level, tuning);
    const ready = isNextTierXpReady(state.keepXp, level, tuning);
    const nextDef = levelDefs.find((d) => d.level === level + 1);
    return {
      level,
      renownLevel: 0,
      into,
      span,
      pct: span > 0 ? Math.min(1, Math.max(0, into / span)) : 0,
      ready,
      atTopTier: false,
      // BANKED, NOT BROKEN: `into` keeps growing while a Ready tier waits to
      // be paid for, so the raw form printed "460 / 300" — which reads as a
      // bug, not as progress in hand. Six of the eleven tiers are free and
      // five are resource-gated, so Ready-with-overflow is the NORMAL state
      // for the whole gated stretch, and the bible celebrates it ("the bar
      // sits at Ready for twenty minutes"). Say that instead.
      numerals: ready
        ? `${formatXpCount(span)} / ${formatXpCount(span)} · banked`
        : `${formatXpCount(into)} / ${formatXpCount(span)}`,
      levelLabel: ready ? `Lv ${level} ▸ Ready` : `Lv ${level}`,
      nextTierName: nextDef?.headline ?? null,
      renownFlairName: null,
      renownNextIn: 0,
    };
  }

  // RENOWN (bible §1.7) — past the top tier, flair-only, endless. Arithmetic
  // lives in `core/progression/xp.ts` so the reducer's flair grant and this
  // readout can never disagree about which level the player is on.
  const renownLevel = renownLevelFor(state.keepXp, tuning);
  const { into, span } = renownBarProgress(state.keepXp, tuning);
  const nextFlair = renownFlairForLevel(renownLevel + 1);
  return {
    level,
    renownLevel,
    into,
    span,
    pct: Math.min(1, Math.max(0, into / span)),
    ready: false,
    atTopTier: true,
    numerals: `${formatXpCount(into)} / ${formatXpCount(span)}`,
    levelLabel:
      renownLevel > 0 ? `Lv ${level} · Renown ${renownLevel}` : `Lv ${level}`,
    nextTierName: null,
    // The bar names the FLOURISH it is working toward, so the endgame has a
    // named carrot exactly like every tier below it does. Past the last
    // flourish the label says so rather than pretending one is coming.
    renownFlairName: nextFlair?.name ?? null,
    renownNextIn: Math.max(0, span - into),
  };
}

/** Forward-only clamp (bible §0.3: `keepXp` never decreases, but a stray
 * out-of-order sync must never paint a negative chip). */
export function xpGainSinceLast(prevKeepXp: number, nextKeepXp: number): number {
  return Math.max(0, nextKeepXp - prevKeepXp);
}

/**
 * THE TICK FLOOR (bible §0.2): "the fill animates with a 2px minimum
 * advance… so a sub-pixel grant still visibly nudges." Pure pixel
 * arithmetic — the DOM shell supplies the previous painted width and the
 * raw target width; this decides what to actually paint. Never advances
 * PAST the raw target when the raw target itself is smaller (a decrease
 * should never happen per §0.3, but this stays a no-op rather than a lie
 * if it ever does), and never overshoots `maxPx` (the track's own width).
 */
export function minAdvancePx(
  prevPx: number,
  nextPxRaw: number,
  maxPx: number,
  minPx = 2,
): number {
  if (nextPxRaw <= prevPx) return Math.min(nextPxRaw, maxPx);
  return Math.min(maxPx, Math.max(nextPxRaw, prevPx + minPx));
}

/**
 * THE WHOLE PAINT DECISION, as one pure function — `{ width, paintedPx }` for
 * a given model, track width and previously-painted width.
 *
 * WHY IT IS A FUNCTION AND NOT THREE LINES IN `sync`. `minAdvancePx` was
 * thoroughly unit-tested while its CALL SITE was not, so replacing
 * `minAdvancePx(lastPaintedPx, rawPx, maxPx)` with a bare `rawPx` left the
 * whole suite green — and that bypass is exactly the bug the floor exists to
 * prevent: at the Renown span a 4-XP care action is a fraction of a pixel, so
 * the fill paints no change and the late-game bar reads as frozen. The module
 * doc calls the floor "a rendering promise, not just a tuning one"; a promise
 * whose only enforcement is an untested call site is not enforced. Now the
 * decision itself is the tested unit and `sync` has nothing left to get wrong.
 *
 * `maxPx <= 0` means the element is not laid out yet (a detached node, a
 * hidden parent), where pixel maths is meaningless — fall back to a
 * percentage so the bar is still correct the moment it becomes visible.
 */
export function computeFillPaint(
  pct: number,
  maxPx: number,
  lastPaintedPx: number,
): { readonly width: string; readonly paintedPx: number } {
  const clamped = Math.min(1, Math.max(0, pct));
  if (maxPx <= 0) return { width: `${clamped * 100}%`, paintedPx: lastPaintedPx };
  const paintedPx = minAdvancePx(lastPaintedPx, maxPx * clamped, maxPx);
  return { width: `${paintedPx}px`, paintedPx };
}

/** The bar's second line. Below tier 12 it names the next tier's headline;
 * at Renown it names the next FLOURISH (bible §1.7) with how far off it is,
 * so the endgame bar has a named carrot exactly like every tier below it —
 * rather than the flat "Renown — flair, forever" it shipped with, which is a
 * statement about the game rather than a thing to aim at. */
export function xpBarNextLabel(model: XpBarModel): string {
  if (model.nextTierName !== null) return `Next: ${model.nextTierName}`;
  if (model.renownFlairName !== null) {
    return `Next flourish: ${model.renownFlairName} — ${formatXpCount(model.renownNextIn)} XP`;
  }
  return "Renown — every flourish earned. Still counting.";
}

// ---------------------------------------------------------------------------
// DOM — the dumb shell
// ---------------------------------------------------------------------------

export interface XpBarDeps {
  readonly tuning?: Tuning;
  readonly levelDefs?: readonly KeepLevelDef[];
  /** Tapping the level chip opens the Keep upgrade card (bible §1.2: "the
   * level chip… Tapping it opens the upgrade card"). Wired by `app/main.ts`
   * to `ui/phase5.ts`'s `openUpgrades`. Omitted → the chip renders as a
   * disabled, non-interactive readout rather than a lie. */
  onOpenUpgrades?(): void;
}

export interface XpBarHandle {
  readonly el: HTMLElement;
  /** Re-render from a fresh state. Safe to call every store tick. */
  sync(state: GameState): void;
  /** The fill track's current viewport rect, so another celebration
   * surface (the milestone ribbon) can fly a chip toward it. Null before
   * the element has been laid out (e.g. in a detached-node unit test). */
  anchorRect(): DOMRect | null;
  dispose(): void;
}

const CHIP_LIFETIME_MS = 950;

/** Builds a detached `<div class="pk-xpbar">` — append it wherever the
 * caller's layout wants it (bible task brief: "mountable anywhere"). */
export function createXpBar(deps: XpBarDeps = {}): XpBarHandle {
  const tuning = deps.tuning ?? contentTuning;
  const levelDefs = deps.levelDefs ?? keepLevels;

  const el = document.createElement("div");
  el.className = "pk-xpbar";
  el.setAttribute("role", "status");
  el.setAttribute("aria-label", "Keep experience");

  // A REAL BUTTON. The gold pulsing "Ready" chip used to be part of a
  // `role="status"` div with no listener, so the one element in the UI
  // shouting "there is a tier waiting for you" was the one element that could
  // not take you there.
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "pk-xpbar-chip";
  const onOpenUpgrades = deps.onOpenUpgrades;
  if (onOpenUpgrades === undefined) {
    chip.disabled = true;
  } else {
    chip.addEventListener("click", () => {
      sound("ui.tap");
      onOpenUpgrades();
    });
  }

  const track = document.createElement("div");
  track.className = "pk-xpbar-track";
  const fill = document.createElement("div");
  fill.className = "pk-xpbar-fill";
  track.appendChild(fill);

  const numerals = document.createElement("div");
  numerals.className = "pk-xpbar-numerals";

  const nextTier = document.createElement("div");
  nextTier.className = "pk-xpbar-next";

  const flights = document.createElement("div");
  flights.className = "pk-xpbar-flights";

  el.append(chip, track, numerals, nextTier, flights);

  let lastKeepXp: number | null = null;
  let lastPaintedPx = 0;
  let wasReady = false;

  function spawnGainChip(amount: number): void {
    if (amount <= 0) return;
    const fly = document.createElement("div");
    fly.className = "pk-xpbar-gain";
    fly.textContent = `+${formatXpCount(amount)}`;
    flights.appendChild(fly);
    window.setTimeout(() => fly.remove(), CHIP_LIFETIME_MS);
  }

  return {
    el,
    sync(state: GameState): void {
      const model = buildXpBarModel(state, tuning, levelDefs);

      if (lastKeepXp !== null) {
        spawnGainChip(xpGainSinceLast(lastKeepXp, state.keepXp));
      }
      lastKeepXp = state.keepXp;

      chip.textContent = model.levelLabel;
      chip.classList.toggle("pk-xpbar-chip--ready", model.ready);
      chip.setAttribute(
        "aria-label",
        model.ready
          ? `${model.levelLabel} — a Keep tier is ready. Open upgrades.`
          : `${model.levelLabel} — open Keep upgrades`,
      );
      if (model.ready && !wasReady) sound("keep.ready");
      wasReady = model.ready;

      const paint = computeFillPaint(model.pct, track.clientWidth, lastPaintedPx);
      lastPaintedPx = paint.paintedPx;
      fill.style.width = paint.width;

      numerals.textContent = model.numerals;
      nextTier.textContent = xpBarNextLabel(model);
      nextTier.hidden = false;
    },
    anchorRect(): DOMRect | null {
      if (!el.isConnected) return null;
      return track.getBoundingClientRect();
    },
    dispose(): void {
      el.remove();
    },
  };
}

export interface InitXpBarDeps extends XpBarDeps {
  readonly mount: HTMLElement;
  readonly store: Store<GameState, GameAction>;
}

/** Convenience: build the bar, append it, and keep it synced to a live
 * Store. Mounts into `#ui` when present (the pattern every self-contained
 * `ui/` module in this codebase follows — soundToggle.ts, dailies.ts's
 * entry button), falling back to the given mount. */
export function initXpBar(deps: InitXpBarDeps): XpBarHandle {
  const handle = createXpBar(deps);
  const root = document.getElementById("ui") ?? deps.mount;
  root.appendChild(handle.el);
  handle.sync(deps.store.getState());
  const unsubscribe = deps.store.subscribe((state) => handle.sync(state));
  return {
    ...handle,
    dispose(): void {
      unsubscribe();
      handle.dispose();
    },
  };
}
