/**
 * Genome tests (spec §7.3) — rollGenome's fixed roll contract and rarity
 * weighting, the combineGenomes BREEDING SEAM (spec §12: implemented and
 * tested now, called by nothing in gameplay), and createPipFromGenome as
 * the shared construction path.
 *
 * Determinism throughout: everything is driven by explicit RngStreams
 * (cursor-restorable, spec §2 rule 3) — no clocks, no ambient
 * randomness.
 */

import { describe, expect, it } from "vitest";
import { createRng, createRngFromState } from "../rng";
import type { RngStream } from "../rng";
import { LifeStage, NEED_MAX, PipActivity } from "./types";
import type { TraitGenome } from "./types";
import {
  combineGenomes,
  createPipFromGenome,
  rollGenome,
} from "./genome";
import type { GenomeSpeciesRegistry } from "./genome";
import { species as contentSpecies } from "../../content/species";
import { PERSONALITY_IDS } from "../../content/personalities";
import { tuning } from "../../content/tuning";

const REGISTRY: GenomeSpeciesRegistry = {
  mosspip: {
    id: "mosspip",
    rarity: "common",
    sprite: {
      palettes: ["fern", "lichen", "clover"],
      patterns: ["plain", "speckled", "swirl"],
      accessorySlots: 1,
    },
  },
  emberpip: {
    id: "emberpip",
    rarity: "rare",
    sprite: {
      palettes: ["cinder", "flare"],
      patterns: ["smolder"],
      accessorySlots: 3,
    },
  },
};

const genomeOf = (
  overrides: Partial<TraitGenome> = {},
): TraitGenome => ({
  speciesId: "mosspip",
  palette: "fern",
  pattern: "plain",
  accessorySlots: 1,
  personalityId: "curious",
  ...overrides,
});

/** Fresh stream for a seed (streams are cursor-deterministic). */
function stream(seed: number, name = "egg"): RngStream {
  return createRng(seed).stream(name);
}

describe("rollGenome — spec §7.2/§7.3", () => {
  it("is deterministic from the stream cursor: same seed, same genome", () => {
    const a = rollGenome(stream(42), { species: REGISTRY });
    const b = rollGenome(stream(42), { species: REGISTRY });
    expect(a).toEqual(b);
  });

  it("consumes exactly 4 rolls (species, palette, pattern, personality)", () => {
    const rolled = stream(7);
    rollGenome(rolled, { species: REGISTRY });
    const manual = stream(7);
    for (let i = 0; i < 4; i++) manual.next();
    expect(rolled.getState()).toBe(manual.getState());
  });

  it("every field comes from the chosen species' registry entry / the personality list", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const genome = rollGenome(stream(seed), { species: REGISTRY });
      const speciesEntry = REGISTRY[genome.speciesId];
      expect(speciesEntry).toBeDefined();
      expect(speciesEntry?.sprite.palettes).toContain(genome.palette);
      expect(speciesEntry?.sprite.patterns).toContain(genome.pattern);
      expect(genome.accessorySlots).toBe(speciesEntry?.sprite.accessorySlots);
      expect(PERSONALITY_IDS).toContain(genome.personalityId);
    }
  });

  it("weights the species roll by registry rarity (weight 0 never hatches)", () => {
    const rarityWeights = { common: 1, rare: 0 };
    for (let seed = 1; seed <= 80; seed++) {
      const genome = rollGenome(stream(seed), {
        species: REGISTRY,
        rarityWeights,
      });
      expect(genome.speciesId).toBe("mosspip");
    }
  });

  it("both species appear under the default (non-zero) weights", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      seen.add(rollGenome(stream(seed), { species: REGISTRY }).speciesId);
    }
    expect(seen).toEqual(new Set(["mosspip", "emberpip"]));
  });

  it("works against the real shipped registries (default content)", () => {
    const genome = rollGenome(stream(11));
    const entry = contentSpecies[genome.speciesId];
    expect(entry).toBeDefined();
    expect(entry?.sprite.palettes).toContain(genome.palette);
    expect(entry?.sprite.patterns).toContain(genome.pattern);
  });
});

describe("combineGenomes — the breeding seam (spec §7.3/§12)", () => {
  const parentA = genomeOf({
    speciesId: "mosspip",
    palette: "fern",
    pattern: "plain",
    personalityId: "lazy",
  });
  const parentB = genomeOf({
    speciesId: "emberpip",
    palette: "cinder",
    pattern: "smolder",
    accessorySlots: 3,
    personalityId: "chaotic",
  });

  it("is deterministic from the stream cursor", () => {
    const a = combineGenomes(parentA, parentB, stream(99), { species: REGISTRY });
    const b = combineGenomes(parentA, parentB, stream(99), { species: REGISTRY });
    expect(a).toEqual(b);
  });

  it("resuming from a saved cursor produces the same child (reload never re-rolls)", () => {
    const rng = createRng(31);
    rng.stream("egg").next(); // some pre-play draws
    rng.stream("egg").next();
    const saved = rng.getState();

    const live = combineGenomes(parentA, parentB, rng.stream("egg"), {
      species: REGISTRY,
    });
    const restored = combineGenomes(
      parentA,
      parentB,
      createRngFromState(31, saved).stream("egg"),
      { species: REGISTRY },
    );
    expect(restored).toEqual(live);
  });

  it("consumes exactly 6 rolls whether or not mutations fire", () => {
    for (const mutationChance of [0, 1]) {
      const rolled = stream(5);
      combineGenomes(parentA, parentB, rolled, {
        species: REGISTRY,
        tuning: { breeding: { mutationChance } },
      });
      const manual = stream(5);
      for (let i = 0; i < 6; i++) manual.next();
      expect(rolled.getState()).toBe(manual.getState());
    }
  });

  it("field provenance with mutation off: every field comes from a parent, 50/50-ish", () => {
    const speciesSeen = new Set<string>();
    const personalitySeen = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) {
      const child = combineGenomes(parentA, parentB, stream(seed), {
        species: REGISTRY,
        tuning: { breeding: { mutationChance: 0 } },
      });
      expect([parentA.speciesId, parentB.speciesId]).toContain(child.speciesId);
      expect([parentA.palette, parentB.palette]).toContain(child.palette);
      expect([parentA.pattern, parentB.pattern]).toContain(child.pattern);
      expect([parentA.personalityId, parentB.personalityId]).toContain(
        child.personalityId,
      );
      speciesSeen.add(child.speciesId);
      personalitySeen.add(child.personalityId);
    }
    // Both parents actually contribute across seeds (not a constant pick).
    expect(speciesSeen.size).toBe(2);
    expect(personalitySeen.size).toBe(2);
  });

  it("mutation bounds: forced mutations draw from the CHILD species' registry lists", () => {
    // Parents carry variant values that do NOT exist in the registry, so
    // any in-registry value proves the mutation drew fresh.
    const alienA = genomeOf({ palette: "not-a-palette", pattern: "not-a-pattern" });
    const alienB = genomeOf({
      speciesId: "emberpip",
      palette: "also-not", // not in emberpip's list either
      pattern: "nope",
      accessorySlots: 3,
      personalityId: "clingy",
    });
    for (let seed = 1; seed <= 60; seed++) {
      const child = combineGenomes(alienA, alienB, stream(seed), {
        species: REGISTRY,
        tuning: { breeding: { mutationChance: 1 } },
      });
      const entry = REGISTRY[child.speciesId];
      expect(entry?.sprite.palettes).toContain(child.palette);
      expect(entry?.sprite.patterns).toContain(child.pattern);
    }
  });

  it("accessorySlots comes from the child species' registry entry", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const child = combineGenomes(parentA, parentB, stream(seed), {
        species: REGISTRY,
        tuning: { breeding: { mutationChance: 0 } },
      });
      expect(child.accessorySlots).toBe(
        REGISTRY[child.speciesId]?.sprite.accessorySlots,
      );
    }
  });

  it("species missing from the registry: variants inherit from parents, slots from the winning parent", () => {
    const ghostA = genomeOf({ speciesId: "ghostpip", accessorySlots: 5, palette: "boo" });
    const ghostB = genomeOf({ speciesId: "wispip", accessorySlots: 7, palette: "waft" });
    for (let seed = 1; seed <= 40; seed++) {
      // mutationChance 1: with no registry entry the mutation cannot draw,
      // so it falls back to the parent pick (same roll count).
      const child = combineGenomes(ghostA, ghostB, stream(seed), {
        species: {},
        tuning: { breeding: { mutationChance: 1 } },
      });
      expect([ghostA.palette, ghostB.palette]).toContain(child.palette);
      expect(child.accessorySlots).toBe(
        child.speciesId === "ghostpip" ? 5 : 7,
      );
    }
  });

  it("uses the tuning-defined mutation chance by default (small, spec §7.3)", () => {
    expect(tuning.breeding.mutationChance).toBeGreaterThan(0);
    expect(tuning.breeding.mutationChance).toBeLessThan(0.5);
  });
});

describe("createPipFromGenome — shared construction path (spec §7.2)", () => {
  it("builds a fresh Pipling: full needs, Idle, zero history, genome preserved", () => {
    const genome = genomeOf({ personalityId: "clingy" });
    const pip = createPipFromGenome(genome, {
      id: "pip-9",
      name: "Newpip",
      hatchedAt: 123_456,
      lifeStage: LifeStage.Pipling,
    });
    expect(pip.id).toBe("pip-9");
    expect(pip.speciesId).toBe(genome.speciesId);
    expect(pip.personalityId).toBe("clingy");
    expect(pip.genome).toEqual(genome);
    expect(pip.lifeStage).toBe(LifeStage.Pipling);
    expect(pip.activity).toBe(PipActivity.Idle);
    expect(pip.hatchedAt).toBe(123_456);
    expect(pip.needsUpdatedAt).toBe(123_456);
    expect(pip.ageMs).toBe(0);
    expect(pip.happinessIntegral).toBe(0);
    expect(pip.pendingSulk).toBe(false);
    expect(pip.readyToEvolve).toBe(false);
    expect(pip.lastGiftItemId).toBeNull();
    expect(pip.expedition).toBeNull();
    for (const value of Object.values(pip.needs)) {
      expect(value).toBe(NEED_MAX);
    }
  });

  it("honors explicit starting needs (the starter's ~60 hunger path)", () => {
    const pip = createPipFromGenome(genomeOf(), {
      id: "pip-1",
      name: "Mosspip",
      hatchedAt: 0,
      lifeStage: LifeStage.Adult,
      needs: { hunger: 60, cleanliness: 100, happiness: 100, energy: 100 },
    });
    expect(pip.lifeStage).toBe(LifeStage.Adult);
    expect(pip.needs.hunger).toBe(60);
  });
});
