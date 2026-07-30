/**
 * DAILY BOUNTY TEMPLATES (docs/retention-bible.md §5.2) — pure content, no
 * logic. `core/progression/bounties.ts` reads this registry to generate a
 * level-aware trio each day; nothing here decides eligibility or targets
 * beyond the static `requires`/`target` shape.
 *
 * Every template's `kind` maps to a plain player action the reducer
 * already dispatches (Feed/Clean/Play/Pet/Rest are legal even from
 * Sulking, spec §4.7 — the "universal care" templates below guarantee the
 * eligible pool never starves at ANY Keep level or roster state).
 *
 * Rewards are modest, level-aware bundles from the SAME grant vocabulary
 * the streak ladder uses (resources/items only — never a tuning key on the
 * isolation list, §0.4) and are checked against
 * `retention.grants.preLevel2WoodCap` the same way the ladder is.
 */

export interface BountyRequirements {
  readonly minKeepLevel?: number;
  /** Must be an UNLOCKED expedition id at the current Keep level. */
  readonly expeditionId?: string;
  /** Must be OBTAINABLE (drops somewhere unlocked) at the current level. */
  readonly itemId?: string;
  /** Must already be PLACED on the Keep grid. */
  readonly placedItemId?: string;
  readonly needsAdultPip?: boolean;
  readonly minRosterSize?: number;
  readonly needsAffordableDecoration?: boolean;
}

export type BountyKind =
  | "feed"
  | "clean"
  | "play"
  | "pet"
  | "rest"
  | "expedition"
  | "collect"
  | "hatch"
  | "job"
  | "place";

export interface BountyRewardBundle {
  readonly resources?: Readonly<Record<string, number>>;
  readonly items?: Readonly<Record<string, number>>;
}

export interface BountyTargetFormula {
  readonly base: number;
  readonly perRosterPip: number;
}

export interface BountyTemplate {
  readonly id: string;
  readonly name: string;
  readonly kind: BountyKind;
  readonly requires: BountyRequirements;
  readonly target: number | BountyTargetFormula;
  readonly reward: BountyRewardBundle;
  /** Relative weight when multiple templates share a kind and are both
   * eligible the same day. */
  readonly weight: number;
}

export const BOUNTY_TEMPLATES: readonly BountyTemplate[] = [
  {
    id: "hand-out-snacks",
    name: "Hand out four snacks",
    kind: "feed",
    requires: {},
    target: { base: 4, perRosterPip: 0 },
    reward: { items: { berry: 1 } },
    weight: 10,
  },
  {
    id: "freshen-everyone",
    name: "Freshen everyone up",
    kind: "clean",
    requires: {},
    target: { base: 1, perRosterPip: 1 },
    reward: { resources: { fiber: 2 } },
    weight: 10,
  },
  {
    id: "sit-with-someone",
    name: "Sit with someone",
    kind: "pet",
    requires: {},
    target: 3,
    reward: { items: { berry: 2 } },
    weight: 8,
  },
  {
    id: "playtime",
    name: "Play together",
    kind: "play",
    requires: {},
    target: 2,
    reward: { items: { berry: 2 } },
    weight: 8,
  },
  {
    id: "proper-nap",
    name: "A proper nap",
    kind: "rest",
    requires: {},
    target: 1,
    reward: { items: { toastnut: 1 } },
    weight: 6,
  },
  {
    id: "trips-to-meadow",
    name: "Three trips to the Meadow",
    kind: "expedition",
    requires: { expeditionId: "meadow" },
    target: 3,
    reward: { resources: { fiber: 2 } },
    weight: 10,
  },
  {
    id: "long-road-bramblewick",
    name: "Take the long road",
    kind: "expedition",
    requires: { expeditionId: "bramblewick" },
    target: 1,
    reward: { items: { honeydrop: 1 } },
    weight: 6,
  },
  {
    id: "bring-home-fiber",
    name: "Bring home six Fiber",
    kind: "collect",
    requires: { itemId: "fiber" },
    target: 6,
    reward: { resources: { fiber: 1 } },
    weight: 8,
  },
  {
    id: "forest-run",
    name: "A Forest run",
    kind: "expedition",
    requires: { expeditionId: "forest", minKeepLevel: 2 },
    target: 2,
    reward: { resources: { wood: 2 } },
    weight: 8,
  },
  {
    id: "something-simmering",
    name: "Something simmering",
    kind: "job",
    requires: { placedItemId: "stockpot", minKeepLevel: 2 },
    target: 1,
    reward: { items: { toastnut: 2 } },
    weight: 6,
  },
  {
    id: "hatch-one-egg",
    name: "Hatch one egg",
    kind: "hatch",
    requires: { minKeepLevel: 2 },
    target: 1,
    reward: { resources: { fiber: 2 } },
    weight: 5,
  },
  {
    id: "shore-trips",
    name: "Two Shore trips",
    kind: "expedition",
    requires: { expeditionId: "shore", minKeepLevel: 3 },
    target: 2,
    reward: { resources: { shell: 2 } },
    weight: 6,
  },
  {
    id: "evening-at-the-grotto",
    name: "An evening at the Grotto",
    kind: "expedition",
    requires: { expeditionId: "lanterngrotto", minKeepLevel: 3 },
    target: 1,
    reward: { items: { glowcap: 1 } },
    weight: 4,
  },
  {
    id: "tidy-a-corner",
    name: "Tidy a corner",
    kind: "place",
    requires: { needsAffordableDecoration: true },
    target: 1,
    reward: { resources: { fiber: 2 } },
    weight: 4,
  },
] as const;
