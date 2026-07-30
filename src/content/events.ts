/**
 * SEASONAL EVENTS (docs/retention-bible.md §8) — limited-time FLAVOUR,
 * never limited-time CONTENT.
 *
 * Two absolute rules make "limited time" safe here (bible §8.1):
 *
 * 1. Every event RECURS ANNUALLY — windows are month-day, so "you missed
 *    it" is always "it comes back". This is what turns limited-time from
 *    *scarcity* into *seasonality* (a holiday, never a sale).
 * 2. Nothing is EVER obtainable only during an event. An event may make
 *    something EASIER (a loot bonus inside the capped channel, a lower
 *    pity threshold — never below `retention.events.pityThresholdMin`) or
 *    LOUDER (a featured item/decoration already in the registry all year).
 *    That is the ENTIRE permitted surface — no `featuredItemIds` or
 *    `featuredDecorationIds` entry may reference something that isn't
 *    already obtainable outside the window (`events.test.ts` checks this
 *    against the real food/decoration registries).
 *
 * `window` reuses the `availableWindow` SHAPE that `ExpeditionDef`/
 * `FoodDef`/`DecorationDef` already carry as an inert §12 seam — this
 * round is the first to actually CONSUME it, and only ever as a
 * *featured* window, never a *gating* one (bible §8.2).
 */

export interface EventWindow {
  /** Annual, inclusive, "MM-DD" style (e.g. "06-21"). */
  readonly from: string;
  readonly to: string;
}

export interface EventDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly window: EventWindow;
  /** Additive bonus-roll chance this event contributes to the ONE summed,
   * capped loot channel (core/progression/multipliers.ts) — capped at
   * `tuning.retention.events.lootBonusRollChanceMax` per event. */
  readonly lootBonusRollChance?: number;
  /** Additive egg-chance bonus POINTS per expedition id — feeds the
   * separate, separately-capped egg-chance channel. */
  readonly eggChanceBonusPoints?: Readonly<Record<string, number>>;
  /** May ONLY lower a biome's pity threshold (never raise it — that would
   * be a punishment for playing at the wrong time of year), floored at
   * `tuning.retention.events.pityThresholdMin`. */
  readonly pityThresholdOverride?: Readonly<Record<string, number>>;
  /** Ids ALREADY in `content/foods.ts`, obtainable all year — merely
   * surfaced/ribboned during the event. */
  readonly featuredItemIds?: readonly string[];
  /** Ids ALREADY in `content/decorations.ts`, buyable all year. */
  readonly featuredDecorationIds?: readonly string[];
}

export const EVENTS: readonly EventDef[] = [
  {
    id: "berry-glut",
    name: "Berry Glut",
    blurb: "The Meadow is absolutely covered in berries this week. Nobody knows why. Everybody's thrilled.",
    window: { from: "06-01", to: "06-07" },
    lootBonusRollChance: 0.1,
    featuredItemIds: ["berry", "honeydrop"],
  },
  {
    id: "lantern-nights",
    name: "Lantern Nights",
    blurb: "The lanterns are out this week — the Grotto glows a little brighter, and a little more often.",
    window: { from: "12-15", to: "12-24" },
    eggChanceBonusPoints: { lanterngrotto: 0.05 },
    pityThresholdOverride: { lanterngrotto: 4 },
    featuredItemIds: ["glowcap", "feastpot"],
  },
  {
    id: "tidying-week",
    name: "Tidying Week",
    blurb: "A good week for sprucing up the Keep. The usual decorations, just louder about it.",
    window: { from: "03-01", to: "03-07" },
    featuredDecorationIds: ["welcome-sign", "moss-tuft", "pebble-path", "wind-chime"],
  },
] as const;

export function eventById(id: string): EventDef | undefined {
  return EVENTS.find((e) => e.id === id);
}
