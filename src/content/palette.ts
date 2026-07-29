/**
 * Palette tokens (spec §11): soft pastels + ONE vibrant accent per
 * species, defined as JS tokens usable from both Pixi (render/) and the
 * DOM overlay (ui/, via inline styles / CSS custom properties).
 *
 * Content-as-data (spec §3): adding a species palette is an entry here +
 * the species registry's `sprite.palettes` ids — no render/ changes. The
 * SpriteResolver (render/spriteResolver.ts) resolves everything through
 * `resolvePipPalette`, which falls back gracefully so an unknown
 * species/variant renders as the neutral "wildcard" look instead of
 * crashing (content validation still warns loudly in dev).
 */

/** The tokens one composed placeholder Pip needs (spec §11 layers). */
export interface PipPaletteTokens {
  /** The species' single vibrant accent (head sprout, flair). */
  readonly accent: string;
  /** Main blob body fill. */
  readonly body: string;
  /** Belly patch fill (lighter than body). */
  readonly belly: string;
  /** Pattern overlay color (dots / stripes / swirl). */
  readonly pattern: string;
  /** Soft outline / shading tone. */
  readonly outline: string;
  /** Cheek blush. */
  readonly blush: string;
}

/** Per-variant tokens (everything except the species-wide accent). */
export type PipPaletteVariant = Omit<PipPaletteTokens, "accent">;

export interface SpeciesPaletteDef {
  /** One vibrant accent per species (spec §11). */
  readonly accent: string;
  /** Keyed by the palette ids in the species registry's `sprite.palettes`. */
  readonly variants: Readonly<Record<string, PipPaletteVariant>>;
  /** Variant used when a genome carries an unknown palette id. */
  readonly fallbackVariantId: string;
}

/** Neutral look for unknown species ids — soft lavender, never a crash. */
const WILDCARD_VARIANT: PipPaletteVariant = {
  body: "#cbc3e3",
  belly: "#eae6f5",
  pattern: "#a99bd1",
  outline: "#847aa8",
  blush: "#f0b8c4",
};

const WILDCARD_ACCENT = "#5ec8e5";

export const speciesPalettes: Readonly<Record<string, SpeciesPaletteDef>> = {
  mosspip: {
    accent: "#ff8a5c", // vibrant coral — the one loud note per spec §11
    fallbackVariantId: "fern",
    variants: {
      fern: {
        body: "#aed9a4",
        belly: "#e4f3d9",
        pattern: "#7fb371",
        outline: "#5f8a5e",
        blush: "#f2b8bd",
      },
      lichen: {
        body: "#b9cfc0",
        belly: "#e8f1e7",
        pattern: "#8aab97",
        outline: "#6c8878",
        blush: "#f0bfc0",
      },
      clover: {
        body: "#a2d7ba",
        belly: "#dcf2e4",
        pattern: "#6fbd90",
        outline: "#568f70",
        blush: "#f4b9c4",
      },
    },
  },
  grovepip: {
    accent: "#f7b32b", // vibrant marigold
    fallbackVariantId: "fern",
    variants: {
      fern: {
        body: "#8fc487",
        belly: "#d4ecc9",
        pattern: "#699a60",
        outline: "#4c7a4c",
        blush: "#e8a9ae",
      },
      lichen: {
        body: "#9dbba9",
        belly: "#dcebdc",
        pattern: "#75957f",
        outline: "#587463",
        blush: "#e5adae",
      },
      clover: {
        body: "#86c2a0",
        belly: "#c9e9d6",
        pattern: "#5da47c",
        outline: "#457f60",
        blush: "#eaa9b4",
      },
    },
  },
};

/**
 * Resolve the full token set for a genome's `(speciesId, palette)` pair.
 * Never throws: unknown species → wildcard; unknown variant → the
 * species' fallback variant (then wildcard if even that is missing).
 */
export function resolvePipPalette(
  speciesId: string,
  paletteId: string,
): PipPaletteTokens {
  const species = speciesPalettes[speciesId];
  if (species === undefined) {
    return { accent: WILDCARD_ACCENT, ...WILDCARD_VARIANT };
  }
  const variant =
    species.variants[paletteId] ??
    species.variants[species.fallbackVariantId] ??
    WILDCARD_VARIANT;
  return { accent: species.accent, ...variant };
}

/** The Keep diorama's pastel ground/sky tones (spec §11 placeholder art). */
export const keepPalette = {
  skyTop: "#cfe8f7",
  skyBottom: "#eef7ea",
  sunGlow: "#fff3c9",
  hillFar: "#dcedc4",
  hillNear: "#cbe5ae",
  ground: "#b7dda1",
  groundNear: "#a8d492",
  path: "#ead9b0",
  tuft: "#8fbf79",
  flowerPetals: ["#f6a8b8", "#f9d47d", "#b79ff0", "#8fd8e8"],
  flowerCore: "#fff6e0",
} as const;

/** Mood dot colors (spec §10 top bar), keyed by the core Mood ids. */
export const moodColors: Readonly<Record<string, string>> = {
  beaming: "#f6b73c",
  content: "#7cc283",
  grumpy: "#e8935a",
  miserable: "#d96a6a",
};

/** Need bar colors (spec §10), keyed by NeedId, plus low-state shifts. */
export const needColors: Readonly<Record<string, string>> = {
  hunger: "#e8a54b",
  cleanliness: "#64c3d9",
  happiness: "#e88bb1",
  energy: "#8bc46e",
};

/** Bar color shifts when a need is low (ui thresholds: < 40 / < 15). */
export const needWarnColor = "#e8935a";
export const needDangerColor = "#d96a6a";

/** Item colors for care-animation morsels / inventory chips, by item id. */
export const itemColors: Readonly<Record<string, string>> = {
  berry: "#e0607e",
  stew: "#d99a4e",
};

/** Fallback for items without an authored color. */
export const itemFallbackColor = "#c9a86b";
