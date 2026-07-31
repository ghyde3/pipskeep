/**
 * ROUND 2I — PLANNING (docs/notifications-bible.md §1, §2.1, §2.3, §4.3.1).
 *
 * `planNotifications` derives every catalogue-worthy due moment DIRECTLY
 * from timestamps already in `GameState` — `departedAt + durationMs` for a
 * homecoming, `incubationStartedAt + incubationMs` (via `core/eggs`'s
 * `eggReadyAt`) for a pipping — exactly like `core/expeditions/index.ts`'s
 * `processDueExpeditionReturns` and never from a stored flag or from
 * `pendingReveals`.
 *
 * THAT LAST POINT IS LOAD-BEARING (bible §2.1's finding): `app/ticker.ts`
 * pauses the game loop on `visibilitychange → hidden`, so NO reducer ever
 * dispatches while the tab is hidden — `pendingReveals` never gains an
 * entry during exactly the window a push notification needs to cover. A
 * transition-driven design (watching for a NEW pendingReveal, the way
 * `app/alerts.ts`/`ui/phase4.ts` do for in-app toasts) would therefore
 * deliver nothing, ever, while hidden — the eighth dead feature. Deriving
 * straight from the un-settled `ActiveExpedition`/`Egg` timestamps is what
 * makes this correct against state the live reducer hasn't touched yet.
 *
 * SCOPE CUT, honestly stated: this round's catalogue does NOT render the
 * ailment/lineage suffixes bible §1.1 sketches. Both suffixes describe the
 * OUTCOME of `settleExpeditionReturn`'s ailment/lineage rolls — rolls that
 * (by the same §2.1 finding) have not happened yet for a trip derived this
 * way, because they only ever run inside the live TICK/CATCHUP path. Rendering
 * them here would mean forward-simulating an RNG-consuming reducer arm
 * ahead of the dispatch that is actually allowed to consume it — precisely
 * the determinism hazard bible §12 finding 5 already declined to take for
 * the (simpler) cure notification. The base homecoming/pipping catalogue
 * ships in full; the suffixes are a follow-up seam, not a silent omission.
 *
 * Coalescing (bible §4.3.1): items of the SAME type whose `dueAt` falls
 * within `coalesceWindowMs` of the earliest item already in the growing
 * cluster merge into ONE `PlannedNotification`, firing at the LATEST
 * `dueAt` in the group (never early). Cross-type merging and every budget
 * rule (quiet hours, daily cap, min-gap, toggles) live in `budget.ts` —
 * this module only ever produces PER-TYPE candidates.
 *
 * Pure: no Notification API, no clock (`now` filtering is the caller's
 * job — see `index.ts`'s `dueNotifications`), no `Math.random()` (copy
 * selection is a throwaway stream, `copy.ts`'s module doc).
 */

import { tuning as contentTuning } from "../../content/tuning";
import { expeditions as contentExpeditions } from "../../content/expeditions";
import { eggReadyAt } from "../eggs";
import {
  homecomingBody,
  homecomingClause,
  homecomingTitle,
  pippingBody,
  pippingClause,
  pippingTitle,
} from "./copy";
import { NOTIFICATION_TYPES } from "./types";
import type {
  NotificationStateSlice,
  NotificationTuning,
  PlannedNotification,
} from "./types";

/** Injectable expedition-name registry (content ids are opaque to core —
 * spec §2 rule 5). Defaults to the real `content/expeditions.ts`. */
export type ExpeditionNameRegistry = Readonly<Record<string, { readonly name: string }>>;

export interface PlanContent {
  readonly expeditionNames?: ExpeditionNameRegistry;
}

interface DueSubject {
  readonly id: string;
  readonly name: string;
  readonly dueAt: number;
  /** Homecoming only — used to resolve the single-Pip title's biome name. */
  readonly expeditionId?: string;
}

interface Cluster {
  readonly dueAt: number;
  readonly subjects: readonly DueSubject[];
}

/** Greedy clustering, ascending by `dueAt`: a new item joins the CURRENT
 * cluster iff it falls within `windowMs` of that cluster's EARLIEST member
 * (not merely its most recent — bible §4.3.1's exact wording), else starts
 * a fresh cluster. The cluster's own `dueAt` is its LATEST member's. */
function clusterByDueAt(items: readonly DueSubject[], windowMs: number): readonly Cluster[] {
  const sorted = [...items].sort((a, b) => a.dueAt - b.dueAt);
  const clusters: { earliest: number; subjects: DueSubject[] }[] = [];
  for (const item of sorted) {
    const open = clusters[clusters.length - 1];
    if (open !== undefined && item.dueAt - open.earliest <= windowMs) {
      open.subjects.push(item);
    } else {
      clusters.push({ earliest: item.dueAt, subjects: [item] });
    }
  }
  return clusters.map((c) => ({
    dueAt: c.subjects[c.subjects.length - 1]?.dueAt ?? c.earliest,
    subjects: c.subjects,
  }));
}

function homecomingTypeTag(): string {
  return NOTIFICATION_TYPES.find((t) => t.id === "homecoming")?.tag ?? "pk-homecoming";
}

function pippingTypeTag(): string {
  return NOTIFICATION_TYPES.find((t) => t.id === "pipping")?.tag ?? "pk-pipping";
}

function planHomecomings(
  state: NotificationStateSlice,
  tuning: NotificationTuning,
  registry: ExpeditionNameRegistry,
): readonly PlannedNotification[] {
  const subjects: DueSubject[] = [];
  for (const pipId of state.rosterOrder) {
    const pip = state.pips[pipId];
    if (pip === undefined || pip.expedition === null) continue;
    const { expeditionId, departedAt, durationMs } = pip.expedition;
    subjects.push({
      id: pipId,
      name: pip.name,
      dueAt: departedAt + durationMs,
      expeditionId,
    });
  }
  const clusters = clusterByDueAt(subjects, tuning.coalesceWindowMs);
  const tag = homecomingTypeTag();
  return clusters.map((cluster): PlannedNotification => {
    const names = cluster.subjects.map((s) => s.name);
    const biomeName =
      cluster.subjects.length === 1
        ? registry[cluster.subjects[0]?.expeditionId ?? ""]?.name
        : undefined;
    return {
      typeId: "homecoming",
      dueAt: cluster.dueAt,
      subjectIds: cluster.subjects.map((s) => s.id),
      title: homecomingTitle(names, biomeName),
      body: homecomingBody(state.seed, cluster.dueAt, names, tuning.maxNamesInBody),
      clause: homecomingClause(names, biomeName),
      tag,
    };
  });
}

function planPippings(
  state: NotificationStateSlice,
  tuning: NotificationTuning,
): readonly PlannedNotification[] {
  const subjects: DueSubject[] = [];
  for (const egg of state.eggs) {
    const readyAt = eggReadyAt(egg);
    if (readyAt === null) continue;
    subjects.push({ id: egg.id, name: egg.id, dueAt: readyAt });
  }
  const clusters = clusterByDueAt(subjects, tuning.coalesceWindowMs);
  const tag = pippingTypeTag();
  return clusters.map((cluster): PlannedNotification => ({
    typeId: "pipping",
    dueAt: cluster.dueAt,
    subjectIds: cluster.subjects.map((s) => s.id),
    title: pippingTitle(cluster.subjects.length),
    body: pippingBody(state.seed, cluster.dueAt, cluster.subjects.length),
    clause: pippingClause(cluster.subjects.length),
    tag,
  }));
}

/**
 * Every catalogue-worthy due moment derivable from `state`, coalesced
 * within type, REGARDLESS of `now` — the caller (`index.ts`'s
 * `dueNotifications`) filters to `dueAt <= now` before handing this to
 * `budget.ts`. Order is not significant; callers sort if they need to.
 */
export function planNotifications(
  state: NotificationStateSlice,
  tuning: NotificationTuning = contentTuning.notifications,
  content: PlanContent = {},
): readonly PlannedNotification[] {
  const registry = content.expeditionNames ?? contentExpeditions;
  return [
    ...planHomecomings(state, tuning, registry),
    ...planPippings(state, tuning),
  ];
}

/**
 * The earliest not-yet-due `dueAt` in the plan (or `null` if nothing is
 * outstanding) — what `app/push.ts` arms its Tier-1 timer against. Budget
 * rules are deliberately NOT applied here: a wake-up that turns out to be
 * suppressed (quiet hours, a toggle) is harmless (`applyBudget` simply
 * delivers nothing and the caller re-arms for the next moment), whereas
 * under-arming would silently drop a delivery.
 */
export function nextDueAt(
  state: NotificationStateSlice,
  now: number,
  tuning: NotificationTuning = contentTuning.notifications,
  content: PlanContent = {},
): number | null {
  let earliest: number | null = null;
  for (const item of planNotifications(state, tuning, content)) {
    if (item.dueAt <= now) continue;
    if (earliest === null || item.dueAt < earliest) earliest = item.dueAt;
  }
  return earliest;
}
