/**
 * Round 2I (docs/notifications-bible.md §8) — notification PREFERENCES.
 * Device-local, not save-local: permission is granted per browser profile,
 * not per save (a save opened on a laptop and a phone has two different
 * permission states), and the debug menu exports/imports the save blob —
 * so "notifications on" must never travel with it as if it were true on a
 * machine that never granted anything.
 *
 * Lives under its own IndexedDB key (`pref-notify`), through the SAME
 * key-value seam `app/sound.ts` uses for `pref-sound` (structural —
 * this module imports nothing from `app/persistence.ts`, so it stays free
 * of idb and the save format, exactly like `SoundPrefStore`). No
 * `GameSettings` field, no `core/save/*` change, no schema bump: bible §8
 * names the one condition that WOULD force one — a notification
 * preference that changes gameplay — and none here does.
 *
 * Two families of pure function live here:
 *   - the STORED shape (`NotificationPrefs`) and its reducer-shaped
 *     transitions (`setMaster`, `applyGranted`, …) — every one takes the
 *     old value and returns a new one, nothing here mutates.
 *   - `shouldOfferAsk`, the bible §3 earned-ask eligibility check — pure,
 *     no browser globals, so it is trivially unit-testable.
 */

import { tuning } from "../content/tuning";
import type { PermissionState } from "./notificationPermission";

export type NotificationTypeId = "homecoming" | "pipping";

/** The catalogue (bible §1) — two types, fewer/better. Kept here rather
 * than imported from the peer round's `src/core/notifications/` (or
 * `src/app/notifications/types.ts` per the bible) so this module has no
 * dependency on code that round owns; the two ids are load-bearing
 * strings shared by construction, not by import. */
export const NOTIFICATION_TYPE_IDS: readonly NotificationTypeId[] = [
  "homecoming",
  "pipping",
];

export interface NotificationPrefs {
  readonly master: boolean;
  readonly types: Readonly<Record<NotificationTypeId, boolean>>;
  /** How many times the earned-ask card has been shown AUTOMATICALLY
   * (never incremented by a manual "ask again" tap from the settings
   * sheet — bible §3.4's manual path bypasses the cap entirely). */
  readonly asks: number;
  /** Qualifying expedition sends since the card was last shown — the
   * clock `reAskAfterSends` counts against. */
  readonly sendsSinceAsk: number;
  /** An explicit "No thanks" (bible §3.3: `askedAndDeclined`) — never
   * auto-re-asked again. The Nook row's manual tap can still undo this. */
  readonly declined: boolean;
  /** The iOS "pop us on your Home Screen" notice (bible §3.5) has run its
   * once-ever automatic showing. */
  readonly iosNoticeShown: boolean;
}

/** IndexedDB key for the whole record — mirrors `app/sound.ts`'s
 * `SOUND_PREF_KEY` precedent exactly (bible §8). */
export const NOTIFY_PREF_KEY = "pref-notify";

/** Opt-in at every level (bible §5.3): nothing is ON until the earned ask
 * is accepted. The per-type values are the REMEMBERED defaults a later
 * `applyGranted` and a master on/off toggle read from — both true, so a
 * fresh "yes" turns everything on and a master off→on round-trip restores
 * exactly what was there. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  master: false,
  types: { homecoming: true, pipping: true },
  asks: 0,
  sendsSinceAsk: 0,
  declined: false,
  iosNoticeShown: false,
};

/** The slice of `app/persistence.ts`'s `SaveStore` this module needs.
 * Structural, like `SoundPrefStore` — no import of `persistence.ts`. */
export interface NotifyPrefStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

/** Tolerant read: anything missing or malformed falls back to the default
 * for that field alone, never the whole record — the same per-field
 * tolerance `app/sound.ts`'s `readPref` uses. */
export function readNotificationPrefs(raw: unknown): NotificationPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_NOTIFICATION_PREFS;
  const r = raw as Partial<NotificationPrefs> & {
    types?: Partial<Record<NotificationTypeId, boolean>>;
  };
  return {
    master: typeof r.master === "boolean" ? r.master : DEFAULT_NOTIFICATION_PREFS.master,
    types: {
      homecoming:
        typeof r.types?.homecoming === "boolean"
          ? r.types.homecoming
          : DEFAULT_NOTIFICATION_PREFS.types.homecoming,
      pipping:
        typeof r.types?.pipping === "boolean"
          ? r.types.pipping
          : DEFAULT_NOTIFICATION_PREFS.types.pipping,
    },
    asks: typeof r.asks === "number" ? r.asks : DEFAULT_NOTIFICATION_PREFS.asks,
    sendsSinceAsk:
      typeof r.sendsSinceAsk === "number"
        ? r.sendsSinceAsk
        : DEFAULT_NOTIFICATION_PREFS.sendsSinceAsk,
    declined:
      typeof r.declined === "boolean" ? r.declined : DEFAULT_NOTIFICATION_PREFS.declined,
    iosNoticeShown:
      typeof r.iosNoticeShown === "boolean"
        ? r.iosNoticeShown
        : DEFAULT_NOTIFICATION_PREFS.iosNoticeShown,
  };
}

// ---------------------------------------------------------------------------
// Pure transitions — every one old-in, new-out
// ---------------------------------------------------------------------------

export function setMaster(prefs: NotificationPrefs, on: boolean): NotificationPrefs {
  return { ...prefs, master: on };
}

export function setType(
  prefs: NotificationPrefs,
  id: NotificationTypeId,
  on: boolean,
): NotificationPrefs {
  return { ...prefs, types: { ...prefs.types, [id]: on } };
}

/** Call once per qualifying expedition send (bible §3.2's trigger),
 * whether or not this particular send ends up showing the card. */
export function recordExpeditionSend(prefs: NotificationPrefs): NotificationPrefs {
  return { ...prefs, sendsSinceAsk: prefs.sendsSinceAsk + 1 };
}

/** Call the moment the card is actually DISPLAYED (auto path only — a
 * manual re-ask does not touch `asks`, see `NotificationPrefs.asks`'s
 * doc). Resets the re-ask clock. */
export function recordAskShown(prefs: NotificationPrefs): NotificationPrefs {
  return { ...prefs, asks: prefs.asks + 1, sendsSinceAsk: 0 };
}

/** Bible §3.3 "On 'Yes, tap me' → Granted": master on, both types on,
 * any prior decline cleared (moot — permission is resolved now). */
export function applyGranted(prefs: NotificationPrefs): NotificationPrefs {
  return {
    ...prefs,
    master: true,
    types: { homecoming: true, pipping: true },
    declined: false,
  };
}

/** Bible §3.3 "No thanks" AND "Denied at the browser dialog" both land
 * here — a hard decline, never auto-re-asked (§3.4). */
export function applyDeclinedByUs(prefs: NotificationPrefs): NotificationPrefs {
  return { ...prefs, declined: true };
}

/** Bible §3.5 — the Home-Screen notice runs once, automatically, ever. */
export function applyIosNoticeShown(prefs: NotificationPrefs): NotificationPrefs {
  return { ...prefs, iosNoticeShown: true };
}

/** The Nook row's manual "ask again" tap (bible §3.4/§5.3: "tapping
 * re-asks"). Clears a hard decline so the card can be offered immediately
 * — the auto-eligibility counters (`asks`/`sendsSinceAsk`) are irrelevant
 * to a manual tap and are left untouched. */
export function clearDeclineForManualReask(prefs: NotificationPrefs): NotificationPrefs {
  return { ...prefs, declined: false };
}

// ---------------------------------------------------------------------------
// Persistence controller — mirrors `app/sound.ts`'s `initSound` shape
// ---------------------------------------------------------------------------

export interface NotificationPrefsController {
  get(): NotificationPrefs;
  /** Persists (fire-and-forget, like `app/sound.ts`'s mute preference —
   * a preference that fails to save is not worth a UI moment) and
   * notifies subscribers synchronously. */
  set(next: NotificationPrefs): void;
  subscribe(listener: (prefs: NotificationPrefs) => void): () => void;
}

/** Loads once at boot (or defaults, with no store / a store that throws —
 * the same "a browser without IndexedDB plays the game without
 * notifications rather than not at all" tolerance bible §8 asks for), then
 * holds the value in memory for the rest of the session. */
export async function initNotificationPrefs(
  store?: NotifyPrefStore,
): Promise<NotificationPrefsController> {
  const stored = await store?.get(NOTIFY_PREF_KEY).catch(() => undefined);
  let prefs = readNotificationPrefs(stored);
  const listeners = new Set<(prefs: NotificationPrefs) => void>();

  return {
    get: () => prefs,
    set(next: NotificationPrefs): void {
      prefs = next;
      void store?.put(NOTIFY_PREF_KEY, prefs).catch(() => {
        // Preference persistence never blocks or breaks the game.
      });
      for (const listener of listeners) listener(prefs);
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Bible §3 — the earned-ask AUTOMATIC eligibility check. Pure: no
 * `Notification`, no `document`, no clock. `permission` narrows what is
 * even worth offering (already resolved states short-circuit);
 * `onboardingActive` defers to the next qualifying send (bible §3.2: "If
 * onboarding is active, the ask defers to the next qualifying send").
 *
 * Does NOT gate the manual re-ask path (the settings sheet's tap bypasses
 * this function entirely and always shows the card when permission is
 * still `"default"`).
 */
export function shouldOfferAsk(
  prefs: NotificationPrefs,
  permission: PermissionState,
  onboardingActive: boolean,
): boolean {
  if (onboardingActive) return false;
  // "ios-gate" is handled by a DIFFERENT, once-ever notice (see
  // notificationAsk.ts) — never by this function. "granted"/"denied"/
  // "unsupported" are all resolved-or-inapplicable: nothing to ask.
  if (permission !== "default") return false;
  if (prefs.declined) return false;
  const cfg = tuning.notifications.permissionAsk;
  // `sendsSinceAsk` does double duty: before the first-ever ask it is
  // simply "qualifying sends so far", which is exactly what
  // `afterExpeditionSends` (1) counts against; after that ask it is reset
  // by `recordAskShown` and becomes the re-ask clock `reAskAfterSends`
  // counts against. One counter, two readings, never both at once.
  if (prefs.asks === 0) return prefs.sendsSinceAsk >= cfg.afterExpeditionSends;
  return prefs.asks < cfg.maxAsks && prefs.sendsSinceAsk >= cfg.reAskAfterSends;
}
