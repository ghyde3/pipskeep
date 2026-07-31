/**
 * BREEDING (spec §12 unfenced, docs/lifecycle-bible.md §6) — "warm and
 * simple; it is a hopeful screen." Pick two eligible Pips, see what a
 * pairing MIGHT pass on, produce an egg.
 *
 * THE PREVIEW IS DELIBERATELY STRUCTURAL, NEVER A ROLL. It would be
 * possible to construct an ephemeral `RngStream` from the live
 * `state.seed`/`state.rngState` and call `combineForBreeding` for a
 * "preview" — but that either spoils the exact child before the player
 * commits (if shown as the true result) or silently drifts from the real
 * roll the moment anything else touches the `lineage` stream between
 * preview and tap (a lineage find on an unrelated trip, say). Showing
 * the RANGE instead (bible: "see what a pairing MIGHT pass on") is both
 * honest and needs no RNG at all: species/personality come from a fixed
 * pair of parents, the mutation/shiny numbers are `content/tuning.ts`
 * constants, and the level share is the bible's own published formula
 * (`1 + floor((mean(levelA, levelB) − 1) × bredLevelShare)`,
 * `core/pips/breeding.ts`'s own `childLevelFromShare`, mirrored here
 * because that helper is private — `breeding.test.ts` cross-checks the
 * mirror against the real function so the two can never quietly drift).
 *
 * Eligibility reads the REAL exported `breedEligibility` (never a second
 * copy of `core/pips/breeding.ts`'s per-pip gate table): once the player
 * has picked a first Pip, every partner option is checked pairwise
 * against her, so a refusal reason shown on screen is always the exact
 * reason `BREED_PIPS` would give if tapped.
 *
 * Pure controller + dumb DOM, same shape as every sibling module.
 */

import "./lifecycle.css";
import { tuning as contentTuning } from "../content/tuning";
import { species as contentSpecies } from "../content/species";
import type { SpeciesId } from "../content/species";
import { personalities } from "../content/personalities";
import type { PersonalityId } from "../content/personalities";
import type { PipId, PipState } from "../core/pips/types";
import { pipLevel } from "../core/pips/level";
import { breedEligibility } from "../core/pips/breeding";
import type { BreedRefusalReason } from "../core/pips/breeding";
import type { Clock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import { buildPortraitEl } from "./pipdex";
import type { PortraitVisual } from "./pipdex";
import { sound } from "../app/sound";

// ---------------------------------------------------------------------------
// Pure model layer
// ---------------------------------------------------------------------------

function pct(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}

function speciesNameOf(speciesId: string): string {
  return (contentSpecies[speciesId as SpeciesId]?.name as string | undefined) ?? speciesId;
}

function personalityNameOf(personalityId: string): string {
  return personalities[personalityId as PersonalityId]?.name ?? personalityId;
}

function portraitVisualOf(pip: PipState): PortraitVisual {
  return {
    speciesId: pip.speciesId,
    paletteId: pip.evolved?.variantId ?? pip.genome.palette,
    pattern: pip.genome.pattern,
    shiny: pip.genome.shiny,
    // ROUND 2D FIX STAGE — `accessoryId` and `jitterSeed` were both
    // omitted here, so this surface drew a LESS individual Pip than every
    // other one: the same creature, minus what it was wearing and minus
    // its own proportions. `ui/sanctuary.ts` and `ui/pipdex.ts` always
    // passed them; these builders were the outliers.
    accessoryId: pip.genome.accessoryId,
    jitterSeed: pip.id,
  };
}

/** Warm, structural refusal copy (never Pip-voiced — mirrors
 * `core/pips/breeding.ts`'s own `BreedRefusalReason` doc: "the world
 * said no", exactly like `sanctuary.ts`'s `RETIRE_REFUSAL_COPY`). */
export const BREED_REFUSAL_COPY: Readonly<Record<BreedRefusalReason, string>> = {
  unknownPip: "Hmm — that Pip isn't around anymore.",
  samePip: "She can't pair with herself.",
  notAdult: "Still a Pipling — too young yet.",
  levelTooLow: "Needs a bit more growing up first.",
  ailing: "Not while she's poorly.",
  busy: "Away from the Keep right now.",
  sulking: "Having a rough week — some care first would help.",
  needsTooLow: "Wants a full round of care before she's in the mood.",
  cooldown: "Resting up from her last clutch.",
  clutchesExhausted: "Has raised all the clutches she's got in her.",
};

export interface BreedPickModel {
  readonly pipId: PipId;
  readonly name: string;
  readonly portraitVisual: PortraitVisual;
  readonly levelLabel: string;
}

function pickModelOf(pip: PipState): BreedPickModel {
  return {
    pipId: pip.id,
    name: pip.name,
    portraitVisual: portraitVisualOf(pip),
    levelLabel: `Level ${pipLevel(pip)}`,
  };
}

/** Every roster Pip, in display order — the first-pick list. */
export function buildBreedRoster(
  state: Pick<GameState, "pips" | "rosterOrder">,
): readonly BreedPickModel[] {
  return state.rosterOrder
    .map((id) => state.pips[id])
    .filter((p): p is PipState => p !== undefined)
    .map(pickModelOf);
}

export interface BreedPartnerOption {
  readonly pick: BreedPickModel;
  readonly eligible: boolean;
  readonly refusalCopy: string | null;
}

/** Every OTHER roster Pip, checked pairwise against `aId` via the real
 * `breedEligibility` — a shown refusal is always the exact one
 * `BREED_PIPS` would give. */
export function buildPartnerOptions(
  state: Pick<GameState, "pips" | "rosterOrder">,
  aId: PipId,
  now: number,
): readonly BreedPartnerOption[] {
  const options: BreedPartnerOption[] = [];
  for (const id of state.rosterOrder) {
    if (id === aId) continue;
    const pip = state.pips[id];
    if (pip === undefined) continue;
    const result = breedEligibility(state.pips, aId, id, now, contentTuning);
    options.push({
      pick: pickModelOf(pip),
      eligible: result.ok,
      refusalCopy: result.ok ? null : (BREED_REFUSAL_COPY[result.reason ?? "unknownPip"] ?? null),
    });
  }
  return options;
}

export interface BreedPreviewModel {
  /** One or two names — one when both parents share a species. */
  readonly speciesNames: readonly string[];
  readonly personalityNames: readonly string[];
  readonly mutationChancePct: number;
  readonly shinyPossible: boolean;
  readonly shinyChancePct: number;
  readonly approxLevel: number;
  readonly generation: number;
}

/** Mirrors `core/pips/breeding.ts`'s private `childLevelFromShare` —
 * see module doc for why this is a deliberate, cross-checked mirror
 * rather than an export change to a file this module does not own. */
function childLevelFromShare(base: number, share: number): number {
  return Math.max(1, 1 + Math.floor((base - 1) * share));
}

export function buildBreedPreview(a: PipState, b: PipState): BreedPreviewModel {
  const speciesNames = [...new Set([a.genome.speciesId, b.genome.speciesId])].map(speciesNameOf);
  const personalityNames = [...new Set([a.personalityId, b.personalityId])].map(personalityNameOf);
  const cfg = contentTuning.lifecycle.lineage;
  const meanLevel = (pipLevel(a) + pipLevel(b)) / 2;
  const shinyPossible = a.genome.shiny || b.genome.shiny;
  return {
    speciesNames,
    personalityNames,
    mutationChancePct: pct(contentTuning.breeding.mutationChance),
    shinyPossible,
    shinyChancePct: shinyPossible ? pct(cfg.shinyInheritChance) : 0,
    approxLevel: childLevelFromShare(meanLevel, cfg.bredLevelShare),
    generation: Math.max(a.generation ?? 1, b.generation ?? 1) + 1,
  };
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface BreedingViewDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  clock: Clock;
}

export interface BreedingView {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  sync(state: GameState): void;
}

export function createBreedingView(deps: BreedingViewDeps): BreedingView {
  const wrap = document.createElement("div");
  wrap.className = "pk-breed-wrap";
  const backdrop = document.createElement("div");
  backdrop.className = "pk-breed-backdrop";
  const panel = document.createElement("div");
  panel.className = "pk-breed";
  wrap.append(backdrop, panel);

  let isOpen = false;
  let lastState: GameState | null = null;
  let aId: PipId | null = null;
  /**
   * The chosen PARTNER, and the round's one shipped blocker when it wasn't
   * here.
   *
   * `sync(state)` re-`render()`s on every store update, and this view is
   * synced from `main.ts`'s single subscription — so it re-renders up to
   * once a SECOND, because the live ticker dispatches a TICK that often.
   * The partner used to be a local of `renderPreview(a, b)` and nothing
   * else, so the very next tick rebuilt the panel from `aId` alone and
   * threw the preview away. In the browser that made "Start a clutch"
   * unreachable: the preview appeared and vanished inside one second,
   * every time. Breeding — the whole succession mechanic this round
   * unfences — could not be used at all.
   *
   * Keeping it beside `aId` is the fix and the invariant: EVERY piece of
   * this view's navigation state must survive a re-render, because a
   * re-render can happen between any two frames without the player doing
   * anything.
   */
  let bId: PipId | null = null;
  let resultMessage: { text: string; tone: "success" | "refusal" } | null = null;

  function close(): void {
    isOpen = false;
    aId = null;
    bId = null;
    resultMessage = null;
    wrap.classList.remove("pk-breed-wrap--open");
  }
  backdrop.addEventListener("click", close);

  function render(): void {
    panel.replaceChildren();
    const state = deps.getState();

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pk-breed-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => {
      sound("ui.tap");
      close();
    });

    const header = document.createElement("div");
    header.className = "pk-breed-header";
    const title = document.createElement("div");
    title.className = "pk-breed-title";
    title.textContent = "A new clutch";
    const blurb = document.createElement("div");
    blurb.className = "pk-breed-blurb";
    blurb.textContent =
      aId === null
        ? "Pick the first Pip."
        : "Pick who she'll pair with.";
    header.append(title, blurb);
    panel.append(closeBtn, header);

    if (resultMessage !== null) {
      const msg = document.createElement("div");
      msg.className = `pk-breed-message pk-breed-message--${resultMessage.tone}`;
      msg.textContent = resultMessage.text;
      panel.appendChild(msg);
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = "pk-breed-cancel";
      ok.textContent = "Alright";
      ok.addEventListener("click", () => {
        sound("ui.tap");
        close();
      });
      panel.appendChild(ok);
      return;
    }

    if (aId === null) {
      const list = document.createElement("div");
      list.className = "pk-breed-list";
      const roster = buildBreedRoster(state);
      if (roster.length < 2) {
        const empty = document.createElement("div");
        empty.className = "pk-breed-empty";
        empty.textContent = "There's only one Pip in the Keep right now — a clutch needs two.";
        list.appendChild(empty);
      } else {
        for (const pick of roster) {
          list.appendChild(renderPickRow(pick, null, () => {
            sound("ui.tap");
            aId = pick.pipId;
            render();
          }));
        }
      }
      panel.appendChild(list);
      return;
    }

    const a = state.pips[aId];
    if (a === undefined) {
      aId = null;
      bId = null;
      render();
      return;
    }

    // A partner is already chosen: this render belongs to the preview, not
    // the picker. Routing through `render()` (rather than letting the pick
    // handler be the only way in) is what makes the preview survive the
    // per-second re-render — see `bId`'s doc comment.
    if (bId !== null) {
      const b = state.pips[bId];
      if (b !== undefined) {
        renderPreview(a, b);
        return;
      }
      bId = null; // partner left the roster mid-pick; fall back to the list
    }

    const back = document.createElement("button");
    back.type = "button";
    back.className = "pk-breed-back";
    back.textContent = `← Choose a different first Pip`;
    back.addEventListener("click", () => {
      sound("ui.tap");
      aId = null;
      bId = null;
      render();
    });
    panel.appendChild(back);

    const chosen = document.createElement("div");
    chosen.className = "pk-breed-chosen";
    chosen.appendChild(buildPortraitEl(portraitVisualOf(a), "small"));
    const chosenName = document.createElement("span");
    chosenName.textContent = a.name;
    chosen.appendChild(chosenName);
    panel.appendChild(chosen);

    const options = buildPartnerOptions(state, aId, deps.clock.now());
    const list = document.createElement("div");
    list.className = "pk-breed-list";
    if (options.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pk-breed-empty";
      empty.textContent = "Nobody else to pair her with just yet.";
      list.appendChild(empty);
    } else {
      for (const option of options) {
        list.appendChild(
          renderPickRow(option.pick, option.eligible ? null : option.refusalCopy, () => {
            if (!option.eligible) return;
            sound("ui.tap");
            const b = state.pips[option.pick.pipId];
            if (b === undefined) return;
            bId = b.id;
            render();
          }),
        );
      }
    }
    panel.appendChild(list);
  }

  function renderPickRow(
    pick: BreedPickModel,
    disabledCopy: string | null,
    onPick: () => void,
  ): HTMLElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "pk-breed-row";
    row.disabled = disabledCopy !== null;
    row.appendChild(buildPortraitEl(pick.portraitVisual, "small"));
    const body = document.createElement("div");
    body.className = "pk-breed-row-body";
    const name = document.createElement("div");
    name.className = "pk-breed-row-name";
    name.textContent = `${pick.name} · ${pick.levelLabel}`;
    body.appendChild(name);
    if (disabledCopy !== null) {
      const reason = document.createElement("div");
      reason.className = "pk-breed-row-reason";
      reason.textContent = disabledCopy;
      body.appendChild(reason);
    }
    row.appendChild(body);
    row.addEventListener("click", onPick);
    return row;
  }

  function renderPreview(a: PipState, b: PipState): void {
    panel.replaceChildren();

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pk-breed-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => {
      sound("ui.tap");
      close();
    });
    panel.appendChild(closeBtn);

    const pair = document.createElement("div");
    pair.className = "pk-breed-pair";
    pair.appendChild(buildPortraitEl(portraitVisualOf(a), "small"));
    const plus = document.createElement("span");
    plus.className = "pk-breed-plus";
    plus.textContent = "+";
    pair.appendChild(plus);
    pair.appendChild(buildPortraitEl(portraitVisualOf(b), "small"));
    panel.appendChild(pair);

    const heading = document.createElement("div");
    heading.className = "pk-breed-heading";
    heading.textContent = `${a.name} & ${b.name}`;
    panel.appendChild(heading);

    const model = buildBreedPreview(a, b);
    const lines = document.createElement("div");
    lines.className = "pk-breed-preview";
    const rows: readonly string[] = [
      `Will hatch as a ${model.speciesNames.join(" or a ")}.`,
      `Takes after ${model.personalityNames.join(" or ")} for a personality.`,
      `About a ${model.mutationChancePct}% chance of a fresh look of her own.`,
      model.shinyPossible ? `A real chance of that shine carrying over.` : `No shine in this pairing.`,
      `Starts around level ${model.approxLevel} — a head start on the line.`,
    ];
    for (const text of rows) {
      const row = document.createElement("div");
      row.className = "pk-breed-preview-row";
      row.textContent = text;
      lines.appendChild(row);
    }
    panel.appendChild(lines);

    const actions = document.createElement("div");
    actions.className = "pk-breed-actions";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "pk-breed-cancel";
    back.textContent = "Not this pair";
    back.addEventListener("click", () => {
      sound("ui.tap");
      bId = null;
      render();
    });
    const go = document.createElement("button");
    go.type = "button";
    go.className = "pk-breed-send";
    go.textContent = "Start a clutch";
    go.addEventListener("click", () => {
      sound("ui.tap");
      deps.dispatch({ type: "BREED_PIPS", aId: a.id, bId: b.id, at: deps.clock.now() });
      const outcome = deps.getState().lastBreedOutcome;
      if (outcome?.ok === true && outcome.aId === a.id && outcome.bId === b.id) {
        resultMessage = { text: "An egg is on its way — warm, and worth the wait.", tone: "success" };
      } else if (outcome?.ok === false) {
        resultMessage = {
          text: BREED_REFUSAL_COPY[outcome.reason] ?? "That didn't quite work — try again in a moment.",
          tone: "refusal",
        };
      }
      bId = null;
      render();
    });
    actions.append(back, go);
    panel.appendChild(actions);
  }

  return {
    el: wrap,
    get isOpen(): boolean {
      return isOpen;
    },
    open(): void {
      const state = deps.getState();
      lastState = state;
      isOpen = true;
      aId = null;
      bId = null;
      resultMessage = null;
      sound("ui.sheet");
      render();
      wrap.classList.add("pk-breed-wrap--open");
    },
    close,
    sync(state: GameState): void {
      const prev = lastState;
      lastState = state;
      if (isOpen && prev !== state && resultMessage === null) render();
    },
  };
}
