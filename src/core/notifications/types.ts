/**
 * ROUND 2I — NOTIFICATIONS: shared types (docs/notifications-bible.md).
 *
 * Pure data only — no Notification API, no DOM, no timers (spec §2 rule 5 /
 * CLAUDE.md's core/ purity fence). Every timestamp is a plain `number`
 * (Clock-supplied ms) and every random draw elsewhere in this directory goes
 * through `core/rng.ts`'s stateless `createRng` (never persisted — the same
 * precedent `progression/streak.ts`'s keepsake offers use), never
 * `Math.random()`.
 *
 * THE CATALOGUE (bible §1) is deliberately two types, full stop — the
 * permission card promises "That's the whole list. Nothing else, ever." and
 * `catalogue.test.ts` (this directory) holds every one of these bars.
 */

import type { Egg } from "../eggs";
import type { PipId } from "../pips/types";

/** The whole catalogue (bible §1). Exactly two — see the module doc. */
export const NOTIFICATION_TYPE_IDS = ["homecoming", "pipping"] as const;
export type NotificationTypeId = (typeof NOTIFICATION_TYPE_IDS)[number];

/** Content-free catalogue descriptor (bible §4.4's tag discipline).
 *
 * INTEGRATION-STAGE REMOVAL: this carried a `priority: 1 | 2` field with a
 * doc comment about which type is "dropped/merged first". Nothing read it.
 * `budget.ts` orders candidates CHRONOLOGICALLY (`sort by dueAt`) and its
 * cross-type merge is structurally fixed — with exactly two catalogue types
 * there is at most one of each to merge, and the homecoming clause always
 * leads. A priority field that no code consults is a promise the catalogue
 * cannot keep, and `catalogue.test.ts` asserting `1 < 2` on it was a guard
 * over nothing. Removed rather than wired: chronological order is the
 * correct behaviour, so there is nothing here to wire it TO. */
export interface NotificationTypeDescriptor {
  readonly id: NotificationTypeId;
  readonly tag: string;
}

export const NOTIFICATION_TYPES: readonly NotificationTypeDescriptor[] = [
  { id: "homecoming", tag: "pk-homecoming" },
  { id: "pipping", tag: "pk-pipping" },
];

/** Tag used for a cross-type coalesced notification (bible §4.3.2 — "the
 * only generic title in the catalogue"). Not one of `NOTIFICATION_TYPES`'
 * own tags because it is never a delivery of ONE type. */
export const COMBINED_TAG = "pk-keep";

// ---------------------------------------------------------------------------
// STATE — the structural slice `plan.ts` reads. GameState satisfies it;
// this module never imports core/state.ts (no core-internal cycles, the
// same discipline core/expeditions/index.ts's ExpeditionStateSlice keeps).
// ---------------------------------------------------------------------------

/** The one field of `ActiveExpedition` a homecoming derivation needs. */
export interface NotificationExpeditionView {
  readonly expeditionId: string;
  readonly departedAt: number;
  readonly durationMs: number;
}

export interface NotificationPipView {
  readonly id: PipId;
  readonly name: string;
  /** Non-null exactly while OnExpedition (mirrors `PipState.expedition`'s
   * own contract) — a homecoming is derived ONLY from this, never from
   * `pendingReveals`, because nothing ever populates `pendingReveals`
   * while the tab is hidden (bible §2.1's whole finding). */
  readonly expedition: NotificationExpeditionView | null;
}

export interface NotificationStateSlice {
  readonly seed: number;
  readonly rosterOrder: readonly PipId[];
  readonly pips: Readonly<Record<PipId, NotificationPipView | undefined>>;
  readonly eggs: readonly Egg[];
}

// ---------------------------------------------------------------------------
// PLAN — what `plan.ts` derives, before the annoyance budget ever sees it.
// ---------------------------------------------------------------------------

/** One already-coalesced-within-type candidate (bible §4.3.1: same-type
 * items whose `dueAt` cluster within `coalesceWindowMs` merge into one,
 * firing at the LATEST `dueAt` in the group so nothing is announced
 * early). Copy is already rendered here — `copy.ts` is pure and data-only,
 * so rendering it at plan time costs nothing and keeps `budget.ts` free of
 * any string-building. */
export interface PlannedNotification {
  readonly typeId: NotificationTypeId;
  readonly dueAt: number;
  readonly subjectIds: readonly string[];
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  /** A short mergeable noun-phrase ("Rooter is home from Bramblewick",
   * "an egg is pipping") — what `budget.ts`'s cross-type merge (bible
   * §4.3.2) stitches into ONE two-clause body when a homecoming and a
   * pipping land within `minGapMs` of each other. Never shown on its own. */
  readonly clause: string;
}

// ---------------------------------------------------------------------------
// BUDGET — the annoyance budget's vocabulary (bible §4).
// ---------------------------------------------------------------------------

export type SuppressionReason =
  | "quiet-hours"
  | "daily-cap"
  | "min-gap"
  | "coalesced"
  | "type-off"
  | "master-off"
  | "no-permission"
  | "already-delivered";

export interface SuppressedNotification {
  readonly item: PlannedNotification;
  readonly reason: SuppressionReason;
}

/** What actually gets delivered (bible §4.3.2 — a cross-type merge carries
 * more than one `typeId` and the generic `COMBINED_TAG`; every other
 * delivery carries exactly one). */
export interface DueNotification {
  readonly typeIds: readonly NotificationTypeId[];
  readonly subjectIds: readonly string[];
  readonly dueAt: number;
  readonly title: string;
  readonly body: string;
  readonly tag: string;
}

export interface ApplyBudgetResult {
  readonly delivering: readonly DueNotification[];
  readonly suppressed: readonly SuppressedNotification[];
}

// ---------------------------------------------------------------------------
// LEDGER — delivery history (bible §4.5 mechanism 4 / §8's `notify-ledger`).
// Device-local, persisted by app/push.ts through the SaveStore seam — this
// module only defines the shape and the pure functions over it (ledger.ts).
// ---------------------------------------------------------------------------

export interface NotificationLedgerEntry {
  readonly typeId: NotificationTypeId;
  readonly subjectIds: readonly string[];
  readonly dueAt: number;
  readonly deliveredAt: number;
}

export interface NotificationLedger {
  /** The most recent day bucket this ledger has pruned to — entries from
   * `day` and `day - 1` are kept (bible §8's "pruned to the current and
   * previous day"), older ones are dropped on the next `recordDelivery`/
   * `pruneLedger` call for a newer day. */
  readonly day: number;
  readonly deliveries: readonly NotificationLedgerEntry[];
}

export const EMPTY_LEDGER: NotificationLedger = { day: 0, deliveries: [] };

// ---------------------------------------------------------------------------
// PREFS — the toggle state `applyBudget` actually consults.
//
// DELIBERATELY NARROW: the full stored `pref-notify` record (asks/declined/
// iosNoticeShown, the earned-ask flow) is `src/ui/notificationPrefs.ts`'s
// `NotificationPrefs` — owned there, not duplicated here, for the SAME
// reason that module gives for not importing this directory: "the two ids
// are load-bearing strings shared by construction, not by import" (its own
// module doc). This type is only what the pure budget layer needs to make
// a delivery decision, so the UI's richer prefs object satisfies it
// structurally with no adapter — TypeScript's structural typing, not a
// shared import, is what keeps the two in sync.
// ---------------------------------------------------------------------------

export interface NotificationTypePrefs {
  readonly homecoming: boolean;
  readonly pipping: boolean;
}

export interface NotificationPrefs {
  readonly master: boolean;
  readonly types: NotificationTypePrefs;
}

/** A fixture default for THIS directory's own tests — never the canonical
 * "never asked" row (that is `src/ui/notificationPrefs.ts`'s
 * `DEFAULT_NOTIFICATION_PREFS`, which also carries `asks`/`declined`/
 * `iosNoticeShown`). Opt-in, matching bible §5.3 either way. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  master: false,
  types: { homecoming: true, pipping: true },
};

// ---------------------------------------------------------------------------
// TUNING — the slice `content/tuning.ts`'s `notifications` block satisfies.
// ---------------------------------------------------------------------------

export interface NotificationTuning {
  readonly quietHours: { readonly startHour: number; readonly endHour: number };
  readonly maxPerDay: number;
  readonly minGapMs: number;
  readonly coalesceWindowMs: number;
  readonly maxNamesInBody: number;
  /** How long after its `dueAt` a notification is still worth showing
   * (`index.ts`'s second filter bound). Past this, the moment has gone
   * stale and is dropped rather than announced late — a phone buzzing at
   * 3am about Tuesday's trip is noise, not news.
   *
   * ROUND-2I REVIEW FIX: replaces `outbox: { horizonMs, maxEntries }` and
   * `periodicSyncMinIntervalMs`, both of which described the Tier-2 outbox
   * this round CUT and were therefore read by nothing — the same
   * dead-knob shape the removals below already call out. This one is
   * consumed on every `dueNotifications` call. */
  readonly staleAfterMs: number;
  /** INTEGRATION-STAGE REMOVAL: `maxClausesPerNotification` and
   * `timerSlopMs` used to sit here and in `content/tuning.ts`, and NOTHING
   * — not one line of production code, not one test — ever read either.
   * Clause count is structurally fixed at two by a two-type catalogue, and
   * the timer-slop tolerance the bible described was never asserted
   * anywhere. Tuning knobs that turn nothing are the same dead-feature
   * shape as state nobody renders (spec §16 v1.3). */
  readonly permissionAsk: {
    readonly afterExpeditionSends: number;
    readonly delayAfterSendMs: number;
    readonly reAskAfterSends: number;
    readonly maxAsks: number;
  };
}

/** The slice `budget.ts` needs beyond `notifications` itself: the SAME
 * day-boundary numbers `progression/streak.ts` already reads, so quiet
 * hours/daily-cap roll over on the identical local-04:00 boundary as the
 * streak and bounties (bible §4.1/§4.2 — "the whole game rolls over
 * together"). `content/tuning.ts` satisfies this in full. */
export interface NotificationHostTuning {
  readonly notifications: NotificationTuning;
  readonly retention: {
    readonly dayStartHour: number;
    readonly dayMs: number;
  };
}
