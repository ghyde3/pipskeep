/**
 * Persistent top bar (spec §10): the ACTIVE PIP SELECTOR — one portrait
 * chip per roster pip (mood dot + tiny status glyph while away/resting/
 * sulking), the four need bars for the SELECTED pip, and resource counts.
 * Away pips stay selectable and their bars stay visible: needs keep
 * decaying while they're out (spec §4.5), and the player deserves to see
 * the damage accumulate in real time.
 *
 * Tap behavior: a chip tap selects that pip (SET_ACTIVE_PIP); tapping the
 * ALREADY-active chip — or the identity row — opens the Pip focus view
 * (spec §10 two views). A bouncing "!" chip appears while pendingReveals
 * is non-empty; tapping it opens the loot-reveal moment.
 *
 * Dumb DOM otherwise: `sync(state)` rebuilds cheap bits and mutates bar
 * widths (CSS transitions smooth them). The mood dot colors by the
 * DISPLAYED mood — Chaotic's §4.3 one-step-off quirk routes through core
 * `displayedMood`. The peek below restores the rng from state and
 * DISCARDS the advanced cursor: pure read, cursor unchanged, so the same
 * state always shows the same dot (spec §2 rule 3 — only actions may
 * advance gameplay streams).
 */

import type { GameAction, GameState } from "../core/state";
import type { PipState } from "../core/pips/types";
import { NEED_IDS, PipActivity } from "../core/pips/types";
import type { NeedId } from "../core/pips/types";
import type { Mood } from "../core/pips/mood";
import { MOOD_DISPLAY_STREAM, displayedMood } from "../core/pips/dialogue";
import { createRngFromState } from "../core/rng";
import {
  moodColors,
  needColors,
  needDangerColor,
  needWarnColor,
  resolvePipPalette,
} from "../content/palette";
import { foods } from "../content/foods";
import { personalities } from "../content/personalities";
import type { PersonalityId } from "../content/personalities";
import { sound } from "../app/sound";

/** Bar color-shift thresholds (task spec: < 40 warn, < 15 danger). */
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

/** Tiny selector-chip status badge (spec §10). Pure — unit-testable. */
export interface StatusGlyph {
  readonly glyph: string;
  /** Warm hover/readout label; also the identity row's status text. */
  readonly label: string;
}

/** Status glyph for a chip, or null when the pip is just around (Idle
 * needs no badge — a present, unbusy pip speaks for itself). A working
 * pip wears the tiny basket (spec §6.2 — the Gathering job at a glance). */
export function statusGlyph(activity: PipActivity): StatusGlyph | null {
  switch (activity) {
    case PipActivity.OnExpedition:
      return { glyph: "»", label: "off exploring" };
    case PipActivity.Returning:
      return { glyph: "!", label: "back with treasure" };
    case PipActivity.Resting:
      return { glyph: "z", label: "snoozing" };
    case PipActivity.Sulking:
      return { glyph: "…", label: "sulking" };
    case PipActivity.AssignedJob:
      return { glyph: "🧺", label: "gathering away" };
    default:
      return null;
  }
}

/** Identity-row subtitle: personality, plus the status when notable.
 * Pure — unit-testable. */
export function identitySubtitle(pip: PipState): string {
  const personality =
    personalities[pip.personalityId as PersonalityId]?.name ?? pip.personalityId;
  const status = statusGlyph(pip.activity);
  return status === null ? personality : `${personality} — ${status.label}`;
}

interface NeedBarEls {
  fill: HTMLElement;
  value: HTMLElement;
}

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

export function createTopBar(deps: TopBarDeps): TopBar {
  const el = document.createElement("div");
  el.className = "pk-topbar";

  // --- Selector row: one chip per roster pip + the "!" reveal chip ---
  const selector = document.createElement("div");
  selector.className = "pk-selector";

  const revealChip = document.createElement("button");
  revealChip.type = "button";
  revealChip.className = "pk-reveal-chip";
  revealChip.title = "Someone brought something home!";
  revealChip.textContent = "!";
  revealChip.addEventListener("click", () => {
    sound("ui.tap");
    deps.openReveal();
  });

  // --- Identity row for the ACTIVE pip (tap = focus view) ---
  const identity = document.createElement("button");
  identity.type = "button";
  identity.className = "pk-identity";
  const who = document.createElement("div");
  who.className = "pk-who";
  const nameEl = document.createElement("div");
  nameEl.className = "pk-who-name";
  const subEl = document.createElement("div");
  subEl.className = "pk-who-sub";
  who.append(nameEl, subEl);
  const infoBadge = document.createElement("span");
  infoBadge.className = "pk-info-badge";
  infoBadge.textContent = "i";
  identity.append(who, infoBadge);
  identity.addEventListener("click", () => {
    sound("ui.tap");
    deps.openFocus();
  });

  // --- Need bars (always the ACTIVE pip's — away or not) ---
  const bars = document.createElement("div");
  bars.className = "pk-needs";
  const barEls = {} as Record<NeedId, NeedBarEls>;
  for (const need of NEED_IDS) {
    const row = document.createElement("div");
    row.className = "pk-need";
    const label = document.createElement("span");
    label.className = "pk-need-label";
    label.textContent = NEED_LABELS[need];
    const track = document.createElement("div");
    track.className = "pk-need-track";
    const fill = document.createElement("div");
    fill.className = "pk-need-fill";
    fill.style.background = needColors[need] ?? "#999";
    track.appendChild(fill);
    const value = document.createElement("span");
    value.className = "pk-need-value";
    row.append(label, track, value);
    bars.appendChild(row);
    barEls[need] = { fill, value };
  }

  // --- Resource / satchel counts ---
  const resources = document.createElement("div");
  resources.className = "pk-resources";

  el.append(selector, identity, bars, resources);

  /** One selector chip. Rebuilt only when the roster key changes. */
  const buildChip = (state: GameState, pip: PipState): HTMLElement => {
    const isActive = pip.id === state.activePipId;
    const button = document.createElement("button");
    button.type = "button";
    button.className = isActive ? "pk-chipbtn pk-chipbtn--active" : "pk-chipbtn";
    button.title = pip.name;
    button.setAttribute("aria-pressed", String(isActive));

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
    const mood = peekDisplayedMood(state, pip);
    moodDot.style.background = moodColors[mood] ?? "#999";
    moodDot.title = mood;
    chip.append(blob, moodDot);

    const status = statusGlyph(pip.activity);
    if (status !== null) {
      const badge = document.createElement("span");
      badge.className = `pk-chip-status pk-chip-status--${pip.activity}`;
      badge.textContent = status.glyph;
      badge.title = `${pip.name} is ${status.label}`;
      chip.appendChild(badge);
    }

    button.appendChild(chip);
    button.addEventListener("click", () => {
      sound("ui.tap");
      if (isActive) {
        deps.openFocus();
      } else {
        deps.dispatch({ type: "SET_ACTIVE_PIP", pipId: pip.id });
      }
    });
    return button;
  };

  let lastSelectorKey = "";

  return {
    el,

    sync(state: GameState): void {
      // Selector rebuild key: everything a chip renders. Cheap string —
      // rebuilding ≤5 chips only when something visible changed.
      const revealCount = state.pendingReveals.length;
      const selectorKey =
        state.rosterOrder
          .map((id) => {
            const p = state.pips[id];
            if (p === undefined) return id;
            return [
              id,
              p.speciesId,
              p.genome.palette,
              p.activity,
              peekDisplayedMood(state, p),
              id === state.activePipId ? "on" : "off",
            ].join("|");
          })
          .join("~") + `~reveals:${revealCount}`;
      if (selectorKey !== lastSelectorKey) {
        lastSelectorKey = selectorKey;
        selector.replaceChildren();
        for (const id of state.rosterOrder) {
          const p = state.pips[id];
          if (p !== undefined) selector.appendChild(buildChip(state, p));
        }
        if (revealCount > 0) {
          revealChip.textContent = revealCount > 1 ? `!${revealCount}` : "!";
          selector.appendChild(revealChip);
        }
      }

      const pip = state.pips[state.activePipId];
      if (pip === undefined) return;

      nameEl.textContent = pip.name;
      subEl.textContent = identitySubtitle(pip);

      for (const need of NEED_IDS) {
        const els = barEls[need];
        const value = pip.needs[need];
        els.fill.style.width = `${Math.round(value)}%`;
        els.fill.style.background =
          value < DANGER_BELOW
            ? needDangerColor
            : value < WARN_BELOW
              ? needWarnColor
              : (needColors[need] ?? "#999");
        els.value.textContent = `${Math.round(value)}`;
      }

      // Satchel chips: foods in inventory first, then loot resources.
      resources.replaceChildren();
      const entries: [string, number][] = [
        ...Object.entries(state.inventory),
        ...Object.entries(state.resources),
      ];
      for (const [id, count] of entries) {
        if (count <= 0) continue;
        const chipEl = document.createElement("span");
        chipEl.className = "pk-resource";
        const name = foods[id as keyof typeof foods]?.name ?? id;
        chipEl.textContent = `${name} ×${count}`;
        resources.appendChild(chipEl);
      }
    },
  };
}
