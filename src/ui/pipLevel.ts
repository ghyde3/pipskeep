/**
 * PER-PIP LEVEL — the Pip's own growth (spec §16 v1.5, docs/lifecycle-
 * bible.md §1). The answer to "no individual Pip matters long-term":
 * Keep XP (round 2F) stays THE bar; this is a second, smaller, per-card
 * number that reads as a biography, never a comparison between two Pips
 * (bible §1.3 — "never a stat block, never percentages on the card").
 *
 * The model layer is a thin, honest wrapper over `core/pips/level.ts` —
 * every number this file shows is read straight from there (`pipLevel`,
 * `xpForLevel`, the six channel getters); nothing is recomputed or
 * re-derived by hand, so this module can never drift from the balance
 * guard in `core/pips/level.balance.test.ts`.
 *
 * `growthLine`/`nextLevelHint` translate the six unshared channels (bible
 * §1.3 table) into short, plain-English clauses — "Steadier than most.
 * Fast on the trail." — never a number. The exact percentages live behind
 * `expand()`, the tap-to-expand detail the bible asks for.
 *
 * Pure controller + dumb DOM, same shape as every sibling `ui/` module:
 * `buildPipLevelModel` is state → data, unit-tested with no DOM;
 * `createPipLevelView` is the self-mounted sheet, opened with a Pip id.
 */

import "./lifecycle.css";
import { tuning as contentTuning } from "../content/tuning";
import type { PipId, PipState } from "../core/pips/types";
import {
  contractReductionFor,
  countdownExtendMultiplierFor,
  cureBonusFor,
  expeditionSpeedMultiplierFor,
  lifespanBonusFor,
  pipLevel,
  pipXpAmount,
  seasoningFor,
  xpForLevel,
} from "../core/pips/level";
import type { GameState } from "../core/state";
import { buildPortraitEl } from "./pipdex";
import type { PortraitVisual } from "./pipdex";
import { sound } from "../app/sound";

// ---------------------------------------------------------------------------
// Pure model layer
// ---------------------------------------------------------------------------

/** The slice of `PipState` every function below reads — a Pip's own
 * level/XP plus everything a channel getter or a portrait needs. */
export type LeveledPip = Pick<
  PipState,
  "id" | "name" | "level" | "pipXp" | "genome" | "evolved"
>;

export interface PipLevelChannels {
  /** Care-ease, bible §1.4's SHARED channel — shown here UNCLAMPED (this
   * Pip's own contribution only); the clamp against building comfort
   * happens in `core/pips/needs.ts`, not here. */
  readonly careEasePct: number;
  /** Expedition duration saved, as a percent (positive = faster). */
  readonly trailSpeedPct: number;
  /** Ailment contract-chance reduction, as a percent. */
  readonly resistancePct: number;
  /** Ailment countdown lengthened, as a percent (more time to react). */
  readonly staminaPct: number;
  /** Cure-roll bonus, as a percent. */
  readonly cureBonusPct: number;
  /** Lifespan lengthened, as a percent. */
  readonly lifespanPct: number;
}

export interface PipLevelModel {
  readonly pipId: PipId;
  readonly name: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly atMaxLevel: boolean;
  readonly xp: number;
  readonly xpIntoLevel: number;
  /** `null` at max level — there is no "next" bar to fill. */
  readonly xpForNextLevel: number | null;
  /** 0–1, always 1 at max level. */
  readonly progress: number;
  readonly growthLine: string;
  /** `null` at max level. */
  readonly nextLevelHint: string | null;
  readonly channels: PipLevelChannels;
  readonly portraitVisual: PortraitVisual;
}

function pct(fraction: number): number {
  // One decimal place — enough to show movement between levels without
  // reading like a spreadsheet (bible §1.3: "no stat block").
  return Math.round(fraction * 1000) / 10;
}

export function buildLevelChannels(pip: LeveledPip): PipLevelChannels {
  const full = pip as PipState;
  return {
    careEasePct: pct(seasoningFor(full)),
    trailSpeedPct: pct(1 - expeditionSpeedMultiplierFor(full)),
    resistancePct: pct(contractReductionFor(full)),
    staminaPct: pct(countdownExtendMultiplierFor(full) - 1),
    cureBonusPct: pct(cureBonusFor(full)),
    lifespanPct: pct(lifespanBonusFor(full)),
  };
}

/**
 * Six clauses, one per unlock level 2–10 (roughly one every level up to
 * 5, pacing out after) covering all six channels the bible's table
 * names, in the order it names them (seasoning, trail legs,
 * constitution, stamina, longevity, constitution-part-2). Cumulative —
 * `growthLine` shows the three most recently unlocked, matching the
 * bible's own worked example ("Steadier than most. Fast on the trail.
 * Hard to knock down.") in both length and register.
 */
const TRAIT_LINES: readonly { readonly level: number; readonly text: string }[] = [
  { level: 2, text: "Settling into her paws." },
  { level: 3, text: "Steadier than most." },
  { level: 4, text: "Fast on the trail." },
  { level: 5, text: "Hard to startle." },
  { level: 6, text: "Hard to knock down." },
  { level: 7, text: "Bounces back quick." },
  { level: 8, text: "Recovers well from a scare." },
  { level: 9, text: "Steady through anything." },
  { level: 10, text: "Built to last." },
];

/** The plain-English readout under the mood dot (bible §1.3). Never a
 * number, never a comparison — just what this Pip has become. */
export function growthLine(pip: LeveledPip): string {
  const level = pipLevel(pip as PipState);
  const unlocked = TRAIT_LINES.filter((t) => t.level <= level);
  if (unlocked.length === 0) return "Just getting started.";
  return unlocked
    .slice(-3)
    .map((t) => t.text)
    .join(" ");
}

/** "One more level and…" — `null` at max level. */
export function nextLevelHint(pip: LeveledPip): string | null {
  const level = pipLevel(pip as PipState);
  const next = TRAIT_LINES.find((t) => t.level > level);
  if (next === undefined) return null;
  return `Level ${next.level}: ${next.text}`;
}

function portraitVisualOf(pip: LeveledPip): PortraitVisual {
  return {
    speciesId: pip.genome.speciesId,
    paletteId: pip.evolved?.variantId ?? pip.genome.palette,
    pattern: pip.genome.pattern,
    shiny: pip.genome.shiny,
    // ROUND 2D FIX STAGE — the worn accessory and per-individual jitter,
    // omitted here exactly as in memorial/breeding/ailment.
    accessoryId: pip.genome.accessoryId,
    jitterSeed: pip.id,
  };
}

export function buildPipLevelModel(pip: LeveledPip): PipLevelModel {
  const level = pipLevel(pip as PipState);
  const xp = pipXpAmount(pip as PipState);
  const maxLevel = contentTuning.lifecycle.level.maxLevel;
  const atMaxLevel = level >= maxLevel;
  const thisLevelXp = xpForLevel(level);
  const nextLevelXp = atMaxLevel ? null : xpForLevel(level + 1);
  const xpIntoLevel = Math.max(0, xp - thisLevelXp);
  const xpForNextLevel = nextLevelXp === null ? null : Math.max(0, nextLevelXp - thisLevelXp);
  const progress =
    xpForNextLevel === null || xpForNextLevel <= 0
      ? 1
      : Math.max(0, Math.min(1, xpIntoLevel / xpForNextLevel));

  return {
    pipId: pip.id,
    name: pip.name,
    level,
    maxLevel,
    atMaxLevel,
    xp,
    xpIntoLevel,
    xpForNextLevel,
    progress,
    growthLine: growthLine(pip),
    nextLevelHint: nextLevelHint(pip),
    channels: buildLevelChannels(pip),
    portraitVisual: portraitVisualOf(pip),
  };
}

/**
 * SEAM for round 2G's `ui/topBar.ts` (docs/lifecycle-bible.md §9.5's
 * `pipStatusBadge` covers ailing/elder/ready; this is growth's own small
 * cousin) — a short chip label, pure and DOM-free, e.g. for a roster chip
 * or the focus view header. `null` at level 1 (nothing to show yet, the
 * identity level every pre-2H Pip and fresh hatch starts at).
 */
export function pipLevelChipLabel(pip: LeveledPip): string | null {
  const level = pipLevel(pip as PipState);
  return level > 1 ? `Lv ${level}` : null;
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface PipLevelViewDeps {
  getState(): GameState;
}

export interface PipLevelView {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  /** Opens the Growth sheet for one Pip. A no-op (defensive) if the id no
   * longer resolves against the LIVE roster — this sheet only ever shows
   * an active Pip's growth, never a memorial's (that is `memorial.ts`'s
   * page). */
  open(pipId: PipId): void;
  close(): void;
  sync(state: GameState): void;
}

export function createPipLevelView(deps: PipLevelViewDeps): PipLevelView {
  const wrap = document.createElement("div");
  wrap.className = "pk-growth-wrap";
  const backdrop = document.createElement("div");
  backdrop.className = "pk-growth-backdrop";
  const panel = document.createElement("div");
  panel.className = "pk-growth";
  wrap.append(backdrop, panel);

  let isOpen = false;
  let openPipId: PipId | null = null;
  let expanded = false;
  let lastState: GameState | null = null;

  function close(): void {
    isOpen = false;
    openPipId = null;
    expanded = false;
    wrap.classList.remove("pk-growth-wrap--open");
  }
  backdrop.addEventListener("click", close);

  function render(): void {
    panel.replaceChildren();
    if (openPipId === null) return;
    const state = deps.getState();
    const pip = state.pips[openPipId];
    if (pip === undefined) {
      close();
      return;
    }
    const model = buildPipLevelModel(pip);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pk-growth-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => {
      sound("ui.tap");
      close();
    });

    panel.appendChild(buildPortraitEl(model.portraitVisual, "small"));

    const name = document.createElement("div");
    name.className = "pk-growth-name";
    name.textContent = model.name;

    const levelLine = document.createElement("div");
    levelLine.className = "pk-growth-level";
    levelLine.textContent = model.atMaxLevel
      ? `Level ${model.level} — as far as levels go`
      : `Level ${model.level}`;

    const bar = document.createElement("div");
    bar.className = "pk-growth-bar";
    const fill = document.createElement("div");
    fill.className = "pk-growth-bar-fill";
    fill.style.width = `${Math.round(model.progress * 100)}%`;
    bar.appendChild(fill);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(model.progress * 100)));

    const line = document.createElement("div");
    line.className = "pk-growth-line";
    line.textContent = model.growthLine;

    panel.append(closeBtn, name, levelLine, bar, line);

    if (model.nextLevelHint !== null) {
      const hint = document.createElement("div");
      hint.className = "pk-growth-hint";
      hint.textContent = model.nextLevelHint;
      panel.appendChild(hint);
    }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pk-growth-expand";
    toggle.textContent = expanded ? "Hide the details" : "What her levels have bought";
    toggle.addEventListener("click", () => {
      sound("ui.tap");
      expanded = !expanded;
      render();
    });
    panel.appendChild(toggle);

    if (expanded) {
      const detail = document.createElement("div");
      detail.className = "pk-growth-detail";
      const rows: readonly [string, number, string][] = [
        ["Care ease", model.channels.careEasePct, "less need decay"],
        ["Trail legs", model.channels.trailSpeedPct, "shorter trips"],
        ["Constitution", model.channels.resistancePct, "less likely to fall ill"],
        ["Stamina", model.channels.staminaPct, "longer to react if she does"],
        ["Recovery", model.channels.cureBonusPct, "better odds of a cure"],
        ["Longevity", model.channels.lifespanPct, "a longer life"],
      ];
      for (const [label, value, note] of rows) {
        const row = document.createElement("div");
        row.className = "pk-growth-detail-row";
        const tag = document.createElement("span");
        tag.className = "pk-growth-detail-label";
        tag.textContent = label;
        const val = document.createElement("span");
        val.className = "pk-growth-detail-value";
        val.textContent = value > 0 ? `+${value}% ${note}` : "—";
        row.append(tag, val);
        detail.appendChild(row);
      }
      panel.appendChild(detail);
    }
  }

  return {
    el: wrap,
    get isOpen(): boolean {
      return isOpen;
    },
    open(pipId: PipId): void {
      const state = deps.getState();
      lastState = state;
      if (state.pips[pipId] === undefined) return; // defensive
      openPipId = pipId;
      isOpen = true;
      expanded = false;
      sound("ui.sheet");
      render();
      wrap.classList.add("pk-growth-wrap--open");
    },
    close,
    sync(state: GameState): void {
      const prev = lastState;
      lastState = state;
      if (isOpen && prev !== state) render();
    },
  };
}
