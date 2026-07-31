/**
 * "While you were away…" sheet (spec §4.5): a warm summary shown on load
 * (and on tab-return CATCHUPs) when the absence was long enough to have a
 * story — per-pip needs deltas as gentle arrows (never doom), expeditions
 * completed with their destinations, eggs now Pipping, how many unopened
 * loot pouches are waiting, and the capped-time note when the 12h rate
 * cap kicked in ("they stopped counting; they insisted").
 *
 * Split for node testability:
 * - PURE: `deriveAwaySheet(summary, state)` → `AwaySheetModel | null`
 *   (null when the absence was under AWAY_SHEET_MIN_ELAPSED_MS — quick
 *   tab flicks are not news). All copy decisions live here so tests pin
 *   the exact story the player is told.
 * - DOM: `createAwaySheet` renders a model as a blocking-ish card with a
 *   single dismiss button; dismissing hands control back to the wiring
 *   (which then plays the queued loot reveals — the sheet TEASES the
 *   loot, it never spoils the reveal's contents).
 *
 * Tone (spec §15.5): warm, mischievous, opinionated. Needs went down;
 * nobody is guilted about it.
 */

import type { CatchupSummary } from "../core/pips/catchup";
import type { NeedId, PipState } from "../core/pips/types";
import { isSulking } from "../core/pips/machine";
import { expeditions as contentExpeditions } from "../content/expeditions";
import { HOUR_MS, MINUTE_MS, tuning as contentTuning } from "../content/tuning";
import { EGG_READY_TAG } from "../core/eggs";
import { ATTRACTION_VISIT_TAG } from "../core/attractions";
import { sound } from "../app/sound";

/** Absences shorter than this get no sheet ("more than a few minutes"). */
export const AWAY_SHEET_MIN_ELAPSED_MS = 3 * MINUTE_MS;

export interface AwayNeedLine {
  readonly needId: NeedId;
  readonly label: string;
  readonly direction: "up" | "down";
  /** Rounded absolute change, ≥ 1 (sub-point drift isn't news). */
  readonly amount: number;
}

export interface AwayPipLine {
  readonly pipId: string;
  readonly name: string;
  readonly needLines: readonly AwayNeedLine[];
  /** Warm aside when there is one (nothing changed / came home sulky). */
  readonly note: string | null;
}

export interface AwaySheetModel {
  readonly title: string;
  /** "You were gone about 3 hours. The Keep kept busy." */
  readonly elapsedLine: string;
  readonly pips: readonly AwayPipLine[];
  /** "Wren finished the Forest trip." — one per completed expedition. */
  readonly expeditionLines: readonly string[];
  /** The Pipping tease, or null when no egg came due. */
  readonly eggLine: string | null;
  /** "2 unopened loot pouches are waiting." or null. */
  readonly lootLine: string | null;
  /** The 12h rate-cap note, or null when the cap never engaged. */
  readonly cappedLine: string | null;
  /**
   * ROUND 2K (docs/liveliness-bible.md §1.6) — "Busy morning. Four
   * callers, and Pipsqueak stayed longest." Null when nothing visited.
   *
   * ⚠️ THE TONE RULE IS THE POINT, and §1.6 states it as a prohibition:
   * NEVER "you missed them", NEVER "they waited for you", NEVER "came
   * while you were away". Nothing was lost — the held-open rule means the
   * most recent visit per attraction is materialised with its `leavesAt`
   * extended to `returnAt + lingerMs`, so whoever the line names is
   * STANDING IN THE KEEP when the sheet closes. Phrasing a gift as a loss
   * would be the meanest sentence in the game, and 2C's never-punish-
   * absence guardrail forbids it outright.
   */
  readonly visitorLine: string | null;
}

/** The slices of GameState the derivation reads (GameState satisfies
 * both structurally — tests can pass tiny literals).
 *
 * `pips` holds full `PipState` (not just `{ name }`) so the sulking note
 * below can read `isSulking` off the pip's CURRENT (post-catchup) snapshot
 * — see that call site for why the delta itself can't carry this. */
export interface AwaySheetStateView {
  readonly pips: Readonly<Record<string, PipState | undefined>>;
  readonly pendingReveals: readonly unknown[];
  /** ROUND 2K — whoever is standing there NOW. Optional so every
   * pre-2K fixture in the suite stays valid with the field absent. */
  readonly visitors?: Readonly<Record<string, { readonly name: string } | undefined>>;
}

export interface AwaySheetContent {
  readonly expeditionNames?: Readonly<Record<string, { readonly name: string }>>;
  /** The offline rate cap, for the capped-time copy. */
  readonly offlineRateCapMs?: number;
  readonly minElapsedMs?: number;
}

const NEED_LABELS: Readonly<Record<NeedId, string>> = {
  hunger: "Hunger",
  cleanliness: "Cleanliness",
  happiness: "Happiness",
  energy: "Energy",
};

function capitalize(id: string): string {
  return id.length === 0 ? id : id.charAt(0).toUpperCase() + id.slice(1);
}

/** "6 minutes" / "about 3 hours" / "3 days" — friendly, not forensic. */
export function elapsedLabel(elapsedMs: number): string {
  const minutes = Math.max(1, Math.round(elapsedMs / MINUTE_MS));
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(elapsedMs / HOUR_MS);
  if (hours < 48) return `about ${hours} hours`;
  const days = Math.round(elapsedMs / (24 * HOUR_MS));
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Derive the sheet's whole story from a CatchupSummary + current state.
 * Returns null when the absence is too short to mention.
 */
export function deriveAwaySheet(
  summary: CatchupSummary,
  state: AwaySheetStateView,
  content: AwaySheetContent = {},
): AwaySheetModel | null {
  const minElapsed = content.minElapsedMs ?? AWAY_SHEET_MIN_ELAPSED_MS;
  if (summary.elapsedMs < minElapsed) return null;

  const expeditionNames =
    content.expeditionNames ??
    (contentExpeditions as Readonly<Record<string, { name: string }>>);
  const capMs = content.offlineRateCapMs ?? contentTuning.offlineRateCapMs;

  const pipName = (pipId: string): string => state.pips[pipId]?.name ?? "A Pip";

  // Per-pip needs deltas — arrows, not doom.
  const pips: AwayPipLine[] = summary.pips.map((delta) => {
    const needLines: AwayNeedLine[] = [];
    for (const needId of Object.keys(NEED_LABELS) as NeedId[]) {
      const change = Math.round(delta.needsDelta[needId]);
      if (Math.abs(change) < 1) continue;
      needLines.push({
        needId,
        label: NEED_LABELS[needId],
        direction: change > 0 ? "up" : "down",
        amount: Math.abs(change),
      });
    }
    let note: string | null = null;
    // Sulking is checked first, and via `isSulking` (flag OR activity)
    // rather than `delta.activityAfter`: a pip can nap through a sulk
    // (activity stays Resting, machine.ts "Sulking: activity vs. flag")
    // and a sulking pip whose needs happened not to move must not be told
    // it "dozed through". `state.pips` already holds the pip's CURRENT
    // (post-catchup) snapshot, so we read sulking-ness there instead of
    // asking the catch-up engine to additionally report it on the delta.
    const afterPip = state.pips[delta.pipId];
    if (afterPip !== undefined && isSulking(afterPip)) {
      note = "came home a bit sulky. One good snack fixes everything.";
    } else if (needLines.length === 0) {
      note = "dozed through the whole thing, honestly.";
    }
    return { pipId: delta.pipId, name: pipName(delta.pipId), needLines, note };
  });

  // Expeditions completed while away.
  const expeditionLines: string[] = [];
  let eggsReady = 0;
  for (const event of summary.events) {
    if (event.kind === "expeditionReturn") {
      const id = event.expedition.expeditionId;
      const name = expeditionNames[id]?.name ?? capitalize(id);
      expeditionLines.push(`${pipName(event.pipId)} finished the ${name} trip.`);
    } else if (event.kind === "custom" && event.tag === EGG_READY_TAG) {
      eggsReady += 1;
    }
  }

  const eggLine =
    eggsReady === 0
      ? null
      : eggsReady === 1
        ? "An egg is pipping! Something is tapping from inside…"
        : `${eggsReady} eggs are ready — something is tapping inside each one…`;

  // Tease the loot without spoiling the reveal (spec §6.1 owns the show).
  const pouches = state.pendingReveals.length;
  const lootLine =
    pouches === 0
      ? null
      : pouches === 1
        ? "1 unopened loot pouch is waiting."
        : `${pouches} unopened loot pouches are waiting.`;

  const cappedLine =
    summary.cappedMs > 0
      ? `After ${Math.round(capMs / HOUR_MS)} hours the Pips stopped keeping score. They insisted.`
      : null;

  return {
    title: "While you were away…",
    elapsedLine: `You were gone ${elapsedLabel(summary.elapsedMs)}. The Keep kept busy.`,
    pips,
    expeditionLines,
    eggLine,
    lootLine,
    cappedLine,
    visitorLine: deriveVisitorLine(summary, state),
  };
}

/**
 * ROUND 2K (docs/liveliness-bible.md §1.6) — the callers line.
 *
 * Counts the visit events the catch-up pass fired, and names whoever is
 * STILL STANDING THERE. Exported so `awaySheet.test.ts` can pin the exact
 * words, which matters more here than anywhere else in the sheet:
 * `retention.copy.test.ts`'s banned-phrase regex covers "missed
 * them"/"waited for you"/"came and went", and this is the one function
 * that could produce them.
 */
export function deriveVisitorLine(
  summary: CatchupSummary,
  state: AwaySheetStateView,
): string | null {
  let callers = 0;
  for (const event of summary.events) {
    if (event.kind === "custom" && event.tag === ATTRACTION_VISIT_TAG) callers++;
  }
  if (callers === 0) return null;
  // Whoever is here NOW — the held-open rule guarantees at least one, per
  // attraction, on every single return.
  const names = Object.values(state.visitors ?? {})
    .filter((v): v is { name: string } => v !== undefined)
    .map((v) => v.name);
  const busy = callers === 1 ? "Someone came by." : `Busy morning. ${callers} callers.`;
  const longest = names[0];
  if (longest === undefined) return busy;
  return callers === 1
    ? `Someone came by — ${longest} is still here.`
    : `Busy morning. ${callers} callers, and ${longest} stayed longest.`;
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface AwaySheetDeps {
  readonly mount: HTMLElement;
  /** Dismiss tapped — the wiring plays queued loot reveals next. */
  onDismiss(): void;
}

export interface AwaySheet {
  readonly el: HTMLElement;
  show(model: AwaySheetModel): void;
  hide(): void;
  isOpen(): boolean;
}

export function createAwaySheet(deps: AwaySheetDeps): AwaySheet {
  const el = document.createElement("div");
  el.className = "pk-away";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-away-backdrop";

  const cardEl = document.createElement("div");
  cardEl.className = "pk-away-card";

  const titleEl = document.createElement("div");
  titleEl.className = "pk-away-title";
  const elapsedEl = document.createElement("div");
  elapsedEl.className = "pk-away-elapsed";
  const bodyEl = document.createElement("div");
  bodyEl.className = "pk-away-body";

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "pk-away-dismiss";
  dismiss.textContent = "Good to be home";

  cardEl.append(titleEl, elapsedEl, bodyEl, dismiss);
  el.append(backdrop, cardEl);
  deps.mount.appendChild(el);

  let open = false;

  const hide = (): void => {
    open = false;
    el.classList.remove("pk-away--open");
  };

  dismiss.addEventListener("click", () => {
    if (!open) return;
    sound("away.dismiss");
    hide();
    deps.onDismiss();
  });

  const line = (className: string, text: string): HTMLElement => {
    const div = document.createElement("div");
    div.className = className;
    div.textContent = text;
    return div;
  };

  return {
    el,

    show(model: AwaySheetModel): void {
      titleEl.textContent = model.title;
      elapsedEl.textContent = model.elapsedLine;
      bodyEl.replaceChildren();

      for (const pip of model.pips) {
        const row = document.createElement("div");
        row.className = "pk-away-pip";
        row.appendChild(line("pk-away-pipname", pip.name));
        if (pip.needLines.length > 0) {
          const chips = document.createElement("div");
          chips.className = "pk-away-chips";
          for (const need of pip.needLines) {
            const chip = document.createElement("span");
            chip.className = `pk-away-chip pk-away-chip--${need.direction}`;
            chip.textContent = `${need.label} ${need.direction === "down" ? "↓" : "↑"}${need.amount}`;
            chips.appendChild(chip);
          }
          row.appendChild(chips);
        }
        if (pip.note !== null) {
          row.appendChild(line("pk-away-note", `…${pip.note}`));
        }
        bodyEl.appendChild(row);
      }

      const storyLines: { icon: string; text: string }[] = [];
      for (const text of model.expeditionLines) {
        storyLines.push({ icon: "🧭", text });
      }
      if (model.eggLine !== null) storyLines.push({ icon: "🥚", text: model.eggLine });
      // ROUND 2K — above the loot tease: whoever is standing outside is
      // the more surprising news, and unlike the pouches they are already
      // here rather than waiting to be opened.
      if (model.visitorLine !== null) {
        storyLines.push({ icon: "🌿", text: model.visitorLine });
      }
      if (model.lootLine !== null) storyLines.push({ icon: "🎁", text: model.lootLine });
      if (model.cappedLine !== null) {
        storyLines.push({ icon: "⏳", text: model.cappedLine });
      }
      for (const entry of storyLines) {
        const div = document.createElement("div");
        div.className = "pk-away-line";
        const icon = document.createElement("span");
        icon.className = "pk-away-icon";
        icon.textContent = entry.icon;
        const text = document.createElement("span");
        text.textContent = entry.text;
        div.append(icon, text);
        bodyEl.appendChild(div);
      }

      open = true;
      sound("away.open");
      el.classList.add("pk-away--open");
    },

    hide,
    isOpen: () => open,
  };
}
