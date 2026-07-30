/**
 * THE KEEP STRIP (docs/progression-bible.md §0.2/§1; round 2G's
 * hud-redesign doc §2.4) — the owner's diagnosis, verbatim: "I think we
 * need that visual progress bar for experience, I think this is one of the
 * major driving levers that we're missing from the UI." This is that bar,
 * now living where the redesign decided it belongs: the thumb zone, 8px
 * above the action bar, so a Feed/Clean/Play/Pet/Rest tap and the bar it
 * moves are finally next to each other (the old top-bar placement was
 * 489px away, on the opposite end of a phone — see the doc's §1.4).
 *
 * ONE spine, belonging to the Keep (bible §0.1) — `state.keepXp` and
 * `state.keep.level` are the only two numbers the MODEL reads; the DOM
 * shell below additionally owns the Build button and the strip's
 * show/hide, both folded in here because the redesign fuses them into one
 * fixed-position strip (`.pk-keepstrip`) rather than two separately-placed
 * floats. It never dispatches anything itself — `onOpenUpgrades` /
 * `onOpenBuild` are the only two seams out, both optional so a caller that
 * omits one gets an inert (but never lying) disabled control instead of a
 * crash.
 *
 * ROUND 2G DECIDES THE PLACEMENT: `createXpBar`'s returned `el` IS
 * `.pk-keepstrip` now — fixed-position, bottom-anchored, self-contained
 * CSS in `progression.css`. The caller (`app/main.ts`) just appends it
 * into `#ui`; nothing about where it sits is main.ts's decision anymore.
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
 *
 * THE WHOLE WIDGET IS THE BUTTON, AND THAT INCLUDES ITS CALL TO ACTION.
 * Round 2G's first build made `.pk-xpbar` a real `<button>` but left
 * `.pk-xpbar-next` — the line reading "Ready — the Trail Post…. Tap to grow
 * the Keep." — a SIBLING of it, styled as plain 11.5px text with no cursor.
 * So the one string in the game that instructs a tap was the one part of the
 * widget that did not accept one. Both rows are inside the `<button>` now,
 * which is also why the DOM tests below assert reachability, not just
 * rendering: a mutation that deleted the click handler outright left the
 * whole suite green (review finding 5), because every assertion in this file
 * used to stop at the pure model.
 *
 * N6 (hud-redesign doc §2.8): the OLD `.pk-xpbar` carried
 * `role="status"` (implicit `aria-live="polite"`), so a screen-reader user
 * heard a number read out on every XP tick. `role="status"` now lives on a
 * visually-hidden `<span class="pk-sr-only">` that this module updates
 * ONLY on a level change or a ready-state edge — never on a bare numeral
 * tick.
 */

import "./progression.css";
import type { GameState } from "../core/state";
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

/**
 * The bar's second line. Below tier 12 it names the next tier's headline;
 * at Renown it names the next FLOURISH (bible §1.7) with how far off it is,
 * so the endgame bar has a named carrot exactly like every tier below it —
 * rather than the flat "Renown — flair, forever" it shipped with, which is a
 * statement about the game rather than a thing to aim at.
 *
 * ROUND 2G's ONE ADDITION (hud-redesign doc §2.4/§3): when a tier is Ready,
 * this keeps naming the carrot (failure 7's fix, preserved — a Ready bar
 * must not fall back to a bare "Ready!" once it has a real name to say) AND
 * adds the verb the label was missing: "Ready — the Trail Post, and more
 * ground. Tap to grow the Keep." The Ready affordance IS the tap target
 * now (failure 6), so its own label is where the call to action belongs.
 */
export function xpBarNextLabel(model: XpBarModel): string {
  if (model.nextTierName !== null) {
    return model.ready
      ? `Ready — ${model.nextTierName}. Tap to grow the Keep.`
      : `Next: ${model.nextTierName}`;
  }
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
  /** Tapping the bar opens the Keep upgrade card (bible §1.2: "Tapping it
   * opens the upgrade card"). Wired by `app/main.ts` to `ui/phase5.ts`'s
   * `openUpgrades` (which, round 2G, ALSO folds in the old Keep chip's
   * rapid-tap parade Easter egg — see phase5.ts). Omitted → the bar
   * renders as a disabled, non-interactive readout rather than a lie. */
  onOpenUpgrades?(): void;
  /** Tapping the Build icon opens the Build sheet (`ui/phase5.ts`'s
   * `openBuild`) — round 2G folds the Build button into the Keep strip
   * beside the bar, so it no longer floats on its own. Omitted → disabled. */
  onOpenBuild?(): void;
}

export interface XpBarHandle {
  readonly el: HTMLElement;
  /** Re-render from a fresh state. Safe to call every store tick. */
  sync(state: GameState): void;
  /** The fill track's current viewport rect, so another celebration
   * surface (the milestone ribbon) can fly a chip toward it. Null before
   * the element has been laid out (e.g. in a detached-node unit test). */
  anchorRect(): DOMRect | null;
  /** Hides (or restores) the WHOLE Keep strip — driven by the same
   * `onOpenChange` seam `buildSheet.ts` already fires for the old
   * `.pk-keepbar`, plus placement mode (`ui/phase5.ts` wires both). */
  setHidden(hidden: boolean): void;
  dispose(): void;
}

const CHIP_LIFETIME_MS = 950;

/** "Keep level 7, 920 of 1,150 experience — a tier is ready. Open Keep
 * upgrades." (hud-redesign doc §2.8) — the strip's one real `role="status"`
 * text lives on a separate, rarely-updated `<span>` (see N6 in the module
 * doc); THIS is the static, always-current aria-label on the tappable
 * button itself, which changing does not announce anything by itself.
 *
 * IT SAYS WHAT THE SCREEN SAYS, BANKED FORM INCLUDED. `buildXpBarModel`
 * already fixed the visible numerals — `into` keeps climbing past `span`
 * while a Ready tier waits to be paid for, so the raw form printed
 * "460 / 300", which reads as a bug rather than as progress in hand. This
 * label was left on the raw form, so a browser check at a Ready tier found
 * the bar showing "100 / 100 · banked" while the button announced "194 of
 * 100 experience": the identical defect, surviving in the one layer nobody
 * looks at. A screen-reader user gets the same sentence a sighted one does.
 */
export function xpBarAriaLabel(model: XpBarModel): string {
  const counts = model.ready
    ? `${formatXpCount(model.span)} of ${formatXpCount(model.span)} experience banked`
    : `${formatXpCount(model.into)} of ${formatXpCount(model.span)} experience`;
  return (
    `Keep level ${model.level}, ${counts}` +
    (model.ready ? " — a tier is ready" : "") +
    ". Open Keep upgrades."
  );
}

/** N6's sr-only announcement — deliberately much shorter than the full
 * aria-label above (a live region should say the NEWS, not repeat every
 * number every time it fires). */
function xpBarSrAnnouncement(model: XpBarModel): string {
  return `Keep level ${model.level}${model.ready ? " — a tier is ready" : ""}`;
}

/**
 * Builds `.pk-keepstrip` — the fixed, bottom-anchored home the redesign
 * gives this bar (see the module doc). Unlike the old `createXpBar`, this
 * is no longer a "mountable anywhere" detached bar: round 2G is explicitly
 * the round that decides the placement, so the position lives in
 * `progression.css` and the caller (`app/main.ts`) just appends `el`.
 */
export function createXpBar(deps: XpBarDeps = {}): XpBarHandle {
  const tuning = deps.tuning ?? contentTuning;
  const levelDefs = deps.levelDefs ?? keepLevels;

  const el = document.createElement("div");
  el.className = "pk-keepstrip";

  // ROUND 2G INTEGRATE — the mirror of `topBar.ts`'s `--pk-hud-top`.
  //
  // Moving this strip out of `.pk-phase5` and into a bottom-anchored float
  // put a NEW 73px band of chrome between the action bar and the world, in
  // a region other surfaces had already staked out with hardcoded offsets.
  // The measured casualty: `onboarding.css` anchors its coach-mark cue and
  // its Skip button at `bottom: 108px`, tuned when the only thing below
  // them was the 84px action bar. 108px now lands INSIDE this strip
  // (84px→157px), so at 375×812 the tutorial cue covered 62.7% of the XP
  // bar and the Skip button covered 64% of the Build button — during the
  // exact 90 seconds (spec §10.1) a new player first meets both.
  //
  // Publishing the real height is the same fix round 2G already chose for
  // the top: measure, don't guess. Consumers use
  // `calc(var(--pk-hud-bottom, 157px) + N)` and stay correct if this strip
  // ever re-wraps (its second row is text, so it can).
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      // Distance from the viewport bottom to this strip's TOP edge — i.e.
      // the full height of the bottom chrome, action bar included.
      const fromBottom = Math.round(window.innerHeight - rect.top);
      document.documentElement.style.setProperty(
        "--pk-hud-bottom",
        `${fromBottom}px`,
      );
    });
    ro.observe(el);
  }

  const inner = document.createElement("div");
  inner.className = "pk-keepstrip-inner";

  const row = document.createElement("div");
  row.className = "pk-keepstrip-row";

  // A REAL BUTTON — the whole widget, not a 45×20px chip beside it. The
  // gold pulsing "Ready" state used to live on a SEPARATE small chip while
  // the actual tap target was a second, different Keep-level chip in the
  // opposite corner; now the thing that pulses is the thing that acts, and
  // its tap target is the full ~57×215px strip (redesign doc N2/failure 6).
  const bar = document.createElement("button");
  bar.type = "button";
  bar.className = "pk-xpbar";
  const onOpenUpgrades = deps.onOpenUpgrades;
  if (onOpenUpgrades === undefined) {
    bar.disabled = true;
  } else {
    bar.addEventListener("click", () => {
      sound("ui.tap");
      onOpenUpgrades();
    });
  }

  // Row 1 of the button: level chip + track. A wrapper (rather than the
  // button itself being the flex row) is what lets the carrot line — which
  // carries the "Tap to grow the Keep." call to action — live INSIDE the
  // button; see `nextTier` below.
  const main = document.createElement("div");
  main.className = "pk-xpbar-main";

  const chip = document.createElement("span");
  chip.className = "pk-xpbar-chip";
  // THE HUD HAS TO SAY THE WORD "KEEP" SOMEWHERE VISIBLE. The only
  // progression text on a cold landing was `Lv 1`, directly beneath a single
  // Pip — which every new player reads as the PET's level. The aria-label and
  // the sr-only status both said "Keep level 1"; nothing on screen did. A
  // 9px kicker costs ~26px and names the subject of the sentence.
  const kicker = document.createElement("span");
  kicker.className = "pk-xpbar-kicker";
  kicker.textContent = "Keep";
  const levelText = document.createElement("span");
  levelText.className = "pk-xpbar-level";
  chip.append(kicker, levelText);

  const track = document.createElement("div");
  track.className = "pk-xpbar-track";
  const fill = document.createElement("div");
  fill.className = "pk-xpbar-fill";
  const numerals = document.createElement("div");
  numerals.className = "pk-xpbar-numerals";
  track.append(fill, numerals);

  const flights = document.createElement("div");
  flights.className = "pk-xpbar-flights";

  main.append(chip, track, flights);

  // INSIDE the button, not beside it. This line is the only copy in the game
  // that literally instructs a tap ("Ready — …. Tap to grow the Keep."), and
  // it used to be a SIBLING of the button: tapping the words did nothing
  // while the real target was the bar above them. A call to action that is
  // not part of the thing it calls you to act on is a lie with good
  // intentions — so the button now wraps both rows.
  const nextTier = document.createElement("div");
  nextTier.className = "pk-xpbar-next";

  bar.append(main, nextTier);

  const buildBtn = document.createElement("button");
  buildBtn.type = "button";
  buildBtn.className = "pk-build-btn";
  buildBtn.textContent = "⚒";
  buildBtn.setAttribute("aria-label", "Build");
  buildBtn.title = "Build something for the Keep";
  const onOpenBuild = deps.onOpenBuild;
  if (onOpenBuild === undefined) {
    buildBtn.disabled = true;
  } else {
    buildBtn.addEventListener("click", () => {
      sound("ui.tap");
      onOpenBuild();
    });
  }

  row.append(bar, buildBtn);

  inner.append(row);

  // N6: role="status" moves OFF the always-repainted bar and onto this
  // visually-hidden span, which `sync` below only touches on a level/ready
  // EDGE — never on a bare XP tick.
  const srStatus = document.createElement("span");
  srStatus.className = "pk-sr-only";
  srStatus.setAttribute("role", "status");

  el.append(inner, srStatus);

  let lastKeepXp: number | null = null;
  let lastPaintedPx = 0;
  let wasReady = false;
  let lastAnnouncedLevel: number | null = null;
  let lastAnnouncedReady: boolean | null = null;

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

      levelText.textContent = model.levelLabel;
      bar.classList.toggle("pk-xpbar--ready", model.ready);
      bar.setAttribute("aria-label", xpBarAriaLabel(model));
      if (model.ready && !wasReady) sound("keep.ready");
      wasReady = model.ready;

      if (model.level !== lastAnnouncedLevel || model.ready !== lastAnnouncedReady) {
        lastAnnouncedLevel = model.level;
        lastAnnouncedReady = model.ready;
        srStatus.textContent = xpBarSrAnnouncement(model);
      }

      const paint = computeFillPaint(model.pct, track.clientWidth, lastPaintedPx);
      lastPaintedPx = paint.paintedPx;
      fill.style.width = paint.width;

      numerals.textContent = model.numerals;
      nextTier.textContent = xpBarNextLabel(model);
      nextTier.classList.toggle("pk-xpbar-next--ready", model.ready);
    },
    anchorRect(): DOMRect | null {
      if (!el.isConnected) return null;
      return track.getBoundingClientRect();
    },
    setHidden(hidden: boolean): void {
      el.classList.toggle("pk-keepstrip--hide", hidden);
    },
    dispose(): void {
      el.remove();
    },
  };
}

// NOTE (round 2G review, scope fence — CLAUDE.md rule 3 / spec §12): an
// `initXpBar` convenience wrapper used to live here, mounting the strip and
// subscribing it to a Store. `app/main.ts` calls `createXpBar` directly and
// drives `sync` from its own subscription, so the wrapper had no caller in
// the tree — a speculative implementation kept alive by nothing. Deleted
// rather than retained: the seam that matters (`createXpBar` + `sync`) is
// right above, and a second entry point is how the sulking rule broke twice.
