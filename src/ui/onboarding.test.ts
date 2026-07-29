/**
 * Onboarding controller tests (spec §10 "≤ 60 seconds, skippable" +
 * §10.1 the acceptance bar) — the PURE layer only, node-style like the
 * other UI suites; the DOM shells (runStarterPick / initOnboarding) are
 * untested chrome around these models:
 *
 * - Deterministic starter trio from a seed (spec §7.1): same species,
 *   three DISTINCT palettes + personalities, identical across calls,
 *   and exactly the trio createNewGame is born from — whichever
 *   candidate wins, the genesis cursor lands in the same place.
 * - Step progression: feed → explore on a fresh APPLIED feed outcome
 *   (refusals and other care actions don't count), explore → done on a
 *   fresh successful send (with the free-play toast).
 * - Skip semantics: jumps straight to done/completed from any guided
 *   beat; the reducer's forward-only rule makes it sticky and replay-
 *   proof. The starter pick itself has no skip (a pip must exist) —
 *   state.onboarding only ever begins at "feed", after the pick.
 * - Existing-save bypass: a completed onboarding yields no cue and no
 *   progression, and the v3 → v4 migration completes it by default.
 */

import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  STARTER_CANDIDATE_COUNT,
  createNewGame,
  rollStarterCandidates,
  rootReducer,
} from "../core/state";
import type { GameState, OnboardingState } from "../core/state";
import type { CareOutcome } from "../core/pips/care";
import type { AssignExpeditionOutcome } from "../core/expeditions";
import { PERSONALITY_IDS } from "../content/personalities";
import { species } from "../content/species";
import {
  EXPLORE_PROMPT,
  FEED_PROMPT,
  FREE_PLAY_TOAST,
  ONBOARDING_GREETINGS,
  buildStarterCards,
  deriveOnboardingProgress,
  onboardingCue,
  skipOnboarding,
  starterGreeting,
} from "./onboarding";
import { PERSONALITY_BLURBS } from "./focusView";
import { migrate } from "../core/save/migrate";
import v3Fixture from "../core/save/fixtures/v3.json";

const NOW = 1_000_000;

/** A fresh onboarding-age game (pick already made — step "feed"). */
function freshState(seed = 7, choice = 0): GameState {
  return createNewGame(seed, NOW, undefined, choice);
}

function withOnboarding(
  state: GameState,
  onboarding: OnboardingState,
): GameState {
  return { ...state, onboarding };
}

function appliedFeed(state: GameState, at = NOW + 1): CareOutcome {
  return {
    action: "feed",
    pipId: state.activePipId,
    at,
    applied: true,
  } as CareOutcome;
}

function okSend(state: GameState, at = NOW + 2): AssignExpeditionOutcome {
  return {
    ok: true,
    pipId: state.activePipId,
    expeditionId: "meadow",
    departedAt: at,
    durationMs: 300_000,
    returnAt: at + 300_000,
  };
}

// ---------------------------------------------------------------------------
// Deterministic starter trio (spec §7.1 / §10.1.1)
// ---------------------------------------------------------------------------

describe("rollStarterCandidates — the deterministic trio", () => {
  it("rolls exactly three candidates, all the same species", () => {
    const trio = rollStarterCandidates(42);
    expect(trio).toHaveLength(STARTER_CANDIDATE_COUNT);
    expect(STARTER_CANDIDATE_COUNT).toBe(3);
    for (const genome of trio) {
      expect(genome.speciesId).toBe("mosspip");
    }
  });

  it("is deterministic: same seed, same three Pips, forever", () => {
    for (const seed of [0, 1, 42, 0xdeadbeef]) {
      expect(rollStarterCandidates(seed)).toStrictEqual(
        rollStarterCandidates(seed),
      );
    }
  });

  it("palettes and personalities are DISTINCT within the trio, and valid", () => {
    const mosspipPalettes = species["mosspip"]?.sprite.palettes ?? [];
    for (let seed = 0; seed < 50; seed++) {
      const trio = rollStarterCandidates(seed);
      const palettes = new Set(trio.map((g) => g.palette));
      const personalities = new Set(trio.map((g) => g.personalityId));
      expect(palettes.size).toBe(3);
      expect(personalities.size).toBe(3);
      for (const genome of trio) {
        expect(mosspipPalettes).toContain(genome.palette);
        expect(PERSONALITY_IDS).toContain(genome.personalityId);
      }
    }
  });

  it("varies across seeds (not one hardcoded trio)", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      seen.add(JSON.stringify(rollStarterCandidates(seed)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("createNewGame(choice i) is born from candidate i of the same trio", () => {
    const seed = 1337;
    const trio = rollStarterCandidates(seed);
    for (let i = 0; i < trio.length; i++) {
      const state = createNewGame(seed, NOW, undefined, i);
      const starter = state.pips[state.activePipId];
      expect(starter?.genome).toStrictEqual(trio[i]);
      expect(starter?.personalityId).toBe(trio[i]?.personalityId);
    }
  });

  it("the genesis cursor is identical whichever candidate wins (the pick never perturbs future rolls)", () => {
    const seed = 99;
    const a = createNewGame(seed, NOW, undefined, 0);
    const b = createNewGame(seed, NOW, undefined, 2);
    expect(a.rngState).toStrictEqual(b.rngState);
  });

  it("an out-of-range choice clamps instead of crashing", () => {
    const trio = rollStarterCandidates(5);
    expect(
      createNewGame(5, NOW, undefined, 99).pips["pip-1"]?.genome,
    ).toStrictEqual(trio[2]);
    expect(
      createNewGame(5, NOW, undefined, -4).pips["pip-1"]?.genome,
    ).toStrictEqual(trio[0]);
  });
});

describe("buildStarterCards — the pick screen's view models", () => {
  it("carries a one-line personality intro drawn from the blurbs", () => {
    const cards = buildStarterCards(rollStarterCandidates(11));
    expect(cards).toHaveLength(3);
    cards.forEach((card, i) => {
      expect(card.index).toBe(i);
      expect(card.speciesName).toBe("Mosspip");
      expect(card.intro).toBe(PERSONALITY_BLURBS[card.genome.personalityId]);
      expect(card.intro.length).toBeGreaterThan(0);
    });
  });

  it("every personality has a landing greeting (and a fallback exists)", () => {
    for (const id of PERSONALITY_IDS) {
      expect(ONBOARDING_GREETINGS[id]).toBeTruthy();
      expect(starterGreeting(id)).toBe(ONBOARDING_GREETINGS[id]);
    }
    expect(starterGreeting("mystery")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Guided-beat cues (spec §10.1.3 / .4)
// ---------------------------------------------------------------------------

describe("onboardingCue", () => {
  it("a fresh game asks for the first Feed, verbatim", () => {
    const cue = onboardingCue(freshState());
    expect(cue?.step).toBe("feed");
    expect(cue?.message).toBe(FEED_PROMPT);
    expect(FEED_PROMPT).toBe("Pips get hungry! Try feeding them.");
  });

  it("the explore step nudges the Meadow send, verbatim prompt", () => {
    const cue = onboardingCue(
      withOnboarding(freshState(), { completed: false, step: "explore" }),
    );
    expect(cue?.step).toBe("explore");
    expect(cue?.message).toBe(EXPLORE_PROMPT);
    expect(EXPLORE_PROMPT).toBe("Pips love exploring.");
    expect(cue?.hint).toBeTruthy();
  });

  it("existing-save bypass: a completed onboarding shows nothing", () => {
    expect(
      onboardingCue(
        withOnboarding(freshState(), { completed: true, step: "done" }),
      ),
    ).toBeNull();
    expect(
      onboardingCue(
        withOnboarding(freshState(), { completed: false, step: "done" }),
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Step progression (spec §10.1.3 → .5)
// ---------------------------------------------------------------------------

describe("deriveOnboardingProgress", () => {
  it("advances feed → explore when a fresh feed LANDS", () => {
    const prev = freshState();
    const next = { ...prev, lastCareOutcome: appliedFeed(prev) };
    const progress = deriveOnboardingProgress(prev, next);
    expect(progress?.action).toEqual({
      type: "ONBOARDING_ADVANCE",
      step: "explore",
    });
    expect(progress?.toast).toBeNull();
  });

  it("a refused feed or a non-feed care action does NOT advance", () => {
    const prev = freshState();
    const refused = {
      ...prev,
      lastCareOutcome: { ...appliedFeed(prev), applied: false },
    };
    expect(deriveOnboardingProgress(prev, refused)).toBeNull();
    const petted = {
      ...prev,
      lastCareOutcome: { ...appliedFeed(prev), action: "pet" } as CareOutcome,
    };
    expect(deriveOnboardingProgress(prev, petted)).toBeNull();
  });

  it("a STALE feed outcome (same reference) does not re-advance", () => {
    const base = freshState();
    const fed = { ...base, lastCareOutcome: appliedFeed(base) };
    // The outcome object is unchanged between prev and next — no news.
    expect(deriveOnboardingProgress(fed, { ...fed })).toBeNull();
  });

  it("advances explore → done (with the free-play toast) on a fresh successful send", () => {
    const prev = withOnboarding(freshState(), {
      completed: false,
      step: "explore",
    });
    const next = { ...prev, lastAssignOutcome: okSend(prev) };
    const progress = deriveOnboardingProgress(prev, next);
    expect(progress?.action).toEqual({
      type: "ONBOARDING_ADVANCE",
      step: "done",
    });
    expect(progress?.toast).toBe(FREE_PLAY_TOAST);
  });

  it("a refused send does not finish onboarding", () => {
    const prev = withOnboarding(freshState(), {
      completed: false,
      step: "explore",
    });
    const next = {
      ...prev,
      lastAssignOutcome: {
        ok: false,
        pipId: prev.activePipId,
        expeditionId: "meadow",
        at: NOW,
        reason: "busy",
      } as AssignExpeditionOutcome,
    };
    expect(deriveOnboardingProgress(prev, next)).toBeNull();
  });

  it("during the feed beat, a send changes nothing (steps are ordered)", () => {
    const prev = freshState();
    const next = { ...prev, lastAssignOutcome: okSend(prev) };
    expect(deriveOnboardingProgress(prev, next)).toBeNull();
  });

  it("existing-save bypass: completed states never progress", () => {
    const prev = withOnboarding(freshState(), {
      completed: true,
      step: "done",
    });
    const next = {
      ...prev,
      lastCareOutcome: appliedFeed(prev),
      lastAssignOutcome: okSend(prev),
    };
    expect(deriveOnboardingProgress(prev, next)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The reducer's forward-only rule + skip semantics (spec §10 skippable)
// ---------------------------------------------------------------------------

describe("ONBOARDING_ADVANCE reducer + skip", () => {
  it("walks feed → explore → done, flipping completed only at done", () => {
    const start = freshState();
    expect(start.onboarding).toEqual({ completed: false, step: "feed" });
    const explored = rootReducer(start, {
      type: "ONBOARDING_ADVANCE",
      step: "explore",
    });
    expect(explored.onboarding).toEqual({ completed: false, step: "explore" });
    const done = rootReducer(explored, {
      type: "ONBOARDING_ADVANCE",
      step: "done",
    });
    expect(done.onboarding).toEqual({ completed: true, step: "done" });
  });

  it("skip from ANY guided beat jumps straight to free play (completed = true)", () => {
    for (const step of ["feed", "explore"] as const) {
      const state = withOnboarding(freshState(), { completed: false, step });
      const skipped = rootReducer(state, skipOnboarding());
      expect(skipped.onboarding).toEqual({ completed: true, step: "done" });
    }
  });

  it("is forward-only: backwards or repeated advances are reference no-ops", () => {
    const done = rootReducer(freshState(), skipOnboarding());
    expect(rootReducer(done, { type: "ONBOARDING_ADVANCE", step: "feed" })).toBe(
      done,
    );
    expect(rootReducer(done, skipOnboarding())).toBe(done);
    const explored = rootReducer(freshState(), {
      type: "ONBOARDING_ADVANCE",
      step: "explore",
    });
    expect(
      rootReducer(explored, { type: "ONBOARDING_ADVANCE", step: "explore" }),
    ).toBe(explored);
  });

  it("the step order itself is the contract the UI leans on", () => {
    expect(ONBOARDING_STEPS).toEqual(["feed", "explore", "done"]);
  });
});

// ---------------------------------------------------------------------------
// Existing saves (spec: onboarding.completed defaults true in migration)
// ---------------------------------------------------------------------------

describe("existing-save bypass — v3 → v4 migration", () => {
  it("a real v3 save arrives with onboarding completed", () => {
    const result = migrate(v3Fixture as unknown);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.state.onboarding).toEqual({
      completed: true,
      step: "done",
    });
    expect(onboardingCue(result.save.state)).toBeNull();
  });
});
