/**
 * DAILY BOUNTIES (docs/retention-bible.md §5) — three a day, generated
 * LEVEL-AWARE: "a bounty for a locked biome is a bug, not a stretch goal."
 *
 * Generation is STATELESS and day-derived (`createRng(seed).stream("bounty:"
 * + dayIndex)`), and that cursor is NEVER persisted — exactly like
 * `rollStarterCandidates` previews the starter trio (core/state.ts). Two
 * consequences worth having: reload-safe by construction (the same day
 * always derives the same three bounties), and `state.rngState` never
 * grows with playtime — no cursor interaction with the loot/egg/job/
 * dialogue/genesis streams whatsoever (spec §2 rule 3 stays untouched).
 *
 * Regeneration is LAZY: the caller (core/state.ts) notices
 * `bounties.day !== today` on any action and regenerates — a 30-day
 * absence generates ONE day, not 30 (bible §3.6's clamp, restated for
 * bounties).
 */

import { BOUNTY_TEMPLATES as contentTemplates } from "../../content/bountyTemplates";
import type {
  BountyKind,
  BountyRequirements,
  BountyRewardBundle,
  BountyTemplate,
} from "../../content/bountyTemplates";
import { createRng } from "../rng";
import type { RngStream } from "../rng";

export type { BountyKind, BountyRequirements, BountyRewardBundle, BountyTemplate };

export interface BountyInstance {
  readonly templateId: string;
  readonly slot: number;
  readonly target: number;
  readonly progress: number;
  readonly completedAt: number | null;
  readonly rerolled: boolean;
  /** Static hints resolved at generation, for the UI (e.g. which biome). */
  readonly params: Readonly<Record<string, string>>;
  /** Became impossible after generation (a placement was removed) —
   * auto-replaced free of charge, never counted as a failure. */
  readonly stale: boolean;
}

export interface BountiesState {
  readonly day: number | null;
  readonly slots: readonly BountyInstance[];
  readonly rerollsUsed: number;
  readonly dayBonusGranted: boolean;
}

export function createEmptyBounties(): BountiesState {
  return { day: null, slots: [], rerollsUsed: 0, dayBonusGranted: false };
}

/** Everything the eligibility filter needs to know about the player's
 * current capabilities. Built by the caller (core/state.ts) from the real
 * GameState; kept structural here so this module stays content-free
 * beyond the injected registries (spec §2 rule 5). */
export interface BountyContext {
  readonly keepLevel: number;
  readonly rosterSize: number;
  readonly hasAdultPip: boolean;
  readonly placedItemIds: ReadonlySet<string>;
  readonly unlockedExpeditionIds: ReadonlySet<string>;
  /** Item ids obtainable (drop somewhere already unlocked) at the current
   * Keep level — resources AND foods. */
  readonly obtainableItemIds: ReadonlySet<string>;
  /** At least one unplaced decoration is affordable within roughly an
   * hour's expected income at this level. */
  readonly hasAffordableDecoration: boolean;
}

export interface BountyTuning {
  readonly retention: {
    readonly bounties: {
      readonly perDay: number;
      readonly freeRerollsPerDay: number;
      readonly dayBonusEggMaxPerDay: number;
    };
  };
}

/** True when `template` is generatable in `context` right now. */
export function isBountyEligible(
  template: BountyTemplate,
  context: BountyContext,
): boolean {
  const req = template.requires;
  if (req.minKeepLevel !== undefined && context.keepLevel < req.minKeepLevel) {
    return false;
  }
  if (req.expeditionId !== undefined && !context.unlockedExpeditionIds.has(req.expeditionId)) {
    return false;
  }
  if (req.itemId !== undefined && !context.obtainableItemIds.has(req.itemId)) {
    return false;
  }
  if (req.placedItemId !== undefined && !context.placedItemIds.has(req.placedItemId)) {
    return false;
  }
  if (req.needsAdultPip === true && !context.hasAdultPip) return false;
  if (req.minRosterSize !== undefined && context.rosterSize < req.minRosterSize) {
    return false;
  }
  if (req.needsAffordableDecoration === true && !context.hasAffordableDecoration) {
    return false;
  }
  return true;
}

/** Resolve a template's target formula against the live roster size. */
export function resolveBountyTarget(
  target: BountyTemplate["target"],
  rosterSize: number,
): number {
  if (typeof target === "number") return target;
  return Math.max(1, target.base + target.perRosterPip * rosterSize);
}

/** Static UI hints resolved from a template's fixed `requires` — never
 * randomly rolled (every template already names its own biome/item, so
 * there is no per-day parameter choice to make, and therefore no extra
 * roll to account for). */
function paramsFor(template: BountyTemplate): Readonly<Record<string, string>> {
  const params: Record<string, string> = {};
  if (template.requires.expeditionId !== undefined) {
    params["expeditionId"] = template.requires.expeditionId;
  }
  if (template.requires.itemId !== undefined) {
    params["itemId"] = template.requires.itemId;
  }
  if (template.requires.placedItemId !== undefined) {
    params["placedItemId"] = template.requires.placedItemId;
  }
  return params;
}

/** Fisher-Yates over the stream — deterministic given the stream's cursor. */
function shuffled<T>(stream: RngStream, items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = stream.int(i + 1);
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

/** One weighted pick among same-kind eligible templates. */
function pickWeighted(stream: RngStream, templates: readonly BountyTemplate[]): BountyTemplate {
  const total = templates.reduce((sum, t) => sum + t.weight, 0);
  let r = stream.next() * total;
  for (const t of templates) {
    r -= t.weight;
    if (r < 0) return t;
  }
  return templates[templates.length - 1] as BountyTemplate;
}

function buildInstance(
  template: BountyTemplate,
  slot: number,
  rosterSize: number,
): BountyInstance {
  return {
    templateId: template.id,
    slot,
    target: resolveBountyTarget(template.target, rosterSize),
    progress: 0,
    completedAt: null,
    rerolled: false,
    params: paramsFor(template),
    stale: false,
  };
}

/** Group eligible templates by kind, preserving template order within
 * each group (weighted pick handles selection within a kind). */
function groupByKind(
  templates: readonly BountyTemplate[],
): Map<BountyKind, BountyTemplate[]> {
  const groups = new Map<BountyKind, BountyTemplate[]>();
  for (const t of templates) {
    const list = groups.get(t.kind);
    if (list === undefined) groups.set(t.kind, [t]);
    else list.push(t);
  }
  return groups;
}

/**
 * Generate the day's trio (bible §5.1/§5.3): distinct kinds, drawn from
 * whatever survives `isBountyEligible` in `context`, deterministic from
 * `(seed, day)`. The RNG stream is throwaway — never persisted in
 * `GameState`, so `rngState` never grows and no other stream's cursor is
 * ever perturbed (bible §11.4).
 */
export function generateBountiesForDay(
  seed: number,
  day: number,
  context: BountyContext,
  tuning: BountyTuning,
  templates: readonly BountyTemplate[] = contentTemplates,
): BountiesState {
  const stream = createRng(seed).stream(`bounty:${day}`);
  const eligible = templates.filter((t) => isBountyEligible(t, context));
  const groups = groupByKind(eligible);
  const kinds = shuffled(stream, [...groups.keys()]);
  const perDay = tuning.retention.bounties.perDay;
  const chosenKinds = kinds.slice(0, perDay);

  const slots: BountyInstance[] = [];
  chosenKinds.forEach((kind, index) => {
    const candidates = groups.get(kind) as BountyTemplate[];
    const template = pickWeighted(stream, candidates);
    slots.push(buildInstance(template, index, context.rosterSize));
  });

  return { day, slots, rerollsUsed: 0, dayBonusGranted: false };
}

/** Ensure `bounties` matches `today` — the lazy regeneration rule (bible
 * §5.1): a 30-day absence generates ONE day, not 30. Returns `bounties`
 * unchanged (by reference) when already current. */
export function ensureBountiesForDay(
  bounties: BountiesState,
  seed: number,
  today: number,
  context: BountyContext,
  tuning: BountyTuning,
  templates: readonly BountyTemplate[] = contentTemplates,
): BountiesState {
  if (bounties.day === today) return bounties;
  return generateBountiesForDay(seed, today, context, tuning, templates);
}

/** One player event that might advance a bounty's progress. `amount`
 * defaults to 1 (most kinds tick by 1 per action); `collect` events pass
 * the actual count harvested. */
export interface BountyProgressEvent {
  readonly kind: BountyKind;
  readonly expeditionId?: string;
  readonly itemId?: string;
  readonly placedItemId?: string;
  readonly amount?: number;
}

function eventMatchesSlot(event: BountyProgressEvent, slot: BountyInstance): boolean {
  if (event.expeditionId !== undefined && slot.params["expeditionId"] !== event.expeditionId) {
    return false;
  }
  if (event.itemId !== undefined && slot.params["itemId"] !== undefined && slot.params["itemId"] !== event.itemId) {
    return false;
  }
  if (
    event.placedItemId !== undefined &&
    slot.params["placedItemId"] !== undefined &&
    slot.params["placedItemId"] !== event.placedItemId
  ) {
    return false;
  }
  return true;
}

export interface BountyApplyResult {
  readonly bounties: BountiesState;
  /** Slots that JUST completed on this event (reward not yet granted —
   * the caller banks it). */
  readonly justCompleted: readonly BountyInstance[];
  /** True the moment all slots are complete for the FIRST time today. */
  readonly dayJustCleared: boolean;
}

/**
 * Apply one event to every slot whose template kind (and params) match,
 * clamping progress at target and marking completion at most once per
 * slot (idempotent — a bounty cannot be completed twice, and progress
 * past target is simply capped, never "overflowing" into a double
 * reward). Auto-bank semantics (bible §5.4): the caller grants
 * `justCompleted`'s rewards immediately, so nothing here needs a claim
 * step.
 */
export function applyBountyEvent(
  bounties: BountiesState,
  event: BountyProgressEvent,
  at: number,
): BountyApplyResult {
  const justCompleted: BountyInstance[] = [];
  let changed = false;
  const resolved = bounties.slots.map((slot) => {
    if (slot.completedAt !== null || slot.stale) return slot;
    const template = contentTemplates.find((t) => t.id === slot.templateId);
    if (template === undefined || template.kind !== event.kind) return slot;
    if (!eventMatchesSlot(event, slot)) return slot;
    const amount = event.amount ?? 1;
    const progress = Math.min(slot.target, slot.progress + amount);
    changed = true;
    if (progress >= slot.target) {
      const completed: BountyInstance = { ...slot, progress, completedAt: at };
      justCompleted.push(completed);
      return completed;
    }
    return { ...slot, progress };
  });

  if (!changed) {
    return { bounties, justCompleted: [], dayJustCleared: false };
  }

  const allComplete =
    resolved.length > 0 && resolved.every((slot) => slot.completedAt !== null || slot.stale);
  const dayJustCleared = allComplete && !bounties.dayBonusGranted;

  return {
    bounties: {
      ...bounties,
      slots: resolved,
      dayBonusGranted: bounties.dayBonusGranted || dayJustCleared,
    },
    justCompleted,
    dayJustCleared,
  };
}

/**
 * Free reroll of one slot (bible §5.4): only while `rerollsUsed <
 * freeRerollsPerDay`, drawing from the eligible pool EXCLUDING the other
 * slots' current kinds (keeps the day's kinds distinct). No-op (state
 * unchanged) when the budget is spent or the slot doesn't exist.
 */
export function rerollBountySlot(
  bounties: BountiesState,
  slot: number,
  seed: number,
  context: BountyContext,
  tuning: BountyTuning,
  templates: readonly BountyTemplate[] = contentTemplates,
): BountiesState {
  if (bounties.rerollsUsed >= tuning.retention.bounties.freeRerollsPerDay) {
    return bounties;
  }
  const target = bounties.slots.find((s) => s.slot === slot);
  if (target === undefined || bounties.day === null) return bounties;

  const otherKinds = new Set(
    bounties.slots
      .filter((s) => s.slot !== slot)
      .map((s) => contentTemplates.find((t) => t.id === s.templateId)?.kind)
      .filter((kind): kind is BountyKind => kind !== undefined),
  );
  const eligible = templates.filter(
    (t) => isBountyEligible(t, context) && !otherKinds.has(t.kind),
  );
  if (eligible.length === 0) return bounties;

  const stream = createRng(seed).stream(`bounty-reroll:${bounties.day}:${slot}:${bounties.rerollsUsed}`);
  const groups = groupByKind(eligible);
  const kinds = [...groups.keys()];
  const chosenKind = stream.pick(kinds);
  const template = pickWeighted(stream, groups.get(chosenKind) as BountyTemplate[]);

  const fresh = { ...buildInstance(template, slot, context.rosterSize), rerolled: true };
  return {
    ...bounties,
    slots: bounties.slots.map((s) => (s.slot === slot ? fresh : s)),
    rerollsUsed: bounties.rerollsUsed + 1,
  };
}

/**
 * Replace any slot whose requirement no longer holds (e.g. a station was
 * removed mid-day) — free of charge, never counted as a failure, never
 * consuming the reroll budget (bible §5.5).
 */
export function replaceStaleBounties(
  bounties: BountiesState,
  context: BountyContext,
  tuning: BountyTuning,
  templates: readonly BountyTemplate[] = contentTemplates,
): BountiesState {
  if (bounties.day === null) return bounties;
  let changed = false;
  const liveKinds = new Set(
    bounties.slots
      .map((s) => contentTemplates.find((t) => t.id === s.templateId)?.kind)
      .filter((kind): kind is BountyKind => kind !== undefined),
  );
  const nextSlots = bounties.slots.map((slot) => {
    if (slot.completedAt !== null) return slot;
    const template = contentTemplates.find((t) => t.id === slot.templateId);
    if (template !== undefined && isBountyEligible(template, context)) return slot;
    // Stale: try to replace with any other eligible template of a kind not
    // already used by another live slot.
    changed = true;
    const otherKinds = new Set(liveKinds);
    if (template !== undefined) otherKinds.delete(template.kind);
    const eligible = templates.filter(
      (t) => isBountyEligible(t, context) && !otherKinds.has(t.kind),
    );
    if (eligible.length === 0) {
      return { ...slot, stale: true };
    }
    const stream = createRng(bounties.day as number).stream(
      `bounty-stale:${bounties.day}:${slot.slot}`,
    );
    const groups = groupByKind(eligible);
    const chosenKind = stream.pick([...groups.keys()]);
    const replacement = pickWeighted(stream, groups.get(chosenKind) as BountyTemplate[]);
    return buildInstance(replacement, slot.slot, context.rosterSize);
  });
  if (!changed) return bounties;
  return { ...bounties, slots: nextSlots };
}
