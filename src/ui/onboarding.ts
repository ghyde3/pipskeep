/**
 * Onboarding (spec §10 "≤ 60 seconds, skippable"; §10.1 THE acceptance
 * bar; §7.1 starter sources): the new-game ceremony and the guided
 * first-90-seconds beats.
 *
 * Flow:
 *  1. Title card ("PipsKeep", tap anywhere) → three starter Pips bounce
 *     in — SAME species, DISTINCT palettes + personalities, rolled
 *     deterministically by core's rollStarterCandidates from the save's
 *     seed — each with a one-line personality intro. The player taps
 *     one; the other two wave goodbye cheerfully and amble off (spec:
 *     "they're fine" — the copy radiates it). The pick is NOT skippable:
 *     a save cannot exist without a Pip, so Skip only appears after it.
 *  2. Guided beats, tracked in state.onboarding (save v4): "feed" — a
 *     soft highlight on the Feed button; when the feed lands (the
 *     existing juicy animation chain plays untouched — this module only
 *     watches the outcome), advance to "explore" — nudge the focus view
 *     and the Meadow send; when the send lands, "done" + a last toast.
 *  3. A quiet Skip in the corner of every guided beat jumps straight to
 *     free play (onboarding.completed = true).
 *
 * Existing saves migrated to v4 arrive with onboarding.completed = true
 * and bypass all of this; a mid-onboarding reload resumes at its step.
 *
 * Split for node testability (the repo's UI pattern): the starter-card
 * models, cue derivation, step progression, and skip semantics are PURE
 * (state in, data out — onboarding.test.ts); runStarterPick and
 * initOnboarding are dumb DOM shells that render the pure models and
 * dispatch actions.
 */

import "./onboarding.css";
import type { Store } from "../core/store";
import type { GameAction, GameState, OnboardingState } from "../core/state";
import type { TraitGenome } from "../core/pips/types";
import { personalities } from "../content/personalities";
import type { PersonalityId } from "../content/personalities";
import { species } from "../content/species";
import { rollStarterNames } from "../core/state";
import { sound } from "../app/sound";
import { personalityBlurb } from "./focusView";
import { buildPortraitEl } from "./pipdex";
import { notify } from "./notify";

// ---------------------------------------------------------------------------
// Copy (spec §15.5 tone: warm, mischievous, opinionated). Exported so
// tests pin the spec-mandated prompts verbatim.
// ---------------------------------------------------------------------------

export const TITLE_TAGLINE = "tap anywhere to begin";
export const PICK_HEADING = "Three little Pips want to move in.";
export const PICK_SUB =
  "Pick your first friend — the other two have plans of their own. Big ones.";
/** Spec §10.1.1: the others wave goodbye, and they're FINE. */
export const GOODBYE_LINE =
  "The other two wave cheerfully and amble off to adventures of their own. They're fine. They're always fine.";
/** Spec §10.1.3 prompt, verbatim. */
export const FEED_PROMPT = "Pips get hungry! Try feeding them.";
/** Spec §10.1.4 prompt, verbatim. */
export const EXPLORE_PROMPT = "Pips love exploring.";
export const EXPLORE_HINT = "Tap your Pip up top, then send them to the Meadow.";
/** The free-play send-off (the Meadow is a 5-minute trot). */
export const FREE_PLAY_TOAST = "See you in five minutes!";
export const SKIP_LABEL = "Skip";

/** The chosen Pip's landing line (spec §10.1.2 "says a line"), in its
 * personality's voice. */
export const ONBOARDING_GREETINGS: Readonly<Record<string, string>> = {
  lazy: "You picked the comfy one. Excellent taste. Nap at eleven.",
  curious: "A whole Keep to sniff! Where do we start? Everywhere. Good.",
  hardworking: "Right then — home. Let's make it magnificent.",
  chaotic: "I live here now! The moss voted for me. Unanimously.",
  clingy: "You picked me! Officially best friends. No take-backs.",
};

const GREETING_FALLBACK = "Home! It smells like adventure and snacks.";

/** Landing line for a personality id — never empty, never crashes. */
export function starterGreeting(personalityId: string): string {
  return ONBOARDING_GREETINGS[personalityId] ?? GREETING_FALLBACK;
}

// ---------------------------------------------------------------------------
// Pure: starter cards, cue derivation, step progression, skip
// ---------------------------------------------------------------------------

/**
 * ROUND 2D item 1 — the three names the starter trio will actually
 * answer to, index-aligned with `rollStarterCandidates(seed)`.
 *
 * These are not guesses or a separate roll: `core/state.ts`'s
 * `rollStarterNames` IS the draw `createNewGame` makes (three rolls from
 * `NAME_STREAM`, before and independent of which candidate wins — see
 * that function's cursor contract), so the name on the card the player
 * taps is the name the Pip is created with.
 *
 * The fix stage exists because the first pass showed ONE name on all
 * three cards, which rendered as "Bracken / Bracken / Bracken" — the
 * round's own "Mosspip / Mosspip / Mosspip" complaint, on the very first
 * screen of the game.
 */
export function previewStarterNames(seed: number): readonly string[] {
  return rollStarterNames(seed);
}

/** Everything one starter card renders (view model over a genome). */
export interface StarterCardModel {
  readonly index: number;
  readonly genome: TraitGenome;
  /** The name THIS Pip will answer to (see `previewStarterNames` above) —
   * distinct per card, and the primary label now that round 2D demotes
   * species to a subtitle. Empty string when the caller has no preview
   * for this index (defensive default; every real caller has three). */
  readonly name: string;
  readonly speciesName: string;
  readonly personalityName: string;
  /** One-line personality intro, drawn from the focus-view blurbs. */
  readonly intro: string;
}

/** View models for the trio (pure; content lookups fall back softly).
 * `names` is index-aligned with `candidates`. */
export function buildStarterCards(
  candidates: readonly TraitGenome[],
  names: readonly string[] = [],
): readonly StarterCardModel[] {
  return candidates.map((genome, index) => ({
    index,
    genome,
    name: names[index] ?? "",
    speciesName: species[genome.speciesId]?.name ?? genome.speciesId,
    personalityName:
      personalities[genome.personalityId as PersonalityId]?.name ??
      genome.personalityId,
    intro: personalityBlurb(genome.personalityId),
  }));
}

/** One guided beat's on-screen ask. */
export interface OnboardingCue {
  readonly step: "feed" | "explore";
  readonly message: string;
  /** Secondary line under the message; null when the message is enough. */
  readonly hint: string | null;
}

/** The cue for a state, or null when onboarding is over (existing-save
 * bypass: migrated saves are completed, so this is null forever). */
export function onboardingCue(
  state: Readonly<{ onboarding: OnboardingState }>,
): OnboardingCue | null {
  const { completed, step } = state.onboarding;
  if (completed) return null;
  if (step === "feed") return { step, message: FEED_PROMPT, hint: null };
  if (step === "explore") {
    return { step, message: EXPLORE_PROMPT, hint: EXPLORE_HINT };
  }
  return null;
}

/** What one state transition means for onboarding: the advance to
 * dispatch plus an optional toast, or null. */
export interface OnboardingProgress {
  readonly action: GameAction;
  readonly toast: string | null;
}

/**
 * Diff one state transition into the next onboarding advance (pure):
 * - step "feed": a FRESH, APPLIED feed outcome advances to "explore"
 *   (refusals and other care actions don't — the ask stays up);
 * - step "explore": a FRESH, successful expedition send advances to
 *   "done" and earns the free-play toast (spec §10.1.5).
 * Completed states never progress (existing-save bypass).
 */
export function deriveOnboardingProgress(
  prev: GameState,
  next: GameState,
): OnboardingProgress | null {
  const { completed, step } = next.onboarding;
  if (completed) return null;

  if (step === "feed") {
    const outcome = next.lastCareOutcome;
    if (
      outcome !== prev.lastCareOutcome &&
      outcome !== null &&
      outcome.action === "feed" &&
      outcome.applied
    ) {
      return {
        action: { type: "ONBOARDING_ADVANCE", step: "explore" },
        toast: null,
      };
    }
    return null;
  }

  if (step === "explore") {
    const outcome = next.lastAssignOutcome;
    if (outcome !== prev.lastAssignOutcome && outcome?.ok === true) {
      return {
        action: { type: "ONBOARDING_ADVANCE", step: "done" },
        toast: FREE_PLAY_TOAST,
      };
    }
  }
  return null;
}

/** Skip = jump straight to free play (spec §10). The reducer's forward-
 * only rule makes this a harmless no-op once already done. */
export function skipOnboarding(): GameAction {
  return { type: "ONBOARDING_ADVANCE", step: "done" };
}

// ---------------------------------------------------------------------------
// DOM: the new-game ceremony (title card → trio → pick → goodbyes)
// ---------------------------------------------------------------------------

/**
 * A little DOM Pip for one starter card.
 *
 * ROUND 2D item 2, FIX STAGE — this is now `ui/pipdex.ts`'s
 * `buildPortraitEl`, the SAME builder the Album, the Long Meadow, the
 * Nursery and the cast strip use, rather than a fourth hand-rolled blob.
 *
 * The first pass made the trio three different SPECIES in the data and in
 * the subtitle, but `.pk-onboard-blob` was a hard-coded 74×64 rounded box
 * with one border-radius and no per-species override — so the round's
 * headline decision ("the first choice a player makes is a real one")
 * reached the player as three colours of one shape. `buildPortraitEl`
 * honours the species silhouette (`--pk-wfrac`/`--pk-hfrac`), the pattern
 * overlay, the worn accessory, the shiny sheen and the per-individual
 * jitter automatically, for every species that will ever exist — and
 * every future fix to any of those lands here for free instead of being
 * forgotten on a fourth surface (the exact divergence round 2E shipped).
 */
function buildStarterPortrait(genome: TraitGenome, jitterSeed: string): HTMLElement {
  return buildPortraitEl(
    {
      speciesId: genome.speciesId,
      paletteId: genome.palette,
      pattern: genome.pattern,
      shiny: genome.shiny,
      accessoryId: genome.accessoryId,
      jitterSeed,
    },
    "small",
  );
}

export interface StarterPickDeps {
  readonly mount: HTMLElement;
  /** The trio from core's rollStarterCandidates(seed). */
  readonly candidates: readonly TraitGenome[];
  /** ROUND 2D item 1 — `previewStarterNames(seed)`: the three names the
   * candidates will actually receive, index-aligned with `candidates`. */
  readonly previewNames: readonly string[];
}

/**
 * The new-game ceremony (spec §10.1.1). Resolves with the chosen
 * candidate index the moment the player picks — boot continues UNDER
 * the overlay while the goodbyes play, so the chosen Pip is already
 * landing in the Keep (arrival wiggle and all) as the curtain lifts.
 */
export function runStarterPick(deps: StarterPickDeps): Promise<number> {
  return new Promise((resolve) => {
    const cards = buildStarterCards(deps.candidates, deps.previewNames);

    const overlay = document.createElement("div");
    overlay.className = "pk-onboard";

    // --- Stage 1: title card ---
    const title = document.createElement("div");
    title.className = "pk-onboard-title";
    // Keyboard/AT path into a new game: the title card is a real button.
    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");
    title.setAttribute("aria-label", "Begin PipsKeep");
    title.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        showPick();
      }
    });
    const wordmark = document.createElement("div");
    wordmark.className = "pk-onboard-wordmark";
    wordmark.textContent = "PipsKeep";
    const tagline = document.createElement("div");
    tagline.className = "pk-onboard-tagline";
    tagline.textContent = TITLE_TAGLINE;
    title.append(wordmark, tagline);
    overlay.appendChild(title);

    let stage: "title" | "pick" | "chosen" = "title";

    // --- Stage 2: the trio bounces in ---
    const showPick = (): void => {
      if (stage !== "title") return;
      stage = "pick";
      sound("ui.tap");
      title.remove();

      const pick = document.createElement("div");
      pick.className = "pk-onboard-pick";
      const heading = document.createElement("div");
      heading.className = "pk-onboard-heading";
      heading.textContent = PICK_HEADING;
      const sub = document.createElement("div");
      sub.className = "pk-onboard-sub";
      sub.textContent = PICK_SUB;
      const row = document.createElement("div");
      row.className = "pk-onboard-cards";
      const goodbye = document.createElement("div");
      goodbye.className = "pk-onboard-goodbye";
      goodbye.textContent = GOODBYE_LINE;

      const cardEls: HTMLButtonElement[] = [];
      for (const card of cards) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pk-onboard-card";
        btn.style.animationDelay = `${160 + card.index * 150}ms`;
        // Jitter seed: the candidate's OWN slot, so the three portraits
        // are never pixel-identical even if two ever shared a genome.
        btn.appendChild(buildStarterPortrait(card.genome, `starter-${card.index}`));
        // ROUND 2D item 1 — the name leads (species drops to a subtitle,
        // same demotion as everywhere else in the round): whichever card
        // gets tapped, `card.name` is who this Pip actually becomes.
        const name = document.createElement("span");
        name.className = "pk-onboard-card-name";
        name.textContent = card.name;
        const kind = document.createElement("span");
        kind.className = "pk-onboard-card-kind";
        kind.textContent = `${card.speciesName} · ${card.personalityName}`;
        const intro = document.createElement("span");
        intro.className = "pk-onboard-card-intro";
        intro.textContent = card.intro;
        btn.append(name, kind, intro);
        btn.addEventListener("click", () => choose(card.index));
        cardEls.push(btn);
        row.appendChild(btn);
      }

      // --- Stage 3: pick → goodbyes → curtain up ---
      const choose = (index: number): void => {
        if (stage !== "pick") return;
        stage = "chosen";
        sound("ui.confirm");
        cardEls.forEach((el, i) => {
          el.disabled = true;
          if (i === index) {
            el.classList.add("pk-onboard-card--chosen");
          } else {
            // Wave, then amble off toward the nearest wing (they're fine).
            el.classList.add(
              "pk-onboard-card--bye",
              i < index
                ? "pk-onboard-card--bye-left"
                : "pk-onboard-card--bye-right",
            );
          }
        });
        sub.textContent = "";
        pick.appendChild(goodbye);
        // Boot continues under the overlay from this moment.
        resolve(index);
        window.setTimeout(() => overlay.classList.add("pk-onboard--out"), 1900);
        window.setTimeout(() => overlay.remove(), 2600);
      };

      pick.append(heading, sub, row);
      overlay.appendChild(pick);
    };

    overlay.addEventListener("click", showPick);
    deps.mount.appendChild(overlay);
  });
}

// ---------------------------------------------------------------------------
// DOM: the guided beats (cue banner, soft highlights, quiet Skip)
// ---------------------------------------------------------------------------

export interface OnboardingDeps {
  readonly mount: HTMLElement;
  readonly store: Store<GameState, GameAction>;
  /** Speak a line above the active Pip (the shared UI speech bubble). */
  say(line: string): void;
  /** True when THIS boot just ran the starter pick (fresh save): the
   * chosen Pip lands, wiggles (scene arrival), and says its line. A
   * resumed mid-onboarding save skips the landing moment. */
  readonly freshPick: boolean;
}

/** How long after a fresh pick the landing line and the first cue wait
 * (the curtain is still lifting; the wiggle deserves its beat). */
const GREETING_DELAY_MS = 2300;
const FIRST_CUE_DELAY_MS = 3400;
/** The completion toast trails the "trotted off" toast by a beat. */
const FREE_PLAY_TOAST_DELAY_MS = 900;

/**
 * Mount the guided beats. A completed onboarding (every migrated save)
 * mounts NOTHING — one early return is the whole bypass.
 */
export function initOnboarding(deps: OnboardingDeps): void {
  const initial = deps.store.getState();
  if (initial.onboarding.completed) return;

  // Cue banner + quiet Skip. Highlights ride a body data attribute
  // (onboarding.css) so per-TICK rebuilds of the highlighted controls
  // can never wash them off.
  const guide = document.createElement("div");
  guide.className = "pk-onboard-guide";
  const cueEl = document.createElement("div");
  cueEl.className = "pk-onboard-cue";
  const messageEl = document.createElement("div");
  messageEl.className = "pk-onboard-cue-msg";
  const hintEl = document.createElement("div");
  hintEl.className = "pk-onboard-cue-hint";
  cueEl.append(messageEl, hintEl);
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "pk-onboard-skip";
  skip.textContent = SKIP_LABEL;
  skip.addEventListener("click", () => {
    sound("ui.tap");
    deps.store.dispatch(skipOnboarding());
  });
  guide.append(cueEl, skip);
  deps.mount.appendChild(guide);

  let done = false;
  const teardown = (): void => {
    if (done) return;
    done = true;
    delete document.body.dataset["pkOnboard"];
    guide.remove();
    unsubscribe();
  };

  const applyCue = (state: GameState): void => {
    const cue = onboardingCue(state);
    if (cue === null) {
      teardown();
      return;
    }
    document.body.dataset["pkOnboard"] = cue.step;
    messageEl.textContent = cue.message;
    hintEl.textContent = cue.hint ?? "";
    hintEl.style.display = cue.hint === null ? "none" : "";
  };

  let prev = initial;
  const unsubscribe = deps.store.subscribe((state) => {
    if (done) return;
    const before = prev;
    prev = state; // update FIRST — the dispatch below re-enters here
    const progress = deriveOnboardingProgress(before, state);
    applyCue(state);
    if (progress !== null) {
      deps.store.dispatch(progress.action);
      if (progress.toast !== null) {
        const message = progress.toast;
        window.setTimeout(() => {
          notify({ kind: "info", message });
        }, FREE_PLAY_TOAST_DELAY_MS);
      }
    }
  });

  // Landing moment (spec §10.1.2): the scene's arrival animation is the
  // happy wiggle; the line goes through the shared speech bubble.
  if (deps.freshPick) {
    window.setTimeout(() => {
      const state = deps.store.getState();
      const pip = state.pips[state.activePipId];
      if (pip !== undefined && !state.onboarding.completed) {
        deps.say(starterGreeting(pip.personalityId));
      }
    }, GREETING_DELAY_MS);
  }

  // First cue: instantly on a resumed save, after the landing beat on a
  // fresh pick.
  applyCue(initial);
  window.setTimeout(
    () => {
      if (!done) guide.classList.add("pk-onboard-guide--in");
    },
    deps.freshPick ? FIRST_CUE_DELAY_MS : 400,
  );
}
