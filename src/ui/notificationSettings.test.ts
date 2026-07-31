/**
 * Round 2I (docs/notifications-bible.md §5) — the settings model (every
 * permission × prefs combination bible §5.3's table names) and a DOM
 * smoke test per round 2G's review finding: a model function being
 * correct is not proof the sheet renders it (`layers.test.ts`/`fakeDom.ts`
 * house pattern).
 */

import { describe, expect, it } from "vitest";
import { asHtml, installFakeDom } from "./fakeDom";
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_TYPE_IDS,
} from "./notificationPrefs";
import type { NotificationPrefs } from "./notificationPrefs";
import type { PermissionState } from "./notificationPermission";
import { FORBIDDEN_SUBSTRINGS } from "../core/notifications/copy";
import {
  createNotificationSettingsSheet,
  notificationSettingsModel,
  notificationUiState,
  notificationsNookRow,
} from "./notificationSettings";

const GRANTED_ON: NotificationPrefs = {
  ...DEFAULT_NOTIFICATION_PREFS,
  master: true,
  types: { homecoming: true, pipping: true },
};

describe("notificationUiState", () => {
  it("maps every permission/prefs combination bible §5.3 names", () => {
    expect(notificationUiState(DEFAULT_NOTIFICATION_PREFS, "granted")).toBe("granted");
    expect(notificationUiState(DEFAULT_NOTIFICATION_PREFS, "denied")).toBe("denied-by-browser");
    expect(notificationUiState(DEFAULT_NOTIFICATION_PREFS, "ios-gate")).toBe("ios-gate");
    expect(notificationUiState(DEFAULT_NOTIFICATION_PREFS, "unsupported")).toBe("unsupported");
    expect(notificationUiState(DEFAULT_NOTIFICATION_PREFS, "default")).toBe("never-asked");
    expect(
      notificationUiState({ ...DEFAULT_NOTIFICATION_PREFS, declined: true }, "default"),
    ).toBe("declined-by-us");
  });
});

describe("notificationSettingsModel", () => {
  it("never-asked: master off, no tap-to-reask disabled, rows reflect remembered (unused) values", () => {
    const model = notificationSettingsModel(DEFAULT_NOTIFICATION_PREFS, "default");
    expect(model.masterTapAction).toBe("reask");
    const master = model.rows.find((r) => r.id === "master");
    expect(master?.on).toBe(false);
    expect(master?.disabled).toBe(false);
  });

  it("declined-by-us: same shape as never-asked but distinct uiState, still offers 'reask'", () => {
    const declined = { ...DEFAULT_NOTIFICATION_PREFS, declined: true };
    const model = notificationSettingsModel(declined, "default");
    expect(model.uiState).toBe("declined-by-us");
    expect(model.masterTapAction).toBe("reask");
  });

  it("granted + master on: both type rows are ON and enabled", () => {
    const model = notificationSettingsModel(GRANTED_ON, "granted");
    expect(model.masterTapAction).toBeNull();
    const master = model.rows.find((r) => r.id === "master");
    expect(master?.on).toBe(true);
    expect(master?.disabled).toBe(false);
    for (const id of NOTIFICATION_TYPE_IDS) {
      const row = model.rows.find((r) => r.id === id);
      expect(row?.on).toBe(true);
      expect(row?.disabled).toBe(false);
    }
  });

  it("granted but master OFF: type rows are disabled (but remember their value)", () => {
    const masterOff: NotificationPrefs = { ...GRANTED_ON, master: false };
    const model = notificationSettingsModel(masterOff, "granted");
    const master = model.rows.find((r) => r.id === "master");
    expect(master?.on).toBe(false);
    expect(master?.disabled).toBe(false); // the master row itself stays tappable
    const homecoming = model.rows.find((r) => r.id === "homecoming");
    expect(homecoming?.on).toBe(true); // remembered
    expect(homecoming?.disabled).toBe(true); // but inert while master is off
  });

  it("denied-by-browser: every row disabled, no tap action (nothing we can do from in here)", () => {
    const model = notificationSettingsModel(DEFAULT_NOTIFICATION_PREFS, "denied");
    expect(model.masterTapAction).toBeNull();
    for (const row of model.rows) expect(row.disabled).toBe(true);
    expect(model.rows.find((r) => r.id === "master")?.hint).toContain("site settings");
  });

  it("ios-gate: disabled rows, masterTapAction re-shows the Home Screen notice", () => {
    const model = notificationSettingsModel(DEFAULT_NOTIFICATION_PREFS, "ios-gate");
    expect(model.masterTapAction).toBe("ios-notice");
    for (const row of model.rows) expect(row.disabled).toBe(true);
  });

  it("unsupported: disabled, no tap action offered", () => {
    const model = notificationSettingsModel(DEFAULT_NOTIFICATION_PREFS, "unsupported");
    expect(model.masterTapAction).toBeNull();
    for (const row of model.rows) expect(row.disabled).toBe(true);
  });

  it("always carries all four 'never send' lines and the quiet-hours line — bible §5.2's trust block", () => {
    const model = notificationSettingsModel(DEFAULT_NOTIFICATION_PREFS, "default");
    expect(model.neverSendLines).toHaveLength(4);
    expect(model.quietHoursLine).toMatch(/10pm/i);
    expect(model.quietHoursLine).toMatch(/four times a day/i);
  });
});

/**
 * ROUND-2I REVIEW FIX (major). The homecoming row's hint used to read
 * "Who's back, what they're carrying, and if they came home with a
 * scrape." — advertising the ailment suffix round 2H's cruelty audit CUT.
 * `plan.ts` refuses to compose it and `copy.ts` has no builder for it, so
 * the sheet was promising a notification that can never arrive, three
 * lines above the "What we will never send you" block whose entire value
 * is that every word in it is literally true.
 *
 * The guard is deliberately on the ROW HINTS (what we say we WILL send)
 * and never on `neverSendLines` (what we promise we won't) — that block
 * has to be allowed to name the very things being ruled out.
 */
describe("the settings sheet never advertises a notification the catalogue cannot send", () => {
  const EVERY_UI_STATE: readonly (readonly [NotificationPrefs, PermissionState])[] = [
    [DEFAULT_NOTIFICATION_PREFS, "default"],
    [{ ...DEFAULT_NOTIFICATION_PREFS, declined: true }, "default"],
    [GRANTED_ON, "granted"],
    [{ ...GRANTED_ON, master: false }, "granted"],
    [{ ...GRANTED_ON, types: { homecoming: true, pipping: false } }, "granted"],
    [{ ...GRANTED_ON, types: { homecoming: false, pipping: true } }, "granted"],
    [{ ...GRANTED_ON, types: { homecoming: false, pipping: false } }, "granted"],
    [DEFAULT_NOTIFICATION_PREFS, "denied"],
    [DEFAULT_NOTIFICATION_PREFS, "ios-gate"],
    [DEFAULT_NOTIFICATION_PREFS, "unsupported"],
  ];

  function everyHint(): readonly string[] {
    const hints: string[] = [];
    for (const [prefs, permission] of EVERY_UI_STATE) {
      const model = notificationSettingsModel(prefs, permission);
      for (const row of model.rows) hints.push(row.hint);
      hints.push(model.quietHoursLine);
      hints.push(notificationsNookRow(prefs, permission).hint);
    }
    return hints;
  }

  /** Concepts this round's catalogue cannot produce. The ailment/lineage
   * suffixes are `plan.ts`'s named scope cut; health and danger are round
   * 2H's binding cruelty cut. */
  const UNSENDABLE = [
    "scrape",
    "ailment",
    "injur",
    "unwell",
    "poorly",
    "sick",
    "hurt",
    "lineage",
    "descend",
  ];

  it("no row hint claims anything about a Pip's health, an ailment, or lineage", () => {
    const hints = everyHint();
    expect(hints.length).toBeGreaterThan(20); // not vacuous
    for (const hint of hints) {
      for (const word of UNSENDABLE) {
        expect(hint.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("no row hint uses the notification catalogue's own forbidden vocabulary", () => {
    // The same list `core/notifications/catalogue.test.ts` scans delivered
    // copy against — a promise made in the settings sheet has to clear the
    // same bar as the notification itself.
    for (const hint of everyHint()) {
      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        expect(hint.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it("the homecoming hint describes exactly what ships: who, and what they carried", () => {
    const model = notificationSettingsModel(GRANTED_ON, "granted");
    const homecoming = model.rows.find((r) => r.id === "homecoming");
    expect(homecoming?.hint).toBe("Who's back, and what they're carrying.");
  });
});

describe("notificationsNookRow", () => {
  it("bible §5.1's fixed label, live hint", () => {
    const row = notificationsNookRow(DEFAULT_NOTIFICATION_PREFS, "default");
    expect(row.label).toBe("Tap on the shoulder");
    expect(row.hint.length).toBeGreaterThan(0);
  });

  it("hint changes with permission/prefs (it is not a static string)", () => {
    const off = notificationsNookRow(DEFAULT_NOTIFICATION_PREFS, "default");
    const on = notificationsNookRow(GRANTED_ON, "granted");
    expect(off.hint).not.toBe(on.hint);
  });
});

describe("createNotificationSettingsSheet — DOM smoke test", () => {
  it("renders the master row, both type rows, and the four never-send bullets when opened", () => {
    const dom = installFakeDom();
    let prefs = GRANTED_ON;
    const sheet = createNotificationSettingsSheet({
      mount: asHtml(dom.ui),
      getPrefs: () => prefs,
      setPrefs: (next) => {
        prefs = next;
      },
      getPermissionState: () => "granted",
      onRequestAsk: () => {},
    });

    sheet.open();

    const text = dom.document.querySelector(".pk-notify-sheet")?.textContent ?? "";
    expect(text).toContain("Let us tap you on the shoulder");
    expect(text).toContain("When a trip comes home");
    expect(text).toContain("When an egg starts pipping");
    expect(text).toContain("What we will never send you");
    expect(text).toContain("Anything about a Pip being unhappy or hungry.");
    expect(text).toContain("Anything about a streak.");

    const rows = dom.document.querySelectorAll(".pk-notify-row");
    expect(rows).toHaveLength(3);

    dom.uninstall();
  });

  it("tapping a type row toggles the pref and re-renders", () => {
    const dom = installFakeDom();
    let prefs = GRANTED_ON;
    const sheet = createNotificationSettingsSheet({
      mount: asHtml(dom.ui),
      getPrefs: () => prefs,
      setPrefs: (next) => {
        prefs = next;
      },
      getPermissionState: () => "granted",
      onRequestAsk: () => {},
    });
    sheet.open();

    const rows = dom.document.querySelectorAll(".pk-notify-row");
    const pippingRow = [...rows].find((r) =>
      r.querySelector(".pk-notify-row-label")?.textContent === "When an egg starts pipping",
    );
    expect(pippingRow).toBeDefined();
    pippingRow?.click();

    expect(prefs.types.pipping).toBe(false);
    dom.uninstall();
  });

  it("tapping the master row while never-asked calls onRequestAsk instead of toggling", () => {
    const dom = installFakeDom();
    let asked = 0;
    const prefs = DEFAULT_NOTIFICATION_PREFS;
    const sheet = createNotificationSettingsSheet({
      mount: asHtml(dom.ui),
      getPrefs: () => prefs,
      setPrefs: () => {
        throw new Error("must not toggle a boolean while unresolved");
      },
      getPermissionState: () => "default",
      onRequestAsk: () => {
        asked += 1;
      },
    });
    sheet.open();

    const masterRow = dom.document.querySelectorAll(".pk-notify-row")[0];
    masterRow?.click();

    expect(asked).toBe(1);
    dom.uninstall();
  });

  it("disabled rows swallow taps", () => {
    const dom = installFakeDom();
    let asked = 0;
    const sheet = createNotificationSettingsSheet({
      mount: asHtml(dom.ui),
      getPrefs: () => DEFAULT_NOTIFICATION_PREFS,
      setPrefs: () => {
        throw new Error("must not fire on a disabled row");
      },
      getPermissionState: () => "denied",
      onRequestAsk: () => {
        asked += 1;
      },
    });
    sheet.open();

    const masterRow = dom.document.querySelectorAll(".pk-notify-row")[0];
    expect(masterRow?.disabled).toBe(true);
    masterRow?.click();
    expect(asked).toBe(0);
    dom.uninstall();
  });
});
