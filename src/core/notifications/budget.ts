/**
 * ROUND 2I — THE ANNOYANCE BUDGET (docs/notifications-bible.md §4).
 *
 * Turns `plan.ts`'s per-type candidates into a delivery decision, with a
 * NAMED suppression reason for everything that doesn't ship — "a
 * suppression that leaves no trace cannot be tested" (bible §4, opening
 * line), and this round's mutation stage is told to delete each rule in
 * turn (bible §9.7).
 *
 * Quiet hours (§4.1): local wall-clock time from `GameState.dayOffsetMs`
 * alone — no timezone library, no new app-layer plumbing. Daily cap/min-gap
 * (§4.2) are counted against the LEDGER (what was actually delivered
 * before), never against the current plan alone. Cross-type coalescing
 * (§4.3.2) merges a homecoming and a pipping landing within `minGapMs` of
 * each other into ONE two-clause "The Keep has been busy" notification
 * instead of dropping the second.
 *
 * EVERY VOLUME RULE IS MEASURED AT THE DELIVERY INSTANT (`now`), NEVER AT
 * `dueAt` — round 2I review finding. `dueAt` is when the game says a thing
 * became true; `now` is when the phone actually lights up, and those two
 * diverge every time a timer runs late (a closed laptop lid, a frozen tab,
 * Chrome's ~60s intensive throttling). Checking quiet hours against `dueAt`
 * meant a trip due at 21:30 buzzed at 02:00 whenever the machine slept
 * through it — precisely the outcome quiet hours exists to prevent. The
 * same reasoning applies to min-gap and the daily cap, and it makes the
 * whole file consistent with the LEDGER, which has always recorded
 * `deliveredAt` rather than `dueAt`. `dueAt` survives only as identity
 * (dedupe) and ordering.
 *
 * Pure: takes the plan, the ledger, prefs and tuning as plain data; returns
 * plain data. No Notification API, no clock read, no persistence — every
 * timestamp it touches was already stamped by the caller.
 */

import { tuning as contentTuning } from "../../content/tuning";
import { dayIndex } from "../progression/streak";
import { combinedBody, COMBINED_TITLE } from "./copy";
import {
  alreadyDelivered,
  deliveredCountForDay,
  lastDeliveryAt,
} from "./ledger";
import { COMBINED_TAG } from "./types";
import type {
  ApplyBudgetResult,
  DueNotification,
  NotificationHostTuning,
  NotificationLedger,
  NotificationPrefs,
  PlannedNotification,
  SuppressedNotification,
  SuppressionReason,
} from "./types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** `((n % m) + m) % m` — a modulo that stays non-negative for a negative
 * `localMs` (a UTC+ timezone can make `now - tzOffsetMs` negative for
 * timestamps near the epoch; tests exercise this directly). */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Local wall-clock HOUR at `atMs`, derived the same way bible §4.1 derives
 * it from `GameState.dayOffsetMs` (`core/clock.ts`'s `localDayOffsetMs`):
 * `dayOffsetMs = dayStartHour·1h + tzOffsetMs`, so `tzOffsetMs =
 * dayOffsetMs - dayStartHour·1h`, and local time is `atMs - tzOffsetMs`. */
export function localHourAt(atMs: number, dayOffsetMs: number, dayStartHour: number): number {
  const tzOffsetMs = dayOffsetMs - dayStartHour * HOUR_MS;
  const localMs = atMs - tzOffsetMs;
  return Math.floor(mod(localMs, DAY_MS) / HOUR_MS);
}

/** Whether `hour` falls inside a (possibly wraparound, e.g. 22 → 8) quiet
 * window `[startHour, endHour)`. */
export function isQuietHour(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false; // a zero-width window is never quiet
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function typeEnabled(prefs: NotificationPrefs, item: PlannedNotification): boolean {
  return prefs.types[item.typeId];
}

/** One item, checked against every PER-ITEM rule (bible §4) — everything
 * EXCEPT the daily cap and min-gap, which depend on the running state of
 * the whole batch and are applied afterwards. `quietHours` is the
 * INJECTED tuning's own slice — never the module-level `contentTuning`
 * default, so a caller that overrides `tuning` (every test in
 * `budget.test.ts`) actually changes what counts as quiet.
 *
 * `now` — the DELIVERY instant, not `item.dueAt` — is what the quiet-hours
 * window is tested against; see the module doc for why. */
function checkPerItemRules(
  item: PlannedNotification,
  now: number,
  ledger: NotificationLedger,
  dayOffsetMs: number,
  dayStartHour: number,
  prefs: NotificationPrefs,
  permissionGranted: boolean,
  quietHours: { readonly startHour: number; readonly endHour: number },
): SuppressionReason | null {
  if (!prefs.master) return "master-off";
  if (!typeEnabled(prefs, item)) return "type-off";
  if (!permissionGranted) return "no-permission";
  const hour = localHourAt(now, dayOffsetMs, dayStartHour);
  if (isQuietHour(hour, quietHours.startHour, quietHours.endHour)) return "quiet-hours";
  if (alreadyDelivered(ledger, item.typeId, item.subjectIds, item.dueAt)) {
    return "already-delivered";
  }
  return null;
}

function toDueNotification(item: PlannedNotification): DueNotification {
  return {
    typeIds: [item.typeId],
    subjectIds: item.subjectIds,
    dueAt: item.dueAt,
    title: item.title,
    body: item.body,
    tag: item.tag,
  };
}

/** Merge a surviving homecoming + pipping pair into one "The Keep has been
 * busy" notification (bible §4.3.2) when their `dueAt`s fall within
 * `minGapMs` of each other. Fires at the LATER of the two (never early). */
function mergeCrossType(
  homecoming: PlannedNotification,
  pipping: PlannedNotification,
): DueNotification {
  return {
    typeIds: ["homecoming", "pipping"],
    subjectIds: [...homecoming.subjectIds, ...pipping.subjectIds],
    dueAt: Math.max(homecoming.dueAt, pipping.dueAt),
    title: COMBINED_TITLE,
    body: combinedBody(homecoming.clause, pipping.clause),
    tag: COMBINED_TAG,
  };
}

/** A candidate awaiting the cap/gap pass — either a single surviving plan
 * item, or the merged combined notification standing in for two. Kept as
 * an explicit tagged union (rather than an `"typeId" in x` structural
 * check) so every branch below narrows cleanly.
 *
 * A `"merged"` candidate carries its own `homecoming` participant rather
 * than closing over "the" homecoming survivor: there can be several (see
 * `buildCandidates`), and a rejected merge must be attributed to the one it
 * actually consumed. */
type CapGapCandidate =
  | { readonly kind: "single"; readonly item: PlannedNotification; readonly dueAt: number }
  | {
      readonly kind: "merged";
      readonly due: DueNotification;
      readonly dueAt: number;
      readonly homecoming: PlannedNotification;
    };

/**
 * Turn the survivors into cap/gap candidates, applying the cross-type merge
 * (bible §4.3.2) to AT MOST ONE homecoming/pipping pair and passing every
 * remaining survivor through untouched.
 *
 * ROUND-2I REVIEW FIX (blocker). This used to be an either/or over the
 * whole survivor set: when both a homecoming and a pipping existed it
 * pushed only that merged pair and the `for (const s of survivors)` loop
 * that would have added the rest sat in the `else` branch, so it never ran.
 * The inline justification ("with exactly two catalogue types there is at
 * most one homecoming survivor and one pipping survivor") was simply false
 * — `plan.ts` emits one `PlannedNotification` per CLUSTER, so two waves of
 * Pips returning more than `coalesceWindowMs` apart are two homecoming
 * candidates. The second was silently dropped: not delivered, not
 * suppressed, no reason recorded, invisible to the ledger and to the
 * `delivering.length + suppressed.length === plan.length` invariant.
 * A merge now CONSUMES its two specific participants and nothing else.
 */
function buildCandidates(
  survivors: readonly PlannedNotification[],
  minGapMs: number,
  onCoalesced: (item: PlannedNotification) => void,
): CapGapCandidate[] {
  // The EARLIEST of each type, by `dueAt` rather than by array position —
  // `plan.ts` happens to emit each type in ascending order today, but the
  // pair worth merging is a property of the timestamps, not of the order
  // the planner returned them in.
  const earliestOfType = (typeId: PlannedNotification["typeId"]): PlannedNotification | undefined =>
    survivors
      .filter((s) => s.typeId === typeId)
      .reduce<PlannedNotification | undefined>(
        (best, s) => (best === undefined || s.dueAt < best.dueAt ? s : best),
        undefined,
      );
  const homecoming = earliestOfType("homecoming");
  const pipping = earliestOfType("pipping");
  const consumed = new Set<PlannedNotification>();
  const candidates: CapGapCandidate[] = [];

  if (
    homecoming !== undefined &&
    pipping !== undefined &&
    Math.abs(pipping.dueAt - homecoming.dueAt) <= minGapMs
  ) {
    const due = mergeCrossType(homecoming, pipping);
    candidates.push({ kind: "merged", due, dueAt: due.dueAt, homecoming });
    onCoalesced(pipping);
    consumed.add(homecoming);
    consumed.add(pipping);
  }

  for (const s of survivors) {
    if (consumed.has(s)) continue;
    candidates.push({ kind: "single", item: s, dueAt: s.dueAt });
  }
  return candidates;
}

/**
 * Apply the full annoyance budget to `plan` (already filtered to what is
 * due and still fresh by the caller — see `index.ts`), as it would be
 * delivered at `now`. Every planned item ends up accounted for in exactly
 * one of `delivering`/`suppressed` — a merge consumes two plan items into
 * one delivery plus one `"coalesced"` suppression, so the count
 * `delivering.length + suppressed.length === plan.length` holds either way
 * (bible §9.2's invariant test).
 *
 * `now` is the moment the notification would actually reach the player, and
 * quiet hours, min-gap and the daily cap are all measured against it — see
 * the module doc.
 */
export function applyBudget(
  plan: readonly PlannedNotification[],
  now: number,
  ledger: NotificationLedger,
  dayOffsetMs: number,
  prefs: NotificationPrefs,
  permissionGranted: boolean,
  tuning: NotificationHostTuning = contentTuning,
): ApplyBudgetResult {
  const dayStartHour = tuning.retention.dayStartHour;
  const dayMs = tuning.retention.dayMs;
  const dayIndexOf = (at: number): number => dayIndex(at, dayOffsetMs, dayMs);

  const survivors: PlannedNotification[] = [];
  const suppressed: SuppressedNotification[] = [];

  for (const item of plan) {
    const reason = checkPerItemRules(
      item,
      now,
      ledger,
      dayOffsetMs,
      dayStartHour,
      prefs,
      permissionGranted,
      tuning.notifications.quietHours,
    );
    if (reason !== null) {
      suppressed.push({ item, reason });
    } else {
      survivors.push(item);
    }
  }

  const candidates = buildCandidates(survivors, tuning.notifications.minGapMs, (item) => {
    suppressed.push({ item, reason: "coalesced" });
  });

  // Chronological order decides who gets the scarce delivery slots: the
  // thing that became true first is announced first.
  candidates.sort((a, b) => a.dueAt - b.dueAt);

  const delivering: DueNotification[] = [];
  const deliveryDay = dayIndexOf(now);
  let deliveredToday = deliveredCountForDay(ledger, deliveryDay, dayIndexOf);
  let lastDeliveredAt = lastDeliveryAt(ledger);

  const rejectCandidate = (candidate: CapGapCandidate, reason: SuppressionReason): void => {
    if (candidate.kind === "single") {
      suppressed.push({ item: candidate.item, reason });
      return;
    }
    // A merged combined notification was rejected. Attribute the reason to
    // the HOMECOMING half only — the pipping half already carries its
    // "coalesced" entry from the merge step above, and a second entry here
    // would double-count it against the count invariant above.
    suppressed.push({ item: candidate.homecoming, reason });
  };

  for (const candidate of candidates) {
    if (deliveredToday >= tuning.notifications.maxPerDay) {
      rejectCandidate(candidate, "daily-cap");
      continue;
    }
    // Measured at `now`, so a second survivor in the SAME wake is min-gap
    // rather than a second buzz in the same instant (the late-wake case:
    // two things that were due half an hour apart, both discovered at 02:00
    // when the lid opens). One invitation, never a burst.
    if (lastDeliveredAt !== null && now - lastDeliveredAt < tuning.notifications.minGapMs) {
      rejectCandidate(candidate, "min-gap");
      continue;
    }

    const due = candidate.kind === "single" ? toDueNotification(candidate.item) : candidate.due;
    delivering.push(due);
    lastDeliveredAt = now;
    deliveredToday += 1;
  }

  return { delivering, suppressed };
}
