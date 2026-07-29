/**
 * Economy domain (spec §6.3) — resources, costs, inventory.
 *
 * Resources ARE the currency; there is no abstract coin and no shop in MVP.
 * Phase 4/5 implement inventory logic. Phase 0 provides vocabulary types.
 */

/** Base resources (spec §6.3). Uncommon/rare items are content-defined on top. */
export const RESOURCE_IDS = ["berry", "fiber", "wood", "shell", "driftwood"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

/**
 * A bundle of resources, used for all costs (spec §6.3), e.g. `{ wood: 4 }`.
 * Amounts are non-negative integers; validation enforces this at boot.
 */
export type ResourceBundle = Partial<Readonly<Record<ResourceId, number>>>;
