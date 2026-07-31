/**
 * Round 2I (docs/notifications-bible.md §3) — the earned-ask card. Pure
 * copy model plus a DOM-driven controller test (round 2G review's house
 * pattern: a model being right is not proof the wiring reaches it).
 *
 * The `setTimeout` dependency is a plain injected queue, not
 * `vi.useFakeTimers()` — mirrors `app/persistence.ts`'s `TimerHost`
 * pattern already in this codebase: fire exactly the callback under test,
 * nothing implicit about real elapsed time.
 */

import { describe, expect, it, vi } from "vitest";
import { asHtml, installFakeDom } from "./fakeDom";
import type { FakeElement } from "./fakeDom";
import {
  IOS_GATE_CARD,
  createNotificationAskFlow,
  notificationAskCardModel,
} from "./notificationAsk";
import type { AskContext } from "./notificationAsk";
import { DEFAULT_NOTIFICATION_PREFS } from "./notificationPrefs";
import type { NotificationPrefs } from "./notificationPrefs";
import type { NotificationHost } from "./notificationPermission";
import { tuning } from "../content/tuning";

const CONTEXT: AskContext = {
  pipName: "Rooter",
  biomeName: "Meadow",
  durationMs: 5 * 60_000,
};

function host(overrides: Partial<NotificationHost> = {}): NotificationHost {
  return {
    hasNotification: true,
    notificationPermission: "default",
    hasServiceWorker: true,
    standalone: undefined,
    requestPermission: async () => "granted",
    ...overrides,
  };
}

/** A `setTimeout` stand-in that just remembers what was scheduled — the
 * test decides when (and whether) to fire it. */
function fakeTimerQueue(): {
  setTimeout(fn: () => void, ms: number): unknown;
  fireAll(): void;
  readonly delays: number[];
} {
  const scheduled: { fn: () => void; ms: number }[] = [];
  return {
    setTimeout(fn, ms) {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    fireAll(): void {
      const copy = scheduled.splice(0, scheduled.length);
      for (const { fn } of copy) fn();
    },
    get delays(): number[] {
      return scheduled.map((s) => s.ms);
    },
  };
}

describe("notificationAskCardModel", () => {
  it("interpolates the pip name, biome, and duration from the trip that just left", () => {
    const model = notificationAskCardModel(CONTEXT);
    expect(model.title).toBe("Shall we tell you when they're back?");
    expect(model.body).toContain("Rooter");
    expect(model.body).toContain("Meadow");
    expect(model.body).toMatch(/5 min/);
  });

  it("falls back to a context-free variant for a manual re-ask with no fresh trip", () => {
    const model = notificationAskCardModel(null);
    expect(model.title).toBe("Shall we tell you when they're back?");
    expect(model.body.length).toBeGreaterThan(0);
    expect(model.body).not.toContain("undefined");
  });

  it("never quotes the banned phrase verbatim (paraphrased, not repeated)", () => {
    const model = notificationAskCardModel(CONTEXT);
    expect(model.body.toLowerCase()).not.toContain("miss you");
  });
});

describe("IOS_GATE_CARD", () => {
  it("is non-empty and mentions the Home Screen", () => {
    expect(IOS_GATE_CARD.title.length).toBeGreaterThan(0);
    expect(IOS_GATE_CARD.body).toMatch(/home screen/i);
  });
});

describe("createNotificationAskFlow", () => {
  function setup(initialPrefs: NotificationPrefs = DEFAULT_NOTIFICATION_PREFS) {
    const dom = installFakeDom();
    let prefs = initialPrefs;
    const timers = fakeTimerQueue();
    let onboardingActive = false;
    const flow = createNotificationAskFlow({
      mount: asHtml(dom.ui),
      getPrefs: () => prefs,
      setPrefs: (next) => {
        prefs = next;
      },
      isOnboardingActive: () => onboardingActive,
      host: host(),
      setTimeout: timers.setTimeout,
    });
    return {
      dom,
      flow,
      timers,
      getPrefs: () => prefs,
      setOnboarding: (v: boolean) => {
        onboardingActive = v;
      },
    };
  }

  it("arms exactly one timer on the first qualifying send, and records the send immediately", () => {
    const { flow, timers, getPrefs } = setup();
    flow.onExpeditionSent(CONTEXT);

    expect(getPrefs().sendsSinceAsk).toBe(1);
    expect(timers.delays).toHaveLength(1);
    expect(timers.delays[0]).toBe(
      tuning.notifications.permissionAsk.delayAfterSendMs + 1900, // trot duration
    );
    expect(flow.isOpen).toBe(false); // not yet — the timer hasn't fired
  });

  it("opens the card once the timer fires, recording the ask", () => {
    const { flow, timers, getPrefs } = setup();
    flow.onExpeditionSent(CONTEXT);
    timers.fireAll();

    expect(flow.isOpen).toBe(true);
    expect(getPrefs().asks).toBe(1);
    expect(getPrefs().sendsSinceAsk).toBe(0);
  });

  it("never arms anything while onboarding is active, and does not count the send", () => {
    const { flow, timers, getPrefs, setOnboarding } = setup();
    setOnboarding(true);
    flow.onExpeditionSent(CONTEXT);

    expect(timers.delays).toHaveLength(0);
    expect(getPrefs().sendsSinceAsk).toBe(0);
  });

  it("never arms anything once permission is already granted", () => {
    const dom = installFakeDom();
    const timers = fakeTimerQueue();
    let prefs = DEFAULT_NOTIFICATION_PREFS;
    const flow = createNotificationAskFlow({
      mount: asHtml(dom.ui),
      getPrefs: () => prefs,
      setPrefs: (next) => {
        prefs = next;
      },
      isOnboardingActive: () => false,
      host: host({ notificationPermission: "granted" }),
      setTimeout: timers.setTimeout,
    });
    flow.onExpeditionSent(CONTEXT);
    expect(timers.delays).toHaveLength(0);
    dom.uninstall();
  });

  it("a hard decline blocks all further automatic asks", () => {
    const { flow, timers } = setup({ ...DEFAULT_NOTIFICATION_PREFS, declined: true });
    flow.onExpeditionSent(CONTEXT);
    expect(timers.delays).toHaveLength(0);
  });

  it("re-arms after reAskAfterSends more qualifying sends following a soft dismiss", () => {
    const { flow, timers, getPrefs } = setup({
      ...DEFAULT_NOTIFICATION_PREFS,
      asks: 1,
      sendsSinceAsk: 0,
    });
    flow.onExpeditionSent(CONTEXT); // 1
    expect(timers.delays).toHaveLength(0);
    flow.onExpeditionSent(CONTEXT); // 2
    expect(timers.delays).toHaveLength(0);
    flow.onExpeditionSent(CONTEXT); // 3 — reAskAfterSends
    expect(timers.delays).toHaveLength(1);
    expect(getPrefs().sendsSinceAsk).toBe(3);
  });

  it("stops offering automatically once maxAsks is reached", () => {
    const { flow, timers } = setup({
      ...DEFAULT_NOTIFICATION_PREFS,
      asks: 2,
      sendsSinceAsk: 99,
    });
    flow.onExpeditionSent(CONTEXT);
    expect(timers.delays).toHaveLength(0);
  });

  /** An iOS-Safari-shaped host: notifications exist only from the Home
   * Screen, and this browsing context is not standalone. */
  function iosFlow(onboarding: () => boolean) {
    const dom = installFakeDom();
    const timers = fakeTimerQueue();
    let prefs = DEFAULT_NOTIFICATION_PREFS;
    const flow = createNotificationAskFlow({
      mount: asHtml(dom.ui),
      getPrefs: () => prefs,
      setPrefs: (next) => {
        prefs = next;
      },
      isOnboardingActive: onboarding,
      host: host({
        hasNotification: false,
        notificationPermission: undefined,
        hasServiceWorker: true,
        standalone: false,
      }),
      setTimeout: timers.setTimeout,
    });
    return { dom, flow, timers, getPrefs: () => prefs };
  }

  it("iOS gate: NEVER during onboarding — the once-ever explanation is not spent on the guided send", () => {
    // ROUND-2I REVIEW FIX (major). The ios-gate branch used to run BEFORE
    // the onboarding guard, so every iOS Safari player met an "add us to
    // your Home Screen" card three seconds into onboarding's guided
    // Meadow send, on top of the departure trot — inside the acceptance-
    // bar ceremony, and once ever, at the moment they had least context.
    const { flow, timers, getPrefs, dom } = iosFlow(() => true);
    flow.onExpeditionSent(CONTEXT);

    expect(timers.delays).toHaveLength(0);
    expect(flow.isOpen).toBe(false);
    expect(getPrefs().iosNoticeShown).toBe(false); // still unspent
    dom.uninstall();
  });

  it("iOS gate: waits for the trot to finish, exactly like the ordinary card", () => {
    const { flow, timers, dom } = iosFlow(() => false);
    flow.onExpeditionSent(CONTEXT);
    expect(timers.delays[0]).toBe(
      tuning.notifications.permissionAsk.delayAfterSendMs + 1900, // trot duration
    );
    dom.uninstall();
  });

  it("iOS gate: substitutes the Home Screen notice, shown once, never the ordinary ask", () => {
    const dom = installFakeDom();
    const timers = fakeTimerQueue();
    let prefs = DEFAULT_NOTIFICATION_PREFS;
    const flow = createNotificationAskFlow({
      mount: asHtml(dom.ui),
      getPrefs: () => prefs,
      setPrefs: (next) => {
        prefs = next;
      },
      isOnboardingActive: () => false,
      host: host({
        hasNotification: false,
        notificationPermission: undefined,
        hasServiceWorker: true,
        standalone: false,
      }),
      setTimeout: timers.setTimeout,
    });

    flow.onExpeditionSent(CONTEXT);
    expect(timers.delays).toHaveLength(1);
    timers.fireAll();
    expect(flow.isOpen).toBe(true);
    expect(dom.document.querySelector(".pk-ask-title")?.textContent).toBe(
      IOS_GATE_CARD.title,
    );

    // "Got it" marks it shown; a second send never re-arms it.
    dom.document.querySelectorAll(".pk-ask-btn")[0]?.click();
    expect(prefs.iosNoticeShown).toBe(true);

    flow.onExpeditionSent(CONTEXT);
    expect(timers.delays).toHaveLength(0);
    dom.uninstall();
  });

  it("'Yes, tap me' requests permission synchronously inside the click handler and grants", async () => {
    const dom = installFakeDom();
    const timers = fakeTimerQueue();
    let prefs = DEFAULT_NOTIFICATION_PREFS;
    const requestPermission = vi.fn(async () => "granted" as const);
    const flow = createNotificationAskFlow({
      mount: asHtml(dom.ui),
      getPrefs: () => prefs,
      setPrefs: (next) => {
        prefs = next;
      },
      isOnboardingActive: () => false,
      host: host({ requestPermission }),
      setTimeout: timers.setTimeout,
    });

    flow.onExpeditionSent(CONTEXT);
    timers.fireAll();
    expect(flow.isOpen).toBe(true);

    const yesButton = dom.document.querySelectorAll(".pk-ask-btn")[0];
    yesButton?.click();

    // Synchronous effects: closed immediately, requestPermission invoked
    // from directly inside this call stack.
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(flow.isOpen).toBe(false);

    // Async resolution applies the grant.
    await Promise.resolve();
    await Promise.resolve();
    expect(prefs.master).toBe(true);
    expect(prefs.types.homecoming).toBe(true);
    expect(prefs.types.pipping).toBe(true);
    dom.uninstall();
  });

  it("'No thanks' records a hard decline and shows no toast", () => {
    const { dom, flow, timers, getPrefs } = setup();
    flow.onExpeditionSent(CONTEXT);
    timers.fireAll();

    const noButton = dom.document.querySelectorAll(".pk-ask-btn--no")[0];
    noButton?.click();

    expect(getPrefs().declined).toBe(true);
    expect(flow.isOpen).toBe(false);
  });

  it("showManually always opens the card when permission is still default, bypassing the counters", () => {
    const { flow, timers, getPrefs } = setup({
      ...DEFAULT_NOTIFICATION_PREFS,
      declined: true,
      asks: 2,
    });
    flow.showManually();
    expect(flow.isOpen).toBe(true);
    expect(getPrefs().asks).toBe(3); // recordAskShown still runs
    expect(timers.delays).toHaveLength(0); // manual path never arms a timer
    // Tapping "ask me again" IS an un-declining: the stored hard decline
    // is cleared, so the Nook stops reporting "Off. Say the word and we'll
    // ask again" behind the card that is now open.
    expect(getPrefs().declined).toBe(false);
  });

  it("the card is announced, labelled, and closeable from the keyboard", () => {
    const { dom, flow, timers } = setup();
    flow.onExpeditionSent(CONTEXT);
    timers.fireAll();
    expect(flow.isOpen).toBe(true);

    const card = dom.document.querySelector(".pk-ask-card");
    expect(card?.getAttribute("role")).toBe("dialog");
    const labelledBy = card?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(dom.document.querySelector(".pk-ask-title")?.id).toBe(labelledBy);

    // Escape is a SOFT dismiss (bible §3.4) — closes without recording a
    // decline, exactly like a tap on the backdrop.
    (flow.el as unknown as FakeElement).dispatch("keydown", { key: "Escape" });
    expect(flow.isOpen).toBe(false);
  });

  it("Escape does NOT dismiss the iOS notice — 'Got it' is its only exit", () => {
    const { flow, timers, dom } = iosFlow(() => false);
    flow.onExpeditionSent(CONTEXT);
    timers.fireAll();
    expect(flow.isOpen).toBe(true);

    (flow.el as unknown as FakeElement).dispatch("keydown", { key: "Escape" });
    expect(flow.isOpen).toBe(true);
    dom.uninstall();
  });

  it("showManually is a no-op once permission is already resolved", () => {
    const dom = installFakeDom();
    let prefs = DEFAULT_NOTIFICATION_PREFS;
    const flow = createNotificationAskFlow({
      mount: asHtml(dom.ui),
      getPrefs: () => prefs,
      setPrefs: (next) => {
        prefs = next;
      },
      isOnboardingActive: () => false,
      host: host({ notificationPermission: "granted" }),
    });
    flow.showManually();
    expect(flow.isOpen).toBe(false);
    dom.uninstall();
  });

  it("permissionState() reflects the injected host", () => {
    const { flow } = setup();
    expect(flow.permissionState()).toBe("default");
  });
});
