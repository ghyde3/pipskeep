/**
 * FLAIR REGISTRY (docs/retention-bible.md §4.3) — the reward that "carries
 * most of the long-haul rows": Album page frames, a curator's stamp on the
 * cover, a ribbon under a species portrait, a title on a Pip's card, a Long
 * Meadow gate sign.
 *
 * WHY THIS FILE EXISTS AT ALL. Round 2C shipped 22 `kind: "flair"` milestone
 * rewards against no registry, no state field and no renderer — so every
 * long-haul target in the game (14/14 The Album, 21/21 the Grove Ledger, the
 * 30-day streak, 100 bounties) paid literally nothing while the sheet
 * promised "a flourish for the Album". That is exactly the failure mode spec
 * v1.3 already made a standing rule about: *treat "written to state" and
 * "visible to the player" as separate acceptance criteria.* Flair is now
 * both — `GameState.flair` records it and `ui/pipdex.ts` (the Album cover
 * and its page frame), `ui/sanctuary.ts` (the gate sign) and
 * `ui/focusView.ts` (a Pip's title) all draw it.
 *
 * Flair is pure decoration by construction: it grants no resources, no
 * items, no capability, and touches nothing on the §0.4 isolation list. It
 * is infinitely grantable and costs the economy exactly nothing — which is
 * the whole reason the bible hands it the long haul.
 *
 * Content, not core: adding a flourish is a data change here plus (if it is
 * a new `kind`) one render branch. `flair.test.ts` pins the registry against
 * `content/milestones.ts` so a milestone can never again promise a flourish
 * that does not exist.
 */

/**
 * Where a flourish actually appears. Every kind has a real renderer — a
 * `kind` with nowhere to draw it is the bug this file was written to fix, so
 * `flair.test.ts` asserts every registry entry's kind is one of these and
 * `ui/pipdex.test.ts` / `ui/sanctuary.test.ts` assert each one renders.
 */
export type FlairKind =
  /** A stamp/sticker pressed into the Album's cover. */
  | "coverStamp"
  /** A ribbon along the Album's cover, under the count lines. */
  | "ribbon"
  /** A border treatment on the Album's pages — the highest-ranked earned
   * frame wins (they are mutually exclusive by nature; the rest still show
   * in the cover's flourishes strip, so nothing is ever invisible). */
  | "pageFrame"
  /** An honourific shown on a Pip's card in the focus view. */
  | "pipTitle"
  /** A carved sign at the Long Meadow's gate. */
  | "sanctuarySign";

export interface FlairDef {
  readonly id: string;
  readonly kind: FlairKind;
  /** Player-facing name — warm, never a rank or a score. */
  readonly name: string;
  /** One line, past-tense and warm, shown beside the flourish. */
  readonly note: string;
  /** A single emoji glyph the DOM draws it with. */
  readonly glyph: string;
  /** `pageFrame` only: higher wins when several are earned. Ordered by how
   * long-haul the milestone behind it is, so the rarest frame shows. */
  readonly rank?: number;
  /**
   * ROUND 2F — RENOWN (docs/progression-bible.md §1.7). Set on the twelve
   * `renown-*` entries only: the Renown level that mints this flourish.
   * Everything else is minted by a milestone and leaves this undefined.
   *
   * WHY THESE EXIST. The bible called Renown "the LAST thing to cut from the
   * round" and it was cut anyway: `tuning.progression.renown` shipped with
   * its `flairEveryLevels` DELETED and a comment explaining that
   * `content/flair.ts` had no Renown entries to mint. So the reward for
   * 3,000 XP past tier 12 — roughly four engaged days, and the whole answer
   * to "what is there at day 30" — was the level chip's text changing. These
   * twelve entries are the other half, and `core/state.ts` grants them on
   * every Renown level crossed.
   */
  readonly renownLevel?: number;
}

export const FLAIR: readonly FlairDef[] = [
  // ---- Cover stamps & stickers (first-hour and first-day rows) ----
  {
    id: "cover-egg-sticker",
    kind: "coverStamp",
    name: "Egg Sticker",
    note: "Stuck on the cover the day the first egg turned up.",
    glyph: "🥚",
  },
  {
    id: "cover-decorator-ribbon",
    kind: "coverStamp",
    name: "Decorator's Sticker",
    note: "For the day the Keep started looking like somewhere.",
    glyph: "🪴",
  },
  {
    id: "cover-full-house-stamp",
    kind: "coverStamp",
    name: "Full House Stamp",
    note: "Pressed in when the Keep first held three.",
    glyph: "🏡",
  },
  {
    id: "album-explorer-stamp",
    kind: "coverStamp",
    name: "Explorer's Stamp",
    note: "Six trails, all walked at least once.",
    glyph: "🧭",
  },
  {
    id: "album-curator-stamp",
    kind: "coverStamp",
    name: "Curator's Stamp",
    note: "Every page filled in. The whole set.",
    glyph: "📚",
  },
  {
    id: "album-glimmer-stamp",
    kind: "coverStamp",
    name: "Glimmer Stamp",
    note: "Something shimmered that wasn't supposed to.",
    glyph: "✨",
  },
  {
    id: "album-founder-stamp",
    kind: "coverStamp",
    name: "Founder's Stamp",
    note: "You were here before the Album could keep count.",
    glyph: "🌱",
  },

  // ---- Ribbons (streak and first-page rows) ----
  {
    id: "album-first-page-ribbon",
    kind: "ribbon",
    name: "First Page Ribbon",
    note: "Tied around the first page that wasn't blank.",
    glyph: "🎗",
  },
  {
    id: "album-week-ribbon",
    kind: "ribbon",
    name: "Week Ribbon",
    note: "A whole week of showing up.",
    glyph: "🏵",
  },
  {
    id: "album-evolution-ribbon",
    kind: "ribbon",
    name: "Growing-Up Ribbon",
    note: "For the first time someone grew up in front of you.",
    glyph: "🍃",
  },
  {
    id: "album-month-ribbon",
    kind: "ribbon",
    name: "Month Ribbon",
    note: "A month of ordinary days, one after another.",
    glyph: "🎀",
  },

  // ---- Page frames (long haul; highest rank wins) ----
  {
    id: "album-caretaker-frame",
    kind: "pageFrame",
    name: "Caretaker's Frame",
    note: "Five hundred small kindnesses, framed.",
    glyph: "🖼",
    rank: 3,
  },
  {
    id: "album-wanderer-frame",
    kind: "pageFrame",
    name: "Wanderer's Frame",
    note: "A hundred homecomings, framed.",
    glyph: "🗺",
    rank: 3,
  },
  {
    id: "album-ledger-frame",
    kind: "pageFrame",
    name: "Ledger Frame",
    note: "Every gift, every line, every leaf.",
    glyph: "🌿",
    rank: 5,
  },
  {
    id: "album-bounty-frame",
    kind: "pageFrame",
    name: "Errand-Runner's Frame",
    note: "A hundred small errands, all done.",
    glyph: "📜",
    rank: 2,
  },
  {
    id: "album-elder-frame",
    kind: "pageFrame",
    name: "Elder's Frame",
    note: "Thirty days lived, at home or over the hill.",
    glyph: "🕯",
    rank: 4,
  },
  {
    id: "album-decorator-frame",
    kind: "pageFrame",
    name: "Decorator's Frame",
    note: "Fifty things set down with care.",
    glyph: "🏡",
    rank: 2,
  },
  {
    id: "album-round-frame",
    kind: "pageFrame",
    name: "Full-Round Frame",
    note: "A hundred whole rounds, cleared.",
    glyph: "☀",
    rank: 2,
  },

  // ---- Pip titles ----
  {
    id: "pip-card-old-friend-title",
    kind: "pipTitle",
    name: "Old Friend of the Trail",
    note: "Knows one path better than anyone.",
    glyph: "🥾",
  },
  {
    id: "pip-card-well-travelled-title",
    kind: "pipTitle",
    name: "Well Travelled",
    note: "Knows every trail, at least a little.",
    glyph: "🎒",
  },

  // ---- Long Meadow gate signs ----
  {
    id: "sanctuary-gate-sign",
    kind: "sanctuarySign",
    name: "The Long Meadow — mind the gate",
    note: "Carved the day the first friend went to help out over the hill.",
    glyph: "🪧",
  },
  {
    id: "sanctuary-gathering-sign",
    kind: "sanctuarySign",
    name: "A warm little community, this",
    note: "Added when five friends were settled over the hill.",
    glyph: "🌼",
  },

  // ---- ROUND 2F: RENOWN (bible §1.7) — one flourish per Renown level ----
  //
  // Twelve, deliberately spread across ALL FIVE kinds so the endgame keeps
  // changing a DIFFERENT surface each time rather than stacking twelve
  // stickers in one strip: the Album cover (stamps + ribbons), its page
  // border (frames), a Pip's card (titles) and the Long Meadow's gate
  // (signs). Every one of those renderers already exists and is already
  // tested, which is exactly why the bible could call Renown "the cheapest
  // possible answer to what is there at day 60".
  //
  // Flair only, forever: no resources, no capability, no cap change — so
  // this whole block is provably outside `balance.test.ts`'s reach.
  {
    id: "renown-lamplight-stamp",
    kind: "coverStamp",
    renownLevel: 1,
    name: "Lamplight Stamp",
    note: "Lit the night the Keep first outgrew its own ladder.",
    glyph: "🏮",
  },
  {
    id: "renown-well-known-ribbon",
    kind: "ribbon",
    renownLevel: 2,
    name: "Well-Known Ribbon",
    note: "Word got round. People know this place now.",
    glyph: "🎖",
  },
  {
    id: "renown-keeper-title",
    kind: "pipTitle",
    renownLevel: 3,
    name: "Keeper of the Keep",
    note: "Has the run of the place, and is quietly smug about it.",
    glyph: "🗝",
  },
  {
    id: "renown-brass-frame",
    kind: "pageFrame",
    renownLevel: 4,
    name: "Brass Frame",
    note: "Pages bound in something that catches the light.",
    glyph: "🔆",
    rank: 6,
  },
  {
    id: "renown-orchard-sign",
    kind: "sanctuarySign",
    renownLevel: 5,
    name: "Mind the pears — they're for everyone",
    note: "Carved the year there was fruit enough to spare.",
    glyph: "🍐",
  },
  {
    id: "renown-high-summer-stamp",
    kind: "coverStamp",
    renownLevel: 6,
    name: "High Summer Stamp",
    note: "Pressed in during one long, easy summer.",
    glyph: "🌻",
  },
  {
    id: "renown-hearthside-ribbon",
    kind: "ribbon",
    renownLevel: 7,
    name: "Hearthside Ribbon",
    note: "For a great many evenings in, with the door shut.",
    glyph: "🧡",
  },
  {
    id: "renown-old-hand-title",
    kind: "pipTitle",
    renownLevel: 8,
    name: "Old Hand of the Keep",
    note: "Was here before most of the furniture.",
    glyph: "🌾",
  },
  {
    id: "renown-lantern-frame",
    kind: "pageFrame",
    renownLevel: 9,
    name: "Lantern Frame",
    note: "A warm border, for pages read late.",
    glyph: "🪔",
    rank: 7,
  },
  {
    id: "renown-far-hill-sign",
    kind: "sanctuarySign",
    renownLevel: 10,
    name: "You can see the whole valley from here",
    note: "Put up where the path finally levels out.",
    glyph: "🏞",
  },
  {
    id: "renown-north-star-stamp",
    kind: "coverStamp",
    renownLevel: 11,
    name: "North Star Stamp",
    note: "The one everyone steers home by.",
    glyph: "⭐",
  },
  {
    id: "renown-evergreen-ribbon",
    kind: "ribbon",
    renownLevel: 12,
    name: "Evergreen Ribbon",
    note: "Still here. Still green. No particular reason to stop.",
    glyph: "🌲",
  },
] as const;

/** Every Renown flourish, ordered by the level that mints it (bible §1.7).
 * `content/flair.test.ts` pins this against `tuning.progression.renown` so a
 * retuned `xpPerLevel` can never outrun the flourishes it promises. */
export const RENOWN_FLAIR: readonly FlairDef[] = FLAIR.filter(
  (f) => f.renownLevel !== undefined,
).sort((a, b) => (a.renownLevel ?? 0) - (b.renownLevel ?? 0));

/** The highest Renown level that mints a flourish — past this the chip keeps
 * counting honestly ("Renown 14") and the Album says every flourish is in. */
export const RENOWN_TOP_FLAIR_LEVEL: number = RENOWN_FLAIR.reduce(
  (max, f) => Math.max(max, f.renownLevel ?? 0),
  0,
);

/** The flourish minted by reaching exactly `level`, or null (level ≤ 0, or
 * past the end of the ladder). */
export function renownFlairForLevel(level: number): FlairDef | null {
  if (level <= 0) return null;
  return RENOWN_FLAIR.find((f) => f.renownLevel === level) ?? null;
}

/** Every flourish minted by crossing from `fromLevel` to `toLevel` — the
 * grant seam `core/state.ts` calls after each XP award. Handles multi-level
 * jumps (a big CATCHUP, a debug grant) without skipping a flourish, and
 * returns nothing at all when the level did not move. */
export function renownFlairEarnedBetween(
  fromLevel: number,
  toLevel: number,
): readonly FlairDef[] {
  if (toLevel <= fromLevel) return [];
  const out: FlairDef[] = [];
  for (let lvl = Math.max(1, fromLevel + 1); lvl <= toLevel; lvl++) {
    const def = renownFlairForLevel(lvl);
    if (def !== null) out.push(def);
  }
  return out;
}

export function flairById(id: string): FlairDef | undefined {
  return FLAIR.find((f) => f.id === id);
}

/** Earned flourishes of one kind, in registry order — the Album's cover
 * strip, the gate signs and a Pip's titles all read this. */
export function earnedFlairOfKind(
  earned: Readonly<Record<string, number>>,
  kind: FlairKind,
): readonly FlairDef[] {
  return FLAIR.filter((f) => f.kind === kind && earned[f.id] !== undefined);
}

/** The single page frame in force: the highest-ranked earned `pageFrame`,
 * ties broken by registry order. Null when none is earned yet. */
export function activePageFrame(
  earned: Readonly<Record<string, number>>,
): FlairDef | null {
  let best: FlairDef | null = null;
  for (const def of FLAIR) {
    if (def.kind !== "pageFrame") continue;
    if (earned[def.id] === undefined) continue;
    if (best === null || (def.rank ?? 0) > (best.rank ?? 0)) best = def;
  }
  return best;
}
