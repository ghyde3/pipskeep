/**
 * Accessory registry (spec §3, spec §11's accessory-anchor placeholder
 * standard; round 2D — docs/BACKLOG.md "Round 2D" item 3).
 *
 * Before this file, `TraitGenome.accessorySlots` was copied whole from the
 * species registry into every genome of that species (not even
 * per-individual) and `render/spriteResolver.ts` built a positioned,
 * empty `accessoryAnchor` container that nothing ever attached to — the
 * SEVENTH dead trait shipped in this codebase (round 2A/2B/2C/2F each
 * found one of the first six). This registry is the content half of
 * fixing that; `render/spriteResolver.ts` draws every id below through
 * the single `accessoryAnchor` path, and `ui/focusView.ts` / `ui/pipdex.ts`
 * / `ui/sanctuary.ts` render the same id as a DOM class on the two flat
 * portrait surfaces (parity guarded by `ui/portraitPatterns.test.ts`).
 *
 * TWELVE accessories, each with a distinct silhouette family (cap /
 * crown / neck / shoulder / hanging / floating) so no two are visually
 * confusable even as small shapes. Several lean into a biome's flavor —
 * `shellpauldron` reads as shore life, `emberbead` as hearth-fire, and so
 * on — but NONE are restricted to their "home" species: `rollGenome`
 * (core/pips/genome.ts) picks the worn accessory before it knows which
 * Pip is wearing it, and a Pebblepip in a lantern bead is a charming
 * accident, not a bug. `speciesAffinity` below is documentation only (and
 * a hook for a future filtered gift-shop UI) — it changes no roll weight.
 *
 * THE "NONE" SENTINEL (why this isn't just `null`): `core/pips/genome.ts`'s
 * `pickAccessory` always fires exactly one roll and, given a non-empty
 * `content.accessoryIds` list, always returns a MEMBER OF THAT LIST — it
 * has no concept of "sometimes pick nothing" (and round 2D's own module
 * doc for that file promises the accessory seam needs "zero changes to
 * this file", so it stays that way). To make bare Pips possible — the
 * task's explicit "NOT every Pip has one" requirement — `NO_ACCESSORY_ID`
 * ("none") is a real, pickable member of the roll pool below, and every
 * render surface treats it (and the pre-2D `null`/`undefined` genomes that
 * predate this file entirely) identically: draw nothing. `TraitGenome.
 * accessoryId`'s `null` stays reachable too (an empty `content.
 * accessoryIds`, e.g. a bare `rollGenome()` call in a test) — `undefined`
 * still means "never rolled" (every pre-2D genome, every bred child).
 * `resolveAccessory` below is the one place all three "bare" spellings
 * (`undefined`, `null`, `"none"`) collapse to the same answer.
 *
 * WEIGHTING: `ACCESSORY_ROLL_POOL` is a flat array `stream.pick` draws
 * uniformly from (the same "repeat an entry to weight it" trick
 * `core/state.ts`'s starter/egg pools already rely on elsewhere) — no
 * change to the picking mechanism, just a longer list. `NO_ACCESSORY_WEIGHT`
 * (8) against twelve accessories at weight 1 each (12) puts the pool at
 * 20 entries, so a hatchling comes up bare 8/20 = 40% of the time. Chosen
 * deliberately: high enough that a bare Pip — the pre-2D look everyone
 * already knows — stays completely normal and charming, low enough that
 * accessories read as a common, noticeable feature of the roster within a
 * few hatches, not a rare drop.
 */

export type AccessoryId =
  | "leafcap"
  | "flower"
  | "scarf"
  | "shellpauldron"
  | "lantern"
  | "pebblecrown"
  | "berrycrown"
  | "snowcap"
  | "cloudwisp"
  | "emberbead"
  | "acorncap"
  | "bowtie";

/**
 * Where on the body an accessory is worn. ROUND 2D FIX STAGE: the first
 * pass positioned all twelve by hand on three surfaces independently, and
 * five landed on the wrong body part — the scarf across the mouth (it
 * read as a gag), the lantern over an eye, the bowtie and the ember bead
 * mid-belly where a mouth would be, the shell pauldron on the blush.
 *
 * The root cause was that "neck" and "shoulder" were opinions held
 * separately in `render/spriteResolver.ts`, `ui/ui.css` and
 * `ui/pipdex.css`. They are content now: each surface derives its own
 * geometry FROM this field, so all three agree on which body part is
 * meant even though each still authors its own shapes (spec §11's
 * three-implementations pattern, which `ui/portraitPatterns.test.ts`
 * guards).
 *
 * The zones, in "fraction of body height measured DOWN from the crown"
 * — the one coordinate system every surface can express:
 * - `crown`   ~0.00: worn ON the head, overlapping it (never floating).
 * - `neck`    ~0.72: below the mouth (~0.60), across the top of the belly.
 * - `shoulder`~0.66: same height, out on one flank.
 * - `side`    ~0.45-0.80: hanging beside the body, clear of the face.
 */
export type AccessorySlot = "crown" | "neck" | "shoulder" | "side";

export interface AccessoryDef {
  readonly id: AccessoryId;
  /** Which body zone this is worn on — see `AccessorySlot`. */
  readonly slot: AccessorySlot;
  /** Display name — debug/QA labeling and a11y (`aria-label`) only; no
   * player-facing UI names an accessory directly yet (spec §16 v1.3: a
   * name nothing shows is fine as long as SOMETHING visual is — here the
   * shape itself is the visible half). */
  readonly name: string;
  /** Primary fill, shared by every render surface (single source of
   * truth for color, exactly like `content/palette.ts`'s tokens) — each
   * surface still authors its OWN shape/geometry (the established
   * three-implementations pattern `portraitPatterns.test.ts` guards). */
  readonly primaryColor: string;
  /** Secondary/accent fill for accessories with a two-tone design.
   * Absent = single-tone. */
  readonly secondaryColor?: string;
  /** Documentation-only flavor hook (see module doc) — which species this
   * accessory's silhouette was designed to echo. Never consulted by the
   * roll (`core/pips/genome.ts`'s `pickAccessory` has no species
   * awareness at roll time) or by the resolver (every accessory renders
   * identically regardless of the wearer's species, spec §11: no
   * per-species render code). */
  readonly speciesAffinity?: readonly string[];
}

export const accessories: Readonly<Record<AccessoryId, AccessoryDef>> = {
  leafcap: {
    id: "leafcap",
    slot: "crown",
    name: "Leaf Cap",
    primaryColor: "#5ba05a",
    secondaryColor: "#3f7a40",
    speciesAffinity: ["mosspip", "grovepip"],
  },
  flower: {
    id: "flower",
    slot: "crown",
    name: "Flower",
    primaryColor: "#f2a6c4",
    secondaryColor: "#f7d24a",
  },
  scarf: {
    id: "scarf",
    slot: "neck",
    name: "Scarf",
    primaryColor: "#d9683c",
    secondaryColor: "#b84f2b",
  },
  shellpauldron: {
    id: "shellpauldron",
    slot: "shoulder",
    name: "Shell Pauldron",
    primaryColor: "#f0d6b8",
    secondaryColor: "#d9a878",
    speciesAffinity: ["tidepip", "reefpip"],
  },
  lantern: {
    id: "lantern",
    slot: "side",
    name: "Little Lantern",
    primaryColor: "#f7c948",
    secondaryColor: "#8a6a3a",
    speciesAffinity: ["lanternpip", "beaconpip"],
  },
  pebblecrown: {
    id: "pebblecrown",
    slot: "crown",
    name: "Pebble Crown",
    primaryColor: "#a8a29a",
    secondaryColor: "#847e73",
    speciesAffinity: ["pebblepip", "cairnpip"],
  },
  berrycrown: {
    id: "berrycrown",
    slot: "crown",
    name: "Berry Crown",
    primaryColor: "#8e3b6b",
    secondaryColor: "#5ba05a",
  },
  snowcap: {
    id: "snowcap",
    slot: "crown",
    name: "Snow Cap",
    primaryColor: "#eaf4fb",
    secondaryColor: "#a9c9de",
    speciesAffinity: ["snowpip", "frostpip"],
  },
  cloudwisp: {
    id: "cloudwisp",
    slot: "crown",
    name: "Cloud Wisp",
    primaryColor: "#f2eef8",
    secondaryColor: "#c7bfe0",
    speciesAffinity: ["cloudpip", "thunderpip"],
  },
  emberbead: {
    id: "emberbead",
    slot: "neck",
    name: "Ember Bead",
    primaryColor: "#ff7a3c",
    secondaryColor: "#8a3a20",
    speciesAffinity: ["emberpip", "hearthpip"],
  },
  acorncap: {
    id: "acorncap",
    slot: "crown",
    name: "Acorn Cap",
    primaryColor: "#9c6b3e",
    secondaryColor: "#5c3f24",
  },
  bowtie: {
    id: "bowtie",
    slot: "neck",
    name: "Bowtie",
    primaryColor: "#e0567e",
    secondaryColor: "#a83b5c",
  },
};

/** Registry order, fixed (WRITERS may append; do not reorder — it is the
 * same "a fixed seed reproduces the same roll forever" concern
 * `content/names.ts`'s doc calls out). */
export const ACCESSORY_IDS: readonly AccessoryId[] = [
  "leafcap",
  "flower",
  "scarf",
  "shellpauldron",
  "lantern",
  "pebblecrown",
  "berrycrown",
  "snowcap",
  "cloudwisp",
  "emberbead",
  "acorncap",
  "bowtie",
];

/** The sentinel `TraitGenome.accessoryId` value meaning "rolled, came up
 * bare" — see the module doc's "THE NONE SENTINEL" section. Never a key in
 * `accessories` above (guarded by `accessories.test.ts`). */
export const NO_ACCESSORY_ID = "none";

/**
 * See the module doc's WEIGHTING section: `NO_ACCESSORY_WEIGHT` "none"
 * copies against 12 accessories at weight 1 each.
 *
 * ROUND 2D FIX STAGE — retuned 8 → 4 (40% bare → 25% bare). The round
 * exists because Pips were interchangeable, and the first pass then made
 * accessories the rarest identity signal of the four: starters and bred
 * children got none at all (fixed separately, in `core/state.ts` and
 * `core/pips/genome.ts`), so a real roster ran well under the nominal
 * 60%. A quarter bare still keeps the pre-2D bare look completely normal
 * — it is the single most common outcome by a factor of three — while
 * making "which one is wearing the leaf cap?" a question a player can
 * actually ask about their own roster.
 */
export const NO_ACCESSORY_WEIGHT = 4;

/**
 * The pool handed to `rollGenome`'s `content.accessoryIds` (core/pips/
 * genome.ts) — `stream.pick` draws uniformly, so repetition IS weighting.
 * Order doesn't affect fairness (a uniform pick over a fixed list), but
 * IS part of the seed's reproducibility contract once shipped: appending
 * only (never reordering/removing) keeps every past roll's outcome fixed.
 */
export const ACCESSORY_ROLL_POOL: readonly string[] = [
  ...Array(NO_ACCESSORY_WEIGHT).fill(NO_ACCESSORY_ID) as string[],
  ...ACCESSORY_IDS,
];

/**
 * Resolve a genome's `accessoryId` to its content def, or `null` for every
 * spelling of "bare": `undefined` (never rolled — pre-2D genomes, bred
 * children), `null` (rolled against an empty pool — e.g. a bare
 * `rollGenome()` test call), the `"none"` sentinel (rolled against the
 * real pool and came up bare), or an id that matches nothing in the
 * registry (defensive — content should never drift out of sync with a
 * saved id, but an unrecognized accessory silently omitting itself is a
 * far better failure than a crash, matching `resolvePipPalette`'s
 * "never throws" precedent).
 */
export function resolveAccessory(id: string | null | undefined): AccessoryDef | null {
  if (id === null || id === undefined || id === NO_ACCESSORY_ID) return null;
  return accessories[id as AccessoryId] ?? null;
}
