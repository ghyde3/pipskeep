/**
 * MILESTONE REGISTRY (docs/retention-bible.md §4) — content-defined so a
 * new milestone is a data change, never a `core/` edit (spec §3).
 *
 * Every reward stays inside the four allowed kinds (resources, items, a
 * keepsake decoration, or flair) — NEVER power: no milestone may reference
 * a tuning key on the isolation list (`needDecayPerHour`, `care.*`,
 * `foods.*`, `offlineRateCapMs`, `personalityDecayMultipliers`,
 * `playRefusal`, `sulkExitThreshold`, §0.4). `content/milestones.test.ts`
 * enforces both the kind allowlist and that the pre-level-2 grant sum
 * stays under `tuning.retention.grants.preLevel2WoodCap`.
 *
 * Milestones NEVER carry an `availableWindow` — not "unused", FORBIDDEN.
 * A windowed achievement is permanently-missed content the moment its
 * window closes, which the round's guardrail (§0.2 "nothing is ever
 * missable") rules out categorically.
 */

export type MilestoneMetric =
  | { readonly kind: "counter"; readonly counterId: string }
  | { readonly kind: "albumForms" }
  | { readonly kind: "ledgerVariants" }
  | { readonly kind: "streakLongest" }
  | { readonly kind: "masteryTierAnyBiome" }
  | { readonly kind: "masteryTierAllBiomes" }
  | { readonly kind: "oldestPipAgeMs" }
  | { readonly kind: "sanctuaryResidents" };

export type MilestoneReward =
  | { readonly kind: "resources"; readonly bundle: Readonly<Record<string, number>> }
  | { readonly kind: "items"; readonly items: Readonly<Record<string, number>> }
  | { readonly kind: "keepsake"; readonly decorationId: string }
  | { readonly kind: "flair"; readonly flairId: string }
  | { readonly kind: "none" };

export interface MilestoneDef {
  readonly id: string;
  readonly name: string;
  /** Past-tense, warm, never an imperative (bible §4.1: "You fed someone.
   * They were pleased." — never "Feed someone!"). */
  readonly blurb: string;
  readonly metric: MilestoneMetric;
  readonly threshold: number;
  readonly reward: MilestoneReward;
  /** Revealed only on earning — a surprise, not a hidden chore. */
  readonly hidden?: boolean;
}

export const MILESTONES: readonly MilestoneDef[] = [
  // ---- First hour (bible §4.2) ----
  {
    id: "first-feed",
    name: "First Feed",
    blurb: "Someone got fed. They were very pleased about it.",
    metric: { kind: "counter", counterId: "feeds" },
    threshold: 1,
    reward: { kind: "items", items: { berry: 2 } },
  },
  {
    id: "first-trip-home",
    name: "First Trip Home",
    blurb: "A trip came back with something to show for it.",
    metric: { kind: "counter", counterId: "expeditionsTotal" },
    threshold: 1,
    reward: { kind: "resources", bundle: { fiber: 2 } },
  },
  {
    id: "first-egg-found",
    name: "First Egg Found",
    blurb: "Something small and hopeful turned up in the loot.",
    metric: { kind: "counter", counterId: "eggsFound" },
    threshold: 1,
    reward: { kind: "flair", flairId: "cover-egg-sticker" },
  },
  {
    id: "first-hatch",
    name: "First Hatch",
    blurb: "An egg pipped, and the Keep got a little fuller.",
    metric: { kind: "counter", counterId: "eggsHatched" },
    threshold: 1,
    reward: { kind: "items", items: { berry: 2 } },
  },
  {
    id: "first-nap",
    name: "First Nap",
    blurb: "Someone put their head down and meant it.",
    metric: { kind: "counter", counterId: "naps" },
    threshold: 1,
    reward: { kind: "resources", bundle: { fiber: 1 } },
  },
  {
    id: "first-decoration-placed",
    name: "First Decoration Placed",
    blurb: "The Keep started looking like somewhere, not just something.",
    metric: { kind: "counter", counterId: "decorationsPlaced" },
    threshold: 1,
    reward: { kind: "flair", flairId: "cover-decorator-ribbon" },
  },
  {
    id: "keep-level-2",
    name: "Keep Level 2",
    blurb: "The plot grew, and the Forest opened up.",
    metric: { kind: "counter", counterId: "keepLevel2Reached" },
    threshold: 1,
    reward: { kind: "resources", bundle: { fiber: 2 } },
  },

  // ---- First day ----
  {
    id: "ten-care-actions",
    name: "10 Care Actions",
    blurb: "A whole morning of feeding, cleaning and fussing.",
    metric: { kind: "counter", counterId: "careActions" },
    threshold: 10,
    reward: { kind: "items", items: { berry: 3 } },
  },
  {
    id: "five-trips",
    name: "5 Trips",
    blurb: "Five little journeys, five little homecomings.",
    metric: { kind: "counter", counterId: "expeditionsTotal" },
    threshold: 5,
    reward: { kind: "resources", bundle: { fiber: 3 } },
  },
  {
    id: "three-pips-in-the-keep",
    name: "Three Pips in the Keep",
    blurb: "A full roster. The Keep sounds different now.",
    metric: { kind: "counter", counterId: "rosterSizeReached3" },
    threshold: 1,
    reward: { kind: "flair", flairId: "cover-full-house-stamp" },
  },
  {
    id: "a-pip-at-work",
    name: "A Pip at Work",
    blurb: "Someone found a job they were proud of.",
    metric: { kind: "counter", counterId: "jobsAssigned" },
    threshold: 1,
    reward: { kind: "resources", bundle: { fiber: 2 } },
  },
  {
    id: "first-field-note",
    name: "First Album Field Note",
    blurb: "A page turned up that wasn't blank anymore.",
    metric: { kind: "albumForms" },
    threshold: 1,
    reward: { kind: "flair", flairId: "album-first-page-ribbon" },
  },
  {
    id: "three-bounties-in-a-day",
    name: "Three Bounties in a Day",
    blurb: "Today's whole round, done before lunch.",
    metric: { kind: "counter", counterId: "bountyDaysCleared" },
    threshold: 1,
    reward: { kind: "resources", bundle: { fiber: 2 } },
  },

  // ---- First week ----
  {
    id: "fifty-care-actions",
    name: "50 Care Actions",
    blurb: "A proper habit, now.",
    metric: { kind: "counter", counterId: "careActions" },
    threshold: 50,
    reward: { kind: "items", items: { stew: 1 } },
  },
  {
    id: "twentyfive-trips",
    name: "25 Trips",
    blurb: "The roads are getting familiar.",
    metric: { kind: "counter", counterId: "expeditionsTotal" },
    threshold: 25,
    reward: { kind: "resources", bundle: { fiber: 3, wood: 2 } },
  },
  {
    id: "seven-day-streak",
    name: "A 7-Day Streak",
    blurb: "A whole week of showing up. Nobody kept score but the Keep did, warmly.",
    metric: { kind: "streakLongest" },
    threshold: 7,
    reward: { kind: "flair", flairId: "album-week-ribbon" },
  },
  {
    id: "four-album-forms",
    name: "4 Album Forms",
    blurb: "The scrapbook is filling in.",
    metric: { kind: "albumForms" },
    threshold: 4,
    reward: { kind: "resources", bundle: { fiber: 3 } },
  },
  {
    id: "first-evolution",
    name: "First Evolution",
    blurb: "Someone grew up, right in front of you.",
    metric: { kind: "counter", counterId: "evolutions" },
    threshold: 1,
    reward: { kind: "flair", flairId: "album-evolution-ribbon" },
  },
  {
    id: "keep-level-3",
    name: "Keep Level 3",
    blurb: "The Shore opened, and the horizon got bigger.",
    metric: { kind: "counter", counterId: "keepLevel3Reached" },
    threshold: 1,
    reward: { kind: "resources", bundle: { shell: 2 } },
  },
  {
    id: "every-biome-visited",
    name: "Every Biome Visited",
    blurb: "Six trails, six trips, one very well-travelled Keep.",
    metric: { kind: "counter", counterId: "biomesVisited" },
    threshold: 6,
    reward: { kind: "flair", flairId: "album-explorer-stamp" },
  },
  {
    id: "roster-upgrade",
    name: "Roster Upgrade",
    blurb: "Room for two more.",
    metric: { kind: "counter", counterId: "rosterUpgradePurchased" },
    threshold: 1,
    reward: { kind: "resources", bundle: { fiber: 3 } },
  },
  {
    id: "first-long-meadow-resident",
    name: "First Long Meadow Resident",
    blurb: "Someone went to help out over the hill. They're doing fine.",
    metric: { kind: "counter", counterId: "sanctuaryArrivals" },
    threshold: 1,
    reward: { kind: "flair", flairId: "sanctuary-gate-sign" },
  },
  {
    id: "ten-bounties",
    name: "10 Bounties",
    blurb: "Ten small errands, ten small satisfactions.",
    metric: { kind: "counter", counterId: "bountiesCompleted" },
    threshold: 10,
    reward: { kind: "resources", bundle: { fiber: 3 } },
  },

  // ---- Long haul ----
  {
    id: "five-hundred-care-actions",
    name: "500 Care Actions",
    blurb: "Uncountable, except this counted.",
    metric: { kind: "counter", counterId: "careActions" },
    threshold: 500,
    reward: { kind: "flair", flairId: "album-caretaker-frame" },
  },
  {
    id: "hundred-trips",
    name: "100 Trips",
    blurb: "A hundred homecomings.",
    metric: { kind: "counter", counterId: "expeditionsTotal" },
    threshold: 100,
    reward: { kind: "flair", flairId: "album-wanderer-frame" },
  },
  {
    id: "full-album",
    name: "14/14 The Album",
    blurb: "Every form, met and kept.",
    metric: { kind: "albumForms" },
    threshold: 14,
    reward: { kind: "flair", flairId: "album-curator-stamp" },
  },
  {
    id: "full-ledger",
    name: "21/21 The Grove Ledger",
    blurb: "Every gift, every line, every leaf.",
    metric: { kind: "ledgerVariants" },
    threshold: 21,
    reward: { kind: "flair", flairId: "album-ledger-frame" },
  },
  {
    id: "thirty-day-streak",
    name: "A 30-Day Streak",
    blurb: "A month of showing up, one ordinary day at a time.",
    metric: { kind: "streakLongest" },
    threshold: 30,
    reward: { kind: "flair", flairId: "album-month-ribbon" },
  },
  {
    id: "hundred-bounties",
    name: "100 Bounties",
    blurb: "A hundred small errands, all done.",
    metric: { kind: "counter", counterId: "bountiesCompleted" },
    threshold: 100,
    reward: { kind: "flair", flairId: "album-bounty-frame" },
  },
  {
    id: "thirty-day-old-pip",
    name: "A Pip 30 Days Old",
    blurb: "Thirty days lived, however they were spent — at home or over the hill.",
    metric: { kind: "oldestPipAgeMs" },
    threshold: 30 * 24 * 60 * 60 * 1000,
    reward: { kind: "flair", flairId: "album-elder-frame" },
  },
  {
    id: "mastery-tier-5-any-biome",
    name: "Mastery Tier 5, One Biome",
    blurb: "Someone knows a trail better than anyone.",
    metric: { kind: "masteryTierAnyBiome" },
    threshold: 5,
    reward: { kind: "flair", flairId: "pip-card-old-friend-title" },
  },
  {
    id: "mastery-tier-3-all-biomes",
    name: "Mastery Tier 3, Every Biome",
    blurb: "Someone knows every trail, at least a little.",
    metric: { kind: "masteryTierAllBiomes" },
    threshold: 3,
    reward: { kind: "flair", flairId: "pip-card-well-travelled-title" },
  },
  {
    id: "first-glimmer",
    name: "First Glimmer",
    blurb: "Something shimmered that wasn't supposed to. Lucky you.",
    metric: { kind: "counter", counterId: "shiniesFound" },
    threshold: 1,
    reward: { kind: "flair", flairId: "album-glimmer-stamp" },
    hidden: true,
  },
  {
    id: "fifty-decorations-placed",
    name: "50 Decorations Placed",
    blurb: "The Keep is unmistakably, densely yours.",
    metric: { kind: "counter", counterId: "decorationsPlaced" },
    threshold: 50,
    reward: { kind: "flair", flairId: "album-decorator-frame" },
  },
  {
    id: "five-sanctuary-residents",
    name: "5 Residents at the Long Meadow",
    blurb: "A whole warm little community over the hill.",
    metric: { kind: "sanctuaryResidents" },
    threshold: 5,
    reward: { kind: "flair", flairId: "sanctuary-gathering-sign" },
  },
  {
    id: "hundred-bounty-days",
    name: "100 Bounty-Days",
    blurb: "A hundred whole rounds, cleared.",
    metric: { kind: "counter", counterId: "bountyDaysCleared" },
    threshold: 100,
    reward: { kind: "flair", flairId: "album-round-frame" },
  },

  /**
   * The v6 migration's one-time apology-in-flair (bible §11.3): a
   * returning veteran's Album opens already partly full AND stamped — a
   * gift, never a reset. Granted ONLY by `MIGRATIONS[5]`, never earnable
   * through play (threshold `Infinity` makes the ordinary evaluator a
   * permanent no-op for it — the migration sets `earned` directly).
   */
  {
    id: "founder",
    name: "Founder",
    blurb: "You were here before the Album could keep count. It remembers now.",
    metric: { kind: "counter", counterId: "founderGrantOnly" },
    threshold: Number.POSITIVE_INFINITY,
    reward: { kind: "flair", flairId: "album-founder-stamp" },
    hidden: true,
  },
] as const;

export function milestoneById(id: string): MilestoneDef | undefined {
  return MILESTONES.find((m) => m.id === id);
}
