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
