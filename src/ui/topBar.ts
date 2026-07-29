/**
 * Persistent top bar (spec §10): active Pip portrait chip with mood dot,
 * four live need bars, resource counts. Pure read-side DOM: `sync(state)`
 * rebuilds cheap bits and mutates bar widths (CSS transitions smooth
 * them); it dispatches nothing.
 *
 * The mood dot colors by the DISPLAYED mood — Chaotic's §4.3 one-step-off
 * quirk routes through core `displayedMood`. The peek below restores the
 * rng from state and DISCARDS the advanced cursor: pure read, cursor
 * unchanged, so the same state always shows the same dot (spec §2 rule 3
 * — only actions may advance gameplay streams).
 */

import type { GameState } from "../core/state";
import type { PipState } from "../core/pips/types";
import { NEED_IDS } from "../core/pips/types";
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

interface NeedBarEls {
  fill: HTMLElement;
  value: HTMLElement;
}

export interface TopBar {
  readonly el: HTMLElement;
  sync(state: GameState): void;
}

export function createTopBar(): TopBar {
  const el = document.createElement("div");
  el.className = "pk-topbar";

  // Portrait chip: CSS blob + eyes + mood dot.
  const chip = document.createElement("div");
  chip.className = "pk-chip";
  const blob = document.createElement("div");
  blob.className = "pk-chip-blob";
  const eyes = document.createElement("div");
  eyes.className = "pk-chip-eyes";
  eyes.append(
    Object.assign(document.createElement("i")),
    Object.assign(document.createElement("i")),
  );
  blob.appendChild(eyes);
  const moodDot = document.createElement("div");
  moodDot.className = "pk-mood-dot";
  chip.append(blob, moodDot);

  const who = document.createElement("div");
  who.className = "pk-who";
  const nameEl = document.createElement("div");
  nameEl.className = "pk-who-name";
  const subEl = document.createElement("div");
  subEl.className = "pk-who-sub";
  who.append(nameEl, subEl);

  const identity = document.createElement("div");
  identity.className = "pk-identity";
  identity.append(chip, who);

  // Need bars.
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

  // Resource / satchel counts.
  const resources = document.createElement("div");
  resources.className = "pk-resources";

  el.append(identity, bars, resources);

  let lastChipKey = "";

  return {
    el,

    sync(state: GameState): void {
      const pip = state.pips[state.activePipId];
      if (pip === undefined) return;

      // Portrait colors only change with genome/species — cache by key.
      const chipKey = `${pip.speciesId}|${pip.genome.palette}`;
      if (chipKey !== lastChipKey) {
        lastChipKey = chipKey;
        const chipPalette = resolvePipPalette(pip.speciesId, pip.genome.palette);
        blob.style.background = chipPalette.body;
        blob.style.borderColor = chipPalette.outline;
        chip.style.setProperty("--pk-accent", chipPalette.accent);
      }
      nameEl.textContent = pip.name;
      const personality =
        personalities[pip.personalityId as PersonalityId]?.name ??
        pip.personalityId;
      subEl.textContent = personality;

      const mood = peekDisplayedMood(state, pip);
      moodDot.style.background = moodColors[mood] ?? "#999";
      moodDot.title = mood;

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
