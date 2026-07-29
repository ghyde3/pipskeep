/**
 * Economy domain (spec §6.3) — resources, costs, inventory.
 *
 * Resources ARE the currency; there is no abstract coin and no shop in
 * MVP. Costs everywhere (Keep levels, the roster upgrade, decorations,
 * foods-as-seam) are resource BUNDLES, and this module owns the two
 * spending primitives:
 *
 * - `canAfford(resources, cost)` — pure affordability check.
 * - `spend(resources, cost)` — exact bundle deduction with a TYPED
 *   refusal (`missing` = the per-resource shortfall) when short. Spend
 *   is all-or-nothing and can NEVER produce a negative balance: nothing
 *   is deducted unless the whole bundle is covered, and the arithmetic
 *   subtracts at most what is present by construction.
 *
 * Pure data-in/data-out; no clock, no randomness, no content imports.
 */

/** Base resources (spec §6.3). Uncommon/rare items are content-defined on
 * top. Berries are deliberately NOT here: they are FOOD (the food registry
 * is the routing rule everywhere — reveals, job production, migrations),
 * so they live in the inventory, never in `state.resources`. */
export const RESOURCE_IDS = ["fiber", "wood", "shell", "driftwood"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

/**
 * A bundle of resources, used for all costs (spec §6.3), e.g. `{ wood: 4 }`.
 * Amounts are non-negative integers; validation enforces this at boot.
 */
export type ResourceBundle = Partial<Readonly<Record<ResourceId, number>>>;

/** Player resource balances, as stored in `state.resources`. Keyed by
 * string because loot tables may drop content-defined ids beyond the
 * base five (core treats item ids as opaque, spec §2 rule 5). */
export type ResourceCounts = Readonly<Record<string, number>>;

/** True when every entry of `cost` is covered by `resources` (missing
 * keys count as 0). Zero/absent cost entries are trivially covered. */
export function canAfford(resources: ResourceCounts, cost: ResourceBundle): boolean {
  return Object.entries(cost).every(
    ([resourceId, amount]) =>
      amount === undefined || (resources[resourceId] ?? 0) >= amount,
  );
}

export type SpendResult =
  | { readonly ok: true; readonly resources: ResourceCounts }
  | {
      readonly ok: false;
      /** Per-resource shortfall (only the resources that fell short),
       * e.g. `{ wood: 3 }` = "3 more Wood needed". */
      readonly missing: ResourceCounts;
    };

/**
 * Deduct `cost` from `resources`, exactly (spec §6.3). All-or-nothing:
 * when any resource is short, NOTHING is deducted and the typed refusal
 * reports every shortfall. Balances never go negative. Pure — the input
 * record is never mutated.
 */
export function spend(resources: ResourceCounts, cost: ResourceBundle): SpendResult {
  const missing: Record<string, number> = {};
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (amount === undefined) continue;
    const shortfall = amount - (resources[resourceId] ?? 0);
    if (shortfall > 0) missing[resourceId] = shortfall;
  }
  if (Object.keys(missing).length > 0) return { ok: false, missing };

  const next: Record<string, number> = { ...resources };
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (amount === undefined || amount === 0) continue;
    next[resourceId] = (next[resourceId] ?? 0) - amount;
  }
  return { ok: true, resources: next };
}
