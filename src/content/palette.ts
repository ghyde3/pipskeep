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
      // ROUND 2B (content-bible §1.7/§8.2.2): evolution GIFT-VARIANT looks
      // — additive keys, keyed by `evolution.giftVariants`/`defaultVariantId`
      // values (content/species.ts), NOT by birth palette id. `fern`/
      // `lichen`/`clover` above stay the birth-inherited look (a Pip keeps
      // its birth palette id through evolution); these four are what the
      // resolver switches to once `resolvePipSprite` is passed the Pip's
      // stored `evolved.variantId` (spriteResolver.ts's `variantId` param).
      // Until that wiring lands in render/keepScene.ts (§8.2.2, outside
      // this file's fence), these entries are correct-but-unread data —
      // shipping them now means the fix is a read, not a design exercise.
      berrybright: {
        body: "#ad9e91",
        belly: "#dad3ce",
        pattern: "#877b71",
        outline: "#645c54",
        blush: "#e8a9ae",
      },
      heartymoss: {
        body: "#aab380",
        belly: "#d9ddc6",
        pattern: "#858c64",
        outline: "#63684a",
        blush: "#e8a9ae",
      },
      sunorchard: {
        body: "#b2bc73",
        belly: "#dce1c0",
        pattern: "#8b935a",
        outline: "#676d43",
        blush: "#e8a9ae",
      },
      verdant: {
        body: "#b2bc77",
        belly: "#dce1c2",
        pattern: "#8b935d",
        outline: "#676d45",
        blush: "#e8a9ae",
      },
    },
  },

  // ============================================================
  // ROUND 2B CONTENT EXPANSION (content-bible §1.8) — twelve new
  // species palettes. Derivation rule for every BIRTH-palette variant
  // below (mechanical starting point, hand-tuned only where a variant
  // read muddy or risked disappearing into the Keep's pastel grass
  // ground — see the camouflage note further down): from the `body`
  // hex, belly = body lightened 55% toward white, pattern = body
  // darkened 22%, outline = body darkened 42%. Accent and blush are
  // each species' one fixed pair (bible table); every variant of a
  // species shares the same accent (palette.test.ts enforces this).
  // ============================================================

  pebblepip: {
    accent: "#8ac926", // lichen lime
    fallbackVariantId: "flint",
    variants: {
      flint: {
        body: "#c8c6bd",
        belly: "#e6e5e1",
        pattern: "#9c9a93",
        outline: "#74736e",
        blush: "#eaa9ad",
      },
      riverstone: {
        body: "#b9c4cc",
        belly: "#e0e4e8",
        pattern: "#90999f",
        outline: "#6b7276",
        blush: "#eaa9ad",
      },
      sandstone: {
        body: "#d9c6ac",
        belly: "#eee5da",
        pattern: "#a99a86",
        outline: "#7e7364",
        blush: "#eaa9ad",
      },
    },
  },
  cairnpip: {
    accent: "#ffd60a", // tucked gold
    fallbackVariantId: "flint",
    variants: {
      // Birth-inherited (same ids as pebblepip; cairnpip has its own hexes).
      flint: {
        body: "#b3b1a7",
        belly: "#dddcd7",
        pattern: "#8c8a82",
        outline: "#686761",
        blush: "#e6a3a6",
      },
      riverstone: {
        body: "#a3b0ba",
        belly: "#d6dbe0",
        pattern: "#7f8991",
        outline: "#5f666c",
        blush: "#e6a3a6",
      },
      sandstone: {
        body: "#c9b494",
        belly: "#e7ddcf",
        pattern: "#9d8c73",
        outline: "#756856",
        blush: "#e6a3a6",
      },
      // Evolution gift-variant looks (content-bible §1.7).
      mosscap: {
        body: "#bca485",
        belly: "#e1d6c8",
        pattern: "#938068",
        outline: "#6d5f4d",
        blush: "#e6a3a6",
      },
      // Camouflage-adjusted (§11 task): a straight glowcap-green blend
      // read almost identical in hue to the Keep's grass ground. Shifted
      // to a cooler teal "vein of light in stone" instead — reads clearly
      // even at top-bar portrait-chip size.
      veinlight: {
        body: "#97bbaf",
        belly: "#d0e0db",
        pattern: "#769289",
        outline: "#586c66",
        blush: "#e6a3a6",
      },
      riverworn: {
        body: "#beb694",
        belly: "#e2decf",
        pattern: "#948e73",
        outline: "#6e6a56",
        blush: "#e6a3a6",
      },
    },
  },
  tidepip: {
    accent: "#00b4d8", // vivid cyan
    fallbackVariantId: "cockle",
    variants: {
      cockle: {
        body: "#f0dcc4",
        belly: "#f8efe4",
        pattern: "#bbac99",
        outline: "#8b8072",
        blush: "#f2b6bd",
      },
      sandbar: {
        body: "#e8d3b3",
        belly: "#f5ebdd",
        pattern: "#b5a58c",
        outline: "#877a68",
        blush: "#f2b6bd",
      },
      seafoam: {
        body: "#d6e8de",
        belly: "#edf5f0",
        pattern: "#a7b5ad",
        outline: "#7c8781",
        blush: "#f2b6bd",
      },
    },
  },
  reefpip: {
    accent: "#ff477e", // coral pink
    fallbackVariantId: "cockle",
    variants: {
      cockle: {
        body: "#e6cdb0",
        belly: "#f4e9db",
        pattern: "#b3a089",
        outline: "#857766",
        blush: "#f0aeb6",
      },
      sandbar: {
        body: "#dcc39f",
        belly: "#efe4d4",
        pattern: "#ac987c",
        outline: "#80715c",
        blush: "#f0aeb6",
      },
      seafoam: {
        body: "#c2ddd1",
        belly: "#e4f0ea",
        pattern: "#97aca3",
        outline: "#718079",
        blush: "#f0aeb6",
      },
      // Camouflage-adjusted: tideroll's teal-green blended in as green as
      // the grass. "Coralbloom" leans into its own name (coral = pink,
      // matching reefpip's accent) instead.
      coralbloom: {
        body: "#e3a6a5",
        belly: "#f2d7d7",
        pattern: "#b18181",
        outline: "#846060",
        blush: "#f0aeb6",
      },
      // Camouflage-adjusted: glowcap green pushed the same way. "Pearlrim"
      // leans into pale nacre instead.
      pearlrim: {
        body: "#e0ddcf",
        belly: "#f1f0e9",
        pattern: "#afaca1",
        outline: "#828078",
        blush: "#f0aeb6",
      },
      seaglass: {
        body: "#dcbfae",
        belly: "#efe2db",
        pattern: "#ac9588",
        outline: "#806f65",
        blush: "#f0aeb6",
      },
    },
  },
  emberpip: {
    accent: "#ff5714", // flame orange
    fallbackVariantId: "cinder",
    variants: {
      cinder: {
        body: "#e8cdbd",
        belly: "#f5e9e1",
        pattern: "#b5a093",
        outline: "#87776e",
        blush: "#f4b0a6",
      },
      hearthash: {
        body: "#dcc4c0",
        belly: "#efe4e3",
        pattern: "#ac9996",
        outline: "#80726f",
        blush: "#f4b0a6",
      },
      coalglow: {
        body: "#f0c9a8",
        belly: "#f8e7d8",
        pattern: "#bb9d83",
        outline: "#8b7561",
        blush: "#f4b0a6",
      },
    },
  },
  hearthpip: {
    accent: "#ff9505", // hearth amber
    fallbackVariantId: "cinder",
    variants: {
      cinder: {
        body: "#d9b8a4",
        belly: "#eedfd6",
        pattern: "#a99080",
        outline: "#7e6b5f",
        blush: "#eda99f",
      },
      hearthash: {
        body: "#ccadaa",
        belly: "#e8dad9",
        pattern: "#9f8785",
        outline: "#766463",
        blush: "#eda99f",
      },
      coalglow: {
        body: "#e3b48d",
        belly: "#f2ddcc",
        pattern: "#b18c6e",
        outline: "#846852",
        blush: "#eda99f",
      },
      bakestone: {
        body: "#d69d7c",
        belly: "#edd3c4",
        pattern: "#a77a61",
        outline: "#7c5b48",
        blush: "#eda99f",
      },
      cinnamon: {
        body: "#c89c81",
        belly: "#e6d2c6",
        pattern: "#9c7a65",
        outline: "#745a4b",
        blush: "#eda99f",
      },
      hearthlight: {
        body: "#ddaf8c",
        belly: "#f0dbcb",
        pattern: "#ac896d",
        outline: "#806651",
        blush: "#eda99f",
      },
    },
  },
  snowpip: {
    accent: "#e63946", // holly red
    fallbackVariantId: "powder",
    variants: {
      powder: {
        body: "#f0f4f8",
        belly: "#f8fafc",
        pattern: "#bbbec1",
        outline: "#8b8e90",
        blush: "#f3bcc4",
      },
      hush: {
        body: "#e2eaf2",
        belly: "#f2f6f9",
        pattern: "#b0b7bd",
        outline: "#83888c",
        blush: "#f3bcc4",
      },
      bluehour: {
        body: "#d4e0ee",
        belly: "#ecf1f7",
        pattern: "#a5afba",
        outline: "#7b828a",
        blush: "#f3bcc4",
      },
    },
  },
  frostpip: {
    accent: "#4cc9f0", // ice cyan
    fallbackVariantId: "powder",
    variants: {
      powder: {
        body: "#e4edf5",
        belly: "#f3f7fb",
        pattern: "#b2b9bf",
        outline: "#84898e",
        blush: "#eeb3bf",
      },
      hush: {
        body: "#d2e0ec",
        belly: "#ebf1f6",
        pattern: "#a4afb8",
        outline: "#7a8289",
        blush: "#eeb3bf",
      },
      bluehour: {
        body: "#c0d4e8",
        belly: "#e3ecf5",
        pattern: "#96a5b5",
        outline: "#6f7b87",
        blush: "#eeb3bf",
      },
      cocoadust: {
        body: "#c4b9b5",
        belly: "#e4e0de",
        pattern: "#99908d",
        outline: "#726b69",
        blush: "#eeb3bf",
      },
      berryfrost: {
        body: "#b5d7ec",
        belly: "#deedf6",
        pattern: "#8da8b8",
        outline: "#697d89",
        blush: "#eeb3bf",
      },
      windowfrost: {
        body: "#c2ddee",
        belly: "#e4f0f7",
        pattern: "#97acba",
        outline: "#71808a",
        blush: "#eeb3bf",
      },
    },
  },
  cloudpip: {
    accent: "#9d4edd", // violet
    fallbackVariantId: "nimbus",
    variants: {
      nimbus: {
        body: "#f2eef8",
        belly: "#f9f7fc",
        pattern: "#bdbac1",
        outline: "#8c8a90",
        blush: "#f2bcc8",
      },
      dawnwash: {
        body: "#f6e4ea",
        belly: "#fbf3f6",
        pattern: "#c0b2b7",
        outline: "#8f8488",
        blush: "#f2bcc8",
      },
      duskveil: {
        body: "#e0dcee",
        belly: "#f1eff7",
        pattern: "#afacba",
        outline: "#82808a",
        blush: "#f2bcc8",
      },
    },
  },
  thunderpip: {
    accent: "#ffe74c", // electric yellow
    fallbackVariantId: "nimbus",
    variants: {
      nimbus: {
        body: "#dcd6e6",
        belly: "#efedf4",
        pattern: "#aca7b3",
        outline: "#807c85",
        blush: "#e9b0bf",
      },
      dawnwash: {
        body: "#e2cdd6",
        belly: "#f2e9ed",
        pattern: "#b0a0a7",
        outline: "#83777c",
        blush: "#e9b0bf",
      },
      duskveil: {
        body: "#c8c2d8",
        belly: "#e6e4ed",
        pattern: "#9c97a8",
        outline: "#74717d",
        blush: "#e9b0bf",
      },
      sunshower: {
        body: "#e0c49d",
        belly: "#f1e4d3",
        pattern: "#af997a",
        outline: "#82725b",
        blush: "#e9b0bf",
      },
      hailhush: {
        body: "#b8cae0",
        belly: "#dfe7f1",
        pattern: "#909eaf",
        outline: "#6b7582",
        blush: "#e9b0bf",
      },
      rainveil: {
        body: "#dccfcb",
        belly: "#efe9e8",
        pattern: "#aca19e",
        outline: "#807876",
        blush: "#e9b0bf",
      },
    },
  },
  lanternpip: {
    accent: "#9fff6b", // glow green
    fallbackVariantId: "deepwater",
    variants: {
      deepwater: {
        body: "#9fb8c4",
        belly: "#d4dfe4",
        pattern: "#7c9099",
        outline: "#5c6b72",
        blush: "#e8a9b8",
      },
      mossglow: {
        body: "#a8c2ae",
        belly: "#d8e4db",
        pattern: "#839788",
        outline: "#617165",
        blush: "#e8a9b8",
      },
      embercave: {
        body: "#c2b0a4",
        belly: "#e4dbd6",
        pattern: "#978980",
        outline: "#71665f",
        blush: "#e8a9b8",
      },
    },
  },
  beaconpip: {
    accent: "#00f5d4", // beacon turquoise
    fallbackVariantId: "deepwater",
    variants: {
      deepwater: {
        body: "#8aa6b6",
        belly: "#cad7de",
        pattern: "#6c818e",
        outline: "#50606a",
        blush: "#e2a3b4",
      },
      mossglow: {
        body: "#95b09d",
        belly: "#cfdbd3",
        pattern: "#74897a",
        outline: "#56665b",
        blush: "#e2a3b4",
      },
      embercave: {
        body: "#b09c8e",
        belly: "#dbd2cc",
        pattern: "#897a6f",
        outline: "#665a52",
        blush: "#e2a3b4",
      },
      // Camouflage-adjusted: a straight glowcap-green blend read close to
      // the grass ground in both hue and lightness. "Greenflame" keeps
      // its green (the name commits to it) but pushed cooler/darker,
      // toward beaconpip's own turquoise accent instead of the food's
      // yellow-green, which reads as a deliberate glow rather than a
      // Pip-shaped hole in the lawn.
      greenflame: {
        body: "#5aafa0",
        belly: "#b5dbd4",
        pattern: "#46897d",
        outline: "#34665d",
        blush: "#e2a3b4",
      },
      festival: {
        body: "#b38a7e",
        belly: "#ddcac5",
        pattern: "#8c6c62",
        outline: "#685049",
        blush: "#e2a3b4",
      },
      harbourlight: {
        body: "#88afa6",
        belly: "#c9dbd7",
        pattern: "#6a8981",
        outline: "#4f6660",
        blush: "#e2a3b4",
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
  // ROUND 2B (content-bible §1.8): nine more foods (§4).
  honeydrop: "#f0b429",
  toastnut: "#c98b45",
  frostberry: "#7fc7e8",
  cocoabun: "#a9714b",
  glowcap: "#8fe388",
  tideroll: "#7ec4a8",
  emberloaf: "#d1743c",
  feastpot: "#e0563f",
};

/** Fallback for items without an authored color. */
export const itemFallbackColor = "#c9a86b";
