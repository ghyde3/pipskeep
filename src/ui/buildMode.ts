/**
 * Build-mode controllers (spec §9 placement UI, §6.3 resource costs) —
 * the PURE model layer behind the Build sheet and placement mode. No
 * DOM here: state in, view model out (node-testable, the focusView.ts
 * pattern).
 *
 * - `buildSheetModel(state)` — every placeable + decoration as a sheet
 *   entry with its resource-bundle cost, affordability, and the friendly
 *   per-resource shortfall when short (spec §6.3: resources ARE the
 *   currency; core/economy `canAfford` is the single affordability
 *   rule). Plus the rearrange rows: every current placement with its
 *   name, tile, and — for stations — who is working there.
 * - Copy helpers (`formatBundle`, `formatMissing`) — warm and concrete,
 *   never guilt (spec §15.5). Tile-validity previews live in the SCENE's
 *   placement mode (render/keepScene.ts tints the ghost via core/keep's
 *   own pure placeItem/moveItem — spec §2: one rule, everywhere).
 *
 * The core PLACE_ITEM reducer charges the item's cost (all-or-nothing
 * spend, refused-as-unchanged when short) and REMOVE_ITEM refunds it in
 * full — this model's grey-out mirrors the same canAfford rule, so an
 * enabled card can never be refused for affordability.
 */

import type { GameState } from "../core/state";
import type { PipState } from "../core/pips/types";
import type { Footprint, PlacementId } from "../core/keep";
import { canAfford } from "../core/economy";
import type { ResourceBundle } from "../core/economy";
import { placeables } from "../content/placeables";
import { decorations } from "../content/decorations";
import { jobs as contentJobs } from "../content/jobs";
import { foods } from "../content/foods";

/** One buildable item (placeable or decoration) as content defines it —
 * the merged view the Build sheet lists. */
export interface BuildItemDef {
  readonly id: string;
  readonly name: string;
  readonly kind: "station" | "decoration";
  readonly cost: ResourceBundle;
  readonly footprint: Footprint;
}

/** The merged placeables ∪ decorations catalog, stations first (the
 * functional stuff is what a new Keep wants soonest). */
export function buildCatalog(): readonly BuildItemDef[] {
  return [
    ...placeables.map(
      (def): BuildItemDef => ({
        id: def.id,
        name: def.name,
        kind: "station",
        cost: def.cost,
        footprint: def.footprint,
      }),
    ),
    ...decorations.map(
      (def): BuildItemDef => ({
        id: def.id,
        name: def.name,
        kind: "decoration",
        cost: def.cost,
        footprint: def.footprint,
      }),
    ),
  ];
}

/** Catalog lookup by id (place-mode entry point). */
export function findBuildItem(itemId: string): BuildItemDef | null {
  return buildCatalog().find((item) => item.id === itemId) ?? null;
}

/** Display name for a resource/item id: registry name when the id is a
 * food (Berries double as food), otherwise the capitalized id. */
export function resourceDisplayName(id: string): string {
  const food = foods[id as keyof typeof foods];
  if (food !== undefined) return food.name;
  return id.length === 0 ? id : id.charAt(0).toUpperCase() + id.slice(1);
}

/** "2 Wood + 3 Fiber" — a cost bundle as one friendly line ("Free" for
 * an empty bundle, which content validation should never allow here). */
export function formatBundle(cost: ResourceBundle): string {
  const parts = Object.entries(cost)
    .filter(([, amount]) => amount !== undefined && amount > 0)
    .map(([id, amount]) => `${amount} ${resourceDisplayName(id)}`);
  return parts.length === 0 ? "Free" : parts.join(" + ");
}

/** "Needs 2 more Wood" / "Needs 2 more Wood and 1 more Fiber" — the
 * friendly shortfall line for a greyed entry (spec §15.5: warm, never
 * scolding — the missing amounts are a to-do list, not a wall). */
export function formatMissing(missing: Readonly<Record<string, number>>): string {
  const parts = Object.entries(missing)
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => `${amount} more ${resourceDisplayName(id)}`);
  if (parts.length === 0) return "";
  if (parts.length === 1) return `Needs ${parts[0]}`;
  const last = parts[parts.length - 1];
  return `Needs ${parts.slice(0, -1).join(", ")} and ${last}`;
}

/** One Build-sheet entry: the item plus this save's affordability. */
export interface BuildEntryModel extends BuildItemDef {
  readonly footprintLabel: string;
  readonly costLabel: string;
  readonly affordable: boolean;
  /** Per-resource shortfall when not affordable (else empty). */
  readonly missing: Readonly<Record<string, number>>;
  /** Friendly shortfall line, "" when affordable. */
  readonly missingLabel: string;
}

/** One rearrange row: a current placement, and who works there. */
export interface RearrangeRowModel {
  readonly placementId: PlacementId;
  readonly itemId: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** Name of the pip assigned at this placement (stations), else null. */
  readonly workerName: string | null;
}

export interface BuildSheetModel {
  readonly entries: readonly BuildEntryModel[];
  readonly rearrange: readonly RearrangeRowModel[];
}

/** Per-resource shortfall of `cost` against `resources` (only the short
 * ones, mirroring core/economy spend's refusal shape). */
export function missingFor(
  resources: Readonly<Record<string, number>>,
  cost: ResourceBundle,
): Readonly<Record<string, number>> {
  const missing: Record<string, number> = {};
  for (const [id, amount] of Object.entries(cost)) {
    if (amount === undefined) continue;
    const shortfall = amount - (resources[id] ?? 0);
    if (shortfall > 0) missing[id] = shortfall;
  }
  return missing;
}

/** The whole Build sheet's view model. Pure. */
export function buildSheetModel(state: GameState): BuildSheetModel {
  const entries = buildCatalog().map((item): BuildEntryModel => {
    const affordable = canAfford(state.resources, item.cost);
    const missing = affordable ? {} : missingFor(state.resources, item.cost);
    return {
      ...item,
      footprintLabel: `${item.footprint.w}×${item.footprint.h}`,
      costLabel: formatBundle(item.cost),
      affordable,
      missing,
      missingLabel: formatMissing(missing),
    };
  });

  const workerByPlacement = new Map<PlacementId, PipState>();
  for (const [pipId, job] of Object.entries(state.jobs)) {
    const pip = state.pips[pipId];
    if (pip !== undefined) workerByPlacement.set(job.stationPlacementId, pip);
  }

  const rearrange = Object.entries(state.keep.placements).map(
    ([placementId, placement]): RearrangeRowModel => ({
      placementId,
      itemId: placement.itemId,
      name: findBuildItem(placement.itemId)?.name ?? placement.itemId,
      x: placement.x,
      y: placement.y,
      workerName: workerByPlacement.get(placementId)?.name ?? null,
    }),
  );

  return { entries, rearrange };
}

/** True when this placement hosts a job someone could work (used for
 * remove-confirmation copy and the rearrange rows). */
export function placementHostsJob(itemId: string): boolean {
  return Object.values(contentJobs).some((job) => job.stationItemId === itemId);
}
