/**
 * Round 2I (docs/notifications-bible.md §3/§8) — the stored-prefs
 * transitions and the earned-ask eligibility check. All pure; no browser
 * globals, no clock.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFY_PREF_KEY,
  applyDeclinedByUs,
  applyGranted,
  applyIosNoticeShown,
  clearDeclineForManualReask,
  initNotificationPrefs,
  readNotificationPrefs,
  recordAskShown,
  recordExpeditionSend,
  setMaster,
  setType,
  shouldOfferAsk,
} from "./notificationPrefs";
import type { NotificationPrefs, NotifyPrefStore } from "./notificationPrefs";

describe("readNotificationPrefs", () => {
  it("falls back to defaults for missing/malformed input", () => {
    expect(readNotificationPrefs(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(readNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(readNotificationPrefs("garbage")).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(readNotificationPrefs(42)).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("tolerates a partially-malformed record, field by field", () => {
    const result = readNotificationPrefs({
      master: true,
      types: { homecoming: false }, // pipping missing
      asks: "three", // wrong type
      declined: true,
    });
    expect(result.master).toBe(true);
    expect(result.types.homecoming).toBe(false);
    expect(result.types.pipping).toBe(DEFAULT_NOTIFICATION_PREFS.types.pipping);
    expect(result.asks).toBe(DEFAULT_NOTIFICATION_PREFS.asks);
    expect(result.declined).toBe(true);
  });

  it("round-trips a fully well-formed record exactly", () => {
    const full: NotificationPrefs = {
      master: true,
      types: { homecoming: false, pipping: true },
      asks: 2,
      sendsSinceAsk: 1,
      declined: false,
      iosNoticeShown: true,
    };
    expect(readNotificationPrefs(full)).toEqual(full);
  });
});

describe("pure transitions", () => {
  const base = DEFAULT_NOTIFICATION_PREFS;

  it("setMaster / setType touch only the targeted field", () => {
    expect(setMaster(base, true)).toEqual({ ...base, master: true });
    expect(setType(base, "pipping", false)).toEqual({
      ...base,
      types: { ...base.types, pipping: false },
    });
  });

  it("recordExpeditionSend increments sendsSinceAsk only", () => {
    expect(recordExpeditionSend(base)).toEqual({ ...base, sendsSinceAsk: 1 });
  });

  it("recordAskShown increments asks and resets sendsSinceAsk", () => {
    const primed = { ...base, asks: 1, sendsSinceAsk: 5 };
    expect(recordAskShown(primed)).toEqual({ ...primed, asks: 2, sendsSinceAsk: 0 });
  });

  it("applyGranted turns everything on and clears any decline", () => {
    const declined = { ...base, declined: true, master: false, types: { homecoming: false, pipping: false } };
    expect(applyGranted(declined)).toEqual({
      ...declined,
      master: true,
      types: { homecoming: true, pipping: true },
      declined: false,
    });
  });

  it("applyDeclinedByUs sets a hard decline and nothing else", () => {
    expect(applyDeclinedByUs(base)).toEqual({ ...base, declined: true });
  });

  it("applyIosNoticeShown is a one-way flag", () => {
    expect(applyIosNoticeShown(base)).toEqual({ ...base, iosNoticeShown: true });
  });

  it("clearDeclineForManualReask undoes a hard decline without touching the ask counters", () => {
    const declined = { ...base, declined: true, asks: 2, sendsSinceAsk: 4 };
    expect(clearDeclineForManualReask(declined)).toEqual({ ...declined, declined: false });
  });
});

describe("shouldOfferAsk — the earned-ask eligibility check", () => {
  const base = DEFAULT_NOTIFICATION_PREFS;

  it("never during onboarding, regardless of anything else", () => {
    expect(shouldOfferAsk({ ...base, sendsSinceAsk: 99 }, "default", true)).toBe(false);
  });

  it("never once permission is already granted", () => {
    expect(shouldOfferAsk(base, "granted", false)).toBe(false);
  });

  it("never once permission is denied by the browser", () => {
    expect(shouldOfferAsk(base, "denied", false)).toBe(false);
  });

  it("never for the iOS gate — that is a different, once-ever notice", () => {
    expect(shouldOfferAsk(base, "ios-gate", false)).toBe(false);
  });

  it("never when unsupported", () => {
    expect(shouldOfferAsk(base, "unsupported", false)).toBe(false);
  });

  it("never after a hard decline, however many sends have piled up", () => {
    expect(shouldOfferAsk({ ...base, declined: true, sendsSinceAsk: 50 }, "default", false)).toBe(
      false,
    );
  });

  it("offers on the very first qualifying send (afterExpeditionSends: 1)", () => {
    // Not yet — zero qualifying sends recorded.
    expect(shouldOfferAsk({ ...base, asks: 0, sendsSinceAsk: 0 }, "default", false)).toBe(false);
    // One send recorded (recordExpeditionSend called once) — now yes.
    expect(shouldOfferAsk({ ...base, asks: 0, sendsSinceAsk: 1 }, "default", false)).toBe(true);
  });

  it("after one ask, waits for reAskAfterSends (3) more sends before offering again", () => {
    const justAsked = { ...base, asks: 1, sendsSinceAsk: 0 };
    expect(shouldOfferAsk(justAsked, "default", false)).toBe(false);
    expect(shouldOfferAsk({ ...justAsked, sendsSinceAsk: 2 }, "default", false)).toBe(false);
    expect(shouldOfferAsk({ ...justAsked, sendsSinceAsk: 3 }, "default", false)).toBe(true);
  });

  it("never offers automatically once maxAsks (2) has been reached", () => {
    expect(shouldOfferAsk({ ...base, asks: 2, sendsSinceAsk: 99 }, "default", false)).toBe(false);
  });

  it("caps at exactly maxAsks — one below the cap still offers with enough sends", () => {
    expect(shouldOfferAsk({ ...base, asks: 1, sendsSinceAsk: 3 }, "default", false)).toBe(true);
  });
});

describe("initNotificationPrefs — the persistence controller", () => {
  function fakeStore(initial: Record<string, unknown> = {}): NotifyPrefStore {
    const data = new Map(Object.entries(initial));
    return {
      get: async (key) => data.get(key),
      put: async (key, value) => {
        data.set(key, value);
      },
    };
  }

  it("defaults when nothing is stored", async () => {
    const ctl = await initNotificationPrefs(fakeStore());
    expect(ctl.get()).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("loads whatever was stored under NOTIFY_PREF_KEY", async () => {
    const stored: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS, master: true };
    const ctl = await initNotificationPrefs(fakeStore({ [NOTIFY_PREF_KEY]: stored }));
    expect(ctl.get()).toEqual(stored);
  });

  it("works with no store at all (defaults, no persistence, never throws)", async () => {
    const ctl = await initNotificationPrefs(undefined);
    expect(ctl.get()).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(() => ctl.set({ ...DEFAULT_NOTIFICATION_PREFS, master: true })).not.toThrow();
    expect(ctl.get().master).toBe(true);
  });

  it("set() persists and notifies subscribers", async () => {
    const store = fakeStore();
    const ctl = await initNotificationPrefs(store);
    const seen: NotificationPrefs[] = [];
    ctl.subscribe((p) => seen.push(p));

    ctl.set({ ...DEFAULT_NOTIFICATION_PREFS, master: true });

    expect(ctl.get().master).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.master).toBe(true);
    await expect(store.get(NOTIFY_PREF_KEY)).resolves.toEqual(ctl.get());
  });

  it("a store whose get() rejects still yields defaults rather than throwing", async () => {
    const throwing: NotifyPrefStore = {
      get: async () => {
        throw new Error("idb unavailable");
      },
      put: async () => {},
    };
    const ctl = await initNotificationPrefs(throwing);
    expect(ctl.get()).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});
