/**
 * Round 2I (docs/notifications-bible.md §5) — SETTINGS: the Nook row
 * ("Tap on the shoulder") and the sheet it opens.
 *
 * Bible §5.1: "The Nook row is a DESTINATION, not a switch" — it opens
 * this sheet rather than toggling in place, because notifications need
 * more than one switch and a popover holding three destinations must not
 * grow into a preferences pane.
 *
 * Split like every other sheet in `ui/`: `notificationUiState` /
 * `notificationSettingsModel` / `notificationsNookRow` are PURE (state
 * in, view model out — node-testable, no DOM); `createNotificationSettingsSheet`
 * is the dumb DOM shell.
 */

import "./notificationSettings.css";
import { sound } from "../app/sound";
import type { PermissionState } from "./notificationPermission";
import type { NotificationPrefs, NotificationTypeId } from "./notificationPrefs";
import { NOTIFICATION_TYPE_IDS, setMaster, setType } from "./notificationPrefs";

/** Every combination the settings surfaces have to render honestly
 * (bible §5.3's table) — permission state further split by whether OUR
 * card was the one that got declined (browser permission stays `"default"`
 * either way; only `NotificationPrefs.declined` tells the two apart). */
export type NotificationUiState =
  | "never-asked"
  | "granted"
  | "declined-by-us"
  | "denied-by-browser"
  | "ios-gate"
  | "unsupported";

export function notificationUiState(
  prefs: NotificationPrefs,
  permission: PermissionState,
): NotificationUiState {
  if (permission === "granted") return "granted";
  if (permission === "denied") return "denied-by-browser";
  if (permission === "ios-gate") return "ios-gate";
  if (permission === "unsupported") return "unsupported";
  return prefs.declined ? "declined-by-us" : "never-asked";
}

/** Bible §5.3's row-hint table, by ui state. `granted` is further split on
 * the master switch's OWN value (the table's "on, both types on" is the
 * moment right after granting — the player is free to flip it back off
 * afterwards, and the hint should say so honestly rather than freeze at
 * the moment it was granted). */
function masterHint(uiState: NotificationUiState, prefs: NotificationPrefs): string {
  switch (uiState) {
    case "never-asked":
      return "Off. We'll offer once you've got a trip running.";
    case "granted":
      if (!prefs.master) return "Off. Tap to turn it back on.";
      if (prefs.types.homecoming && prefs.types.pipping) {
        return "On — trips home and eggs pipping.";
      }
      if (prefs.types.homecoming) return "On — trips home only.";
      if (prefs.types.pipping) return "On — eggs pipping only.";
      return "On, but both kinds below are turned off.";
    case "declined-by-us":
      return "Off. Say the word and we'll ask again.";
    case "denied-by-browser":
      return (
        "Your browser is holding the door shut. If you change your mind, it's in " +
        "the site settings for this page — we can't ask again from in here."
      );
    case "ios-gate":
      return "Add PipsKeep to your Home Screen and we can wave at you.";
    case "unsupported":
      return "Not available in this browser.";
  }
}

/** Bible §5.1 — the Nook menu's row. A destination, not a switch. */
export interface NookNotifyRowModel {
  readonly label: string;
  readonly hint: string;
}

export function notificationsNookRow(
  prefs: NotificationPrefs,
  permission: PermissionState,
): NookNotifyRowModel {
  const uiState = notificationUiState(prefs, permission);
  return { label: "Tap on the shoulder", hint: masterHint(uiState, prefs) };
}

const TYPE_COPY: Readonly<Record<NotificationTypeId, { label: string; hint: string }>> = {
  // ROUND-2I REVIEW FIX: the homecoming hint used to end "…and if they
  // came home with a scrape." No notification can ever say that — round
  // 2H's cruelty cut removed the ailment suffix, `plan.ts` cuts it
  // explicitly and `copy.ts` has no builder for it. This sheet's whole
  // value is that the "What we will never send you" block three lines
  // below is literally true, and an advert for a notification that does
  // not exist undoes it. The hint now describes exactly what ships.
  homecoming: {
    label: "When a trip comes home",
    hint: "Who's back, and what they're carrying.",
  },
  pipping: {
    label: "When an egg starts pipping",
    hint: "Tap-tap.",
  },
};

export interface SettingsRowModel {
  readonly id: "master" | NotificationTypeId;
  readonly label: string;
  readonly hint: string;
  readonly on: boolean;
  readonly disabled: boolean;
}

export interface NotificationSettingsModel {
  readonly uiState: NotificationUiState;
  readonly rows: readonly SettingsRowModel[];
  readonly quietHoursLine: string;
  readonly neverSendLines: readonly string[];
  /** Non-null ⇒ tapping the master row should (re-)offer the ask instead
   * of toggling a boolean (bible §5.3: "tap re-asks" / "tap re-shows"). */
  readonly masterTapAction: "reask" | "ios-notice" | null;
}

/** Bible §5.2's exact copy — the "what we will never send you" block is
 * NOT decoration (spec §16 v1.3's standing rule: the cuts of bible §1.3/
 * §6 are only real if the player can see them). */
const NEVER_SEND_LINES: readonly string[] = [
  "Anything about a Pip being unhappy or hungry.",
  "Anything about a Pip being in danger. If there's bad news you can't act on from where you're standing, it waits until you're home.",
  "Anything asking you to come back.",
  "Anything about a streak.",
];

const QUIET_HOURS_LINE =
  "We stay quiet between 10pm and 8am, your time, and never more than four times a day.";

export function notificationSettingsModel(
  prefs: NotificationPrefs,
  permission: PermissionState,
): NotificationSettingsModel {
  const uiState = notificationUiState(prefs, permission);
  const blocked =
    uiState === "denied-by-browser" || uiState === "ios-gate" || uiState === "unsupported";
  const typesUsable = uiState === "granted" && prefs.master;

  const rows: SettingsRowModel[] = [
    {
      id: "master",
      label: "Let us tap you on the shoulder",
      hint: masterHint(uiState, prefs),
      on: uiState === "granted" && prefs.master,
      disabled: blocked,
    },
    ...NOTIFICATION_TYPE_IDS.map((id): SettingsRowModel => {
      const copy = TYPE_COPY[id];
      return {
        id,
        label: copy.label,
        hint: copy.hint,
        on: prefs.types[id],
        disabled: blocked || !typesUsable,
      };
    }),
  ];

  const masterTapAction: NotificationSettingsModel["masterTapAction"] =
    uiState === "never-asked" || uiState === "declined-by-us"
      ? "reask"
      : uiState === "ios-gate"
        ? "ios-notice"
        : null;

  return {
    uiState,
    rows,
    quietHoursLine: QUIET_HOURS_LINE,
    neverSendLines: NEVER_SEND_LINES,
    masterTapAction,
  };
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface NotificationSettingsDeps {
  readonly mount: HTMLElement;
  getPrefs(): NotificationPrefs;
  setPrefs(next: NotificationPrefs): void;
  getPermissionState(): PermissionState;
  /** Delegates to `notificationAsk.ts`'s `showManually()` — this module
   * never talks to `Notification` itself. */
  onRequestAsk(): void;
}

export interface NotificationSettingsSheet {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /** Re-render from current prefs/permission — call after any change
   * (a toggle here, a grant/decline from the ask card, a boot). */
  refresh(): void;
}

export function createNotificationSettingsSheet(
  deps: NotificationSettingsDeps,
): NotificationSettingsSheet {
  const el = document.createElement("div");
  el.className = "pk-notify-wrap";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-notify-backdrop";

  const sheet = document.createElement("div");
  sheet.className = "pk-notify-sheet";

  const handle = document.createElement("div");
  handle.className = "pk-notify-handle";
  const title = document.createElement("div");
  title.className = "pk-notify-title";
  title.textContent = "Notifications";
  const body = document.createElement("div");
  body.className = "pk-notify-body";
  sheet.append(handle, title, body);
  el.append(backdrop, sheet);
  deps.mount.appendChild(el);

  let isOpen = false;

  const close = (): void => {
    isOpen = false;
    el.classList.remove("pk-notify-wrap--open");
  };
  backdrop.addEventListener("click", () => {
    sound("ui.tap");
    close();
  });

  const renderRow = (row: SettingsRowModel, onTap: () => void): HTMLElement => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "pk-notify-row";
    item.classList.toggle("pk-notify-row--on", row.on);
    item.disabled = row.disabled;
    item.setAttribute("role", "switch");
    item.setAttribute("aria-checked", row.on ? "true" : "false");

    const mark = document.createElement("span");
    mark.className = "pk-notify-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = row.on ? "✓" : "";

    const text = document.createElement("span");
    text.className = "pk-notify-row-text";
    const label = document.createElement("span");
    label.className = "pk-notify-row-label";
    label.textContent = row.label;
    const hint = document.createElement("span");
    hint.className = "pk-notify-row-hint";
    hint.textContent = row.hint;
    text.append(label, hint);

    item.append(mark, text);
    item.addEventListener("click", () => {
      if (row.disabled) return;
      sound("ui.tap");
      onTap();
    });
    return item;
  };

  const render = (): void => {
    const model = notificationSettingsModel(deps.getPrefs(), deps.getPermissionState());
    body.replaceChildren();

    for (const row of model.rows) {
      const onTap = (): void => {
        if (row.id === "master") {
          if (model.masterTapAction !== null) {
            deps.onRequestAsk();
            return;
          }
          deps.setPrefs(setMaster(deps.getPrefs(), !row.on));
        } else {
          deps.setPrefs(setType(deps.getPrefs(), row.id, !row.on));
        }
        render();
      };
      body.appendChild(renderRow(row, onTap));
    }

    const info = document.createElement("div");
    info.className = "pk-notify-info";
    info.textContent = model.quietHoursLine;
    body.appendChild(info);

    const neverTitle = document.createElement("div");
    neverTitle.className = "pk-notify-never-title";
    neverTitle.textContent = "What we will never send you";
    body.appendChild(neverTitle);

    const neverList = document.createElement("ul");
    neverList.className = "pk-notify-never-list";
    for (const line of model.neverSendLines) {
      const li = document.createElement("li");
      li.textContent = line;
      neverList.appendChild(li);
    }
    body.appendChild(neverList);
  };

  return {
    el,
    open(): void {
      isOpen = true;
      sound("ui.sheet");
      render();
      el.classList.add("pk-notify-wrap--open");
    },
    close,
    get isOpen(): boolean {
      return isOpen;
    },
    refresh(): void {
      if (isOpen) render();
    },
  };
}
