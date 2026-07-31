/**
 * Round 2I (docs/notifications-bible.md §2.3/§7.1) — the Tier-1 scheduler.
 * Every browser surface (timers, the SW registration, the Notification
 * host, the ledger store) is a fake — this suite never touches a real
 * DOM/browser, mirroring `app/persistence.test.ts`'s own harness style.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../core/clock";
import { EggState } from "../core/eggs";
import type { Egg } from "../core/eggs";
import type { NotificationPipView, NotificationPrefs, NotificationStateSlice } from "../core/notifications";
import { notify, registerPushChannel, setNotifyVisibilityHost } from "../ui/notify";
import type { NotificationHost } from "../ui/notificationPermission";
import {
  applyGranted,
  initNotificationPrefs,
  NOTIFY_PREF_KEY,
  setType,
} from "../ui/notificationPrefs";
import type { NotifyPrefStore } from "../ui/notificationPrefs";
import {
  createNotifyPushChannel,
  createPushScheduler,
  initPushNotifications,
  NOTIFICATION_ICON_URL,
  NOTIFY_LEDGER_KEY,
} from "./push";
import type {
  OsNotificationHandle,
  PushLedgerStore,
  PushSchedulerDeps,
  PushTimerHost,
  PushVisibilityHost,
  ServiceWorkerHost,
  ServiceWorkerRegistrationLike,
} from "./push";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const OFFSET_4AM = 4 * HOUR_MS; // dayStartHour 4, zero tz shift

const ALL_ON: NotificationPrefs = { master: true, types: { homecoming: true, pipping: true } };

/** A real macrotask flush — guarantees every already-scheduled microtask
 * (however many `await` hops deep) has settled before the caller
 * continues, unlike a fixed number of `await Promise.resolve()`s. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeTimers implements PushTimerHost {
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; fn: () => void }>();
  constructor(private readonly clock: FakeClock) {}

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.clock.now() + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  pendingCount(): number {
    return this.tasks.size;
  }

  /** Advance the clock, firing every due task in order (mirrors
   * `app/persistence.test.ts`'s own `FakeTimers.advance`). */
  async advance(ms: number): Promise<void> {
    const target = this.clock.now() + ms;
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Number.POSITIVE_INFINITY;
      for (const [id, task] of this.tasks) {
        if (task.at <= target && task.at < dueAt) {
          dueId = id;
          dueAt = task.at;
        }
      }
      if (dueId === null) break;
      const task = this.tasks.get(dueId);
      this.tasks.delete(dueId);
      if (task !== undefined) {
        this.clock.set(task.at);
        task.fn();
        // `task.fn()` may kick off a `wake()` chain with several `await`
        // hops (registration → permission → ledger → showNotification →
        // re-arm). A real macrotask flush (not just a microtask tick)
        // guarantees the WHOLE chain settles before this loop looks for
        // the next due task (e.g. the re-arm `wake()` itself schedules).
        await flushMicrotasks();
      }
    }
    this.clock.set(target);
  }
}

class FakeRegistration implements ServiceWorkerRegistrationLike {
  readonly shown: { readonly title: string; readonly body?: string; readonly tag?: string }[] = [];
  private readonly handles: { tag: string; closed: boolean }[] = [];

  async showNotification(
    title: string,
    options?: { readonly body?: string; readonly tag?: string; readonly renotify?: boolean },
  ): Promise<void> {
    this.shown.push({ title, body: options?.body, tag: options?.tag });
    this.handles.push({ tag: options?.tag ?? "", closed: false });
  }

  async getNotifications(): Promise<readonly OsNotificationHandle[]> {
    return this.handles.map((h) => ({
      tag: h.tag,
      close: (): void => {
        h.closed = true;
      },
    }));
  }

  closedTags(): readonly string[] {
    return this.handles.filter((h) => h.closed).map((h) => h.tag);
  }

  openTags(): readonly string[] {
    return this.handles.filter((h) => !h.closed).map((h) => h.tag);
  }
}

function swHost(registration: ServiceWorkerRegistrationLike | null): ServiceWorkerHost {
  return {
    ready: registration === null ? Promise.reject(new Error("no service worker")) : Promise.resolve(registration),
  };
}

function notificationHost(permission: "default" | "granted" | "denied"): NotificationHost {
  return { hasNotification: true, notificationPermission: permission, hasServiceWorker: true };
}

function fakeLedgerStore(): PushLedgerStore & { readonly writes: unknown[] } {
  let stored: unknown;
  const writes: unknown[] = [];
  return {
    writes,
    get: (key) => Promise.resolve(key === NOTIFY_LEDGER_KEY ? stored : undefined),
    put: (key, value) => {
      if (key === NOTIFY_LEDGER_KEY) {
        stored = value;
        writes.push(value);
      }
      return Promise.resolve();
    },
  };
}

/** The real `pref-notify` key-value seam, in memory — the same shape
 * `app/persistence.ts`'s `SaveStore` satisfies in production. */
function fakePrefStore(): NotifyPrefStore {
  let stored: unknown;
  return {
    get: (key) => Promise.resolve(key === NOTIFY_PREF_KEY ? stored : undefined),
    put: (key, value) => {
      if (key === NOTIFY_PREF_KEY) stored = value;
      return Promise.resolve();
    },
  };
}

function pip(id: string, name: string, expedition: NotificationPipView["expedition"]): NotificationPipView {
  return { id, name, expedition };
}

function egg(id: string, incubationStartedAt: number, incubationMs: number): Egg {
  return {
    id,
    state: EggState.Incubating,
    foundAt: 0,
    rarity: "common",
    incubationMs,
    incubationStartedAt,
    sourceExpeditionId: "meadow",
  };
}

function state(overrides: Partial<NotificationStateSlice> = {}): NotificationStateSlice {
  return { seed: 1, rosterOrder: [], pips: {}, eggs: [], ...overrides };
}

/**
 * INTEGRATION STAGE: the scheduler delivers THROUGH `ui/notify.ts`'s
 * seam, which routes on document visibility — and the scheduler only ever
 * runs while the page is hidden. Modelling that here is what makes these
 * tests exercise the real production path (a "visible" host would send
 * every delivery down the toast branch instead, which is exactly the
 * behaviour `wake()`'s own visibility guard is asserted on below).
 */
beforeEach(() => {
  setNotifyVisibilityHost({ visibilityState: "hidden" });
});

afterEach(() => {
  setNotifyVisibilityHost(null);
  registerPushChannel(null);
});

describe("createPushScheduler — arm/wake", () => {
  it("arms a timer for the next due moment and delivers exactly at it", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const registration = new FakeRegistration();
    const departedAt = 10 * HOUR_MS;
    let s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 5 * MINUTE_MS }) },
    });
    clock.set(departedAt);

    const scheduler = createPushScheduler({
      clock,
      getState: () => s,
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("granted"),
      timers,
    });

    scheduler.arm();
    expect(timers.pendingCount()).toBe(1);
    expect(registration.shown).toHaveLength(0);

    await timers.advance(5 * MINUTE_MS);

    expect(registration.shown).toHaveLength(1);
    expect(registration.shown[0]?.title).toBe("Rooter is back from Meadow");
    expect(scheduler.getLedger().deliveries).toHaveLength(1);
  });

  it("never delivers twice for the same due moment (recompute-at-fire cancellation)", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const registration = new FakeRegistration();
    const departedAt = 10 * HOUR_MS;
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 5 * MINUTE_MS }) },
    });
    clock.set(departedAt);

    const scheduler = createPushScheduler({
      clock,
      getState: () => s,
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("granted"),
      timers,
    });

    scheduler.arm();
    await timers.advance(5 * MINUTE_MS);
    expect(registration.shown).toHaveLength(1);

    // A later wake (say the SW opportunistically drained, or a second
    // tab fired) recomputes against the SAME unchanged state and the
    // ledger already holds the delivery — nothing new is shown.
    await scheduler.wake();
    expect(registration.shown).toHaveLength(1);
  });

  it("cancellation via state change: once the player has handled it, a later wake shows nothing", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const registration = new FakeRegistration();
    const departedAt = 10 * HOUR_MS;
    let s: NotificationStateSlice = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 5 * MINUTE_MS }) },
    });
    clock.set(departedAt);

    const scheduler = createPushScheduler({
      clock,
      getState: () => s,
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("granted"),
      timers,
    });

    scheduler.arm();
    // The player comes back and acknowledges the reveal BEFORE the timer
    // fires — the Pip is no longer OnExpedition in the (unadvanced) state
    // a real reducer would produce.
    s = state({ rosterOrder: ["p1"], pips: { p1: pip("p1", "Rooter", null) } });

    await timers.advance(5 * MINUTE_MS);
    expect(registration.shown).toHaveLength(0);
  });

  it("no permission granted: never calls showNotification, never throws", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const registration = new FakeRegistration();
    const departedAt = 10 * HOUR_MS;
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 5 * MINUTE_MS }) },
    });
    clock.set(departedAt);

    const scheduler = createPushScheduler({
      clock,
      getState: () => s,
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("default"),
      timers,
    });

    scheduler.arm();
    await expect(timers.advance(5 * MINUTE_MS)).resolves.not.toThrow();
    expect(registration.shown).toHaveLength(0);
  });

  it("no service worker registration available: never throws, never delivers", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const departedAt = 10 * HOUR_MS;
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 5 * MINUTE_MS }) },
    });
    clock.set(departedAt);

    const scheduler = createPushScheduler({
      clock,
      getState: () => s,
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: null,
      notificationHost: notificationHost("granted"),
      timers,
    });

    scheduler.arm();
    await expect(timers.advance(5 * MINUTE_MS)).resolves.not.toThrow();
  });

  it("ledger persistence: a delivery survives a fresh scheduler instance (simulated reload)", async () => {
    const clock = new FakeClock(0);
    const ledgerStore = fakeLedgerStore();
    const departedAt = 10 * HOUR_MS;
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 0 }) },
    });
    clock.set(departedAt);

    const registrationA = new FakeRegistration();
    const first = createPushScheduler({
      clock,
      getState: () => s,
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registrationA),
      notificationHost: notificationHost("granted"),
      timers: new FakeTimers(clock),
      ledgerStore,
    });
    await first.wake();
    expect(registrationA.shown).toHaveLength(1);
    expect(ledgerStore.writes.length).toBeGreaterThan(0);

    // A "fresh page load" — new scheduler, same persisted ledger.
    const registrationB = new FakeRegistration();
    const second = createPushScheduler({
      clock,
      getState: () => s,
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registrationB),
      notificationHost: notificationHost("granted"),
      timers: new FakeTimers(clock),
      ledgerStore,
    });
    await second.wake();
    expect(registrationB.shown).toHaveLength(0);
  });
});

describe("createPushScheduler — integration-stage guarantees", () => {
  /** A pip whose 5-minute trip is due the instant the clock reaches
   * `departedAt + 5m`. */
  function dueTripState(departedAt: number): NotificationStateSlice {
    return state({
      rosterOrder: ["p1"],
      pips: {
        p1: pip("p1", "Rooter", {
          expeditionId: "meadow",
          departedAt,
          durationMs: 5 * MINUTE_MS,
        }),
      },
    });
  }

  it("delivers THROUGH ui/notify.ts's seam, not around it", async () => {
    // Proof by removal: with the seam torn down (no channel registered),
    // a scheduler that called `showNotification` directly would still
    // deliver. This one must not — and must not book a ledger entry for
    // a notification nobody ever saw.
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const registration = new FakeRegistration();
    const departedAt = 10 * HOUR_MS;
    clock.set(departedAt);

    const scheduler = createPushScheduler({
      clock,
      getState: () => dueTripState(departedAt),
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("granted"),
      timers,
    });
    registerPushChannel(null);

    scheduler.arm();
    await timers.advance(5 * MINUTE_MS);

    expect(registration.shown).toHaveLength(0);
    expect(scheduler.getLedger().deliveries).toHaveLength(0);
  });

  it("never delivers while the page is visible — the ticker's CATCHUP owns that moment", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const registration = new FakeRegistration();
    const departedAt = 10 * HOUR_MS;
    clock.set(departedAt);
    const visibility = new FakeVisibility(); // starts "visible"

    const scheduler = createPushScheduler({
      clock,
      getState: () => dueTripState(departedAt),
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("granted"),
      timers,
      visibility,
    });

    scheduler.arm();
    await timers.advance(5 * MINUTE_MS);

    expect(registration.shown).toHaveLength(0);
    expect(scheduler.getLedger().deliveries).toHaveLength(0);

    // ...and the same scheduler delivers once the player is away.
    visibility.set("hidden");
    await scheduler.wake();
    expect(registration.shown).toHaveLength(1);
  });

  it("falls back to the Notification constructor when no service worker is registered (npm run dev)", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const departedAt = 10 * HOUR_MS;
    clock.set(departedAt);
    const local: { title: string; tag: string; icon: string }[] = [];

    const scheduler = createPushScheduler({
      clock,
      getState: () => dueTripState(departedAt),
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: null,
      notificationHost: notificationHost("granted"),
      timers,
      showLocalNotification: (title, options) => {
        local.push({ title, tag: options.tag, icon: options.icon });
        return true;
      },
    });

    scheduler.arm();
    await timers.advance(5 * MINUTE_MS);

    expect(local).toHaveLength(1);
    expect(local[0]?.title).toBe("Rooter is back from Meadow");
    expect(local[0]?.tag).toBe("pk-homecoming");
    expect(local[0]?.icon).toBe(NOTIFICATION_ICON_URL);
    // A real delivery, so it IS booked against the budget.
    expect(scheduler.getLedger().deliveries).toHaveLength(1);
  });

  it("books nothing when no delivery mechanism exists at all", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const departedAt = 10 * HOUR_MS;
    clock.set(departedAt);

    const scheduler = createPushScheduler({
      clock,
      getState: () => dueTripState(departedAt),
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: null,
      notificationHost: notificationHost("granted"),
      timers,
      showLocalNotification: () => false,
    });

    scheduler.arm();
    await timers.advance(5 * MINUTE_MS);

    // The whole point: an undelivered item must not consume its own
    // daily-cap slot NOR be marked already-delivered, so the next wake
    // can still show it.
    expect(scheduler.getLedger().deliveries).toHaveLength(0);
  });

  it("a homecoming carries the app icon through to showNotification", async () => {
    const clock = new FakeClock(0);
    const departedAt = 10 * HOUR_MS;
    clock.set(departedAt);
    const shownIcons: (string | undefined)[] = [];
    const registration: ServiceWorkerRegistrationLike = {
      async showNotification(_title, options) {
        shownIcons.push(options?.icon);
      },
      async getNotifications() {
        return [];
      },
    };

    const scheduler = createPushScheduler({
      clock,
      getState: () => dueTripState(departedAt - 5 * MINUTE_MS),
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("granted"),
      timers: new FakeTimers(clock),
    });

    await scheduler.wake();
    expect(shownIcons).toEqual([NOTIFICATION_ICON_URL]);
  });
});

/**
 * ROUND-2I REVIEW FIX (major, two findings). Every other case in this file
 * hardcodes `getPrefs: () => ALL_ON`, so NOTHING asserted that the stored
 * preference actually reaches the pure budget layer. Two mutations proved
 * it: replacing `deps.getPrefs()` in `push.ts` with a hardcoded all-on
 * object left the suite 16/16 green, and severing the toggle at main.ts's
 * own call site did too. `applyBudget` is well covered on both flags
 * (budget.test.ts's "master off suppresses everything" / "one type off
 * suppresses only that type"); it was only the SEAM between the stored
 * value and that layer that was unguarded — the "setting nothing reads"
 * dead-feature shape this round exists to avoid.
 */
describe("createPushScheduler — the stored preference actually reaches the budget", () => {
  function schedulerWith(
    getPrefs: () => NotificationPrefs,
    registration: FakeRegistration,
    clock: FakeClock,
    timers: FakeTimers,
    departedAt: number,
  ) {
    return createPushScheduler({
      clock,
      getState: () =>
        state({
          rosterOrder: ["p1"],
          pips: {
            p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 5 * MINUTE_MS }),
          },
          eggs: [egg("egg-1", departedAt, 5 * MINUTE_MS)],
        }),
      getPrefs,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("granted"),
      timers,
    });
  }

  it("master OFF delivers nothing, even with permission granted and something due", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const registration = new FakeRegistration();
    const departedAt = 10 * HOUR_MS;
    clock.set(departedAt);

    const scheduler = schedulerWith(
      () => ({ master: false, types: { homecoming: true, pipping: true } }),
      registration,
      clock,
      timers,
      departedAt,
    );
    scheduler.arm();
    await timers.advance(5 * MINUTE_MS);

    expect(registration.shown).toHaveLength(0);
    expect(scheduler.getLedger().deliveries).toHaveLength(0);
  });

  it("one type OFF silences that type and leaves the other alone", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const registration = new FakeRegistration();
    const departedAt = 10 * HOUR_MS;
    clock.set(departedAt);

    const scheduler = schedulerWith(
      () => ({ master: true, types: { homecoming: false, pipping: true } }),
      registration,
      clock,
      timers,
      departedAt,
    );
    scheduler.arm();
    await timers.advance(5 * MINUTE_MS);

    expect(registration.shown).toHaveLength(1);
    expect(registration.shown[0]?.tag).toBe("pk-pipping");
  });

  it("the REAL persisted prefs controller drives it: toggling a type off in the Nook silences it", async () => {
    // The wiring main.ts performs, end to end: the same controller the
    // settings sheet mutates is the one the scheduler reads. No fake prefs
    // object anywhere in this test.
    const store = fakePrefStore();
    const ctl = await initNotificationPrefs(store);
    ctl.set(applyGranted(ctl.get())); // the player said "Yes, tap me"

    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const registration = new FakeRegistration();
    const departedAt = 10 * HOUR_MS;
    clock.set(departedAt + 5 * MINUTE_MS); // both the trip and the egg are due

    const scheduler = schedulerWith(() => ctl.get(), registration, clock, timers, departedAt);

    // Control: with the stored prefs untouched, the homecoming ships (as
    // half of the cross-type "The Keep has been busy" merge).
    await scheduler.wake();
    expect(registration.shown.map((n) => n.tag)).toContain("pk-keep");

    // Now the player opens the Nook and turns homecomings off.
    const off = new FakeRegistration();
    const second = schedulerWith(() => ctl.get(), off, clock, new FakeTimers(clock), departedAt);
    ctl.set(setType(ctl.get(), "homecoming", false));
    await second.wake();

    expect(off.shown.every((n) => n.tag !== "pk-homecoming")).toBe(true);
    expect(off.shown.map((n) => n.tag)).toEqual(["pk-pipping"]);
  });
});

describe("createPushScheduler — cancelAll", () => {
  it("clears the armed timer and closes every pk-* notification, leaving others alone", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const registration = new FakeRegistration();
    await registration.showNotification("pre-existing pk", { tag: "pk-homecoming" });
    await registration.showNotification("unrelated", { tag: "some-other-app-tag" });

    const departedAt = 10 * HOUR_MS;
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 5 * MINUTE_MS }) },
    });
    clock.set(departedAt);

    const scheduler = createPushScheduler({
      clock,
      getState: () => s,
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("granted"),
      timers,
    });

    scheduler.arm();
    expect(timers.pendingCount()).toBe(1);

    await scheduler.cancelAll();

    expect(timers.pendingCount()).toBe(0);
    expect(registration.closedTags()).toEqual(["pk-homecoming"]);
    expect(registration.openTags()).toEqual(["some-other-app-tag"]);

    // The cleared timer never fires even once the due moment passes.
    await timers.advance(5 * MINUTE_MS);
    expect(registration.shown.filter((n) => n.tag === "pk-homecoming")).toHaveLength(1); // unchanged
  });
});

describe("createNotifyPushChannel", () => {
  it("delivers when permission is granted", async () => {
    const registration = new FakeRegistration();
    const channel = createNotifyPushChannel({
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("granted"),
    });
    channel.deliver({ typeId: "homecoming", title: "t", body: "b", tag: "pk-homecoming" });
    await flushMicrotasks();
    expect(registration.shown).toEqual([{ title: "t", body: "b", tag: "pk-homecoming" }]);
  });

  it("does nothing when permission is not granted", async () => {
    const registration = new FakeRegistration();
    const channel = createNotifyPushChannel({
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("denied"),
    });
    channel.deliver({ typeId: "homecoming", title: "t", body: "b", tag: "pk-homecoming" });
    await flushMicrotasks();
    expect(registration.shown).toHaveLength(0);
  });
});

class FakeVisibility implements PushVisibilityHost {
  visibilityState = "visible";
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  set(next: string): void {
    this.visibilityState = next;
    for (const listener of [...this.listeners]) listener();
  }
}

describe("initPushNotifications — wiring", () => {
  afterEach(() => {
    registerPushChannel(null);
    setNotifyVisibilityHost(null);
  });

  it("arms on hidden and cancels (closing pk-* notifications) on visible", async () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers(clock);
    const registration = new FakeRegistration();
    await registration.showNotification("stale", { tag: "pk-homecoming" });
    const visibility = new FakeVisibility();
    const departedAt = 10 * HOUR_MS;
    const s = state({
      rosterOrder: ["p1"],
      pips: { p1: pip("p1", "Rooter", { expeditionId: "meadow", departedAt, durationMs: 5 * MINUTE_MS }) },
    });
    clock.set(departedAt);

    const push = initPushNotifications({
      clock,
      getState: () => s,
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("granted"),
      timers,
      visibility,
    });

    visibility.set("hidden");
    expect(timers.pendingCount()).toBe(1);

    visibility.set("visible");
    expect(timers.pendingCount()).toBe(0);
    await flushMicrotasks();
    expect(registration.closedTags()).toContain("pk-homecoming");

    push.dispose();
  });

  it("registers a REAL PushChannel with src/ui/notify.ts's seam — a hidden-tab push event reaches showNotification", async () => {
    const registration = new FakeRegistration();
    const push = initPushNotifications({
      clock: new FakeClock(0),
      getState: () => state(),
      getPrefs: () => ALL_ON,
      getDayOffsetMs: () => OFFSET_4AM,
      serviceWorker: swHost(registration),
      notificationHost: notificationHost("granted"),
      timers: new FakeTimers(new FakeClock(0)),
      visibility: null,
    });

    setNotifyVisibilityHost({ visibilityState: "hidden" });
    notify({
      kind: "expeditionReturn",
      message: "Rooter is home!",
      push: { typeId: "homecoming", title: "t", body: "b", tag: "pk-homecoming" },
    });

    await flushMicrotasks();
    expect(registration.shown).toEqual([{ title: "t", body: "b", tag: "pk-homecoming" }]);

    push.dispose();
  });
});
