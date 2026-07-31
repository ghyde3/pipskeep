/**
 * THE LOSS MOMENT + MEMORIAL (spec §16 v1.5, docs/lifecycle-bible.md §4–
 * §5, promises 3/4: "old age is peaceful", "every loss leaves a thread").
 *
 * Four surfaces, one module, because they are one story about how an
 * ending is handled:
 *
 *  1. THE LOSS MOMENT — full-screen, dignified, unhurried. Driven purely
 *     by `state.lastLossOutcome` (a reference-diff on `sync`, the same
 *     pattern every `last*Outcome` echo in this codebase uses): `"lost"`
 *     shows the eulogy (assembled from the Pip's OWN frozen history —
 *     `core/sanctuary/index.ts`'s memorial record — never the same
 *     paragraph twice), `"loyalTurn"` shows the survival beat. Neither is
 *     ever reachable except from a LIVE dispatch (`core/pips/ailment.ts`'s
 *     `resolveAilments` only ever runs inside TICK), so this surface can
 *     never greet a player who just opened the app.
 *  2. `isMourning` — the SEAM `docs/lifecycle-bible.md §9.5` asks round
 *     2G's `ui/levelUp.ts`/`ui/milestoneCelebration.ts` to defer against:
 *     nothing else may fire during the loss moment or for a few seconds
 *     after. Pure `(state, now)`, derivable from `lastLossOutcome.at`
 *     alone — see its own doc comment for the one deliberate
 *     approximation that entails.
 *  3. THE RETIREMENT-READY CARD — old age's OWN moment, contrasted on
 *     purpose (bible §4: "it must not feel like a lesser death"): warm
 *     light, "Not today" costs nothing, and the flag stays sticky so it
 *     can be reopened as many times as the player likes.
 *  4. THE LINEAGE BOARD — "Someone to find" (bible §5.3): a standing,
 *     un-nagging list of every lost Pip's unfound egg, read straight off
 *     `state.lineageEggs` (core/pips/ailment.ts's `LineageEggSeed` — a
 *     seed never expires and is removed only by being found, so this
 *     list needs no countdown, no badge, no expiry logic of its own).
 *
 * Pure controller + dumb DOM, same shape as `sanctuary.ts` (a sibling
 * module I also own, and the Long Meadow this module's residents live in).
 */

import "./lifecycle.css";
import { tuning as contentTuning } from "../content/tuning";
import { ailments as contentAilments } from "../content/ailments";
import type { AilmentId } from "../content/ailments";
import { expeditions as contentExpeditions } from "../content/expeditions";
import type { ExpeditionId } from "../content/expeditions";
import { species as contentSpecies } from "../content/species";
import type { SpeciesId } from "../content/species";
import { personalities } from "../content/personalities";
import type { PersonalityId } from "../content/personalities";
import type { PipId, PipState } from "../core/pips/types";
import type { LineageEggSeed } from "../core/pips/ailment";
import type { SanctuaryRecord } from "../core/sanctuary";
import type { Clock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import { buildPortraitEl } from "./pipdex";
import type { PortraitVisual } from "./pipdex";
import { sound } from "../app/sound";

// ---------------------------------------------------------------------------
// Numbers, spelled out (bible §4: "in words, never a clock")
// ---------------------------------------------------------------------------

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen",
] as const;
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
] as const;

/** Spells out 0–999 in words; beyond that, a warm catch-all rather than a
 * four-digit number (bible: nothing here is ever a clock or a stat). */
export function wordifyNumber(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 20) return ONES[v] as string;
  if (v < 100) {
    const tens = TENS[Math.floor(v / 10)] as string;
    const rest = v % 10;
    return rest === 0 ? tens : `${tens}-${ONES[rest]}`;
  }
  if (v < 1000) {
    const hundreds = Math.floor(v / 100);
    const rest = v % 100;
    const prefix = `${ONES[hundreds]} hundred`;
    return rest === 0 ? prefix : `${prefix} and ${wordifyNumber(rest)}`;
  }
  return "more times than she could count";
}

function plural(n: number, word: string): string {
  return `${wordifyNumber(n)} ${word}${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// isMourning — the SEAM (docs/lifecycle-bible.md §9.5)
// ---------------------------------------------------------------------------

/**
 * A generous, fixed window rather than a stateful "still on screen" flag
 * — `isMourning` must stay a PURE function of `(state, now)` to work as a
 * seam two files this module does not own can call with nothing more
 * than the store, and `lastLossOutcome` carries no "dismissed" bit (it
 * is a transient echo, the same contract every `last*Outcome` keeps).
 * 15s comfortably covers reading both beats of either moment plus the
 * bible's own "3 seconds after it closes" — long enough that a
 * fast-tapping player is still inside it when they close the card, short
 * enough that a real celebration is never blocked for long.
 */
export const MOURNING_WINDOW_MS = 15_000;

export function isMourning(
  state: Pick<GameState, "lastLossOutcome">,
  now: number,
): boolean {
  const outcome = state.lastLossOutcome;
  if (outcome == null) return false;
  if (outcome.kind !== "lost" && outcome.kind !== "loyalTurn") return false;
  return now - outcome.at < MOURNING_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Flavour tables — UI-owned, deterministic, never a new RNG stream (same
// discipline `sanctuary.ts`'s SANCTUARY_ACTIVITY_LINES already uses).
// ---------------------------------------------------------------------------

const LOSS_QUIRKS: Readonly<Record<PersonalityId, string>> = {
  lazy: "and never once hurried for anything",
  curious: "and always found something nobody else noticed",
  hardworking: "and never came home without something to show for it",
  chaotic: "and always came back with a story that didn't quite add up",
  clingy: "and always came straight back to you first",
};
const DEFAULT_LOSS_QUIRK = "and was always glad to see you";

const RETIREMENT_QUIRKS: Readonly<Record<PersonalityId, string>> = {
  lazy: "one very determined opinion about naps",
  curious: "one very determined opinion about rocks",
  hardworking: "one very determined opinion about a job well done",
  chaotic: "one very determined opinion about the fence",
  clingy: "one very determined opinion about staying close",
};
const DEFAULT_RETIREMENT_QUIRK = "one very determined opinion about something small";

/** Bible §3.6: "A title" — the scar becomes a name, carried to the
 * Album/memorial. First scar only (a Pip usually carries at most one or
 * two in a lifetime; the FIRST is the one that shaped the story). */
const SCAR_TITLES: Readonly<Record<AilmentId, string>> = {
  brambleburr: "of the Brambles",
  chillshake: "of the Drifts",
  lanternfever: "of the Grotto",
};

function speciesNameOf(speciesId: string): string {
  return (contentSpecies[speciesId as SpeciesId]?.name as string | undefined) ?? speciesId;
}

function biomeNameOf(expeditionId: string): string {
  return (
    (contentExpeditions[expeditionId as ExpeditionId]?.name as string | undefined) ?? "the wilds"
  );
}

function topBiome(mastery: Readonly<Record<string, number>> | undefined): {
  id: string;
  trips: number;
} | null {
  let best: { id: string; trips: number } | null = null;
  for (const [id, trips] of Object.entries(mastery ?? {})) {
    if (trips > 0 && (best === null || trips > best.trips)) best = { id, trips };
  }
  return best;
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

// ---------------------------------------------------------------------------
// THE LOSS MOMENT — pure model
// ---------------------------------------------------------------------------

export interface LossEulogyModel {
  readonly pipId: PipId;
  readonly name: string;
  readonly speciesName: string;
  readonly title: string | null;
  readonly portraitVisual: PortraitVisual;
  readonly bodyParagraph: string;
  readonly eggLine: string;
}

/** Assembled from the Pip's OWN frozen history (bible §4: "a eulogy
 * assembled from the player's own history") — never hand-authored, never
 * the same paragraph twice. `record` is the memorial `SanctuaryRecord`
 * `resolveAilments`'s TRUE LOSS branch just wrote. */
export function buildLossEulogy(record: SanctuaryRecord, fromExpeditionId: string): LossEulogyModel {
  const pip = record.pip;
  const days = Math.floor((pip.lifeMs ?? 0) / contentTuning.retention.dayMs);
  const best = topBiome(pip.mastery);
  const quirk = LOSS_QUIRKS[pip.personalityId as PersonalityId] ?? DEFAULT_LOSS_QUIRK;
  const daysClause = `${pip.name} was with you ${plural(days, "day")}`;
  const bodyParagraph =
    best !== null
      ? `${daysClause}, went to the ${biomeNameOf(best.id)} ${plural(best.trips, "time")}, ${quirk}.`
      : `${daysClause}, ${quirk}.`;
  const firstScar = pip.scars?.[0];
  const title = firstScar !== undefined ? (SCAR_TITLES[firstScar as AilmentId] ?? null) : null;
  return {
    pipId: pip.id,
    name: pip.name,
    speciesName: speciesNameOf(pip.speciesId),
    title,
    portraitVisual: portraitVisualOf(pip),
    bodyParagraph,
    eggLine: `Her egg is somewhere in the ${biomeNameOf(fromExpeditionId)}. Pips leave one where they were happiest.`,
  };
}

export interface LoyalTurnModel {
  readonly pipId: PipId;
  readonly name: string;
  readonly portraitVisual: PortraitVisual;
  readonly bodyParagraph: string;
}

/** The shielded save (bible §4's "Loyal Turn") — same staging as a loss,
 * opposite outcome, and it must never announce that a shield exists. */
export function buildLoyalTurnModel(pip: PipState): LoyalTurnModel {
  const ailmentName =
    (contentAilments[pip.scars?.[pip.scars.length - 1] as AilmentId | undefined ?? ("" as AilmentId)]
      ?.name as string | undefined) ?? null;
  const bodyParagraph =
    ailmentName !== null
      ? `Somewhere in the small hours the shaking stopped. She is thinner, and there's a small mark now from the ${ailmentName.toLowerCase()}, and she is absolutely fine.`
      : "Somewhere in the small hours the shaking stopped. She is thinner, and she is absolutely fine.";
  return { pipId: pip.id, name: pip.name, portraitVisual: portraitVisualOf(pip), bodyParagraph };
}

// ---------------------------------------------------------------------------
// THE RETIREMENT-READY CARD — pure model
// ---------------------------------------------------------------------------

export interface RetirementReadyModel {
  readonly pipId: PipId;
  readonly name: string;
  readonly personalityName: string;
  readonly homeBiomeName: string;
  readonly portraitVisual: PortraitVisual;
  readonly bodyParagraph: string;
}

export function buildRetirementReadyModel(pip: PipState): RetirementReadyModel {
  const totalTrips = Object.values(pip.mastery ?? {}).reduce((sum, n) => sum + n, 0);
  const days = Math.floor((pip.lifeMs ?? 0) / contentTuning.retention.dayMs);
  const best = topBiome(pip.mastery);
  const quirk = RETIREMENT_QUIRKS[pip.personalityId as PersonalityId] ?? DEFAULT_RETIREMENT_QUIRK;
  const bodyParagraph =
    totalTrips > 0
      ? `${plural(days, "day")}, ${plural(totalTrips, "trip")}, and ${quirk}.`
      : `${plural(days, "day")}, and ${quirk}.`;
  return {
    pipId: pip.id,
    name: pip.name,
    personalityName: personalities[pip.personalityId as PersonalityId]?.name ?? pip.personalityId,
    homeBiomeName: best !== null ? biomeNameOf(best.id) : "the Keep",
    portraitVisual: portraitVisualOf(pip),
    bodyParagraph,
  };
}

// ---------------------------------------------------------------------------
// THE LINEAGE BOARD — pure model (bible §5.3)
// ---------------------------------------------------------------------------

export interface LineageBoardRow {
  readonly seed: LineageEggSeed;
  readonly parentName: string;
  readonly biomeName: string;
}

export interface LineageBoardModel {
  readonly rows: readonly LineageBoardRow[];
}

export function buildLineageBoardModel(
  state: Pick<GameState, "lineageEggs">,
): LineageBoardModel {
  const seeds = state.lineageEggs ?? [];
  return {
    rows: seeds.map((seed) => ({
      seed,
      parentName: seed.name,
      biomeName: biomeNameOf(seed.expeditionId),
    })),
  };
}

/** SEAM (bible §5.3 item 3): "the send-off card for that biome carries a
 * line" — for the integrate stage to splice into `focusView.ts`'s (a
 * file this module does not own) expedition send-off copy. `null` when
 * `expeditionId` carries no unfound seed. */
export function lineageHintFor(
  seeds: readonly LineageEggSeed[] | undefined,
  expeditionId: string,
): string | null {
  const seed = (seeds ?? []).find((s) => s.expeditionId === expeditionId);
  return seed === undefined ? null : `${seed.name}'s egg is somewhere here.`;
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface MemorialViewDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  clock: Clock;
  /** SEAM: wired by the integrate stage to open the expedition picker
   * pre-set to a trail (the lineage board's "Send someone" button, bible
   * §5.3 item 2). Every other affordance in this module is
   * self-contained; this is the one that reaches into a picker owned by
   * `focusView.ts`, which this module does not edit. Optional so the
   * board still renders (minus that one tap) before the seam is wired. */
  onSendToExpedition?(expeditionId: string): void;
}

type LossStage =
  | { readonly kind: "lost"; readonly beat: 1 | 2; readonly model: LossEulogyModel }
  | { readonly kind: "loyalTurn"; readonly model: LoyalTurnModel };

export interface MemorialView {
  readonly el: HTMLElement;
  sync(state: GameState): void;
  openLineageBoard(): void;
  closeLineageBoard(): void;
  /** Reopens the retirement-ready card for a Pip at will — the auto-popup
   * already fires once on the `readyToRetire` edge transition; this is
   * for a "ready" badge tap elsewhere (bible: sticky, dismissable as many
   * times as the player likes, at no cost). */
  openRetirementReady(pipId: PipId): void;
}

export function createMemorialView(deps: MemorialViewDeps): MemorialView {
  const root = document.createElement("div");
  root.className = "pk-memorial-root";

  // --- The loss moment / Loyal Turn — full screen ---
  const lossWrap = document.createElement("div");
  lossWrap.className = "pk-loss";
  const lossPanel = document.createElement("div");
  lossPanel.className = "pk-loss-panel";
  lossWrap.appendChild(lossPanel);

  // --- The retirement-ready card ---
  const retireWrap = document.createElement("div");
  retireWrap.className = "pk-retireready-wrap";
  const retireBackdrop = document.createElement("div");
  retireBackdrop.className = "pk-retireready-backdrop";
  const retirePanel = document.createElement("div");
  retirePanel.className = "pk-retireready";
  retireWrap.append(retireBackdrop, retirePanel);

  // --- The lineage board ---
  const boardWrap = document.createElement("div");
  boardWrap.className = "pk-lineage-wrap";
  const boardBackdrop = document.createElement("div");
  boardBackdrop.className = "pk-lineage-backdrop";
  const boardPanel = document.createElement("div");
  boardPanel.className = "pk-lineage";
  boardWrap.append(boardBackdrop, boardPanel);

  root.append(lossWrap, retireWrap, boardWrap);

  let lastState: GameState | null = null;
  let lossStage: LossStage | null = null;
  let retireModel: RetirementReadyModel | null = null;
  let retireQueue: PipId[] = [];

  function closeLoss(): void {
    lossStage = null;
    lossWrap.classList.remove("pk-loss--open");
    lossPanel.replaceChildren();
    maybeShowNextRetirement();
  }

  function renderLoss(): void {
    lossPanel.replaceChildren();
    if (lossStage === null) return;

    if (lossStage.kind === "loyalTurn") {
      const model = lossStage.model;
      lossPanel.appendChild(buildPortraitEl(model.portraitVisual, "large"));
      const name = document.createElement("div");
      name.className = "pk-loss-name";
      name.textContent = `${model.name} came through it.`;
      const body = document.createElement("div");
      body.className = "pk-loss-body";
      body.textContent = model.bodyParagraph;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pk-loss-btn";
      btn.textContent = "Sit with her a while";
      btn.addEventListener("click", () => {
        sound("ui.tap");
        closeLoss();
      });
      lossPanel.append(name, body, btn);
      return;
    }

    const { beat, model } = lossStage;
    lossPanel.appendChild(buildPortraitEl(model.portraitVisual, "large"));

    if (beat === 1) {
      const name = document.createElement("div");
      name.className = "pk-loss-name";
      name.textContent = model.name;
      const sub = document.createElement("div");
      sub.className = "pk-loss-sub";
      sub.textContent = model.title !== null ? `${model.speciesName} · ${model.title}` : model.speciesName;
      const headline = document.createElement("div");
      headline.className = "pk-loss-headline";
      headline.textContent = `${model.name} didn't get better.`;
      const body = document.createElement("div");
      body.className = "pk-loss-body";
      body.textContent = model.bodyParagraph;
      const egg = document.createElement("div");
      egg.className = "pk-loss-egg";
      egg.textContent = model.eggLine;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pk-loss-btn";
      btn.textContent = "Say goodbye";
      btn.addEventListener("click", () => {
        sound("ui.tap");
        lossStage = { ...lossStage, beat: 2 } as LossStage;
        renderLoss();
      });
      lossPanel.append(name, sub, headline, body, egg, btn);
    } else {
      const stays = document.createElement("div");
      stays.className = "pk-loss-headline";
      stays.textContent = `${model.name}'s page stays in the Album. Always.`;
      const body = document.createElement("div");
      body.className = "pk-loss-body";
      body.textContent = `She's in the Long Meadow now, under the old tree, if you want to visit.`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pk-loss-btn";
      btn.textContent = "Go back to the Keep";
      btn.addEventListener("click", () => {
        sound("ui.tap");
        closeLoss();
      });
      lossPanel.append(stays, body, btn);
    }
  }

  function openLoss(stage: LossStage): void {
    lossStage = stage;
    // A dedicated "one warm two-note fall" cue (bible §4) needs its own
    // entry in `app/audio/palette.ts`, which this module does not own —
    // `"ui.sheet"` is the closest already-authored slot rather than an
    // unauthored id that would silently fall back to the default cue.
    sound("ui.sheet");
    renderLoss();
    lossWrap.classList.add("pk-loss--open");
  }

  function closeRetire(): void {
    retireModel = null;
    retireWrap.classList.remove("pk-retireready-wrap--open");
  }

  function renderRetire(): void {
    retirePanel.replaceChildren();
    const model = retireModel;
    if (model === null) return;

    retirePanel.appendChild(buildPortraitEl(model.portraitVisual, "small"));
    const name = document.createElement("div");
    name.className = "pk-retireready-name";
    name.textContent = model.name;
    const sub = document.createElement("div");
    sub.className = "pk-retireready-sub";
    sub.textContent = `${model.personalityName} · Old friend of the ${model.homeBiomeName}`;
    const headline = document.createElement("div");
    headline.className = "pk-retireready-headline";
    headline.textContent = `${model.name} has had a long life.`;
    const body = document.createElement("div");
    body.className = "pk-retireready-body";
    body.textContent = model.bodyParagraph;
    const closing = document.createElement("div");
    closing.className = "pk-retireready-body";
    closing.textContent =
      "The Long Meadow is ready whenever you both are. She'll be there to visit, and can always come home.";

    const actions = document.createElement("div");
    actions.className = "pk-retireready-actions";
    const notToday = document.createElement("button");
    notToday.type = "button";
    notToday.className = "pk-retireready-cancel";
    notToday.textContent = "Not today";
    notToday.addEventListener("click", () => {
      sound("ui.tap");
      closeRetire();
      maybeShowNextRetirement();
    });
    const walk = document.createElement("button");
    walk.type = "button";
    walk.className = "pk-retireready-send";
    walk.textContent = "Walk her over";
    walk.addEventListener("click", () => {
      sound("ui.tap");
      deps.dispatch({ type: "RETIRE_PIP", pipId: model.pipId, at: deps.clock.now() });
      closeRetire();
      maybeShowNextRetirement();
    });
    actions.append(notToday, walk);

    retirePanel.append(name, sub, headline, body, closing, actions);
  }
  retireBackdrop.addEventListener("click", () => {
    closeRetire();
    maybeShowNextRetirement();
  });

  function maybeShowNextRetirement(): void {
    if (lossStage !== null || retireModel !== null) return;
    const nextId = retireQueue.shift();
    if (nextId === undefined) return;
    const pip = deps.getState().pips[nextId];
    if (pip === undefined || pip.readyToRetire !== true) {
      maybeShowNextRetirement();
      return;
    }
    retireModel = buildRetirementReadyModel(pip);
    sound("ui.sheet");
    renderRetire();
    retireWrap.classList.add("pk-retireready-wrap--open");
  }

  function renderBoard(state: GameState): void {
    boardPanel.replaceChildren();

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pk-lineage-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => {
      sound("ui.tap");
      view.closeLineageBoard();
    });

    const header = document.createElement("div");
    header.className = "pk-lineage-header";
    const title = document.createElement("div");
    title.className = "pk-lineage-title";
    title.textContent = "Someone to find";
    const blurb = document.createElement("div");
    blurb.className = "pk-lineage-blurb";
    blurb.textContent =
      "Every Pip lost to the wild leaves an egg where they were happiest. Go back, and she'll be there the first or second time.";
    header.append(title, blurb);

    const list = document.createElement("div");
    list.className = "pk-lineage-list";
    const model = buildLineageBoardModel(state);
    if (model.rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pk-lineage-empty";
      empty.textContent = "Nobody's waiting to be found right now.";
      list.appendChild(empty);
    } else {
      for (const row of model.rows) {
        const card = document.createElement("div");
        card.className = "pk-lineage-card";
        card.appendChild(
          buildPortraitEl(
            {
              speciesId: row.seed.genome.speciesId,
              paletteId: row.seed.genome.palette,
              pattern: row.seed.genome.pattern,
              shiny: row.seed.genome.shiny,
            },
            "small",
          ),
        );
        const body = document.createElement("div");
        body.className = "pk-lineage-body";
        const line = document.createElement("div");
        line.className = "pk-lineage-line";
        line.textContent = `${row.parentName}'s egg — somewhere in the ${row.biomeName}.`;
        body.appendChild(line);
        card.appendChild(body);

        const sendBtn = document.createElement("button");
        sendBtn.type = "button";
        sendBtn.className = "pk-lineage-send";
        sendBtn.textContent = "Send someone";
        sendBtn.disabled = deps.onSendToExpedition === undefined;
        sendBtn.addEventListener("click", () => {
          sound("ui.tap");
          deps.onSendToExpedition?.(row.seed.expeditionId);
        });
        card.appendChild(sendBtn);

        list.appendChild(card);
      }
    }

    boardPanel.append(closeBtn, header, list);
  }
  boardBackdrop.addEventListener("click", () => view.closeLineageBoard());

  const view: MemorialView = {
    el: root,

    sync(state: GameState): void {
      const prev = lastState;
      lastState = state;

      if (prev !== null && state.lastLossOutcome !== prev.lastLossOutcome && state.lastLossOutcome != null) {
        const outcome = state.lastLossOutcome;
        if (outcome.kind === "lost") {
          const record = state.sanctuary.pips[outcome.pipId];
          if (record !== undefined) {
            openLoss({ kind: "lost", beat: 1, model: buildLossEulogy(record, outcome.fromExpeditionId) });
          }
        } else if (outcome.kind === "loyalTurn") {
          const pip = state.pips[outcome.pipId];
          if (pip !== undefined) {
            openLoss({ kind: "loyalTurn", model: buildLoyalTurnModel(pip) });
          }
        }
      }

      if (prev !== null) {
        for (const id of state.rosterOrder) {
          const nextPip = state.pips[id];
          const prevPip = prev.pips[id];
          if (nextPip?.readyToRetire === true && prevPip?.readyToRetire !== true) {
            if (!retireQueue.includes(id)) retireQueue.push(id);
          }
        }
      }
      maybeShowNextRetirement();

      if (boardWrap.classList.contains("pk-lineage-wrap--open") && prev !== state) {
        renderBoard(state);
      }
    },

    openLineageBoard(): void {
      const state = deps.getState();
      sound("ui.sheet");
      renderBoard(state);
      boardWrap.classList.add("pk-lineage-wrap--open");
    },
    closeLineageBoard(): void {
      boardWrap.classList.remove("pk-lineage-wrap--open");
    },

    openRetirementReady(pipId: PipId): void {
      const pip = deps.getState().pips[pipId];
      if (pip === undefined || pip.readyToRetire !== true) return; // defensive
      if (!retireQueue.includes(pipId)) retireQueue.unshift(pipId);
      else {
        retireQueue = [pipId, ...retireQueue.filter((id) => id !== pipId)];
      }
      maybeShowNextRetirement();
    },
  };

  return view;
}
