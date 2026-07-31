/**
 * ROUND 2I — THE DELIVERY LEDGER (docs/notifications-bible.md §4.5
 * mechanism 4, §8). Records what was ACTUALLY delivered, never what was
 * merely planned — "a missed delivery consumes no daily budget" (bible
 * §2.6). Pruned to the current + previous day bucket (bible §8) so the
 * persisted record never grows without bound.
 *
 * Pure. Persistence (the `notify-ledger` SaveStore key) is `app/push.ts`'s
 * job — this module only ever transforms one `NotificationLedger` value
 * into another. `dayIndexOf` is always the caller's
 * `core/progression/streak.ts`'s `dayIndex` partially applied to the
 * live `dayOffsetMs`/`dayMs` — this module stays free of that dependency
 * so it never needs to know the day-boundary tuning itself.
 */

import type {
  DueNotification,
  NotificationLedger,
  NotificationLedgerEntry,
  NotificationTypeId,
} from "./types";

/** Keep only entries delivered on `day` or `day - 1` (bible §8: "pruned to
 * the current and previous day"). A no-op when the ledger is already
 * tagged `day` (the common case — most calls happen within the same
 * bucket the ledger was last touched in). */
export function pruneLedgerToDay(
  ledger: NotificationLedger,
  day: number,
  dayIndexOf: (at: number) => number,
): NotificationLedger {
  if (ledger.day === day) return ledger;
  return {
    day,
    deliveries: ledger.deliveries.filter((entry) => day - dayIndexOf(entry.deliveredAt) <= 1),
  };
}

/** Subject-set + type + dueAt identity — the dedupe key `alreadyDelivered`
 * and `recordDelivery` both use. Order-independent (subjectIds sorted). */
function deliveryKey(typeId: NotificationTypeId, subjectIds: readonly string[], dueAt: number): string {
  return `${typeId}:${dueAt}:${[...subjectIds].sort().join(",")}`;
}

/** True iff a delivery matching this EXACT (typeId, subjectIds, dueAt)
 * triple is already recorded — the "already-delivered" suppression
 * (bible §4.5 mechanism 4: catches a double-fire across a timer and an SW
 * drain, or two tabs). */
export function alreadyDelivered(
  ledger: NotificationLedger,
  typeId: NotificationTypeId,
  subjectIds: readonly string[],
  dueAt: number,
): boolean {
  const key = deliveryKey(typeId, subjectIds, dueAt);
  return ledger.deliveries.some(
    (entry) => deliveryKey(entry.typeId, entry.subjectIds, entry.dueAt) === key,
  );
}

/** How many deliveries the ledger already holds within day bucket `day`
 * (bible §4.2's `maxPerDay`, counted per `dayIndex`). */
export function deliveredCountForDay(
  ledger: NotificationLedger,
  day: number,
  dayIndexOf: (at: number) => number,
): number {
  return ledger.deliveries.filter((entry) => dayIndexOf(entry.deliveredAt) === day).length;
}

/** The most recent delivery's `deliveredAt` (or `null` if none) — the
 * anchor `budget.ts`'s min-gap check compares the next candidate against. */
export function lastDeliveryAt(ledger: NotificationLedger): number | null {
  let latest: number | null = null;
  for (const entry of ledger.deliveries) {
    if (latest === null || entry.deliveredAt > latest) latest = entry.deliveredAt;
  }
  return latest;
}

/** Append one delivery record for a `DueNotification` that actually
 * reached `showNotification` (one record per constituent typeId — a
 * cross-type merge writes one entry per type it named, so each type's own
 * dedupe/cap accounting stays independent), pruned to `day`/`day - 1`. */
export function recordDelivery(
  ledger: NotificationLedger,
  delivered: DueNotification,
  deliveredAt: number,
  day: number,
  dayIndexOf: (at: number) => number,
): NotificationLedger {
  const pruned = pruneLedgerToDay(ledger, day, dayIndexOf).deliveries;
  const additions: NotificationLedgerEntry[] = delivered.typeIds.map((typeId) => ({
    typeId,
    subjectIds: delivered.subjectIds,
    dueAt: delivered.dueAt,
    deliveredAt,
  }));
  return { day, deliveries: [...pruned, ...additions] };
}
