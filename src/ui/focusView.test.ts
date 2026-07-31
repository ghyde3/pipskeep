/**
 * Focus-view controller tests (spec §10 Pip focus view) — the PURE model
 * layer only: expedition row derivation (unlock gating copy, one-pip-per-
 * expedition, live countdown, Sulking/Pipling stay sendable so core gets
 * to voice the refusal), duration/countdown formatting, and the
 * personality blurb roster. The DOM shell is untested chrome around this
 * (same pattern as debugMenu.test.ts).
 */

import { describe, expect, it } from "vitest";
import { MINUTE_MS, tuning } from "../content/tuning";
import { PERSONALITY_IDS } from "../content/personalities";
import { LifeStage, PipActivity } from "../core/pips/types";
import type { PipNeeds, PipState } from "../core/pips/types";
import type { GameState } from "../core/state";
import { adultAt } from "../core/pips/lifecycle";
import {
  PERSONALITY_BLURBS,
  RENAME_ERROR_COPY,
  buildExpeditionRow,
  buildFocusModel,
  formatCountdown,
  formatDurationShort,
  formatGrowUpCountdown,
  lifeStageLabel,
  masteryBadgeFor,
  personalityBlurb,
  pityNoteFor,
  canOfferRetire,
  createFocusView,
} from "./focusView";
import { tripsForTier } from "../core/progression/mastery";
import { installFakeDom } from "./fakeDom";
import type { FakeElement } from "./fakeDom";
import { SAFE_TRAIL_COPY, expeditions } from "../content/expeditions";
import { PIP_NAME_MAX_LENGTH } from "../core/state";

const needs = (overrides: Partial<PipNeeds> = {}): PipNeeds => ({
  hunger: 80,
  cleanliness: 80,
  happiness: 80,
  energy: 80,
  ...overrides,
});

function makePip(overrides: Partial<PipState> = {}): PipState {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Mosspip",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "plain",
      personalityId: "curious",
      shiny: false,
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: needs(),
    activity: PipActivity.Idle,
    pendingSulk: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  };
}

function makeState(
  overrides: Partial<GameState> & { pip?: PipState } = {},
): GameState {
  const pip = overrides.pip ?? makePip();
  return {
    pips: { [pip.id]: pip },
    rosterOrder: [pip.id],
    activePipId: pip.id,
    inventory: {},
    resources: {},
    rngState: {},
    seed: 42,
    keep: { level: 1, placements: {} },
    jobs: {},
    rosterUpgradePurchased: false,
    eggs: [],
    pendingReveals: [],
    nextPipNumber: 2,
    nextEggNumber: 1,
    nextPlacementNumber: 1,
    cooldowns: {},
    lastLineIndex: {},
    createdAt: 0,
    lastTickAt: 0,
    lastCareOutcome: null,
    lastCatchup: null,
    lastAssignOutcome: null,
    lastHatchOutcome: null,
    lastJobOutcome: null,
    lastEvolveOutcome: null,
    onboarding: { completed: true, step: "done" },
    pipdex: {
      entries: {},
      discoveryOrder: [],
      formsSeen: 0,
      formsCaught: 0,
      variantsCaught: 0,
      shiniesCaught: 0,
      unreadEntryIds: [],
    },
    sanctuary: { pips: {}, order: [] },
    lastSanctuaryOutcome: null,
    // ROUND 2C — progression stack defaults (docs/retention-bible.md).
    streak: {
      current: 0,
      longest: 0,
      lastVisitDay: null,
      totalVisitDays: 0,
      graceBanked: 2,
      graceRefilledOnDay: null,
      rainDays: 0,
      rewardedForDay: null,
      pendingChoices: [],
    },
    dayOffsetMs: 0,
    counters: {},
    milestones: { earned: {}, pendingCelebrations: [] },
    bounties: { day: null, slots: [], rerollsUsed: 0, dayBonusGranted: false },
    eggPity: {},
    activeEvents: [],
    keepsakes: {},
    flair: {},
    keepXp: 0,
    lastLevelUp: null,
    ...overrides,
  };
}

const row = (state: GameState, expeditionId: string, now = 0) => {
  const pip = state.pips[state.activePipId];
  if (pip === undefined) throw new Error("active pip missing");
  const built = buildExpeditionRow(state, pip, expeditionId, now);
  if (built === null) throw new Error(`${expeditionId} missing from registry`);
  return built;
};

describe("personality blurbs — spec §15.5 tone copy", () => {
  it("covers every launch personality with a non-empty one-liner", () => {
    for (const id of PERSONALITY_IDS) {
      expect(PERSONALITY_BLURBS[id], id).toBeTypeOf("string");
      expect((PERSONALITY_BLURBS[id] as string).length).toBeGreaterThan(10);
    }
  });

  it("unknown personalities fall back instead of crashing", () => {
    expect(personalityBlurb("moody")).toBeTypeOf("string");
  });
});

describe("formatDurationShort / formatCountdown", () => {
  it("renders minutes and hour+minute durations", () => {
    expect(formatDurationShort(5 * MINUTE_MS)).toBe("5 min");
    expect(formatDurationShort(30 * MINUTE_MS)).toBe("30 min");
    expect(formatDurationShort(60 * MINUTE_MS)).toBe("1 h");
    expect(formatDurationShort(90 * MINUTE_MS)).toBe("1 h 30 min");
  });

  it("counts down m:ss, rolls into h:mm:ss, clamps at 0:00", () => {
    expect(formatCountdown(272_000)).toBe("4:32");
    expect(formatCountdown(3_849_000)).toBe("1:04:09");
    expect(formatCountdown(999)).toBe("0:01");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});

describe("buildExpeditionRow — unlock gating (spec §6.1/§9)", () => {
  it("at Keep level 1: meadow sendable, forest/shore locked with friendly level copy", () => {
    const state = makeState();
    expect(row(state, "meadow").status).toBe("available");
    expect(row(state, "meadow").sendable).toBe(true);

    const forest = row(state, "forest");
    expect(forest.status).toBe("locked");
    expect(forest.sendable).toBe(false);
    expect(forest.note).toContain("Keep level 2");

    // ROUND 2F (progression bible §2.1): the Shore's unlock moved 3 → 4,
    // following the Shell/Driftwood that supplies Cozy Bunks' cost.
    expect(row(state, "shore").note).toContain("Keep level 4");
  });

  it("Keep level 4 unlocks meadow/forest/shore", () => {
    const state = makeState({ keep: { level: 4, placements: {} } });
    for (const id of ["meadow", "forest", "shore"]) {
      expect(row(state, id).status, id).toBe("available");
    }
  });

  it("duration label reflects Hardworking's −15% (spec §4.2)", () => {
    const base = makeState();
    expect(row(base, "shore").durationLabel).toBe("30 min");

    const hardworking = makePip({ personalityId: "hardworking" });
    const state = makeState({ pip: hardworking });
    const expected = formatDurationShort(
      30 * MINUTE_MS * tuning.quirks.hardworkingExpeditionDurationMultiplier,
    );
    expect(row(state, "shore").durationLabel).toBe(expected);
    expect(expected).not.toBe("30 min");
  });
});

describe("buildExpeditionRow — occupancy and away states (spec §6.1)", () => {
  it("another pip out on the trail marks it occupied, with the occupant named", () => {
    const other = makePip({
      id: "pip-2",
      name: "Fernpip",
      activity: PipActivity.OnExpedition,
      expedition: { expeditionId: "meadow", departedAt: 0, durationMs: 1000 },
    });
    const me = makePip();
    const state = makeState({
      pips: { [me.id]: me, [other.id]: other },
      rosterOrder: [me.id, other.id],
    });
    const meadow = row(state, "meadow");
    expect(meadow.status).toBe("occupied");
    expect(meadow.sendable).toBe(false);
    expect(meadow.note).toContain("Fernpip");
  });

  it("a Returning pip with uncollected loot still occupies its expedition", () => {
    const other = makePip({
      id: "pip-2",
      name: "Fernpip",
      activity: PipActivity.Returning,
      expedition: { expeditionId: "meadow", departedAt: 0, durationMs: 1000 },
    });
    const me = makePip();
    const state = makeState({
      pips: { [me.id]: me, [other.id]: other },
      rosterOrder: [me.id, other.id],
    });
    expect(row(state, "meadow").status).toBe("occupied");
  });

  it("the pip's own active expedition shows a live derived countdown", () => {
    const departedAt = 100_000;
    const durationMs = 5 * MINUTE_MS;
    const pip = makePip({
      activity: PipActivity.OnExpedition,
      expedition: { expeditionId: "meadow", departedAt, durationMs },
    });
    const state = makeState({ pip });

    // 4:32 left: now = departedAt + duration − 272s.
    const now = departedAt + durationMs - 272_000;
    const meadow = row(state, "meadow", now);
    expect(meadow.status).toBe("active");
    expect(meadow.countdown).toBe("4:32");
    expect(meadow.sendable).toBe(false);

    // Other rows go quiet while this pip is away (level 2 keeps forest open).
    const state2 = makeState({ pip, keep: { level: 2, placements: {} } });
    expect(row(state2, "forest", now).status).toBe("away");
    expect(row(state2, "forest", now).sendable).toBe(false);
  });

  it("a Returning pip's row flips to 'back!' copy with no countdown", () => {
    const pip = makePip({
      activity: PipActivity.Returning,
      expedition: {
        expeditionId: "meadow",
        departedAt: 0,
        durationMs: 5 * MINUTE_MS,
      },
    });
    const state = makeState({ pip });
    const meadow = row(state, "meadow", 10 * MINUTE_MS);
    expect(meadow.status).toBe("active");
    expect(meadow.countdown).toBeNull();
    expect(meadow.note).toContain("back");
  });
});

describe("buildExpeditionRow — who gets a Send button (spec §4.7)", () => {
  it("Resting pips are not offered trips (structural, no dialogue)", () => {
    const state = makeState({ pip: makePip({ activity: PipActivity.Resting }) });
    const meadow = row(state, "meadow");
    expect(meadow.status).toBe("resting");
    expect(meadow.sendable).toBe(false);
  });

  it("Sulking pips KEEP the Send button — the refusal line is theirs to deliver", () => {
    const state = makeState({ pip: makePip({ activity: PipActivity.Sulking }) });
    expect(row(state, "meadow").sendable).toBe(true);
  });

  it("Piplings keep the Send button on their supervised trail (spec §4.6, round 2A)", () => {
    const state = makeState({ pip: makePip({ lifeStage: LifeStage.Pipling }) });
    expect(row(state, "meadow").sendable).toBe(true);
  });
});

describe("buildExpeditionRow — Piplings explain themselves (finding #3)", () => {
  const piplingState = (overrides: Partial<PipState> = {}) =>
    makeState({
      pip: makePip({ lifeStage: LifeStage.Pipling, hatchedAt: 0, ...overrides }),
      // ROUND 2F: the Shore's unlock moved 3 → 4 (progression bible
      // §2.1) — level 4 unlocks forest/shore so the Pipling reason is
      // what's actually being asserted, not the level.
      keep: { level: 4, placements: {} },
    });

  it("labels an allowed trail as a little supervised trip, still sendable", () => {
    const meadow = row(piplingState(), "meadow");
    expect(tuning.pipling.allowedExpeditionIds).toContain("meadow");
    expect(meadow.status).toBe("available");
    expect(meadow.sendable).toBe(true);
    expect(meadow.badge).toBe("Supervised");
    expect(meadow.note).toContain("supervised");
  });

  it("an adult-only trail shows the grow-up countdown, not a bare refusal", () => {
    // 5h20m before this Pipling turns Adult.
    const now = tuning.pipling.durationMs - (5 * 60 + 20) * MINUTE_MS;
    const forest = row(piplingState(), "forest", now);

    expect(forest.status).toBe("pipling");
    expect(forest.sendable).toBe(false);
    expect(forest.badge).toBe("Pipling");
    expect(forest.note).toContain("Still a Pipling");
    expect(forest.countdown).toBe("5h 20m");
    // The DOM shell ticks this every frame off the absolute timestamp.
    expect(forest.countdownUntil).toBe(tuning.pipling.durationMs);
  });

  it("the countdown target is exactly core's adultAt (no drift between layers)", () => {
    const state = piplingState({ hatchedAt: 1_234_567 });
    const pip = state.pips["pip-1"];
    if (pip === undefined) throw new Error("pip missing");
    expect(row(state, "shore").countdownUntil).toBe(adultAt(pip));
  });

  it("still-locked trails keep the Keep-level reason (the actionable one)", () => {
    const state = makeState({
      pip: makePip({ lifeStage: LifeStage.Pipling }),
      keep: { level: 1, placements: {} },
    });
    const forest = row(state, "forest");
    expect(forest.status).toBe("locked");
    expect(forest.note).toContain("Keep level 2");
  });

  it("Adults never get a pipling row", () => {
    // ROUND 2F: level 4 unlocks meadow/forest/shore (Shore moved 3 → 4).
    const state = makeState({ keep: { level: 4, placements: {} } });
    for (const id of ["meadow", "forest", "shore"]) {
      expect(row(state, id).status, id).not.toBe("pipling");
      expect(row(state, id).badge, id).toBeNull();
    }
  });
});

describe("formatGrowUpCountdown — coarse above an hour, live below", () => {
  it("renders hours+minutes, minutes+seconds, then bare seconds", () => {
    expect(formatGrowUpCountdown(5 * 3_600_000 + 20 * 60_000)).toBe("5h 20m");
    expect(formatGrowUpCountdown(8 * 3_600_000)).toBe("8h 0m");
    expect(formatGrowUpCountdown(12 * 60_000 + 30_000)).toBe("12m 30s");
    expect(formatGrowUpCountdown(90_000)).toBe("1m 30s");
    expect(formatGrowUpCountdown(8_000)).toBe("8s");
  });

  it("never renders a negative or a bare zero", () => {
    expect(formatGrowUpCountdown(0)).toBe("a moment");
    expect(formatGrowUpCountdown(-60_000)).toBe("a moment");
  });
});

describe("buildFocusModel — the whole panel model", () => {
  it("assembles identity, stage, mood, needs, and every expedition row", () => {
    const state = makeState();
    const model = buildFocusModel(state, "pip-1", 0);
    expect(model).not.toBeNull();
    expect(model?.speciesName).toBe("Mosspip");
    expect(model?.personalityName).toBe("Curious");
    expect(model?.blurb).toBe(PERSONALITY_BLURBS["curious"]);
    expect(model?.stageLabel).toBe(lifeStageLabel(LifeStage.Adult));
    expect(model?.mood).toBe("beaming"); // all needs at 80 ≥ 70
    expect(model?.needs.hunger).toBe(80);
    // ROUND 2B (content bible §2): six biomes, three tiers, two rhythms —
    // a quick trip and a deep trip per Keep level.
    expect(model?.expeditions.map((r) => r.id)).toEqual([
      "meadow",
      "bramblewick",
      "forest",
      "snowdrift",
      "shore",
      "lanterngrotto",
    ]);
  });

  it("returns null for an unknown pip instead of crashing", () => {
    expect(buildFocusModel(makeState(), "pip-99", 0)).toBeNull();
  });

  /**
   * ROUND 2G N1 FIX (hud-redesign doc §2.7, spec v1.3 §10's standing rule):
   * before this round, the focus view never mentioned sulking at all — not
   * even for a Pip whose bare `activity` reads "sulking". Now it reports it
   * via `isSulking`, which ALSO catches the case `activity` cannot: a Pip
   * napping through a sulk (`activity: "resting"`, `sulking: true`).
   */
  it("reports sulking via isSulking — including a Pip napping through it", () => {
    const sulkingActivity = makeState({ pip: makePip({ activity: PipActivity.Sulking }) });
    expect(buildFocusModel(sulkingActivity, "pip-1", 0)?.sulking).toBe(true);

    const nappingThroughIt = makeState({
      pip: makePip({ activity: PipActivity.Resting, sulking: true }),
    });
    expect(buildFocusModel(nappingThroughIt, "pip-1", 0)?.sulking).toBe(true);

    const notSulking = makeState({ pip: makePip({ activity: PipActivity.Idle }) });
    expect(buildFocusModel(notSulking, "pip-1", 0)?.sulking).toBe(false);
  });

  /** ROUND-2C REVIEW FIX: `pip-card-old-friend-title` /
   * `pip-card-well-travelled-title` were `kind: "flair"` milestone rewards
   * (mastery tier 5 in one biome, tier 3 in all six) that granted and drew
   * nothing at all. Bible §4.3 asks for "a title on a Pip's card". */
  it("carries earned flair TITLES, and none at all on a fresh save", () => {
    expect(buildFocusModel(makeState(), "pip-1", 0)?.flairTitles).toEqual([]);

    const titled = buildFocusModel(
      { ...makeState(), flair: { "pip-card-old-friend-title": 5, "album-curator-stamp": 6 } },
      "pip-1",
      0,
    );
    expect(titled?.flairTitles.join(" ")).toContain("Old Friend of the Trail");
    // Album flair does NOT leak onto a Pip's card.
    expect(titled?.flairTitles.join(" ")).not.toContain("Curator");
  });
});

describe("masteryBadgeFor — a subtle rank, never a numbers dump (bible §6.3)", () => {
  it("is null below tier 1", () => {
    const pip = makePip(); // no mastery at all
    expect(masteryBadgeFor(pip, "meadow")).toBeNull();
  });

  it("shows filled/hollow pips plus the tier title once tier 1 is reached", () => {
    const meadowDurationMs = expeditions.meadow.durationMs;
    const tripsNeeded = tripsForTier(1, meadowDurationMs, tuning);
    const pip = makePip({ mastery: { meadow: tripsNeeded } });
    const badge = masteryBadgeFor(pip, "meadow");
    expect(badge).not.toBeNull();
    expect(badge).toContain("●");
    expect(badge).toMatch(/knows the path/i);
  });

  it("never appears for a raw trip count on an unrelated biome", () => {
    const pip = makePip({ mastery: { forest: 999 } });
    expect(masteryBadgeFor(pip, "meadow")).toBeNull();
  });

  it("flows through buildExpeditionRow untouched for the other six existing fields", () => {
    const state = makeState();
    const meadow = row(state, "meadow");
    expect(meadow.masteryBadge).toBeNull();
    expect(meadow.status).toBe("available"); // existing field, unaffected
  });
});

describe("pityNoteFor — visible, always, phrased as encouragement (bible §7)", () => {
  it("is null for a common-only pool (Bramblewick has nothing rarer to chase)", () => {
    const state = makeState({ keep: { level: 2, placements: {} } });
    expect(pityNoteFor(state, "bramblewick")).toBeNull();
  });

  it("shows the counter/threshold for an uncommon pool, unhidden", () => {
    const state = makeState({ eggPity: { meadow: 3 } });
    const note = pityNoteFor(state, "meadow");
    expect(note).toContain("3/");
    expect(note).toMatch(/cloudpip/i); // meadow's only uncommon species
  });

  it("encourages without a bare countdown once the guarantee is close", () => {
    const threshold = tuning.retention.eggPity.thresholdByRarity["uncommon"] as number;
    const state = makeState({ eggPity: { meadow: threshold } });
    expect(pityNoteFor(state, "meadow")).toMatch(/guaranteed/i);
  });

  it("flows through buildExpeditionRow's meadow row", () => {
    const state = makeState({ eggPity: { meadow: 1 } });
    expect(row(state, "meadow").pityNote).toMatch(/1\//);
  });

  it("picks 'an' before a vowel-leading species name (Forest's Emberpip)", () => {
    const state = makeState({ keep: { level: 2, placements: {} } });
    expect(pityNoteFor(state, "forest")).toContain("an Emberpip");
  });

  it("names both tied rarest-tier species on a pool with no single rarest (Snowdrift)", () => {
    const state = makeState({ keep: { level: 2, placements: {} } });
    const note = pityNoteFor(state, "snowdrift");
    expect(note).toMatch(/snowpip or cloudpip/i);
  });
});

/**
 * The Long Meadow door (round 2C, docs/retention-bible.md §2.3). The focus
 * view draws "Send to the Long Meadow" only when core says the tap can
 * actually succeed — see `canOfferRetire`'s doc comment for why offering a
 * button that can only apologise is the worse design.
 */
describe("canOfferRetire — the focus view's Long Meadow door", () => {
  function twoPipState(overrides: Partial<PipState> = {}): GameState {
    const a = makePip({ id: "pip-1", ...overrides });
    const b = makePip({ id: "pip-2" });
    return makeState({
      pip: a,
      pips: { "pip-1": a, "pip-2": b },
      rosterOrder: ["pip-1", "pip-2"],
    } as Partial<GameState> & { pip?: PipState });
  }

  it("is false for the last Pip — the Keep is never left empty", () => {
    const state = makeState();
    expect(state.rosterOrder).toHaveLength(1);
    expect(canOfferRetire(state, state.activePipId)).toBe(false);
  });

  it("is true for an ordinary Idle Pip once there is someone to hold the fort", () => {
    expect(canOfferRetire(twoPipState(), "pip-1")).toBe(true);
  });

  it("is TRUE for a Sulking Pip — a change of scene, never disposal (bible §2.3)", () => {
    const state = twoPipState({ activity: PipActivity.Sulking, sulking: true });
    expect(canOfferRetire(state, "pip-1")).toBe(true);
  });

  it("is true for a Resting Pip and one on a job (they travel fine)", () => {
    expect(canOfferRetire(twoPipState({ activity: PipActivity.Resting }), "pip-1")).toBe(
      true,
    );
    expect(
      canOfferRetire(twoPipState({ activity: PipActivity.AssignedJob }), "pip-1"),
    ).toBe(true);
  });

  it("is false while loot is in flight, so no reveal is ever stranded", () => {
    for (const activity of [PipActivity.OnExpedition, PipActivity.Returning]) {
      const state = twoPipState({
        activity,
        expedition: { expeditionId: "meadow", departedAt: 0, durationMs: 300_000 },
      });
      expect(canOfferRetire(state, "pip-1"), activity).toBe(false);
    }
  });

  it("is false for an id that is not in the roster (defensive)", () => {
    expect(canOfferRetire(twoPipState(), "pip-nobody")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ROUND 2H — the lifecycle seams inside a Pip's own page (spec §16 v1.5).
//
// Every one of these guards a WIRING decision, which is the class of thing
// this codebase has shipped dead five times: core computes it, and nothing
// ever puts it in front of the player. A model field with no assertion that
// it reaches a row is exactly that failure one commit early.
// ---------------------------------------------------------------------------

describe("ROUND 2H — expedition rows carry the risk line and the lineage thread", () => {
  it("PROMISE 1: EVERY row states its risk, on every status, including the safe ones", () => {
    // The reassurance is load-bearing. A player who only ever sees copy on
    // the dangerous trails learns nothing from its absence on the others —
    // "no line" and "not dangerous" are not the same message.
    for (const expeditionId of Object.keys(expeditions)) {
      const row = buildExpeditionRow(
        makeState({ keep: { level: 6, placements: {} } }),
        makePip(),
        expeditionId,
        0,
      );
      expect(row, expeditionId).not.toBeNull();
      expect(row?.riskCopy.length, expeditionId).toBeGreaterThan(0);
      expect(row?.riskCopy, expeditionId).toBe(
        expeditions[expeditionId as keyof typeof expeditions].riskCopy,
      );
    }
  });

  it("PROMISE 1: the three quick trails read safe and the three deep trails warn", () => {
    const riskOf = (id: string): string =>
      buildExpeditionRow(
        makeState({ keep: { level: 6, placements: {} } }),
        makePip(),
        id,
        0,
      )?.riskCopy ?? "";
    for (const safe of ["meadow", "forest", "shore"]) {
      expect(riskOf(safe), safe).toBe(SAFE_TRAIL_COPY);
    }
    for (const risky of ["bramblewick", "snowdrift", "lanterngrotto"]) {
      expect(riskOf(risky), risky).not.toBe(SAFE_TRAIL_COPY);
      expect(riskOf(risky).length, risky).toBeGreaterThan(0);
    }
  });

  it("PROMISE 4: a lost Pip's egg shows up as a hint on THAT biome's row only", () => {
    const state = makeState({
      keep: { level: 6, placements: {} },
      lineageEggs: [
        {
          pipId: "gone-1",
          name: "Bramble",
          genome: makePip().genome,
          expeditionId: "bramblewick",
          level: 4,
          scars: [],
          generation: 1,
          seededAt: 0,
          misses: 0,
        },
      ],
    });
    const hit = buildExpeditionRow(state, makePip(), "bramblewick", 0);
    expect(hit?.lineageHint).toContain("Bramble");
    // ...and nowhere else — the thread points at ONE place, which is what
    // makes it a quest instead of ambient noise.
    for (const other of ["meadow", "forest", "shore", "snowdrift", "lanterngrotto"]) {
      expect(
        buildExpeditionRow(state, makePip(), other, 0)?.lineageHint,
        other,
      ).toBeNull();
    }
  });

  it("has no lineage hint anywhere in a Keep that has never lost anyone", () => {
    for (const expeditionId of Object.keys(expeditions)) {
      expect(
        buildExpeditionRow(
          makeState({ keep: { level: 6, placements: {} } }),
          makePip(),
          expeditionId,
          0,
        )?.lineageHint,
        expeditionId,
      ).toBeNull();
    }
  });
});

describe("ROUND 2H — THE SEND SEAM: the Send button routes through the risk confirm", () => {
  // This is the assertion promise 1 lives or dies on at the UI layer. If
  // `focusView` keeps dispatching ASSIGN_EXPEDITION itself, `ui/ailment.ts`'s
  // confirm never gets a chance to run and a player can walk a Pip into a
  // dangerous biome having been told nothing. The seam is optional by
  // design (every pre-2H caller still works), which is exactly why it needs
  // a test proving main.ts's wired path is the one that fires.
  function sendableState(): GameState {
    return makeState({
      keep: { level: 6, placements: {} },
      pip: makePip({ needs: needs() }),
    });
  }

  function clickSend(deps: Record<string, unknown>): void {
    const dom = installFakeDom();
    try {
      const view = createFocusView(
        deps as unknown as Parameters<typeof createFocusView>[0],
      );
      view.sync(sendableState());
      view.open();
      const root = view.el as unknown as FakeElement;
      const send = root
        .querySelectorAll(".pk-exp-send")
        .find((el) => el.textContent === "Send");
      expect(send, "no Send button was rendered").toBeDefined();
      send?.click();
    } finally {
      dom.uninstall();
    }
  }

  it("calls requestExpedition — and does NOT dispatch — when the seam is wired", () => {
    const dispatched: unknown[] = [];
    const requested: Array<[string, string]> = [];
    clickSend({
      dispatch: (a: unknown) => dispatched.push(a),
      getState: () => sendableState(),
      clock: { now: () => 0 },
      requestExpedition: (pipId: string, expeditionId: string) =>
        requested.push([pipId, expeditionId]),
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]?.[0]).toBe("pip-1");
    expect(
      dispatched.some(
        (a) => (a as { type?: string }).type === "ASSIGN_EXPEDITION",
      ),
      "the seam was wired but the view dispatched anyway — the confirm would be bypassed",
    ).toBe(false);
  });

  it("falls back to its own dispatch when the seam is absent (every pre-2H caller)", () => {
    const dispatched: Array<{ type?: string }> = [];
    clickSend({
      dispatch: (a: { type?: string }) => dispatched.push(a),
      getState: () => sendableState(),
      clock: { now: () => 0 },
    });
    expect(dispatched.filter((a) => a.type === "ASSIGN_EXPEDITION")).toHaveLength(
      1,
    );
  });
});

describe("ROUND 2D item 5 — the rename dialog (discoverable, not prominent)", () => {
  /** Opens the focus view then taps the rename affordance, returning the
   * root so a test can drive the dialog. Fails loudly if either the
   * trigger button or the dialog it opens is missing — the whole point of
   * a DOM test here (round 2D's task brief: "unit-test the models" plus
   * an actual click-through, not just a pure-model assertion that the
   * button could quietly stop being wired to anything). */
  function openRenameDialog(deps: Record<string, unknown>): FakeElement {
    const view = createFocusView(
      deps as unknown as Parameters<typeof createFocusView>[0],
    );
    view.sync(makeState());
    view.open();
    const root = view.el as unknown as FakeElement;
    const renameBtn = root.querySelector(".pk-focus-rename-btn");
    expect(renameBtn, "no rename button was rendered").not.toBeNull();
    renameBtn?.click();
    const wrap = root.querySelector(".pk-rename-wrap");
    expect(
      wrap?.classList.contains("pk-rename-wrap--open"),
      "rename button click did not open the dialog",
    ).toBe(true);
    return root;
  }

  it("pre-fills the input with the Pip's current name", () => {
    const dom = installFakeDom();
    try {
      const root = openRenameDialog({
        dispatch: () => {},
        getState: () => makeState(),
        clock: { now: () => 0 },
      });
      const input = root.querySelector(".pk-rename-input") as FakeElement | null;
      expect(input?.value).toBe("Mosspip");
    } finally {
      dom.uninstall();
    }
  });

  it("Save dispatches RENAME_PIP with the trimmed, validated name, and closes", () => {
    const dom = installFakeDom();
    const dispatched: unknown[] = [];
    try {
      const root = openRenameDialog({
        dispatch: (a: unknown) => dispatched.push(a),
        getState: () => makeState(),
        clock: { now: () => 0 },
      });
      const input = root.querySelector(".pk-rename-input") as FakeElement;
      input.value = "  Clover  ";
      input.dispatch("input");
      root.querySelector(".pk-rename-save")?.click();

      expect(dispatched).toEqual([
        { type: "RENAME_PIP", pipId: "pip-1", name: "Clover" },
      ]);
      expect(
        root.querySelector(".pk-rename-wrap")?.classList.contains("pk-rename-wrap--open"),
      ).toBe(false);
    } finally {
      dom.uninstall();
    }
  });

  it("Enter in the input submits, exactly like tapping Save", () => {
    const dom = installFakeDom();
    const dispatched: unknown[] = [];
    try {
      const root = openRenameDialog({
        dispatch: (a: unknown) => dispatched.push(a),
        getState: () => makeState(),
        clock: { now: () => 0 },
      });
      const input = root.querySelector(".pk-rename-input") as FakeElement;
      input.value = "Pebble";
      input.dispatch("input");
      input.dispatch("keydown", { key: "Enter" });

      expect(dispatched).toEqual([
        { type: "RENAME_PIP", pipId: "pip-1", name: "Pebble" },
      ]);
    } finally {
      dom.uninstall();
    }
  });

  it("an empty (or whitespace-only) name is refused kindly, in-panel, and never dispatched", () => {
    const dom = installFakeDom();
    const dispatched: unknown[] = [];
    try {
      const root = openRenameDialog({
        dispatch: (a: unknown) => dispatched.push(a),
        getState: () => makeState(),
        clock: { now: () => 0 },
      });
      const input = root.querySelector(".pk-rename-input") as FakeElement;
      input.value = "   ";
      input.dispatch("input");
      root.querySelector(".pk-rename-save")?.click();

      expect(dispatched).toHaveLength(0);
      expect(root.querySelector(".pk-rename-error")?.textContent).toBe(
        RENAME_ERROR_COPY.empty,
      );
      // Stays open — a refusal is not a close.
      expect(
        root.querySelector(".pk-rename-wrap")?.classList.contains("pk-rename-wrap--open"),
      ).toBe(true);
    } finally {
      dom.uninstall();
    }
  });

  it("a name over the length cap is refused kindly, and never dispatched", () => {
    const dom = installFakeDom();
    const dispatched: unknown[] = [];
    try {
      const root = openRenameDialog({
        dispatch: (a: unknown) => dispatched.push(a),
        getState: () => makeState(),
        clock: { now: () => 0 },
      });
      const input = root.querySelector(".pk-rename-input") as FakeElement;
      input.value = "x".repeat(PIP_NAME_MAX_LENGTH + 1);
      input.dispatch("input");
      root.querySelector(".pk-rename-save")?.click();

      expect(dispatched).toHaveLength(0);
      expect(root.querySelector(".pk-rename-error")?.textContent).toBe(
        RENAME_ERROR_COPY.tooLong,
      );
    } finally {
      dom.uninstall();
    }
  });

  it("editing after an error clears it, without needing another Save tap", () => {
    const dom = installFakeDom();
    try {
      const root = openRenameDialog({
        dispatch: () => {},
        getState: () => makeState(),
        clock: { now: () => 0 },
      });
      const input = root.querySelector(".pk-rename-input") as FakeElement;
      input.value = "   ";
      input.dispatch("input");
      root.querySelector(".pk-rename-save")?.click();
      expect(root.querySelector(".pk-rename-error")).not.toBeNull();

      input.value = "Wisp";
      input.dispatch("input");
      expect(root.querySelector(".pk-rename-error")).toBeNull();
    } finally {
      dom.uninstall();
    }
  });

  it("Cancel closes without dispatching, discarding the draft", () => {
    const dom = installFakeDom();
    const dispatched: unknown[] = [];
    try {
      const root = openRenameDialog({
        dispatch: (a: unknown) => dispatched.push(a),
        getState: () => makeState(),
        clock: { now: () => 0 },
      });
      const input = root.querySelector(".pk-rename-input") as FakeElement;
      input.value = "Ignored";
      input.dispatch("input");
      root.querySelector(".pk-rename-cancel")?.click();

      expect(dispatched).toHaveLength(0);
      expect(
        root.querySelector(".pk-rename-wrap")?.classList.contains("pk-rename-wrap--open"),
      ).toBe(false);
    } finally {
      dom.uninstall();
    }
  });

  it("Escape in the input closes without dispatching", () => {
    const dom = installFakeDom();
    const dispatched: unknown[] = [];
    try {
      const root = openRenameDialog({
        dispatch: (a: unknown) => dispatched.push(a),
        getState: () => makeState(),
        clock: { now: () => 0 },
      });
      const input = root.querySelector(".pk-rename-input") as FakeElement;
      input.dispatch("keydown", { key: "Escape" });

      expect(dispatched).toHaveLength(0);
      expect(
        root.querySelector(".pk-rename-wrap")?.classList.contains("pk-rename-wrap--open"),
      ).toBe(false);
    } finally {
      dom.uninstall();
    }
  });

  it("carries an aria-label naming the Pip, so the affordance is announced (not just visible)", () => {
    const dom = installFakeDom();
    try {
      const view = createFocusView({
        dispatch: () => {},
        getState: () => makeState(),
        clock: { now: () => 0 },
      } as unknown as Parameters<typeof createFocusView>[0]);
      view.sync(makeState());
      view.open();
      const root = view.el as unknown as FakeElement;
      const renameBtn = root.querySelector(".pk-focus-rename-btn");
      expect(renameBtn?.getAttribute("aria-label")).toBe("Rename Mosspip");
    } finally {
      dom.uninstall();
    }
  });
});
