/**
 * Pip name pool (spec §3; round 2D — docs/BACKLOG.md "Round 2D — Pip
 * identity & variety"). Before this file, `createPipFromGenome` named
 * every hatchling after its species (`contentSpecies[id].name`), so three
 * starters all read as "Mosspip / Mosspip / Mosspip" — the deepest
 * remaining flaw in a game that now asks players to grieve these
 * creatures (round 2H). Every Pip gets an individually rolled name from
 * here instead (`core/pips/genome.ts`'s `rollPipName`); species becomes a
 * subtitle ("Thimble · Mosspip · Curious"), never the identity.
 *
 * Register: warm, storybook-cozy, occasionally whimsical — the tone of
 * `content/dialogue/*.ts` (opinionated, occasionally weird), but these
 * are NAMES, not jokes: no punchlines, never twee. No §0-forbidden
 * vocabulary (Pal, -gotchi, or any Pokémon/Palworld/Tamagotchi term), and
 * nothing built from the game's own species root ("pip") — a Pip called
 * "Pipsqueak" reads as a diminutive of the CREATURE TYPE, not as a name.
 *
 * THE VOCABULARY RULE (round 2D fix stage — this pool shipped nine
 * collisions on its first pass and every one of them broke a real
 * sentence): a name may never be a word the game already uses for a
 * THING. "Feed Berry a Berry", "Send Meadow to the Meadow", "Sprout" as a
 * name when a sprout is the accent feature every single Pip wears on its
 * head — each of those reads as a bug, not as charm. `names.test.ts`
 * enforces this mechanically now: every entry below is checked against
 * every species/food/expedition/decoration/placeable/keep-level/upgrade/
 * palette/pattern/personality/job/ailment/accessory/decor-set/event/
 * milestone id AND display word in the whole content tree, so the class
 * of bug cannot come back when either side grows.
 *
 * Grouped so the pool reads as one coherent world rather than a random
 * list (WRITERS: extend a group below; `names.test.ts` only requires the
 * flattened `NAME_POOL` to stay duplicate-free, ≥ 100 entries, clear of
 * the content vocabulary above, and free of the "pip" root — it does not
 * care about group boundaries). 160 names is comfortably past the "rare
 * collisions across a long game" bar the round asked for: a roster of 5 +
 * a Long Meadow of a few dozen + a 14-species Album's worth of first
 * catches is still a small fraction of the pool, and `rollPipName`
 * additionally excludes every name already in use before it draws.
 */

/** Plants, groves, hedgerows — the game's home turf. */
const GARDEN_AND_GROVE = [
  "Poppy",
  "Marigold",
  "Juniper",
  "Hazel",
  "Willow",
  "Rowan",
  "Heather",
  "Birch",
  "Larch",
  "Sorrel",
  "Nettle",
  "Dandelion",
  "Chestnut",
  "Maple",
  "Petal",
  "Sprig",
  "Bracken",
  "Thistledown",
  "Yarrow",
  "Tansy",
  "Comfrey",
  "Foxglove",
  "Cowslip",
  "Mallow",
] as const;

/** Kitchen-and-hearth warmth — the register the away sheet's "welcome
 * home" copy already lives in. Deliberately the old-fashioned, buttery
 * end of that register (Treacle, Bannock, Bramley) rather than the
 * diner end (Waffle, Pretzel, Nougat), which read as punchlines. */
const HEARTH_AND_KITCHEN = [
  "Biscuit",
  "Marmalade",
  "Nutmeg",
  "Butterscotch",
  "Toffee",
  "Custard",
  "Scone",
  "Treacle",
  "Praline",
  "Gingersnap",
  "Shortbread",
  "Barley",
  "Oatcake",
  "Bannock",
  "Clove",
  "Anise",
  "Vanilla",
  "Caramel",
  "Fudge",
  "Crumble",
  "Molasses",
  "Bramley",
] as const;

/** A little chaotic, a little clumsy — Chaotic/Curious energy. */
const WHIMSY_AND_WOBBLE = [
  "Doodle",
  "Wobble",
  "Sprocket",
  "Bumble",
  "Tumble",
  "Squiggle",
  "Puddle",
  "Flicker",
  "Pocket",
  "Scamper",
  "Waddle",
  "Snicket",
  "Tinker",
  "Fidget",
  "Bobbin",
  "Twitch",
  "Scribble",
  "Rummage",
  "Jostle",
  "Muddle",
] as const;

/** Sky, weather, small wonders — matches Curious's dialogue pool. */
const WEATHER_AND_WONDER = [
  "Breeze",
  "Drizzle",
  "Comet",
  "Squall",
  "Mist",
  "Gossamer",
  "Dewdrop",
  "Sunbeam",
  "Moonrise",
  "Twilight",
  "Daybreak",
  "Vesper",
  "Gale",
  "Rainlily",
  "Halo",
  "Flurry",
  "Zephyr",
  "Drift",
  "Rime",
  "Eddy",
  "Aurora",
  "Dapple",
  "Shimmer",
  "Gloaming",
] as const;

/** Small woodland/pond life — the museum-of-tiny-things vibe. */
const LITTLE_CREATURES = [
  "Squeak",
  "Chirp",
  "Flutter",
  "Cricket",
  "Sparrow",
  "Wren",
  "Finch",
  "Otter",
  "Vole",
  "Newt",
  "Peep",
  "Robin",
  "Snail",
  "Inchworm",
  "Firefly",
  "Ladybird",
  "Tadpole",
  "Minnow",
  "Starling",
  "Dormouse",
  "Dunnock",
  "Linnet",
  "Plover",
  "Wagtail",
] as const;

/** Small objects a Keep collects — Curious's museum, Hardworking's kit. */
const TRINKET_AND_TOOL = [
  "Thimble",
  "Button",
  "Kettle",
  "Ribbon",
  "Marble",
  "Wicker",
  "Hollow",
  "Bellows",
  "Trinket",
  "Cog",
  "Spindle",
  "Whistle",
  "Satchel",
  "Parasol",
  "Buckle",
  "Tassel",
  // ROUND 2J FIX STAGE: "Compass" moved out — the crafted Compass Rose
  // (a craft-only decoration) claimed the word, and docs/economy-bible.md
  // §6.4 is explicit that when the derived forbidden-vocabulary set and
  // the name pool collide, THE POOL ENTRY MOVES, never the content noun.
  // "Sextant" keeps the same nautical-instrument register and the same
  // 140-name count.
  "Sextant",
  "Anchor",
  "Quill",
  "Inkwell",
  "Bodkin",
  "Skein",
  "Locket",
  "Trivet",
] as const;

/** Orchard fruit and herbs — pairs nicely with a Pip actually eating one
 * (but never IS one: `Berry` and `Cocoa` were pulled here for exactly
 * that reason — see the module doc's vocabulary rule). */
const ORCHARD_AND_HERB = [
  "Clementine",
  "Apricot",
  "Plum",
  "Fig",
  "Olive",
  "Basil",
  "Sage",
  "Rosemary",
  "Saffron",
  "Cardamom",
  "Honeydew",
  "Currant",
  "Damson",
  "Quince",
  "Persimmon",
  "Mulberry",
  "Gooseberry",
  "Elderflower",
  "Sloe",
  "Medlar",
  "Bilberry",
  "Rhubarb",
] as const;

/** The whole world, flattened — `rollPipName`'s default pool. Order is
 * stable (WRITERS may append within a group; do not reorder existing
 * entries) so a given RNG draw stays reproducible across edits that only
 * ever grow the pool. */
export const NAME_POOL: readonly string[] = [
  ...GARDEN_AND_GROVE,
  ...HEARTH_AND_KITCHEN,
  ...WHIMSY_AND_WOBBLE,
  ...WEATHER_AND_WONDER,
  ...LITTLE_CREATURES,
  ...TRINKET_AND_TOOL,
  ...ORCHARD_AND_HERB,
];
