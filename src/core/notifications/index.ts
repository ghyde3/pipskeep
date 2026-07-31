/**
 * ROUND 2I — NOTIFICATIONS: THE PURE CORE (docs/notifications-bible.md,
 * spec §16 v1.6's Web Push item). `app/push.ts` is the only impure
 * consumer of the SCHEDULING half of this directory. The peer round's
 * `src/ui/notificationPrefs.ts`/`notificationSettings.ts` own the stored
 * preference shape and the settings sheet independently (by design — see
 * `NotificationPrefs`'s own doc comment in `types.ts` for why the two
 * directories deliberately don't import each other).
 *
 * `dueNotifications` is the round's testability keystone: a single pure
 * function of `(state, now, settings)` that returns EXACTLY the
 * notifications that should exist right now, as data — no Notification
 * API, no DOM, no timers anywhere in this directory (CLAUDE.md's core/
 * purity fence: no Date.now()/Math.random() outside clock.ts/rng.ts, and
 * this directory calls neither directly — `now` and every random draw's
 * seed are the caller's).
 *
 * Everything the bible asks to live in "the pure layer" does:
 * coalescing (`plan.ts`), the daily cap/min-gap/quiet-hours (`budget.ts`),
 * and cancellation — which is not a separate mechanism at all here, it is
 * this function's own recompute-from-scratch contract (see the module doc
 * on `plan.ts` for why that IS the cancellation mechanism, bible §4.5
 * mechanism 1): call `dueNotifications` again after the player has
 * acknowledged a reveal or hatched an egg, and the settled item is simply
 * no longer in the plan.
 *
 * `settings` deliberately bundles more than just the toggle prefs
 * (`NotificationPrefs`) — it also carries the delivery ledger and the
 * day-boundary offset, because quiet hours/daily-cap/min-gap/dedupe are
 * ALL pure functions of "what has already been delivered" plus "what time
 * is it locally", and bundling them here is what lets this one function
 * be the complete, honest answer to "what should be showing right now" —
 * see `NOTIFICATION SCOPE CUT` in `plan.ts`'s module doc for the one thing
 * deliberately NOT in this round's catalogue (the ailment/lineage
 * suffixes), and `copy.ts`'s `FORBIDDEN_SUBSTRINGS` for round 2H's binding
 * cut, held by `catalogue.test.ts`.
 */

import { tuning as contentTuning } from "../../content/tuning";
import { applyBudget } from "./budget";
import { planNotifications } from "./plan";
import type {
  DueNotification,
  NotificationHostTuning,
  NotificationLedger,
  NotificationPrefs,
  NotificationStateSlice,
} from "./types";

export interface DueNotificationsSettings {
  readonly prefs: NotificationPrefs;
  readonly ledger: NotificationLedger;
  /** `GameState.dayOffsetMs` — the SAME local-day-boundary offset the
   * streak/bounties already read (bible §4.1). */
  readonly dayOffsetMs: number;
  /** The browser's `Notification.permission === "granted"`, read by the
   * caller (`app/push.ts`) — this module never touches the Notification
   * API itself. */
  readonly permissionGranted: boolean;
  /** Override for tests; defaults to `content/tuning.ts`. */
  readonly tuning?: NotificationHostTuning;
}

/**
 * THE KEYSTONE. Every notification that should exist at `now`, fully
 * filtered (toggles, permission, quiet hours), deduped against the ledger,
 * capped, and coalesced (within-type and cross-type) — ready for
 * `app/push.ts` to hand each one straight to `showNotification`.
 *
 * Calling this again with a later `now` over the SAME (unadvanced) state
 * and the SAME ledger is idempotent in the sense that matters: an item
 * already recorded in `ledger` comes back `"already-delivered"`
 * (suppressed, not redelivered); an item the player has since resolved
 * (a reveal acknowledged, an egg hatched) simply is not derivable from the
 * new `state` at all. That is the whole cancellation story (bible §4.5) —
 * there is no separate "cancel" entry point in this module because none is
 * needed.
 */
export function dueNotifications(
  state: NotificationStateSlice,
  now: number,
  settings: DueNotificationsSettings,
): readonly DueNotification[] {
  const tuning = settings.tuning ?? contentTuning;
  // TWO BOUNDS, not one (round 2I review finding). `dueAt <= now` is
  // "has it happened yet"; `now - dueAt <= staleAfterMs` is "is it still
  // worth a buzz". Without the second, a machine asleep for three days
  // wakes and announces a Meadow trip from Tuesday — the copy survives it
  // (no time words, by design) but the interruption does not deserve to
  // exist. Neither bound produces a `SuppressedNotification`: both are
  // about whether an item is in the budget's scope at all, which is why
  // they sit here rather than inside `applyBudget`.
  const plan = planNotifications(state, tuning.notifications).filter(
    (item) => item.dueAt <= now && now - item.dueAt <= tuning.notifications.staleAfterMs,
  );
  return applyBudget(
    plan,
    now,
    settings.ledger,
    settings.dayOffsetMs,
    settings.prefs,
    settings.permissionGranted,
    tuning,
  ).delivering;
}

export * from "./types";
export * from "./copy";
export * from "./ledger";
export { planNotifications, nextDueAt } from "./plan";
export type { PlanContent, ExpeditionNameRegistry } from "./plan";
export { applyBudget, localHourAt, isQuietHour } from "./budget";
