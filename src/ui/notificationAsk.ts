/**
 * Round 2I (docs/notifications-bible.md §3) — THE EARNED ASK.
 *
 * Never on first launch, never cold, never from a timer that isn't
 * counting down from something the player just did. The one and only
 * automatic trigger is "three seconds after the departure trot completes,
 * on the player's first [qualifying] expedition send" (§3.2) — `main.ts`
 * calls `onExpeditionSent` from the SAME `lastAssignOutcome` diff that
 * already plays the trot and fires the "trotted off" toast; this module
 * owns everything from there down (the delay, the eligibility check, the
 * card, and the iOS Home-Screen substitute — §3.5).
 *
 * Pure/DOM split like every other sheet in `ui/`: `notificationAskCardModel`
 * and `IOS_GATE_CARD` are pure data; `createNotificationAskFlow` is the
 * dumb shell plus the one piece of real scheduling this surface owns (the
 * "three seconds after" `setTimeout`, entirely presentational — it does
 * not touch `core/` or perturb any RNG cursor).
 */

import "./notificationAsk.css";
import { tuning } from "../content/tuning";
import { formatDurationShort } from "./focusView";
import { notify } from "./notify";
import { sound } from "../app/sound";
import type { NotificationHost, PermissionState } from "./notificationPermission";
import {
  defaultNotificationHost,
  detectPermissionState,
  requestBrowserPermission,
} from "./notificationPermission";
import type { NotificationPrefs } from "./notificationPrefs";
import {
  applyDeclinedByUs,
  applyGranted,
  applyIosNoticeShown,
  clearDeclineForManualReask,
  recordAskShown,
  recordExpeditionSend,
  shouldOfferAsk,
} from "./notificationPrefs";

/** The trip that just left — bible §3.3: "interpolated from the trip that
 * just left … what makes the card read as the Keep talking rather than a
 * consent banner." */
export interface AskContext {
  readonly pipName: string;
  readonly biomeName: string;
  readonly durationMs: number;
}

export interface AskCardModel {
  readonly title: string;
  readonly body: string;
}

/** Bible §3.3's copy. A manual re-ask from the settings sheet may have no
 * fresh trip in hand (the player opened Settings before ever sending
 * anyone anywhere) — `context: null` keeps the promise without a name to
 * hang it on rather than inventing a fake trip. (The "no 'your Pips miss
 * you'" line is paraphrased here, not quoted, so this copy never risks
 * tripping a forbidden-phrase scan over the peer round's `copy.ts` — the
 * promise survives without repeating the banned words verbatim.) */
export function notificationAskCardModel(context: AskContext | null): AskCardModel {
  const whatWeDo =
    "If you wander away, we can tap you on the shoulder when a trip comes home — " +
    "and when an egg starts tapping back. That's the whole list. Nothing else, " +
    "ever — no guilt trips, no nagging.";
  const body =
    context === null
      ? whatWeDo
      : `${context.pipName} is off to the ${context.biomeName} for ` +
        `${formatDurationShort(context.durationMs)}. ${whatWeDo}`;
  return { title: "Shall we tell you when they're back?", body };
}

/** Bible §3.5 — shown ONCE, ever, automatically, and it REPLACES the
 * ordinary ask card rather than appearing alongside it. */
export const IOS_GATE_CARD: AskCardModel = {
  title: "Pop us on your Home Screen first",
  body:
    "iPhones only let us wave at you from the Home Screen. Tap Share, then " +
    "Add to Home Screen, and open PipsKeep from there — after that we can " +
    "tell you when a trip's home. Everything works exactly the same either " +
    "way. You'll just have to come and look, which is honestly half the fun.",
};

export interface NotificationAskDeps {
  readonly mount: HTMLElement;
  getPrefs(): NotificationPrefs;
  setPrefs(next: NotificationPrefs): void;
  /** Onboarding gates the automatic trigger only (bible §3.2); a manual
   * re-ask from the settings sheet is always available. */
  isOnboardingActive(): boolean;
  /** Overridable for tests; defaults to the real browser globals. */
  readonly host?: NotificationHost;
  /** Overridable for tests; defaults to `window.setTimeout`. */
  setTimeout?(fn: () => void, ms: number): unknown;
}

export interface NotificationAskFlow {
  readonly el: HTMLElement;
  /** Call from the SAME `lastAssignOutcome` diff that plays the departure
   * trot (bible §3.2's trigger) — every successful send, qualifying or
   * not; this function decides that for itself. */
  onExpeditionSent(context: AskContext): void;
  /** The settings sheet's "tap to ask again" affordance (bible §3.4/§5.3)
   * — bypasses the automatic eligibility counters entirely. A no-op while
   * permission is already resolved (granted/denied) or unsupported. */
  showManually(): void;
  /** For the settings sheet to render honest permission-state copy. */
  permissionState(): PermissionState;
  readonly isOpen: boolean;
  dispose(): void;
}

/** Bible §3.2 — the CSS-measured trot animation is 1900ms (`.pk-trot`'s
 * `pk-trot-off` keyframe in `ui.css`; `main.ts`'s 4000ms is only a
 * belt-and-braces cleanup timer, not the real duration). The ask card
 * "slides up after, from the bottom … the trot animation and its speech
 * bubble own that beat" — so the full wait is the trot's real screen time
 * plus `tuning.notifications.permissionAsk.delayAfterSendMs`'s three-second
 * pause the bible actually argues for. */
const TROT_DURATION_MS = 1900;

/** `aria-labelledby` target — the card's own title element. */
const ASK_TITLE_ID = "pk-ask-title";

export function createNotificationAskFlow(deps: NotificationAskDeps): NotificationAskFlow {
  const host = deps.host ?? defaultNotificationHost();
  const armTimer = deps.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms));
  let lastContext: AskContext | null = null;
  let isOpen = false;

  const el = document.createElement("div");
  el.className = "pk-ask-wrap";
  const backdrop = document.createElement("div");
  backdrop.className = "pk-ask-backdrop";
  const card = document.createElement("div");
  card.className = "pk-ask-card";
  // ROUND-2I REVIEW FIX (a11y): this is a modal over a backdrop, and it
  // used to be two anonymous divs — nothing announced it, nothing let a
  // keyboard user out of it. The settings sheet next door already does
  // better (`role="switch"`/`aria-checked` on every row), so this is
  // catching up with the house standard, not inventing one.
  // Deliberately NOT `aria-modal="true"`: there is no focus trap here (and
  // the bible §3.2 wants this card to read as an invitation, not a wall),
  // so claiming modality would strand a screen-reader user with no way
  // back to the page. Announced and labelled and escapable, not trapped.
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-labelledby", ASK_TITLE_ID);
  el.append(backdrop, card);
  deps.mount.appendChild(el);

  let mode: "ask" | "ios" | null = null;

  const close = (): void => {
    mode = null;
    isOpen = false;
    el.classList.remove("pk-ask-wrap--open");
  };

  // Escape closes, exactly like a tap outside: a SOFT dismiss for the ask
  // card (no choice made, `declined` untouched — bible §3.4) and a no-op
  // for the iOS notice, whose only described exit is "Got it".
  el.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape" && mode === "ask") close();
  });

  const renderButtons = (
    buttons: readonly { label: string; variant: "yes" | "no"; onTap: () => void }[],
  ): HTMLElement => {
    const actions = document.createElement("div");
    actions.className = "pk-ask-actions";
    for (const button of buttons) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `pk-ask-btn pk-ask-btn--${button.variant}`;
      b.textContent = button.label;
      b.addEventListener("click", button.onTap);
      actions.appendChild(b);
    }
    return actions;
  };

  const renderCard = (model: AskCardModel, actions: HTMLElement): void => {
    card.replaceChildren();
    const title = document.createElement("div");
    title.className = "pk-ask-title";
    title.id = ASK_TITLE_ID;
    title.textContent = model.title;
    const body = document.createElement("div");
    body.className = "pk-ask-body";
    body.textContent = model.body;
    card.append(title, body, actions);
  };

  /** Reveal, THEN focus — `.pk-ask-wrap` is `visibility: hidden` until the
   * open class lands, and a hidden element cannot take focus. Moving focus
   * into the card is what puts a keyboard user on the choice instead of
   * behind the backdrop, and what lets Escape (handled on the wrapper)
   * reach us at all. Guarded because the node-side fake DOM has no
   * `focus()` — an a11y nicety must never be why a test environment
   * throws. */
  const reveal = (): void => {
    el.classList.add("pk-ask-wrap--open");
    const first = card.querySelector(".pk-ask-btn") as { focus?: () => void } | null;
    if (typeof first?.focus === "function") first.focus();
  };

  const openAsk = (context: AskContext | null): void => {
    mode = "ask";
    isOpen = true;
    const yes = (): void => {
      sound("ui.tap");
      // MUST run synchronously inside this click handler — Safari
      // requires the gesture, Chrome heuristically penalises a detached
      // call (bible §3.2/§9.4/§9.6).
      void requestBrowserPermission(host).then((result) => {
        if (result === "granted") {
          deps.setPrefs(applyGranted(deps.getPrefs()));
          notify({ kind: "info", message: "Lovely. We'll keep it to the interesting bits." });
        } else {
          // "Denied at the browser dialog" and "Dismissed (no answer)"
          // both land as a hard decline (bible §3.3) — a browser will
          // not re-prompt after a hard deny, and a dismiss-without-
          // choosing is rare enough that treating it as "not now" (one
          // ask spent, never auto-repeated) matches the bible's own
          // "counts as one ask" language.
          deps.setPrefs(applyDeclinedByUs(deps.getPrefs()));
          notify({
            kind: "info",
            message: "No problem at all — the Doorstep will tell you everything when you come back.",
          });
        }
      });
      close();
    };
    const no = (): void => {
      sound("ui.tap");
      deps.setPrefs(applyDeclinedByUs(deps.getPrefs()));
      close();
    };
    renderCard(
      notificationAskCardModel(context),
      renderButtons([
        { label: "Yes, tap me", variant: "yes", onTap: yes },
        { label: "No thanks", variant: "no", onTap: no },
      ]),
    );
    sound("ui.sheet");
    reveal();
  };

  const openIos = (): void => {
    mode = "ios";
    isOpen = true;
    const gotIt = (): void => {
      sound("ui.tap");
      deps.setPrefs(applyIosNoticeShown(deps.getPrefs()));
      close();
    };
    renderCard(
      IOS_GATE_CARD,
      renderButtons([{ label: "Got it", variant: "yes", onTap: gotIt }]),
    );
    sound("ui.sheet");
    reveal();
  };

  // Bible §3.4 — a soft dismiss (tap outside, no choice made) is NOT a
  // decline: `declined` stays false so `shouldOfferAsk` can offer again
  // after `reAskAfterSends` more sends. It only closes the card. (The
  // iOS notice has no separate dismiss rule in the bible — "Got it" is
  // its only described exit — so an outside tap there is a no-op rather
  // than inventing a second behaviour.)
  backdrop.addEventListener("click", () => {
    if (mode === "ask") close();
  });

  return {
    el,
    onExpeditionSent(context: AskContext): void {
      lastContext = context;
      const permission = detectPermissionState(host);

      // Bible §3.2: "If onboarding is active, the ask defers to the next
      // qualifying send" — so an onboarding-time send does not count as
      // one at all (it neither arms a timer nor advances `sendsSinceAsk`);
      // the FIRST send after onboarding completes is what starts the clock.
      //
      // ROUND-2I REVIEW FIX (major): this guard used to sit BELOW the
      // ios-gate branch, so every iOS Safari player met the "Pop us on
      // your Home Screen" card three seconds into onboarding's guided
      // Meadow send — an install prompt dropped into the ≤60s acceptance
      // -bar ceremony bible §3.2 explicitly forbids interrupting, and,
      // because `iosNoticeShown` makes it once-ever, the one warm
      // explanation spent at the moment the player had least context.
      if (deps.isOnboardingActive()) return;

      if (permission === "ios-gate") {
        if (deps.getPrefs().iosNoticeShown) return; // shown once, ever
        // Same beat as the ordinary card: the trot and its speech bubble
        // own the screen first (it used to land 1.9s earlier, over them).
        armTimer(() => {
          if (deps.isOnboardingActive()) return;
          if (!deps.getPrefs().iosNoticeShown) openIos();
        }, tuning.notifications.permissionAsk.delayAfterSendMs + TROT_DURATION_MS);
        return;
      }

      deps.setPrefs(recordExpeditionSend(deps.getPrefs()));
      if (!shouldOfferAsk(deps.getPrefs(), permission, false)) return;

      armTimer(() => {
        // Re-check at fire time: the player may have opened Settings and
        // asked manually (or the permission may have changed) during the
        // wait, in the same spirit as the scheduling round's "never
        // trust the armed payload" rule.
        if (deps.isOnboardingActive()) return;
        if (!shouldOfferAsk(deps.getPrefs(), detectPermissionState(host), false)) return;
        deps.setPrefs(recordAskShown(deps.getPrefs()));
        openAsk(context);
      }, tuning.notifications.permissionAsk.delayAfterSendMs + TROT_DURATION_MS);
    },
    showManually(): void {
      const permission = detectPermissionState(host);
      if (permission === "ios-gate") {
        openIos();
        return;
      }
      if (permission !== "default") return; // already resolved — nothing to ask
      // The player has just tapped "ask me again" in the Nook, which is
      // an explicit un-declining: clear the stored hard decline so the
      // settings sheet stops reporting "Off. Say the word and we'll ask
      // again" behind the card that is now open. (ROUND-2I REVIEW FIX:
      // `clearDeclineForManualReask` was exported and unit-tested but
      // called from nowhere — a correct function nothing reached.)
      deps.setPrefs(clearDeclineForManualReask(deps.getPrefs()));
      deps.setPrefs(recordAskShown(deps.getPrefs()));
      openAsk(lastContext);
    },
    permissionState(): PermissionState {
      return detectPermissionState(host);
    },
    get isOpen(): boolean {
      return isOpen;
    },
    dispose(): void {
      el.remove();
    },
  };
}
