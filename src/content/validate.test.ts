import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectContentIssues,
  defaultContentBundle,
  validateContent,
  type ContentBundle,
} from "./validate";
import { REQUIRED_LINES_PER_CONTEXT } from "./dialogue";
import type { ExpeditionDef } from "./expeditions";
import type { SpeciesDef } from "./species";
import { tuning } from "./tuning";
import type { ResourceBundle } from "../core/economy";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("default content bundle", () => {
  it("has zero errors", () => {
    const { errors } = collectContentIssues(defaultContentBundle);
    expect(errors).toEqual([]);
  });

  it("ships fully-authored dialogue pools (Phase 2 authoring pass)", () => {
    // Spec §3: 8+ lines per personality × context is the launch minimum.
    const { errors, warnings } = collectContentIssues(defaultContentBundle);
    expect(REQUIRED_LINES_PER_CONTEXT).toBe(8);
    expect(errors.filter((e) => e.startsWith("dialogue:"))).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("hard-fails an underfilled dialogue pool (spec §3 violation)", () => {
    const lazy = defaultContentBundle.dialogue.lazy;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      dialogue: {
        ...defaultContentBundle.dialogue,
        lazy: { ...lazy, refusal: ["Hmm. No."] },
      },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual([
      `dialogue: pool lazy/refusal has 1/${REQUIRED_LINES_PER_CONTEXT} lines (launch minimum, spec §3)`,
    ]);
  });
});

describe("broken content is caught", () => {
  it("flags a broken evolution target", () => {
    const mosspip = defaultContentBundle.species["mosspip"];
    expect(mosspip).toBeDefined();
    expect(mosspip?.evolution).toBeDefined();
    const broken: SpeciesDef = {
      ...(mosspip as SpeciesDef),
      evolution: {
        ...(mosspip as SpeciesDef).evolution!,
        targetSpeciesId: "ghostpip", // does not exist
      },
    };
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      species: { ...defaultContentBundle.species, mosspip: broken },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual([
      'species "mosspip": broken evolution target "ghostpip"',
    ]);
  });

  it("flags an empty loot table", () => {
    const meadow = defaultContentBundle.expeditions["meadow"] as ExpeditionDef;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      expeditions: {
        ...defaultContentBundle.expeditions,
        meadow: { ...meadow, lootTable: [] },
      },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual(['expedition "meadow": empty loot table']);
  });

  it("flags a loot item that does not exist in any registry", () => {
    const meadow = defaultContentBundle.expeditions["meadow"] as ExpeditionDef;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      expeditions: {
        ...defaultContentBundle.expeditions,
        meadow: {
          ...meadow,
          lootTable: [{ itemId: "unobtainium", weight: 1 }],
        },
      },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual([
      'expedition "meadow": loot item "unobtainium" does not exist',
    ]);
  });

  it("flags non-positive loot weights", () => {
    const meadow = defaultContentBundle.expeditions["meadow"] as ExpeditionDef;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      expeditions: {
        ...defaultContentBundle.expeditions,
        meadow: {
          ...meadow,
          lootTable: [{ itemId: "berry", weight: 0 }],
        },
      },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual([
      'expedition "meadow": loot item "berry" has non-positive weight 0',
    ]);
  });

  // ROUND 2B — biome-themed egg pools (orchestrator ruling #1): every
  // `eggSpecies` id must resolve to a real, hatchable species, or
  // `core/state.ts`'s fallback to the whole registry would be silent.
  it("flags an eggSpecies pool referencing an unknown species", () => {
    const meadow = defaultContentBundle.expeditions["meadow"] as ExpeditionDef;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      expeditions: {
        ...defaultContentBundle.expeditions,
        meadow: { ...meadow, eggSpecies: ["ghostpip"] },
      },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      'expedition "meadow": eggSpecies references unknown species "ghostpip"',
    );
    expect(errors).toContain(
      'expedition "meadow": eggSpecies has no hatchable species (every listed id is unknown or zero-weight) — hatches from this biome would silently fall back to the whole registry',
    );
  });

  it("flags an eggSpecies pool that is present but empty", () => {
    const meadow = defaultContentBundle.expeditions["meadow"] as ExpeditionDef;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      expeditions: {
        ...defaultContentBundle.expeditions,
        meadow: { ...meadow, eggSpecies: [] },
      },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual(['expedition "meadow": eggSpecies is present but empty']);
  });

  it("warns (does not error) when an eggSpecies pool includes a zero-weight lineage species, but still errors if that's ALL it has", () => {
    const meadow = defaultContentBundle.expeditions["meadow"] as ExpeditionDef;
    // grovepip is "lineage" (zero hatch weight) — mixed with a real
    // hatchable species this is a soft warning, not a hard error.
    const mixedBundle: ContentBundle = {
      ...defaultContentBundle,
      expeditions: {
        ...defaultContentBundle.expeditions,
        meadow: { ...meadow, eggSpecies: ["mosspip", "grovepip"] },
      },
    };
    const mixed = collectContentIssues(mixedBundle);
    expect(mixed.errors).toEqual([]);
    expect(mixed.warnings).toContain(
      'expedition "meadow": eggSpecies includes "grovepip", whose rarity ("lineage") has zero hatch weight — it can never actually hatch from this pool',
    );

    // Lineage-only is a hard error: the pool would hatch NOTHING from
    // its own list and silently fall back to the whole registry.
    const lineageOnlyBundle: ContentBundle = {
      ...defaultContentBundle,
      expeditions: {
        ...defaultContentBundle.expeditions,
        meadow: { ...meadow, eggSpecies: ["grovepip"] },
      },
    };
    const lineageOnly = collectContentIssues(lineageOnlyBundle);
    expect(lineageOnly.errors).toContain(
      'expedition "meadow": eggSpecies has no hatchable species (every listed id is unknown or zero-weight) — hatches from this biome would silently fall back to the whole registry',
    );
  });

  it("the shipped registry's every eggSpecies pool is fully hatchable (no lineage forms, no unknown ids)", () => {
    const { errors, warnings } = collectContentIssues(defaultContentBundle);
    expect(errors).toEqual([]);
    expect(warnings.filter((w) => w.includes("eggSpecies"))).toEqual([]);
  });

  it("flags negative costs", () => {
    const first = defaultContentBundle.decorations[0];
    expect(first).toBeDefined();
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      decorations: [
        { ...first!, cost: { wood: -3 } },
        ...defaultContentBundle.decorations.slice(1),
      ],
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual([
      `decoration "${first!.id}": negative cost wood=-3`,
    ]);
  });

  it("flags a missing gift-item ref in evolution variants", () => {
    const mosspip = defaultContentBundle.species["mosspip"] as SpeciesDef;
    const broken: SpeciesDef = {
      ...mosspip,
      evolution: {
        ...mosspip.evolution!,
        giftVariants: { "golden-acorn": "gilded" }, // item does not exist
      },
    };
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      species: { ...defaultContentBundle.species, mosspip: broken },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual([
      'species "mosspip": evolution gift item "golden-acorn" does not exist',
    ]);
  });

  it("flags a gift variant referencing a food-shaped id that does not exist (round 2B)", () => {
    // The content-bible §1.7 coordination rule: every giftVariants key MUST
    // be a real food id. A typo'd or renamed food (e.g. a species author
    // wiring up "feastpot-deluxe" instead of the shipped "feastpot") must
    // fail loudly, not silently no-op at Give Item time.
    const mosspip = defaultContentBundle.species["mosspip"] as SpeciesDef;
    const broken: SpeciesDef = {
      ...mosspip,
      evolution: {
        ...mosspip.evolution!,
        giftVariants: { "feastpot-deluxe": "gilded" },
      },
    };
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      species: { ...defaultContentBundle.species, mosspip: broken },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual([
      'species "mosspip": evolution gift item "feastpot-deluxe" does not exist',
    ]);
  });

  it("accepts a gift variant that references a REAL food id (the positive case)", () => {
    const mosspip = defaultContentBundle.species["mosspip"] as SpeciesDef;
    const fine: SpeciesDef = {
      ...mosspip,
      evolution: {
        ...mosspip.evolution!,
        giftVariants: { feastpot: "some-variant" },
      },
    };
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      species: { ...defaultContentBundle.species, mosspip: fine },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual([]);
  });

  it("flags an unknown resource in a decoration's cost bundle", () => {
    const first = defaultContentBundle.decorations[0];
    expect(first).toBeDefined();
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      decorations: [
        { ...first!, cost: { stone: 3 } as unknown as ResourceBundle },
        ...defaultContentBundle.decorations.slice(1),
      ],
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual([
      `decoration "${first!.id}": unknown resource "stone" in cost`,
    ]);
  });

  it("flags an unknown resource in a placeable's cost bundle", () => {
    const first = defaultContentBundle.placeables[0];
    expect(first).toBeDefined();
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      placeables: [
        { ...first!, cost: { glowsilk: 2 } as unknown as ResourceBundle },
        ...defaultContentBundle.placeables.slice(1),
      ],
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual([
      `placeable "${first!.id}": unknown resource "glowsilk" in cost`,
    ]);
  });

  it("flags a food with a negative hungerRestore (a negative restore)", () => {
    const berry = defaultContentBundle.foods["berry"];
    expect(berry).toBeDefined();
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      foods: {
        ...defaultContentBundle.foods,
        berry: { ...berry!, hungerRestore: -10 },
      },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual(['food "berry": negative hungerRestore -10']);
  });

  it("flags a food with a negative side-effect restore", () => {
    // Round 2B extends the "negative restore" guard beyond hungerRestore:
    // a food's Happiness/Energy side effects (spec §5) are bonuses and
    // must only ever ADD — a negative one would silently punish a Feed.
    const stew = defaultContentBundle.foods["stew"];
    expect(stew).toBeDefined();
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      foods: {
        ...defaultContentBundle.foods,
        stew: { ...stew!, sideEffects: { happiness: -15 } },
      },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual(['food "stew": negative happiness side effect -15']);
  });

  // ROUND 2F — building effects, icons, decor sets and dead-tier unlocks
  // (progression bible §3/§4; ruling #5's "no dead features" applies to
  // every one of these: a broken reference here is invisible to the
  // player until the specific card/tier is reached, which is exactly the
  // failure mode this file exists to catch loudly at boot instead).
  it("flags a comfort effect referencing an unknown need", () => {
    const firstDeco = defaultContentBundle.decorations[0]!;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      decorations: [
        {
          ...firstDeco,
          effects: [{ kind: "comfort", need: "stamina" as never, decayReduction: 0.05 }],
        },
        ...defaultContentBundle.decorations.slice(1),
      ],
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      `decoration "${firstDeco.id}": comfort effect references unknown need "stamina"`,
    );
  });

  it("flags a job effect referencing a job that does not exist", () => {
    const firstPlaceable = defaultContentBundle.placeables[0]!;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      placeables: [
        { ...firstPlaceable, effects: [{ kind: "job", jobId: "brewing" }] },
        ...defaultContentBundle.placeables.slice(1),
      ],
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      `placeable "${firstPlaceable.id}": job effect references unknown job "brewing"`,
    );
  });

  it("flags an unknown icon motif on a decoration or placeable", () => {
    const firstDeco = defaultContentBundle.decorations[0]!;
    const firstPlaceable = defaultContentBundle.placeables[0]!;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      decorations: [
        { ...firstDeco, icon: { motif: "teapot" as never } },
        ...defaultContentBundle.decorations.slice(1),
      ],
      placeables: [
        { ...firstPlaceable, icon: { motif: "teapot" as never } },
        ...defaultContentBundle.placeables.slice(1),
      ],
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      `decoration "${firstDeco.id}": unknown icon motif "teapot"`,
    );
    expect(errors).toContain(
      `placeable "${firstPlaceable.id}": unknown icon motif "teapot"`,
    );
  });

  it("flags an unknown icon badge", () => {
    const firstDeco = defaultContentBundle.decorations[0]!;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      decorations: [
        { ...firstDeco, icon: { motif: firstDeco.icon.motif, badge: "crown" as never } },
        ...defaultContentBundle.decorations.slice(1),
      ],
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      `decoration "${firstDeco.id}": unknown icon badge "crown"`,
    );
  });

  it("flags a decor set naming a member item that does not exist", () => {
    const firstSet = defaultContentBundle.decorSets[0]!;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      decorSets: [
        { ...firstSet, memberItemIds: [...firstSet.memberItemIds, "ghost-statue"] },
        ...defaultContentBundle.decorSets.slice(1),
      ],
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      `decor set "${firstSet.id}": member "ghost-statue" does not exist`,
    );
  });

  it("flags a Keep tier with no unlocks — a tier that only raises a number is a dead tier", () => {
    const firstLevel = defaultContentBundle.keepLevels[0]!;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      keepLevels: [
        { ...firstLevel, unlocks: [] },
        ...defaultContentBundle.keepLevels.slice(1),
      ],
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      `keep level ${firstLevel.level}: no unlocks — a tier that only raises a number is a dead tier`,
    );
  });

  it("flags a placeable's unlockKeepLevel that names no defined Keep tier", () => {
    const firstPlaceable = defaultContentBundle.placeables[0]!;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      placeables: [
        { ...firstPlaceable, unlockKeepLevel: 99 as never },
        ...defaultContentBundle.placeables.slice(1),
      ],
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      `placeable "${firstPlaceable.id}": unlockKeepLevel 99 is not a defined Keep level`,
    );
  });

  it("the shipped default content has no building-effect, icon, decor-set or dead-tier errors", () => {
    const { errors } = collectContentIssues(defaultContentBundle);
    expect(errors).toEqual([]);
  });

  /**
   * ROUND 2F (progression bible §3.1) — the `job` effect kind is what puts
   * "A Pip can work here" on a Build card, but `core/keep/jobs.ts` decides
   * hosting from the job's own `stationItemId`. Two sources of truth for one
   * fact, so both directions are pinned: a card must not advertise work the
   * station cannot host, and a station must not host work its card never
   * mentions.
   */
  it("flags a placeable advertising a job that a DIFFERENT station actually hosts", () => {
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      placeables: defaultContentBundle.placeables.map((p) =>
        p.id === "food-bowl"
          ? { ...p, effects: [...(p.effects ?? []), { kind: "job", jobId: "mending" }] }
          : p,
      ),
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      'placeable "food-bowl": advertises job "mending", but that job is hosted by "workbench"',
    );
  });

  it("flags a station that hosts a job but whose card never says so", () => {
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      placeables: defaultContentBundle.placeables.map((p) =>
        p.id === "workbench"
          ? { ...p, effects: (p.effects ?? []).filter((e) => e.kind !== "job") }
          : p,
      ),
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      'placeable "workbench": hosts job "mending" but no job effect says so, so its card cannot tell the player',
    );
  });

  it("every shipped job's station advertises it, and vice versa", () => {
    // The positive form: all three jobs (Gathering, Simmering, Mending) are
    // both hosted and advertised, so every job in the game is reachable AND
    // discoverable.
    expect(collectContentIssues(defaultContentBundle).errors).toEqual([]);
    for (const job of Object.values(defaultContentBundle.jobs)) {
      const station = defaultContentBundle.placeables.find(
        (p) => p.id === job.stationItemId,
      );
      expect(station, `job ${job.id} has no station`).toBeDefined();
      expect(
        (station!.effects ?? []).some((e) => e.kind === "job" && e.jobId === job.id),
        `job ${job.id} is not advertised on ${job.stationItemId}'s card`,
      ).toBe(true);
    }
  });

  /**
   * ROUND 2F (progression bible §8.5). Widening the ladder re-spread four
   * expeditions and gave stations their own tiers, leaving three bounty
   * templates advertising a `minKeepLevel` from the OLD spread. The numbers
   * are fixed — this rule is what stops them going stale again, because a
   * tier written in two files drifts the moment either one moves.
   */
  it("flags a bounty template whose minKeepLevel disagrees with its expedition's real unlock tier", () => {
    const grotto = defaultContentBundle.expeditions["lanterngrotto"]!;
    const template = defaultContentBundle.bountyTemplates.find(
      (t) => t.id === "evening-at-the-grotto",
    )!;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      bountyTemplates: defaultContentBundle.bountyTemplates.map((t) =>
        t.id === template.id
          ? { ...t, requires: { ...t.requires, minKeepLevel: 3 } }
          : t,
      ),
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      `bounty "${template.id}": minKeepLevel 3 disagrees with expedition "lanterngrotto", which unlocks at Keep level ${grotto.unlockKeepLevel}`,
    );
    // …and the SHIPPED numbers agree, which is the point of the rule.
    expect(collectContentIssues(defaultContentBundle).errors).toEqual([]);
  });

  it("flags a bounty template whose minKeepLevel disagrees with its station's real unlock tier", () => {
    const stockpot = defaultContentBundle.placeables.find((p) => p.id === "stockpot")!;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      bountyTemplates: defaultContentBundle.bountyTemplates.map((t) =>
        t.id === "something-simmering"
          ? { ...t, requires: { ...t.requires, minKeepLevel: 2 } }
          : t,
      ),
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toContain(
      `bounty "something-simmering": minKeepLevel 2 disagrees with placeable "stockpot", which unlocks at Keep level ${stockpot.unlockKeepLevel}`,
    );
  });

  it("flags a food, decoration, or placeable missing flavor text", () => {
    const berry = defaultContentBundle.foods["berry"]!;
    const firstDeco = defaultContentBundle.decorations[0]!;
    const firstPlaceable = defaultContentBundle.placeables[0]!;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      foods: { ...defaultContentBundle.foods, berry: { ...berry, flavor: "  " } },
      decorations: [
        { ...firstDeco, flavor: "" },
        ...defaultContentBundle.decorations.slice(1),
      ],
      placeables: [
        { ...firstPlaceable, flavor: "" },
        ...defaultContentBundle.placeables.slice(1),
      ],
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors).toEqual(
      expect.arrayContaining([
        'food "berry": missing flavor text',
        `decoration "${firstDeco.id}": missing flavor text`,
        `placeable "${firstPlaceable.id}": missing flavor text`,
      ]),
    );
    expect(errors).toHaveLength(3);
  });
});

describe("validateContent logging", () => {
  it("logs errors via console.error (loud, per spec §3)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const meadow = defaultContentBundle.expeditions["meadow"] as ExpeditionDef;
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      expeditions: {
        ...defaultContentBundle.expeditions,
        meadow: { ...meadow, lootTable: [] },
      },
    };
    const result = validateContent(bundle);

    expect(result.errors).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[content] expedition "meadow": empty loot table',
    );
    // Fully-authored default dialogue → nothing left to warn about.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("logs no errors for the shipped default content", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    validateContent();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

/**
 * Content invariants that are DESIGN decisions rather than schema rules —
 * things `validateContent` cannot know are wrong, but that a future edit
 * must not undo silently. Each one names the playtest finding it settles.
 * (The behavioural guards live in `core/pips/balance.test.ts`; these are
 * the cheap second signature next to the rest of the content checks.)
 */
describe("tuned content decisions that must not be quietly reverted", () => {
  it("a Pipling is the LOWEST-upkeep Pip in the Keep (round 2A amendment to spec §4.6)", () => {
    // The pre-2A shape — a life stage that could do nothing for 24h AND
    // cost 20% more upkeep — was pure tax on the most exciting moment in
    // the game. Also asserted behaviourally in balance.test.ts; this is
    // the second, independent signature so renaming that one `it` cannot
    // drop the decision's only guard.
    expect(tuning.pipling.decayMultiplier).toBeLessThanOrEqual(1);
    expect(tuning.pipling.durationMs).toBeLessThanOrEqual(
      tuning.offlineRateCapMs,
    );
    expect(tuning.pipling.allowedExpeditionIds).toContain("meadow");
  });

  it("the Gathering Station stays cheaper than the Keep level it funds (round 2B)", () => {
    // Full reachability arithmetic lives in
    // core/economy/reachability.test.ts; this is the flat data claim, kept
    // beside the other content invariants because the two prices now live
    // in the same object and can be compared by eye.
    const station = tuning.placeableCosts["gathering-station"];
    const level2 = tuning.progression.levelCosts[2];
    expect(station.wood ?? 0).toBeLessThanOrEqual(level2?.wood ?? 0);
    expect(station.fiber ?? 0).toBeLessThanOrEqual(level2?.fiber ?? 0);
  });

  it("every care action can out-restore what a day away takes (round 2B)", () => {
    // The leave-safe floor, stated once here as a content-shape claim:
    // the fastest-decaying need over a full capped window must be inside
    // reach of the actions that cure it. balance.test.ts proves it per
    // personality and through the reducer.
    const capHours = tuning.offlineRateCapMs / (60 * 60 * 1000);
    /** Worst case over a full capped window: the need's own rate times
     * the largest personality multiplier THAT need can draw. */
    const worstDrop = (need: "hunger" | "happiness"): number =>
      -tuning.needDecayPerHour[need] *
      Math.max(
        ...Object.values(tuning.personalityDecayMultipliers).map(
          (row) => row[need],
        ),
      ) *
      capHours;

    expect(2 * tuning.foods.berry.hunger).toBeGreaterThan(worstDrop("hunger"));
    expect(tuning.foods.stew.hunger).toBeGreaterThan(worstDrop("hunger"));
    expect(
      tuning.care.play.happiness + tuning.care.pet.clingyHappiness,
    ).toBeGreaterThan(worstDrop("happiness"));
  });
});

/**
 * THE DEAD-TIER CHECK (ruling #2). Before this round the Keep-level check only
 * asserted that a tier's PROSE was non-empty, which a review mutation exploited
 * exactly: moving both tier-8 placeables from `unlockKeepLevel: 8` to 9 left
 * the suite green at 1,969 tests while `content/keep.ts` went on advertising
 * "the Workbench, the Mending job, the Sun Bunks", and the Mending job died
 * with the station that hosts it. These are the tests that mutation cannot
 * survive.
 */
describe("a dead tier is rejected (progression bible §2, ruling #2)", () => {
  it("the shipped ladder has a real gate at every tier — nothing is a pure number bump", () => {
    const { errors } = collectContentIssues(defaultContentBundle);
    expect(errors.filter((e) => e.includes("NOTHING in content gates"))).toEqual([]);
  });

  it("REPRODUCES the mutation: moving tier 8's placeables to 9 makes tier 8 dead, and is caught", () => {
    const moved = defaultContentBundle.placeables.map((p) =>
      p.unlockKeepLevel === 8 ? { ...p, unlockKeepLevel: 9 as typeof p.unlockKeepLevel } : p,
    );
    // Sanity: the mutation actually moved something, so this test cannot
    // silently pass by exercising an unchanged bundle.
    expect(defaultContentBundle.placeables.some((p) => p.unlockKeepLevel === 8)).toBe(true);
    expect(moved.some((p) => p.unlockKeepLevel === 8)).toBe(false);

    const bundle: ContentBundle = { ...defaultContentBundle, placeables: moved };
    const { errors } = collectContentIssues(bundle);
    expect(errors.some((e) => e.includes("keep level 8: NOTHING in content gates"))).toBe(true);
  });

  it("catches a dead tier whichever currency was removed — expeditions, upgrades, grid or set bonuses", () => {
    // Tier 5's only gates are the Lanterngrotto and grid growth. Remove both.
    const expeditions = Object.fromEntries(
      Object.entries(defaultContentBundle.expeditions).map(([id, e]) => [
        id,
        e.unlockKeepLevel === 5 ? { ...e, unlockKeepLevel: 6 as typeof e.unlockKeepLevel } : e,
      ]),
    );
    const gridGrowth = { ...defaultContentBundle.tuning.progression.gridGrowth };
    delete (gridGrowth as Record<number, unknown>)[5];
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      expeditions,
      tuning: {
        progression: {
          ...defaultContentBundle.tuning.progression,
          gridGrowth,
        },
      },
    };
    const { errors } = collectContentIssues(bundle);
    expect(errors.some((e) => e.includes("keep level 5: NOTHING in content gates"))).toBe(true);
  });

  it("a tier priced in resources is still dead if it hands nothing over — a price is not a reward", () => {
    // Tier 7 costs wood/fiber/shell AND gates the Trail Post + grid growth.
    // Strip both gates but leave the cost: the tier must still be rejected.
    const placeables = defaultContentBundle.placeables.map((p) =>
      p.unlockKeepLevel === 7 ? { ...p, unlockKeepLevel: 8 as typeof p.unlockKeepLevel } : p,
    );
    const gridGrowth = { ...defaultContentBundle.tuning.progression.gridGrowth };
    delete (gridGrowth as Record<number, unknown>)[7];
    const bundle: ContentBundle = {
      ...defaultContentBundle,
      placeables,
      tuning: {
        progression: { ...defaultContentBundle.tuning.progression, gridGrowth },
      },
    };
    expect(Object.keys(defaultContentBundle.keepLevels[6]!.cost).length).toBeGreaterThan(0);
    const { errors } = collectContentIssues(bundle);
    expect(errors.some((e) => e.includes("keep level 7: NOTHING in content gates"))).toBe(true);
  });

  it("tier 1 is exempt — it is the starting state, not something you unlock", () => {
    const { errors } = collectContentIssues(defaultContentBundle);
    expect(errors.some((e) => e.includes("keep level 1: NOTHING"))).toBe(false);
  });

  it("a headline that leads with a number is rejected — the XP bar would announce a number", () => {
    const keepLevels = defaultContentBundle.keepLevels.map((l) =>
      l.level === 7 ? { ...l, headline: "+2 rows of ground" } : l,
    );
    const { errors } = collectContentIssues({ ...defaultContentBundle, keepLevels });
    expect(errors.some((e) => e.includes("leads with a number"))).toBe(true);
  });

  it("an empty headline is rejected — the bar would have nothing to name", () => {
    const keepLevels = defaultContentBundle.keepLevels.map((l) =>
      l.level === 4 ? { ...l, headline: "   " } : l,
    );
    const { errors } = collectContentIssues({ ...defaultContentBundle, keepLevels });
    expect(errors.some((e) => e.includes("no headline"))).toBe(true);
  });
});
