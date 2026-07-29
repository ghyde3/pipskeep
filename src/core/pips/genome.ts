/**
 * Trait genomes (spec §7.3) — rolling a fresh genome for a hatching egg,
 * combining two genomes (the breeding seam, spec §12), and building a
 * PipState from a genome (shared by createNewGame and HATCH_EGG).
 *
 * RNG contracts (cursor determinism, spec §2 rule 3) — every function
 * consumes a FIXED number of rolls from the stream it is handed, so the
 * cursor advance never depends on outcomes:
 *
 * - `rollGenome`: exactly 5 rolls — species (weighted by registry
 *   rarity), palette, pattern, personality, shiny, in that order.
 * - `combineGenomes`: exactly 6 rolls — species parent (1), palette
 *   mutation check + value (2), pattern mutation check + value (2),
 *   personality parent (1), in that order. The value roll is consumed
 *   whether or not the mutation fired (parent pick and mutation pick each
 *   cost one roll).
 *
 * BREEDING SEAM (spec §12): `combineGenomes` is fully implemented and
 * unit-tested NOW so breeding is a UI feature later, not a data
 * migration — but NOTHING in gameplay calls it. Do not wire it to any
 * action until the breeding phase.
 *
 * Purity: no clock, no Math.random — randomness enters as an RngStream
 * whose cursor the caller owns. Content enters as injectable structural
 * views defaulting to content/ (the pattern used across core/).
 */

import { tuning as contentTuning } from "../../content/tuning";
import { species as contentSpecies } from "../../content/species";
import { PERSONALITY_IDS } from "../../content/personalities";
import type { RngStream } from "../rng";
import { NEED_MAX, PipActivity } from "./types";
import type { LifeStage, PipId, PipNeeds, PipState, TraitGenome } from "./types";

/**
 * Structural view of a species registry entry, as genome rolling needs it
 * (core treats content ids as opaque — spec §2 rule 5). `content/species`
 * satisfies this.
 */
export interface GenomeSpeciesEntry {
  readonly id: string;
  /** Rarity id — looked up in the rarity-weight table. */
  readonly rarity: string;
  readonly sprite: {
    readonly palettes: readonly string[];
    readonly patterns: readonly string[];
    readonly accessorySlots: number;
  };
}

export type GenomeSpeciesRegistry = Readonly<Record<string, GenomeSpeciesEntry>>;

/** Injectable content for genome rolls, defaulting to the real registries. */
export interface GenomeRollContent {
  readonly species?: GenomeSpeciesRegistry;
  /** Relative species-roll weight per rarity id (spec §7.3). */
  readonly rarityWeights?: Readonly<Record<string, number>>;
  readonly personalityIds?: readonly string[];
  /** Chance the hatched genome is the rare iridescent variant. */
  readonly shinyChance?: number;
}

/** Weight for a rarity id missing from the table — ×1 keeps the species
 * hatchable rather than silently unreachable (defensive; validation
 * should keep the table complete). */
const FALLBACK_RARITY_WEIGHT = 1;

/** One weighted pick over the registry (insertion order — deterministic).
 * Consumes exactly one roll. */
function pickSpecies(
  stream: RngStream,
  registry: GenomeSpeciesRegistry,
  rarityWeights: Readonly<Record<string, number>>,
): GenomeSpeciesEntry {
  const entries = Object.values(registry);
  if (entries.length === 0) {
    throw new Error("rollGenome: species registry is empty");
  }
  const weightOf = (entry: GenomeSpeciesEntry): number =>
    rarityWeights[entry.rarity] ?? FALLBACK_RARITY_WEIGHT;
  const total = entries.reduce((sum, entry) => sum + weightOf(entry), 0);
  let r = stream.next() * total;
  for (const entry of entries) {
    r -= weightOf(entry);
    if (r < 0) return entry;
  }
  // Float-edge fallback (r landed exactly on total): last entry.
  return entries[entries.length - 1] as GenomeSpeciesEntry;
}

/**
 * Roll a complete fresh genome for a hatching egg (spec §7.2/§7.3:
 * "species + traits rolled from the RNG egg stream", species weighted by
 * registry rarity, everything else uniform). Exactly 5 rolls, in the
 * order: species, palette, pattern, personality, shiny — the shiny check
 * always consumes its roll, so the cursor advance never depends on the
 * outcome (spec §2 rule 3).
 */
export function rollGenome(
  stream: RngStream,
  content: GenomeRollContent = {},
): TraitGenome {
  const registry = content.species ?? contentSpecies;
  const rarityWeights = content.rarityWeights ?? contentTuning.eggs.rarityWeights;
  const personalityIds = content.personalityIds ?? PERSONALITY_IDS;
  const shinyChance = content.shinyChance ?? contentTuning.genome.shinyChance;

  const speciesEntry = pickSpecies(stream, registry, rarityWeights);
  // Sprite variant lists are validated non-empty at boot (content/validate).
  const palette = stream.pick(speciesEntry.sprite.palettes);
  const pattern = stream.pick(speciesEntry.sprite.patterns);
  const personalityId = stream.pick(personalityIds);
  const shiny = stream.chance(shinyChance);

  return {
    speciesId: speciesEntry.id,
    palette,
    pattern,
    accessorySlots: speciesEntry.sprite.accessorySlots,
    personalityId,
    shiny,
  };
}

/** The slice of tuning breeding reads (injectable for tests). */
export interface BreedingTuning {
  readonly breeding: {
    /** Per-field (palette, pattern) chance of mutating instead of
     * inheriting. */
    readonly mutationChance: number;
  };
}

export interface CombineGenomesContent {
  readonly species?: GenomeSpeciesRegistry;
  readonly tuning?: BreedingTuning;
}

/** One 50/50 parent pick. Consumes exactly one roll. */
function pickParent<T>(stream: RngStream, a: T, b: T): T {
  return stream.chance(0.5) ? a : b;
}

/**
 * Inherit one sprite-variant field (palette/pattern): a mutation check,
 * then EITHER a mutation pick from the child species' variant list OR a
 * 50/50 parent pick — exactly 2 rolls either way (see module doc). A
 * mutation with no usable variant list (species missing from the
 * registry, or an empty list) falls back to the parent pick, still
 * consuming the same 2 rolls.
 */
function inheritVariant(
  stream: RngStream,
  fromA: string,
  fromB: string,
  variants: readonly string[] | undefined,
  mutationChance: number,
): string {
  const mutated = stream.chance(mutationChance);
  if (mutated && variants !== undefined && variants.length > 0) {
    return stream.pick(variants);
  }
  return pickParent(stream, fromA, fromB);
}

/**
 * Combine two parent genomes into a child genome (spec §7.3) — THE
 * BREEDING SEAM (spec §12): tested in core, called by nothing in
 * gameplay.
 *
 * Per-field inheritance:
 * - `speciesId`: either parent, 50/50.
 * - `palette` / `pattern`: either parent 50/50, except with a small
 *   tuning-defined mutation chance the field instead mutates to a
 *   uniformly random variant of the CHILD's species (which may coincide
 *   with a parent's value — a mutation is a fresh draw, not a guaranteed
 *   difference).
 * - `personalityId`: either parent, 50/50.
 * - `accessorySlots`: not rolled — taken from the child species' registry
 *   entry (it is a property of the species' sprite rig, spec §11), or
 *   inherited from whichever parent the species came from when the
 *   species is missing from the registry.
 *
 * Exactly 6 rolls from `rng`, always (see module doc) — determinism
 * never depends on which branches fire.
 */
export function combineGenomes(
  a: TraitGenome,
  b: TraitGenome,
  rng: RngStream,
  content: CombineGenomesContent = {},
): TraitGenome {
  const registry = content.species ?? contentSpecies;
  const { mutationChance } = (content.tuning ?? contentTuning).breeding;

  const speciesId = pickParent(rng, a.speciesId, b.speciesId);
  const speciesEntry = registry[speciesId];

  const palette = inheritVariant(
    rng,
    a.palette,
    b.palette,
    speciesEntry?.sprite.palettes,
    mutationChance,
  );
  const pattern = inheritVariant(
    rng,
    a.pattern,
    b.pattern,
    speciesEntry?.sprite.patterns,
    mutationChance,
  );
  const personalityId = pickParent(rng, a.personalityId, b.personalityId);

  const accessorySlots =
    speciesEntry?.sprite.accessorySlots ??
    (speciesId === a.speciesId ? a.accessorySlots : b.accessorySlots);

  // Shininess is NOT inherited (and costs zero rolls — the 6-roll
  // contract above stays exact): a fresh sparkle is earned at hatch, not
  // passed down. The breeding phase may revisit this rule; until then
  // nothing in gameplay calls this function anyway (spec §12).
  return { speciesId, palette, pattern, accessorySlots, personalityId, shiny: false };
}

export interface CreatePipOptions {
  readonly id: PipId;
  readonly name: string;
  /** Clock timestamp (ms) of hatching (or adoption, for starters). */
  readonly hatchedAt: number;
  readonly lifeStage: LifeStage;
  /** Starting needs; defaults to all NEED_MAX (a newborn is content). */
  readonly needs?: PipNeeds;
}

/**
 * Build a fresh PipState from a genome — the single construction path
 * shared by createNewGame (the starter) and HATCH_EGG (spec §7.2). Live
 * `speciesId`/`personalityId` start as the genome's values; the genome
 * itself is kept as the immutable birth record (types.ts).
 */
export function createPipFromGenome(
  genome: TraitGenome,
  options: CreatePipOptions,
): PipState {
  return {
    id: options.id,
    speciesId: genome.speciesId,
    name: options.name,
    genome,
    personalityId: genome.personalityId,
    lifeStage: options.lifeStage,
    hatchedAt: options.hatchedAt,
    ageMs: 0,
    happinessIntegral: 0,
    needs: options.needs ?? {
      hunger: NEED_MAX,
      cleanliness: NEED_MAX,
      happiness: NEED_MAX,
      energy: NEED_MAX,
    },
    activity: PipActivity.Idle,
    pendingSulk: false,
    // A freshly built Pip (starter or hatchling) is never sulking — set
    // explicitly (not left `undefined`) so a save round-trip through
    // serialize.ts's validator, which always writes a concrete boolean,
    // stays byte-for-byte equal to the in-memory state (round 2A finding
    // #2 — see `PipState.sulking` / `machine.ts`'s `isSulking`).
    sulking: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: options.hatchedAt,
  };
}
