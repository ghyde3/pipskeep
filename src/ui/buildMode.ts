/**
 * Build-mode controllers (spec §9 placement UI, §6.3 resource costs;
 * docs/progression-bible.md §4/§5) — the PURE model layer behind the
 * Build sheet and placement mode. No DOM here: state in, view model out
 * (node-testable, the focusView.ts pattern).
 *
 * ROUND 2F replaces the vague "the Pips will use this" / "just lovely"
 * (bible §4.1's named offender) with the real per-item info bible §4.1
 * specifies: an icon, what the item DOES in generated-from-data effect
 * lines, set membership + progress, a lock label for a not-yet-unlocked
 * station, and a first-build XP callout — grouped for a 45-item catalog
 * (bible §5.5): stations first (locked ones shown, never hidden), then
 * the six themed decoration sets as their own groups, then Rearrange.
 *
 * The KEEPSAKE SHELF (bible §5.4) IS surfaced here, and the reducer half is
 * live: `core/state.ts`'s `PLACE_ITEM` spends `state.keepsakes[itemId]` before
 * it touches resources and stamps `Placement.granted = true`, and REMOVE_ITEM
 * returns a granted placement to the shelf while refunding NO resources (which
 * is what closes the gift-into-resource-printer exploit). This model exposes
 * all three halves: `BuildSheetModel.keepsakes` is the sheet's own top section
 * (bible §5.5 item 1), `BuildEntryModel.costLabel` reads "Free" for a shelved
 * gift, and `keepsakeLabel` names it.
 *
 * (An earlier version of this header said the opposite — that the shelf was
 * deliberately unsurfaced and that PLACE_ITEM ignored `state.keepsakes`. Both
 * clauses were false in the tree they shipped in.)
 *
 * - `buildSheetModel(state)` — stations (locked ones greyed, never
 *   hidden), decorations grouped into their six themed sets with a live
 *   placed-of-total count and bonus-active flag, and the rearrange rows
 *   (every current placement, tile, and — for stations — who works there).
 * - `describeEffect(effect)` — bible §4.4's generated, never-authored
 *   effect copy: a number in `content/buildingEffects.ts` and a number on
 *   a card can therefore never disagree.
 * - Copy helpers (`formatBundle`, `formatMissing`) — warm and concrete,
 *   never guilt (spec §15.5).
 *
 * The core PLACE_ITEM reducer charges the item's cost (all-or-nothing
 * spend, refused-as-unchanged when short) UNLESS a copy is on the Keepsake
 * Shelf, in which case it spends the shelf and charges nothing; REMOVE_ITEM
 * refunds resources in full for a bought placement and returns a granted one
 * to the shelf instead. This model's grey-out mirrors the same
 * shelf-then-canAfford ordering, so an enabled card can never be refused for
 * affordability.
 */

import type { GameState } from "../core/state";
import type { PipState } from "../core/pips/types";
import type { NeedId } from "../core/pips";
import type { Footprint, PlacementId } from "../core/keep";
import { canAfford } from "../core/economy";
import type { ResourceBundle } from "../core/economy";
import { resolveKeepEffects } from "../core/keep/effects";
import { placeables } from "../content/placeables";
import { decorations } from "../content/decorations";
import { decorSets } from "../content/decorSets";
import type { DecorSetDef } from "../content/decorSets";
import type { BuildingEffect } from "../content/buildingEffects";
import type { IconSpec } from "../content/icons";
import { jobs as contentJobs } from "../content/jobs";
import { foods } from "../content/foods";
import { tuning as contentTuning } from "../content/tuning";
import type { Tuning } from "../content/tuning";
import { resolveItemIcon } from "./icons";

/** One buildable item (placeable or decoration) as content defines it —
 * the merged view the Build sheet lists. Stations carry a real
 * `unlockKeepLevel` gate (bible §2.3); decorations carry none, so they
 * default to 1 (never locked — content bible's own reachability rule:
 * "every decoration is buyable by the time the Keep is fully built", no
 * per-tier gate at all). */
export interface BuildItemDef {
  readonly id: string;
  readonly name: string;
  readonly kind: "station" | "decoration";
  readonly cost: ResourceBundle;
  readonly footprint: Footprint;
  readonly flavor: string;
  /** Mechanical effects this item grants while placed (bible §3.1);
   * always an array — content's `effects?` (absent ≡ []) is normalized
   * here so nothing downstream re-checks for `undefined`. */
  readonly effects: readonly BuildingEffect[];
  /** Which themed set (`content/decorSets.ts`) this item's card displays
   * as belonging to — decorations only; display-only, per
   * `content/decorations.ts`'s own doc (a shared item like `cloud-kite`
   * still counts toward BOTH sets' placed tallies — see `buildSheetModel`'s
   * set-group stats, which read `decorSets` directly, not this field). */
  readonly setId?: string;
  readonly unlockKeepLevel: number;
  /** Authored motif (bible §4.2) — badge is never authored; see
   * `./icons.ts`'s `resolveItemIcon`, which is what actually renders. */
  readonly icon: IconSpec;
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
        flavor: def.flavor,
        effects: def.effects ?? [],
        setId: undefined,
        unlockKeepLevel: def.unlockKeepLevel,
        icon: def.icon,
      }),
    ),
    ...decorations.map(
      (def): BuildItemDef => ({
        id: def.id,
        name: def.name,
        kind: "decoration",
        cost: def.cost,
        footprint: def.footprint,
        flavor: def.flavor,
        effects: def.effects ?? [],
        setId: def.setId,
        unlockKeepLevel: 1,
        icon: def.icon,
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

// ---------------------------------------------------------------------------
// Generated effect copy (bible §4.4) — one line per effect, computed from
// the effect's own numbers, never hand-authored. A number here and a
// number in content/buildingEffects.ts can therefore never disagree.
// ---------------------------------------------------------------------------

const NEED_NOUNS: Readonly<Record<NeedId, string>> = {
  hunger: "Hunger",
  cleanliness: "Cleanliness",
  happiness: "Happiness",
  energy: "Energy",
};

/** Integer percent, "6%" — every generated line rounds to a whole percent
 * (spec §15.5: concrete, never a decimal a player has to parse). */
function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function jobEffectLine(jobId: string): string {
  const job = contentJobs[jobId];
  if (job === undefined) return "A Pip can work here.";
  const minutes = Math.max(1, Math.round(job.intervalMs / 60_000));
  return `A Pip can work here — ${job.name}, one find every ${minutes} minutes.`;
}

/** One warm, concrete line per `BuildingEffect` (bible §4.4's table,
 * verbatim). Every branch of `BuildingEffect["kind"]` is covered — a
 * future effect kind fails here at compile time (exhaustive switch),
 * never silently renders blank. */
export function describeEffect(effect: BuildingEffect): string {
  switch (effect.kind) {
    case "comfort":
      return effect.need === "all"
        ? `Every need falls ${pct(effect.decayReduction)} slower, Keep-wide.`
        : `${NEED_NOUNS[effect.need]} falls ${pct(effect.decayReduction)} slower for every Pip in the Keep.`;
    case "restSpeed":
      return `Naps finish ${pct(effect.multiplier - 1)} sooner.`;
    case "expeditionSpeed":
      return `Trips come home ${pct(1 - effect.multiplier)} sooner.`;
    case "expeditionLoot":
      return `A ${pct(effect.bonusRollChance)} better chance of an extra find on every trip.`;
    case "eggChancePoints":
      return "Eggs turn up a shade more often.";
    case "incubationSpeed":
      return `Eggs hatch ${pct(1 - effect.multiplier)} sooner.`;
    case "job":
      return jobEffectLine(effect.jobId);
    case "xpBonus":
      return `+${pct(effect.fraction)} Keep XP from everything you do.`;
  }
}

/**
 * ROUND 2F FIX — WHAT A SET BONUS ACTUALLY IS, IN WORDS.
 *
 * The sheet said `Meadow Green — 0 of 7 placed` and, once earned,
 * `· bonus active`, and NEVER what the bonus was or what it took. Nothing
 * anywhere in the game stated meadow-green's happiness −4%/−7%, tideline's
 * cleanliness −4%/−7%, lantern-ember's +5%/+10% Keep XP, bramble-twine's
 * ×1.10/×1.18 naps, deep-wood's +2%/+4% loot or first-snow's energy −4%/−7%,
 * and nothing said the 3-of-a-set tier only goes live at Keep 3 and the
 * 5-of-a-set at Keep 6. That is 12 discrete, non-random, long-haul goals the
 * player could not see — and since a single decoration's own effect is 1–2%
 * (i.e. noise), the set payoff is the ONLY legible reason a decoration exists.
 *
 * Every line here is GENERATED from the set's own `BuildingEffect` via the
 * same `describeEffect` the item cards use, so the copy can never drift from
 * the simulation.
 */
export interface SetBonusInfoModel {
  /** "3 placed: Happiness falls 4% slower…" — the tier-1 promise, always shown. */
  readonly tier1Line: string;
  /** The tier-2 promise. */
  readonly tier2Line: string;
  /** Which tier is live right now (null = none yet). */
  readonly activeTier: 1 | 2 | null;
  /** "Two more for the set bonus" / "Three more for the bigger bonus" /
   * null once the top tier is earned — the actual next step, by count. */
  readonly nextStepLine: string | null;
  /** "Set bonuses go live at Keep level 3" when the Keep is not yet high
   * enough for the tier the member count has already reached, else null.
   * Without this, placing three Moss Tufts at Keep 2 looks broken. */
  readonly notYetLiveLine: string | null;
}

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven"] as const;

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

export function describeSetBonus(
  set: DecorSetDef,
  placedCount: number,
  keepLevel: number,
  activeTier: 1 | 2 | null,
  tuning: Tuning = contentTuning,
): SetBonusInfoModel {
  const cfg = tuning.progression.setBonus;
  const tier1Line = `${cfg.minMembersTier1} placed: ${describeEffect(set.bonusAt3)}`;
  const tier2Line = `${cfg.minMembersTier2} placed: ${describeEffect(set.bonusAt5)}`;

  let nextStepLine: string | null = null;
  if (placedCount < cfg.minMembersTier1) {
    const need = cfg.minMembersTier1 - placedCount;
    nextStepLine = `${countWord(need)} more for the set bonus`;
  } else if (placedCount < cfg.minMembersTier2 && cfg.minMembersTier2 <= set.memberItemIds.length) {
    const need = cfg.minMembersTier2 - placedCount;
    nextStepLine = `${countWord(need)} more for the bigger bonus`;
  }

  // The member count is there but the Keep is not high enough yet — say so,
  // by name, rather than letting it read as a broken bonus.
  let notYetLiveLine: string | null = null;
  if (activeTier === null && placedCount >= cfg.minMembersTier1 && keepLevel < cfg.tier1LiveAtKeepLevel) {
    notYetLiveLine = `Set bonuses go live at Keep level ${cfg.tier1LiveAtKeepLevel}`;
  } else if (
    activeTier === 1 &&
    placedCount >= cfg.minMembersTier2 &&
    keepLevel < cfg.tier2LiveAtKeepLevel
  ) {
    notYetLiveLine = `The bigger bonus goes live at Keep level ${cfg.tier2LiveAtKeepLevel}`;
  }

  return { tier1Line, tier2Line, activeTier, nextStepLine, notYetLiveLine };
}

// ---------------------------------------------------------------------------
// The Build-sheet view model (bible §4.1/§5.5)
// ---------------------------------------------------------------------------

/** One Build-sheet entry: the item, this save's affordability, and the
 * real per-item info (bible §4.1) that replaces "the Pips will use this"
 * / "just lovely". */
export interface BuildEntryModel extends BuildItemDef {
  /** Motif + DERIVED badge (bible §4.2) — never the raw `icon` field,
   * which carries no badge. */
  readonly resolvedIcon: IconSpec;
  readonly tint: string;
  readonly footprintLabel: string;
  readonly costLabel: string;
  readonly affordable: boolean;
  /** Per-resource shortfall when not affordable (else empty). */
  readonly missing: Readonly<Record<string, number>>;
  /** Friendly shortfall line, "" when affordable. */
  readonly missingLabel: string;
  /** One line per effect, GENERATED from the effect data — never authored
   * (bible §4.1). Empty for an item with no mechanical effect (none in
   * the round-2F catalog, but the model stays honest either way). */
  readonly effectLines: readonly string[];
  /** "Tideline — 3 of 6 placed", or null for a station (no set). */
  readonly setLabel: string | null;
  /** True once the set's 3- or 5-member bonus is active — read from the
   * SAME `resolveKeepEffects` derivation `core/pips/needs.ts` consumes,
   * so this can never drift from the simulation. */
  readonly setBonusActive: boolean;
  /** True when `unlockKeepLevel` is above the Keep's current level. */
  readonly locked: boolean;
  /** "Opens at Keep level 7" when locked, else null. Shown, never hidden
   * (bible §5.5: "a named thing to look forward to is the ladder's whole
   * job", the same pattern `ui/focusView.ts` already uses for expeditions). */
  readonly lockLabel: string | null;
  /** True when this item type has never been placed — the "NEW" flag. */
  readonly isNew: boolean;
  /** "+25 Keep XP the first time you build one", or null once built —
   * the number is read live from `tuning.progression.xp.firstBuild`. */
  readonly firstBuildLabel: string | null;
  /** True when the card should actually be tappable: affordable AND
   * unlocked. `affordable` alone (unchanged meaning — resources only) is
   * kept for callers that only care about the resource gate. */
  readonly buyable: boolean;
  /** How many FREE granted copies of this item are on the Keepsake Shelf
   * (`state.keepsakes`) — a streak or milestone gift. `PLACE_ITEM` spends
   * one of these BEFORE it touches resources, so a card with `keepsakes > 0`
   * costs nothing to place. */
  readonly keepsakes: number;
  /** "Free — a keepsake (2 on the shelf)", or null when there are none.
   *
   * ROUND 2F: `state.keepsakes` was written by round 2C and read by NOTHING
   * — no surface listed it and `PLACE_ITEM` charged full price for a gift
   * the player had already been given. Both halves are wired now; this is
   * the visible one. */
  readonly keepsakeLabel: string | null;
}

/** One themed decoration-set group (bible §3.5/§5.5). Counting mirrors
 * `core/keep/effects.ts` exactly: DISTINCT `memberItemIds` currently
 * placed, so a shared item like `cloud-kite` counts toward every set it
 * is a member of, even though its card only ever DISPLAYS under one
 * (`DecorationDef.setId`, which `entries` groups by). */
export interface BuildSetGroupModel {
  readonly setId: string;
  readonly setName: string;
  readonly placedCount: number;
  readonly totalMembers: number;
  readonly bonusActive: boolean;
  readonly bonusTier: 1 | 2 | null;
  /** ROUND 2F: what the bonus IS and what it takes — see
   * `describeSetBonus`. Null only for the defensive "Other" group, which
   * has no set behind it. */
  readonly bonusInfo: SetBonusInfoModel | null;
  readonly entries: readonly BuildEntryModel[];
}

/** One rearrange row: a current placement, and who works there. */
export interface RearrangeRowModel {
  readonly placementId: PlacementId;
  readonly itemId: string;
  readonly name: string;
  readonly resolvedIcon: IconSpec;
  readonly tint: string;
  readonly x: number;
  readonly y: number;
  /** Name of the pip assigned at this placement (stations), else null. */
  readonly workerName: string | null;
}

export interface BuildSheetModel {
  /** Stations first (bible §5.5) — locked ones INCLUDED, greyed. */
  readonly stations: readonly BuildEntryModel[];
  /** The six themed sets, each its own collapsible group. */
  readonly sets: readonly BuildSetGroupModel[];
  /**
   * ROUND 2F (bible §5.5 item 1) — THE KEEPSAKE SHELF, at the TOP of the
   * sheet: one card per shelved gift, free and yours already. The reducer half
   * (PLACE_ITEM spends the shelf, REMOVE_ITEM returns to it) and the per-card
   * "Free — a keepsake" label both landed, but the sheet had no shelf GROUP —
   * so a day-5 streak player who chose a keepsake had to remember which one
   * and go hunting for it among 45 cards. Empty when the shelf is empty, and
   * then the section is omitted entirely rather than shown blank.
   */
  readonly keepsakes: readonly BuildEntryModel[];
  readonly rearrange: readonly RearrangeRowModel[];
}

function buildEntry(
  item: BuildItemDef,
  state: GameState,
  placedIds: ReadonlySet<string>,
  activeSetBonusBySetId: ReadonlyMap<string, 1 | 2>,
): BuildEntryModel {
  // A granted copy on the Keepsake Shelf is spent before resources are, so
  // it makes the card affordable no matter what the satchel holds — the
  // same ordering `PLACE_ITEM` uses, kept in lockstep on purpose.
  const keepsakes = state.keepsakes[item.id] ?? 0;
  const affordable = keepsakes > 0 || canAfford(state.resources, item.cost);
  const missing = affordable ? {} : missingFor(state.resources, item.cost);
  const locked = item.unlockKeepLevel > state.keep.level;
  const built = (state.counters[`built.${item.id}`] ?? 0) > 0;
  const set = item.setId === undefined ? undefined : decorSets.find((s) => s.id === item.setId);
  const { spec: resolvedIcon, tint } = resolveItemIcon(item.icon, item.effects, item.setId);

  let setLabel: string | null = null;
  let setBonusActive = false;
  if (set !== undefined) {
    const placedCount = set.memberItemIds.filter((id) => placedIds.has(id)).length;
    setBonusActive = activeSetBonusBySetId.has(set.id);
    // The card names the NEXT STEP, not just a tally — bible §3.5's own
    // example copy is "2 of 6 — one more for the set bonus". A bare count is
    // information; a count plus the step is a reason to place the next one.
    const info = describeSetBonus(
      set,
      placedCount,
      state.keep.level,
      activeSetBonusBySetId.get(set.id) ?? null,
    );
    const tail =
      info.nextStepLine !== null
        ? ` — ${info.nextStepLine}`
        : setBonusActive
          ? " — bonus active"
          : "";
    setLabel = `${set.name} — ${placedCount} of ${set.memberItemIds.length} placed${tail}`;
  }

  return {
    ...item,
    resolvedIcon,
    tint,
    footprintLabel: `${item.footprint.w}×${item.footprint.h}`,
    costLabel: keepsakes > 0 ? "Free" : formatBundle(item.cost),
    affordable,
    missing,
    missingLabel: formatMissing(missing),
    effectLines: item.effects.map(describeEffect),
    setLabel,
    setBonusActive,
    locked,
    lockLabel: locked ? `Opens at Keep level ${item.unlockKeepLevel}` : null,
    isNew: !built,
    firstBuildLabel: built
      ? null
      : `+${contentTuning.progression.xp.firstBuild} Keep XP the first time you build one`,
    buyable: affordable && !locked,
    keepsakes,
    keepsakeLabel:
      keepsakes > 0
        ? `Free — a keepsake${keepsakes > 1 ? ` (${keepsakes} on the shelf)` : ""}`
        : null,
  };
}

/** The whole Build sheet's view model. Pure. */
export function buildSheetModel(state: GameState): BuildSheetModel {
  const catalog = buildCatalog();
  const placedIds = new Set(Object.values(state.keep.placements).map((p) => p.itemId));
  const resolved = resolveKeepEffects(state.keep, state.keep.level);
  const activeSetBonusBySetId = new Map<string, 1 | 2>(
    resolved.activeSetBonuses.map((b) => [b.setId, b.tier]),
  );

  const stations = catalog
    .filter((item) => item.kind === "station")
    .map((item) => buildEntry(item, state, placedIds, activeSetBonusBySetId));

  const decorationsById = new Map(
    catalog.filter((item) => item.kind === "decoration").map((item) => [item.id, item]),
  );

  const sets: BuildSetGroupModel[] = decorSets.map((set: DecorSetDef) => {
    const placedCount = set.memberItemIds.filter((id) => placedIds.has(id)).length;
    const entries = catalog
      .filter((item) => item.kind === "decoration" && item.setId === set.id)
      .map((item) => buildEntry(item, state, placedIds, activeSetBonusBySetId));
    const bonusTier = activeSetBonusBySetId.get(set.id) ?? null;
    return {
      setId: set.id,
      setName: set.name,
      placedCount,
      totalMembers: set.memberItemIds.length,
      bonusActive: bonusTier !== null,
      bonusTier,
      bonusInfo: describeSetBonus(set, placedCount, state.keep.level, bonusTier),
      entries,
    };
  });
  // Decorations with no set (none in the round-2F catalog, but the model
  // stays honest for future content that skips setId) never silently
  // vanish: a defensive group catches them.
  const groupedIds = new Set(sets.flatMap((g) => g.entries.map((e) => e.id)));
  const orphaned = [...decorationsById.values()].filter((item) => !groupedIds.has(item.id));
  if (orphaned.length > 0) {
    sets.push({
      setId: "unsorted",
      setName: "Other",
      placedCount: 0,
      totalMembers: 0,
      bonusActive: false,
      bonusTier: null,
      bonusInfo: null,
      entries: orphaned.map((item) => buildEntry(item, state, placedIds, activeSetBonusBySetId)),
    });
  }

  const workerByPlacement = new Map<PlacementId, PipState>();
  for (const [pipId, job] of Object.entries(state.jobs)) {
    const pip = state.pips[pipId];
    if (pip !== undefined) workerByPlacement.set(job.stationPlacementId, pip);
  }

  const rearrange = Object.entries(state.keep.placements).map(
    ([placementId, placement]): RearrangeRowModel => {
      const def = findBuildItem(placement.itemId);
      const { spec: resolvedIcon, tint } = resolveItemIcon(
        def?.icon ?? { motif: "stone" },
        def?.effects,
        def?.setId,
      );
      return {
        placementId,
        itemId: placement.itemId,
        name: def?.name ?? placement.itemId,
        resolvedIcon,
        tint,
        x: placement.x,
        y: placement.y,
        workerName: workerByPlacement.get(placementId)?.name ?? null,
      };
    },
  );

  // THE KEEPSAKE SHELF (bible §5.5 item 1) — one card per shelved gift, in
  // catalog order so it is stable between opens.
  const keepsakes = catalog
    .filter((item) => (state.keepsakes[item.id] ?? 0) > 0)
    .map((item) => buildEntry(item, state, placedIds, activeSetBonusBySetId));

  return { stations, sets, keepsakes, rearrange };
}

/** True when this placement hosts a job someone could work (used for
 * remove-confirmation copy and the rearrange rows). */
export function placementHostsJob(itemId: string): boolean {
  return Object.values(contentJobs).some((job) => job.stationItemId === itemId);
}
