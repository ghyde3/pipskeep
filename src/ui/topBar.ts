/**
 * THE CAST STRIP (round 2G HUD redesign, docs/hud-redesign.md §2.3) —
 * replaces the old `.pk-topbar` dashboard (one Pip's four need bars, an
 * identity row, a 14-chip satchel manifest) with a FIXED-HEIGHT strip that
 * answers "does anything need me" for the WHOLE roster instead of just the
 * selected Pip: one portrait chip per roster pip, each carrying a tiny
 * 4-bar need "comb" + an alert ring, plus a single one-line who-row for the
 * active Pip's name/personality/status/lowest-need. The satchel and the
 * four numeral bars are CUT from here — they were an audit trail nobody
 * read, not a HUD (see the redesign doc §1.3/§6), and so is the helper that
 * built them (see the note where `satchelChips` used to be).
 *
 * Tap behavior, unchanged: a chip tap selects that pip (SET_ACTIVE_PIP);
 * tapping the ALREADY-active chip — or the who-line — opens the Pip focus
 * view (spec §10 two views). The reveal "!" chip pins to the right end of
 * the cast row, OUTSIDE the chip flow, so a returning Pip never reflows
 * every other portrait (redesign doc N5).
 *
 * THE N1 FIX (redesign doc §2.7, spec v1.3 §10's standing rule): every
 * status readout in this module — the chip badge, the alert ring, the
 * who-line, the aria-labels — routes through `statusGlyph(pip)`, which
 * checks `isSulking(pip)` FIRST, before it ever looks at `pip.activity`.
 * A Pip can nap through a sulk (`sulking: true` while `activity` reads
 * "idle" or "resting"), and the OLD `statusGlyph(activity)` silently
 * dropped that Pip's badge while a DIFFERENT Pip whose `activity` happened
 * to equal "sulking" got one — the same fact, reported inconsistently on
 * the same screen. `statusGlyph` no longer takes a bare activity at all
 * (deleted, not deprecated — a second entry point is how this broke once).
 *
 * Dumb DOM otherwise: `sync(state)` rebuilds the roster's chips only when
 * something STRUCTURAL changes (membership/order/species/palette/active
 * pip/pending-reveal count) — a cheap string key, same trick the old
 * selector used. Everything that changes every tick (mood, activity,
 * needs) is a LIVE update over the existing chip elements on every sync
 * call, never a rebuild: rebuilding on every need-decay tick would both be
 * wasteful and would restart the comb's CSS transition every second,
 * killing the "smoothly draining" feel the comb exists to give. The mood
 * dot colors by the DISPLAYED mood — Chaotic's §4.3 one-step-off quirk
 * routes through core `displayedMood`. The peek below restores the rng
 * from state and DISCARDS the advanced cursor: pure read, cursor
 * unchanged, so the same state always shows the same dot (spec §2 rule 3
 * — only actions may advance gameplay streams).
 *
 * The strip's own height is published to `--pk-hud-top` via a
 * ResizeObserver (redesign doc §4) so the celebration surfaces
 * (`levelUp.ts`, `milestoneCelebration.ts`) and toasts can clear it without
 * a hardcoded guess — the bug the old fixed-pixel top-bar offset was.
 */

import type { GameAction, GameState } from "../core/state";
import type { PipState } from "../core/pips/types";
import { NEED_IDS, PipActivity } from "../core/pips/types";
import type { NeedId } from "../core/pips/types";
import type { Mood } from "../core/pips/mood";
import { MOOD_DISPLAY_STREAM, displayedMood } from "../core/pips/dialogue";
import { isSulking } from "../core/pips/machine";
import { createRngFromState } from "../core/rng";
import {
  moodColors,
  needColors,
  needDangerColor,
  needWarnColor,
  resolvePipPalette,
} from "../content/palette";
import { personalities } from "../content/personalities";
import type { PersonalityId } from "../content/personalities";
import { sound } from "../app/sound";

/** Bar color-shift thresholds (task spec: < 40 warn/care, < 15 danger/urgent). */
const WARN_BELOW = 40;
const DANGER_BELOW = 15;

const NEED_LABELS: Record<NeedId, string> = {
  hunger: "Food",
  cleanliness: "Clean",
  happiness: "Happy",
  energy: "Energy",
};

/** Pure displayed-mood peek — see module doc. */
export function peekDisplayedMood(state: GameState, pip: PipState): Mood {
  const rng = createRngFromState(state.seed, state.rngState);
  return displayedMood(pip, rng.stream(MOOD_DISPLAY_STREAM));
}

/** Which CSS modifier a status badge wears — decoupled from `pip.activity`
 * so "sulking" can apply no matter what the underlying activity is. */
export type StatusKind =
  | "ailing"
  | "onExpedition"
  | "returning"
  | "resting"
  | "sulking"
  | "assignedJob";

/** Tiny selector-chip status badge (spec §10, redesign doc §2.7). Pure —
 * unit-testable. */
export interface StatusGlyph {
  readonly glyph: string;
  /** Warm hover/readout label; also the who-line's status clause. */
  readonly label: string;
  readonly kind: StatusKind;
}

/**
 * Status glyph for a chip, or null when the pip is just around (Idle needs
 * no badge — a present, unbusy pip speaks for itself). A working pip wears
 * the tiny basket (spec §6.2 — the Gathering job at a glance).
 *
 * SULKING FIRST. Do not reorder this to check `pip.activity` before
 * `isSulking(pip)` — that is exactly how this rule broke once already (see
 * the module doc's N1 note). A Pip can nap through a sulk: `isSulking`
 * catches BOTH encodings (`activity === Sulking` and the standalone
 * `sulking` flag machine.ts sets for "sulking while Resting"), so this is
 * the one place that check belongs, ahead of the switch.
 */
export function statusGlyph(pip: PipState): StatusGlyph | null {
  // AILING FIRST, ahead of even sulking — ROUND 2H (spec §16 v1.5 promise 1:
  // "loss is never a surprise"). An ailment is the ONE Pip state with a
  // countdown attached, so on a strip that answers "does anything need me"
  // it outranks every other status by definition. Same reasoning as the
  // sulking-first rule below, one notch more urgent: a Pip can also be
  // sulking, napping or off on a trail WHILE ailing, and any of those
  // reported instead would hide the only status the player can lose
  // someone by missing.
  //
  // `!= null` ON PURPOSE, not `!== undefined`: the field is
  // `AilmentState | null | undefined` — a Pip who has NEVER been ill has
  // `undefined`, and `core/pips/ailment.ts` writes an explicit `null` on a
  // CURE. Testing only for `undefined` leaves a cured Pip wearing the
  // "poorly" badge forever (caught in the browser, not by a test — hence
  // the cured-Pip case pinned in topBar.test.ts).
  if (pip.ailment != null) {
    return { glyph: "♥", label: "poorly", kind: "ailing" };
  }
  if (isSulking(pip)) return { glyph: "…", label: "sulking", kind: "sulking" };
  switch (pip.activity) {
    case PipActivity.OnExpedition:
      return { glyph: "»", label: "off exploring", kind: "onExpedition" };
    case PipActivity.Returning:
      return { glyph: "!", label: "back with treasure", kind: "returning" };
    case PipActivity.Resting:
      return { glyph: "z", label: "snoozing", kind: "resting" };
    case PipActivity.AssignedJob:
      return { glyph: "🧺", label: "gathering away", kind: "assignedJob" };
    default:
      return null;
  }
}

/** Identity-row subtitle: personality, plus the status when notable.
 * Pure — unit-testable. Feeds the who-line button's aria-label (redesign
 * doc §2.8 keeps this shape verbatim: `${name}, ${subtitle} — open
 * details`), so its sulking-correctness rides on `statusGlyph`'s fix too. */
export function identitySubtitle(pip: PipState): string {
  const personality =
    personalities[pip.personalityId as PersonalityId]?.name ?? pip.personalityId;
  const status = statusGlyph(pip);
  return status === null ? personality : `${personality} — ${status.label}`;
}

/** The single lowest need, named, only when it has fallen below the warn
 * threshold — "Clean is empty" (< 15) / "Happy is low" (< 40) / null when
 * every need is comfortable. Ties break in `NEED_IDS` order (the first
 * need at the lowest value wins — strict less-than below). Shared by the
 * who-line and both aria-label builders so the three surfaces can never
 * name a different need for the same Pip. */
export function lowestNeedClause(pip: PipState): string | null {
  let lowestId: NeedId = NEED_IDS[0] as NeedId;
  let lowestVal = pip.needs[lowestId];
  for (const id of NEED_IDS) {
    const v = pip.needs[id];
    if (v < lowestVal) {
      lowestVal = v;
      lowestId = id;
    }
  }
  if (lowestVal >= WARN_BELOW) return null;
  const label = NEED_LABELS[lowestId];
  return lowestVal < DANGER_BELOW ? `${label} is empty` : `${label} is low`;
}

/** The who-line's content, split so the DOM can bold the name and dim
 * everything after it (redesign doc §2.3): `rest` already carries its own
 * leading "· " separator (or is "" — never happens today, since every Pip
 * has a personality). Pure — unit-testable; the four example lines in the
 * redesign doc are pinned as test cases. */
export interface HudWhoLine {
  readonly name: string;
  readonly rest: string;
}

export function buildHudWhoLine(pip: PipState): HudWhoLine {
  const personality =
    personalities[pip.personalityId as PersonalityId]?.name ?? pip.personalityId;
  const status = statusGlyph(pip);
  const lowNeed = lowestNeedClause(pip);
  const parts = [personality];
  if (status !== null) parts.push(status.label);
  if (lowNeed !== null) parts.push(lowNeed);
  return { name: pip.name, rest: `· ${parts.join(" · ")}` };
}

/** Roster-wide "does anything need me" signal for one chip's ring (redesign
 * doc §2.3/§2.6): urgent wins over care, and sulking always reads urgent —
 * a sulking Pip needs you right now no matter what its needs currently
 * read (it may have just been fed and still be mid-sulk). */
export type CastAlertLevel = "urgent" | "care" | null;

export function castChipAlertLevel(pip: PipState): CastAlertLevel {
  let min = pip.needs[NEED_IDS[0] as NeedId];
  for (const id of NEED_IDS) {
    const v = pip.needs[id];
    if (v < min) min = v;
  }
  // ROUND 2H: an ailing Pip always reads urgent, whatever its needs say —
  // it is the only state in the game with a countdown on it, and a Pip who
  // has just been fed to full can still be poorly. Same shape as the
  // sulking clause it sits beside, and the same reason. `!= null` for the
  // cured-Pip reason spelled out in `statusGlyph`.
  if (min < DANGER_BELOW || isSulking(pip) || pip.ailment != null) {
    return "urgent";
  }
  if (min < WARN_BELOW) return "care";
  return null;
}

/** The cast chip's full aria-label (redesign doc §2.8 — extends the old
 * shape with the corrected status and the lowest-need clause): "Thistledown
 * — miserable, sulking, Clean is empty". `aria-pressed` (set separately)
 * still carries the selected/unselected state; this is the descriptive
 * label only. */
export function castChipAriaLabel(pip: PipState, mood: Mood, isActive: boolean): string {
  const status = statusGlyph(pip);
  const lowNeed = lowestNeedClause(pip);
  return (
    `${pip.name} — ${mood}` +
    (status !== null ? `, ${status.label}` : "") +
    (lowNeed !== null ? `, ${lowNeed}` : "") +
    (isActive ? "" : ". Select")
  );
}

// NOTE (round 2G review, scope fence — CLAUDE.md rule 3 / spec §12): a
// `satchelChips` pure helper used to live here, merging inventory and
// resources into one chip per item id for the old 14-pill satchel row. Round
// 2G cut that row; the helper was kept "in case another surface wants the
// same shape" and became a speculative implementation alive only because its
// own tests referenced it. Deleted with them. The merge rule it encoded is
// not lost — `itemsSheet.ts` owns inventory display and `buildMode.ts` owns
// resource display, each for a surface that actually renders.

export interface TopBarDeps {
  dispatch(action: GameAction): void;
  /** Open the Pip focus view for the active pip (spec §10 two views). */
  openFocus(): void;
  /** Open the loot-reveal moment (the phase4 module's modal). */
  openReveal(): void;
}

export interface TopBar {
  readonly el: HTMLElement;
  sync(state: GameState): void;
}

interface CastChipRefs {
  readonly button: HTMLButtonElement;
  readonly chipEl: HTMLElement;
  readonly moodDot: HTMLElement;
  readonly combFills: Record<NeedId, HTMLElement>;
  statusBadge: HTMLElement | null;
}

export function createTopBar(deps: TopBarDeps): TopBar {
  const el = document.createElement("div");
  el.className = "pk-hud-top";

  // --- Row A1: the cast row — roster chips + the reveal alert chip ---
  const castRow = document.createElement("div");
  castRow.className = "pk-cast-row";

  const cast = document.createElement("div");
  cast.className = "pk-cast";

  const revealChip = document.createElement("button");
  revealChip.type = "button";
  revealChip.className = "pk-reveal-chip pk-hud-alert";
  revealChip.title = "Someone brought something home!";
  revealChip.setAttribute("aria-label", "Someone brought something home — open the reveal");
  revealChip.textContent = "!";
  revealChip.addEventListener("click", () => {
    sound("ui.tap");
    deps.openReveal();
  });

  castRow.appendChild(cast);

  // --- Row A2: the who-line (active pip; tap = focus view) ---
  const whoLine = document.createElement("div");
  whoLine.className = "pk-hud-line";
  const who = document.createElement("button");
  who.type = "button";
  who.className = "pk-hud-who";
  const whoName = document.createElement("span");
  whoName.className = "pk-hud-who-name";
  const whoRest = document.createElement("span");
  whoRest.className = "pk-hud-who-rest";
  who.append(whoName, whoRest);
  who.addEventListener("click", () => {
    sound("ui.tap");
    deps.openFocus();
  });
  whoLine.appendChild(who);

  el.append(castRow, whoLine);

  // Publish the strip's own rendered height (border-box, safe-area included)
  // so celebration surfaces and toasts can clear it by MEASUREMENT rather
  // than a hardcoded guess (redesign doc §4 — the old fixed-pixel top-bar
  // offset bug). The strip is designed to be a constant 96px regardless of roster
  // size or reveal state, but this is what makes that a guarantee instead
  // of an assumption.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--pk-hud-top", `${h}px`);
    });
    ro.observe(el);
  }

  /** One selector chip's static shell — species art + comb tracks. Rebuilt
   * only when the roster's structural key changes (see `sync` below); the
   * live bits (mood, status, ring, comb fill) are updated separately on
   * every sync call. */
  const buildChip = (pip: PipState): CastChipRefs => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pk-castchip";
    button.title = pip.name;

    const chip = document.createElement("div");
    chip.className = "pk-chip";
    const blob = document.createElement("div");
    blob.className = "pk-chip-blob";
    const eyes = document.createElement("div");
    eyes.className = "pk-chip-eyes";
    eyes.append(document.createElement("i"), document.createElement("i"));
    blob.appendChild(eyes);
    const palette = resolvePipPalette(pip.speciesId, pip.genome.palette);
    blob.style.background = palette.body;
    blob.style.borderColor = palette.outline;
    chip.style.setProperty("--pk-accent", palette.accent);

    const moodDot = document.createElement("div");
    moodDot.className = "pk-mood-dot";
    chip.append(blob, moodDot);

    const comb = document.createElement("div");
    comb.className = "pk-comb";
    comb.setAttribute("aria-hidden", "true");
    const combFills = {} as Record<NeedId, HTMLElement>;
    for (const need of NEED_IDS) {
      const track = document.createElement("div");
      track.className = "pk-comb-track";
      const fill = document.createElement("div");
      fill.className = "pk-comb-fill";
      track.appendChild(fill);
      comb.appendChild(track);
      combFills[need] = fill;
    }

    button.append(chip, comb);
    button.addEventListener("click", () => {
      sound("ui.tap");
      if (button.classList.contains("pk-castchip--active")) {
        deps.openFocus();
      } else {
        deps.dispatch({ type: "SET_ACTIVE_PIP", pipId: pip.id });
      }
    });

    return { button, chipEl: chip, moodDot, combFills, statusBadge: null };
  };

  const chipRegistry = new Map<string, CastChipRefs>();
  let lastStructuralKey = "";

  return {
    el,

    sync(state: GameState): void {
      const revealCount = state.pendingReveals.length;

      cast.style.setProperty("--pk-cast-n", String(Math.max(1, state.rosterOrder.length)));

      // Rebuild key: only what a REBUILD would need to change (portrait
      // identity + roster shape). Mood/activity/needs are excluded on
      // purpose — those are live-updated below on every call, never via
      // rebuild (see module doc: rebuilding every tick would both waste
      // work and restart the comb's CSS transition every second).
      const structuralKey =
        state.rosterOrder
          .map((id) => {
            const p = state.pips[id];
            return p === undefined ? id : `${id}|${p.speciesId}|${p.genome.palette}`;
          })
          .join("~") + `~active:${state.activePipId}~reveals:${revealCount}`;

      if (structuralKey !== lastStructuralKey) {
        lastStructuralKey = structuralKey;
        cast.replaceChildren();
        chipRegistry.clear();
        for (const id of state.rosterOrder) {
          const p = state.pips[id];
          if (p === undefined) continue;
          const refs = buildChip(p);
          chipRegistry.set(id, refs);
          cast.appendChild(refs.button);
        }
        // Pinned OUTSIDE `.pk-cast`, at the row's right end — a returning
        // Pip must never reflow every other portrait (redesign doc N5).
        revealChip.remove();
        if (revealCount > 0) {
          revealChip.textContent = revealCount > 1 ? `!${revealCount}` : "!";
          castRow.appendChild(revealChip);
        }
      }

      // Live per-pip updates — every sync call, independent of the rebuild
      // above (see module doc).
      for (const id of state.rosterOrder) {
        const p = state.pips[id];
        const refs = chipRegistry.get(id);
        if (p === undefined || refs === undefined) continue;

        const isActive = id === state.activePipId;
        const mood = peekDisplayedMood(state, p);
        const status = statusGlyph(p);
        const alert = castChipAlertLevel(p);

        refs.button.classList.toggle("pk-castchip--active", isActive);
        refs.button.classList.toggle("pk-castchip--care", alert === "care");
        refs.button.classList.toggle("pk-castchip--urgent", alert === "urgent");
        refs.button.setAttribute("aria-pressed", String(isActive));
        refs.button.setAttribute("aria-label", castChipAriaLabel(p, mood, isActive));

        refs.moodDot.style.background = moodColors[mood] ?? "#999";
        refs.moodDot.title = mood;

        if (status !== null) {
          if (refs.statusBadge === null) {
            const badge = document.createElement("span");
            badge.setAttribute("aria-hidden", "true"); // named on the button
            refs.chipEl.appendChild(badge);
            refs.statusBadge = badge;
          }
          refs.statusBadge.className = `pk-chip-status pk-chip-status--${status.kind}`;
          refs.statusBadge.textContent = status.glyph;
          refs.statusBadge.title = `${p.name} is ${status.label}`;
        } else if (refs.statusBadge !== null) {
          refs.statusBadge.remove();
          refs.statusBadge = null;
        }

        for (const need of NEED_IDS) {
          const value = p.needs[need];
          const fill = refs.combFills[need];
          fill.style.height = `${Math.max(1, Math.round(value))}%`;
          fill.style.background =
            value < DANGER_BELOW
              ? needDangerColor
              : value < WARN_BELOW
                ? needWarnColor
                : (needColors[need] ?? "#999");
        }
      }

      const pip = state.pips[state.activePipId];
      if (pip === undefined) return;

      const line = buildHudWhoLine(pip);
      whoName.textContent = line.name;
      whoRest.textContent = line.rest;
      // Kept verbatim (redesign doc §2.8): `${name}, ${subtitle} — open
      // details`, riding `identitySubtitle`'s own sulking fix.
      who.setAttribute(
        "aria-label",
        `${pip.name}, ${identitySubtitle(pip)} — open details`,
      );
    },
  };
}
