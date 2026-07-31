/**
 * The Long Meadow (docs/retention-bible.md §2) — the warm fiction, never
 * disposal. Two doors, both exported from this one module:
 *
 * - a VISITABLE PAGE (`open()`/`close()`): every resident, portrait and
 *   name and how long they've been there and what they've been up to (a
 *   personality-flavoured, seeded line — never core dialogue, never a new
 *   RNG stream, bible §0.5/§9's determinism rules untouched) and their
 *   mastery titles (bible §2.1), plus "Ask them home".
 * - a RETIRE CONFIRM (`openRetireConfirm(pipId)`): the entry point the
 *   integrate stage wires from the focus view's "Send to the Long Meadow"
 *   button. It renders on its OWN overlay, independent of whether the
 *   list page is open, because the button that opens it lives in a
 *   module (`focusView.ts`) this file does not own and must not assume is
 *   closed. Copy is unambiguous that the Pip is safe and retrievable — no
 *   "are you sure, this cannot be undone" anywhere, because it can be.
 *
 * Pure-controller pattern, same shape as `pipdex.ts`/`focusView.ts`: every
 * model builder below is state (+ now) → plain data, unit-tested without a
 * DOM. `buildPortraitEl`/`PortraitVisual` are reused verbatim from
 * `pipdex.ts` (a sibling module I also own) — a resident's card wants the
 * exact same procedural look, fed a LIVE Pip's genome (and, unlike the
 * Album's frozen snapshot, its evolution gift variant too — see
 * `buildResidentModel`).
 */

import "./sanctuary.css";
import type { Clock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import type { PipState } from "../core/pips/types";
import type {
  RetireRefusalReason,
  RetrieveRefusalReason,
  SanctuaryReason,
} from "../core/sanctuary";
import { EXPEDITION_IDS, expeditions } from "../content/expeditions";
import { personalities } from "../content/personalities";
import type { PersonalityId } from "../content/personalities";
import { tuning } from "../content/tuning";
import { masteryTier, masteryTitle } from "../core/progression/mastery";
import { earnedFlairOfKind } from "../content/flair";
import type { FlairDef } from "../content/flair";
import { buildPortraitEl } from "./pipdex";
import type { PortraitVisual } from "./pipdex";
import { sound } from "../app/sound";

// ---------------------------------------------------------------------------
// Pure model layer
// ---------------------------------------------------------------------------

/** A resident's portrait uses the LIVE Pip (unlike the Album's frozen
 * snapshot): if they evolved before retiring, `evolved.variantId` picks
 * the gift-look exactly as the Keep would (spec §4.6) — "same name, same
 * freckles, same everything" means the variant too. */
function portraitVisualOf(pip: PipState): PortraitVisual {
  return {
    speciesId: pip.speciesId,
    paletteId: pip.evolved?.variantId ?? pip.genome.palette,
    pattern: pip.genome.pattern,
    shiny: pip.genome.shiny,
  };
}

/** "here since yesterday" / "here 5 days" / "here about 3 weeks" — coarse
 * and warm on purpose (bible §2.5: no countdown, no ticking clock
 * anywhere in this system). Pure arithmetic on a duration, not a calendar
 * read — no `Date` involved. */
export function formatResidencySince(retiredAt: number, now: number): string {
  const ms = Math.max(0, now - retiredAt);
  const dayMs = tuning.retention.dayMs;
  const days = Math.floor(ms / dayMs);
  if (days <= 0) return "arrived today";
  if (days === 1) return "here since yesterday";
  if (days < 14) return `here ${days} days`;
  if (days < 60) return `here about ${Math.max(1, Math.round(days / 7))} weeks`;
  return `here about ${Math.max(1, Math.round(days / 30))} months`;
}

/** The one gate on "Ask them home" (bible §2.5): a settling-in period,
 * never a countdown — waiting costs nothing and the UI never counts down
 * to it (module doc), it just says "home again tomorrow morning". */
export function isSettled(retiredAt: number, now: number, minStayMs: number): boolean {
  return now - retiredAt >= minStayMs;
}

/** Flavour for "she left when the Keep was still one small field" (bible
 * §2.1) — a fixed per-level phrase; any level outside 1–3 (structurally
 * shouldn't happen, spec's `KeepLevel` union) still reads sensibly. */
const KEEP_LEVEL_FLAVOR: Readonly<Record<number, string>> = {
  1: "one small field",
  2: "a growing patch of trails",
  3: "a proper little kingdom",
};

function keepLevelFlavor(level: number): string {
  return KEEP_LEVEL_FLAVOR[level] ?? `Keep level ${level}`;
}

/** Cheap deterministic hash (same djb2-ish shape `speciesLines.ts` uses) —
 * NOT randomness (spec §2 rule 3 governs RNG streams; this touches none),
 * so a resident's "what they've been up to" line is stable for as long as
 * they stay, never re-rolled on every render. */
function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = (h * 33 + key.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** "What they've been up to" (bible §2.1: "a warm line drawn from
 * personality + a seeded flavour pick"). Deliberately NOT the core
 * dialogue corpus (personality × mood/Sulking/Refusal, spec §3) — that
 * stays 240 lines and untouched by species OR by this system; these are
 * UI-owned flavour copy, the same class of thing as `focusView.ts`'s
 * `PERSONALITY_BLURBS`. */
const SANCTUARY_ACTIVITY_LINES: Readonly<Record<string, readonly string[]>> = {
  lazy: [
    "Found the sunniest patch in the Long Meadow and has not moved since.",
    "Was going to help with the fence. Reconsidered.",
    "Napping. Technically supervising the napping of others.",
    "Has perfected a nap that looks, from a distance, like work.",
  ],
  curious: [
    "Has inspected every rock in the Long Meadow at least twice.",
    "Made friends with a beetle. Possibly two beetles.",
    "Keeps finding the one thing nobody else noticed.",
    "Currently investigating a noise. There was no noise.",
  ],
  hardworking: [
    "Reorganized the hay. Nobody asked. Everyone's grateful.",
    "Has a system now. The system involves a lot of walking.",
    "Finished today's jobs and started tomorrow's.",
    "Keeps offering to fix things that were not broken.",
  ],
  chaotic: [
    "Started a game nobody else understands the rules to.",
    "Declared victory over something. Unclear what.",
    "Has a plan for the fence. The fence should be worried.",
    "Convinced two other residents to help with something unclear.",
  ],
  clingy: [
    "Keeps a lookout for the path back to the Keep.",
    "Made a friend and has not left their side since.",
    "Asks after you, warmly, to anyone who will listen.",
    "Saving you a spot by the gate, just in case.",
  ],
};

const FALLBACK_ACTIVITY_LINE = "Settling in nicely, by all accounts.";

/** Deterministic pick, keyed by Pip id — the same Pip always gets the
 * same line for as long as they're resident (no cursor, no save impact,
 * same determinism story as `content/speciesLines.ts`'s `pickSpeciesLine`). */
export function pickActivityLine(pip: Pick<PipState, "id" | "personalityId">): string {
  const pool = SANCTUARY_ACTIVITY_LINES[pip.personalityId];
  if (pool === undefined || pool.length === 0) return FALLBACK_ACTIVITY_LINE;
  return pool[hashKey(pip.id) % pool.length] as string;
}

export interface MasteryChipModel {
  readonly biomeId: string;
  readonly biomeName: string;
  readonly title: string;
}

/** Mastery titles (bible §2.1/§6.3 — "the real reward is the title on the
 * Pip's card"), one chip per biome with tier > 0. Mastery lives on
 * `PipState` and travels to the Long Meadow untouched (bible §6.1), so
 * this reads it exactly as the focus view would, just for a resident. */
export function buildMasteryChips(
  pip: Pick<PipState, "mastery">,
): readonly MasteryChipModel[] {
  const chips: MasteryChipModel[] = [];
  for (const id of EXPEDITION_IDS) {
    const def = expeditions[id];
    const trips = pip.mastery?.[id] ?? 0;
    const tier = masteryTier(trips, def.durationMs, tuning);
    if (tier <= 0) continue;
    const title = masteryTitle(tier, def.name);
    if (title !== null) chips.push({ biomeId: id, biomeName: def.name, title });
  }
  return chips;
}

export interface ResidentModel {
  readonly pipId: string;
  readonly name: string;
  readonly personalityName: string;
  readonly portraitVisual: PortraitVisual;
  readonly residencyLabel: string;
  readonly keepLevelFlavor: string;
  /** Times asked home before (bible §2.5 — "home for the third time"),
   * forward-only, carried on the record itself. */
  readonly visits: number;
  readonly activityLine: string;
  readonly masteryChips: readonly MasteryChipModel[];
  readonly settled: boolean;
  /** Bible §2.4: a ready-to-evolve flag persists through a stay — the
   * card says "ask them home to see it" (evolution is witnessed in the
   * Keep, spec §4.6, never in the Long Meadow). */
  readonly readyToEvolve: boolean;
  /**
   * ROUND 2H (spec §16 v1.5, docs/lifecycle-bible.md §4) — WHY they are
   * here, straight off the record. `undefined ≡ "player"`.
   *
   * ⚠️ `"lost"` CHANGES WHAT THE CARD MAY SAY. The reducer has always
   * refused RETRIEVE_PIP for a lost resident (a memorial is not a pause),
   * but the list rendered one exactly like any other retiree — under a
   * header promising "nothing here is lost… ask anyone home whenever you
   * like", with the settling-in line "home again tomorrow morning". She
   * is not coming home. The player found that out by tapping a button
   * that silently did nothing, which took a careful, honest goodbye and
   * turned it into a bug. `isMemorial` is what the renderer gates on.
   */
  readonly reason: SanctuaryReason;
  readonly isMemorial: boolean;
  /** ROUND 2H (bible §7.6) — shield six, made visible: this resident is
   * still carrying an ailment, its countdown frozen for as long as they
   * stay. The Long Meadow is an unlimited pause button for a frightened
   * player, and it was worth nothing while nothing said so. */
  readonly ailingPaused: boolean;
}

export function buildResidentModel(
  state: Pick<GameState, "sanctuary">,
  pipId: string,
  now: number,
): ResidentModel | null {
  const record = state.sanctuary.pips[pipId];
  if (record === undefined) return null;
  const pip = record.pip;
  const reason: SanctuaryReason = record.reason ?? "player";
  const isMemorial = reason === "lost";
  return {
    pipId,
    name: pip.name,
    personalityName:
      personalities[pip.personalityId as PersonalityId]?.name ?? pip.personalityId,
    portraitVisual: portraitVisualOf(pip),
    residencyLabel: formatResidencySince(record.retiredAt, now),
    keepLevelFlavor: keepLevelFlavor(record.retiredFromKeepLevel),
    visits: record.visits,
    // A memorial gets the remembrance line, never a jaunty "made friends
    // with a beetle" — the personality pool is for residents who are
    // actually out there having a week.
    activityLine: isMemorial ? memorialLine(pip.name) : pickActivityLine(pip),
    masteryChips: buildMasteryChips(pip),
    // `settled` gates the "ask them home" button. A memorial is never
    // settled, at any distance in time — the reducer refuses the retrieve
    // regardless (`core/sanctuary/index.ts`), and the button must agree
    // with the reducer rather than apologise after the tap.
    settled:
      !isMemorial && isSettled(record.retiredAt, now, tuning.retention.sanctuary.minStayMs),
    readyToEvolve: !isMemorial && pip.readyToEvolve,
    reason,
    isMemorial,
    ailingPaused: !isMemorial && pip.ailment != null,
  };
}

/** The memorial's standing line (bible §4). Warm, finite, and honest —
 * the one card in the game that must not imply a return. */
export function memorialLine(name: string): string {
  return `${name} rests here now. The Keep remembers.`;
}

/**
 * The header blurb. ROUND 2H made the original a lie in one specific
 * case: "Nothing here is lost — visit any time, and ask anyone home
 * whenever you like" was printed directly above a memorial card for a Pip
 * who could never be asked home. The Meadow is still a warm place and
 * still mostly a pause; once someone is resting there for good, the
 * header says so first, in the same breath.
 */
export function sanctuaryBlurb(hasMemorial: boolean): string {
  return hasMemorial
    ? "A wide green place over the hill. Most Pips here are just helping out for a while — " +
        "ask them home whenever you like. Some are resting for good, and they stay in the Album forever."
    : "A wide green place over the hill, where Pips go to help out for a while. " +
        "Nothing here is lost — visit any time, and ask anyone home whenever you like.";
}

export interface SanctuaryListModel {
  readonly residents: readonly ResidentModel[];
  /** True when at least one resident is a memorial (`reason: "lost"`) —
   * drives `sanctuaryBlurb`. */
  readonly hasMemorial: boolean;
  /** Earned gate signs (bible §4.3's "a Long Meadow gate sign") — the
   * milestone rewards `sanctuary-gate-sign` / `sanctuary-gathering-sign`,
   * which before this fix were `kind: "flair"` and paid literally nothing.
   * Carved, never a score: a sign is a welcome, not a rank. */
  readonly gateSigns: readonly FlairDef[];
}

/** List ordering = `sanctuary.order` (bible §2.6: "stable display order =
 * order of arrival") — never re-sorted by name, tier, or anything else. */
export function buildSanctuaryListModel(
  state: Pick<GameState, "sanctuary" | "flair">,
  now: number,
): SanctuaryListModel {
  const residents: ResidentModel[] = [];
  for (const pipId of state.sanctuary.order) {
    const model = buildResidentModel(state, pipId, now);
    if (model !== null) residents.push(model);
  }
  return {
    residents,
    hasMemorial: residents.some((r) => r.isMemorial),
    gateSigns: earnedFlairOfKind(state.flair, "sanctuarySign"),
  };
}

export interface RetireConfirmModel {
  readonly pipId: string;
  readonly name: string;
  readonly portraitVisual: PortraitVisual;
}

/** Null when the pip id no longer resolves (structural — the caller
 * should not have offered it; handled defensively, never thrown). */
export function buildRetireConfirmModel(
  state: Pick<GameState, "pips">,
  pipId: string,
): RetireConfirmModel | null {
  const pip = state.pips[pipId];
  if (pip === undefined) return null;
  return { pipId, name: pip.name, portraitVisual: portraitVisualOf(pip) };
}

/** Warm, un-shaming copy for a retire refusal (bible §2.3's legality
 * table is structural, never moral — the copy must not read as either).
 * `unknownPip` is defensive only (the caller shouldn't offer a dead id). */
export const RETIRE_REFUSAL_COPY: Readonly<Record<RetireRefusalReason, string>> = {
  unknownPip: "Hmm — that Pip isn't around to send anywhere.",
  busy: "There's loot on the way home for this one — try again once they're back.",
  lastPip: "Someone has to hold the fort. Bring another Pip home first.",
};

/** Warm copy for a retrieve refusal (bible §2.5 — never a wall, never a
 * countdown: `notSettled` is worded exactly as the bible specifies,
 * "home tomorrow morning", in words). */
export const RETRIEVE_REFUSAL_COPY: Readonly<Record<RetrieveRefusalReason, string>> = {
  unknownResident: "They don't seem to be at the Long Meadow after all.",
  notSettled: "Still settling in — home again tomorrow morning.",
  full: "The Keep's full and cosy — swap someone out and they'll be along.",
  // ROUND 2H (spec §16 v1.5, docs/lifecycle-bible.md §4) — a "lost"
  // resident is a memorial, not a pause; this copy should be effectively
  // unreachable (the Long Meadow list should not offer "ask them home" for
  // one at all), but the reducer refuses it regardless, so the copy exists
  // for the same defensive reason `unknownPip`/`unknownResident` do.
  lost: "She's resting in the Long Meadow now. Some visits are just visits.",
};

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface SanctuaryViewDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  clock: Clock;
}

export interface SanctuaryView {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  sync(state: GameState): void;
  /**
   * The entry point the integrate stage wires from the focus view's
   * "Send to the Long Meadow" affordance (module doc). Opens on its own
   * overlay — works whether or not the list page (`open()`) is currently
   * showing.
   */
  openRetireConfirm(pipId: string): void;
}

export function createSanctuaryView(deps: SanctuaryViewDeps): SanctuaryView {
  const root = document.createElement("div");
  root.className = "pk-sanctuary-root";

  // --- The visitable list page ---
  const listWrap = document.createElement("div");
  listWrap.className = "pk-sanctuary-wrap";
  const listBackdrop = document.createElement("div");
  listBackdrop.className = "pk-sanctuary-backdrop";
  const listPanel = document.createElement("div");
  listPanel.className = "pk-sanctuary";
  listWrap.append(listBackdrop, listPanel);

  // --- The retire confirm, its OWN overlay (module doc) ---
  const confirmWrap = document.createElement("div");
  confirmWrap.className = "pk-sanctuary-confirm-wrap";
  const confirmBackdrop = document.createElement("div");
  confirmBackdrop.className = "pk-sanctuary-confirm-backdrop";
  const confirmPanel = document.createElement("div");
  confirmPanel.className = "pk-sanctuary-confirm";
  confirmWrap.append(confirmBackdrop, confirmPanel);

  root.append(listWrap, confirmWrap);

  let isOpen = false;
  let lastState: GameState | null = null;
  /**
   * The confirm dialog's model is resolved ONCE, at `openRetireConfirm`,
   * and cached here — it is deliberately NEVER re-derived from live state
   * while open. This is load-bearing, not a shortcut: `deps.dispatch` (in
   * the real app, `store.dispatch`) notifies subscribers SYNCHRONOUSLY
   * (`core/store.ts`), so by the instant the Confirm button's own
   * post-dispatch code runs, `sync()` has already fired from the SAME
   * dispatch call. On a SUCCESSFUL retire the Pip has, correctly, just
   * left `state.pips` — re-deriving `buildRetireConfirmModel` at that
   * moment would resolve to `null` and stomp the success message before
   * it ever painted. Caching the model (name, portrait) at open time
   * sidesteps the race entirely, since neither ever changes based on
   * which of `pips`/`sanctuary.pips` currently holds the Pip.
   */
  let confirmModel: RetireConfirmModel | null = null;
  let confirmMessage: { text: string; tone: "success" | "refusal" } | null = null;
  /** True once Confirm has been tapped and an outcome (ok or refused) is
   * showing — swaps the two action buttons for a single "Alright". */
  let confirmResolved = false;
  let confirmSuccessTimer: number | null = null;

  const closeList = (): void => {
    isOpen = false;
    listWrap.classList.remove("pk-sanctuary-wrap--open");
  };
  listBackdrop.addEventListener("click", closeList);

  const closeConfirm = (): void => {
    confirmModel = null;
    confirmMessage = null;
    confirmResolved = false;
    if (confirmSuccessTimer !== null) {
      window.clearTimeout(confirmSuccessTimer);
      confirmSuccessTimer = null;
    }
    confirmWrap.classList.remove("pk-sanctuary-confirm-wrap--open");
  };
  confirmBackdrop.addEventListener("click", closeConfirm);

  function renderResidentCard(model: ResidentModel): HTMLElement {
    const card = document.createElement("div");
    card.className = "pk-sanctuary-card";
    if (model.isMemorial) card.classList.add("pk-sanctuary-card--memorial");

    card.appendChild(buildPortraitEl(model.portraitVisual, "small"));

    const body = document.createElement("div");
    body.className = "pk-sanctuary-body";

    const name = document.createElement("div");
    name.className = "pk-sanctuary-name";
    name.textContent = model.name;

    const sub = document.createElement("div");
    sub.className = "pk-sanctuary-sub";
    sub.textContent = `${model.personalityName} · ${model.residencyLabel}`;

    const flavor = document.createElement("div");
    flavor.className = "pk-sanctuary-flavor";
    flavor.textContent = model.isMemorial
      ? `Knew the Keep when it was ${model.keepLevelFlavor}.`
      : `Left the Keep when it was ${model.keepLevelFlavor}.`;

    const activity = document.createElement("div");
    activity.className = "pk-sanctuary-activity";
    activity.textContent = model.activityLine;

    body.append(name, sub, flavor, activity);

    if (model.visits > 0) {
      const visits = document.createElement("div");
      visits.className = "pk-sanctuary-visits";
      visits.textContent =
        model.visits === 1 ? "Been home once before." : `Been home ${model.visits} times before.`;
      body.appendChild(visits);
    }

    // ROUND 2H (bible §7.6) — SHIELD SIX made visible. A frozen countdown
    // is the best answer available to a player who needs time to go and
    // find a Poultice, and until this line existed there was no way in the
    // game to learn that pausing was even possible.
    if (model.ailingPaused) {
      const paused = document.createElement("div");
      paused.className = "pk-sanctuary-paused";
      paused.textContent = `${model.name} is resting, and still poorly — nothing is getting worse while they're here. Ask them home when you're ready to try again.`;
      body.appendChild(paused);
    }

    if (model.readyToEvolve) {
      const glow = document.createElement("div");
      glow.className = "pk-sanctuary-glow";
      glow.textContent = "✨ Glowing softly — ask them home to see it.";
      body.appendChild(glow);
    }

    if (model.masteryChips.length > 0) {
      const chips = document.createElement("div");
      chips.className = "pk-sanctuary-chips";
      for (const chip of model.masteryChips) {
        const chipEl = document.createElement("span");
        chipEl.className = "pk-sanctuary-chip";
        chipEl.textContent = `${chip.biomeName}: ${chip.title}`;
        chips.appendChild(chipEl);
      }
      body.appendChild(chips);
    }

    card.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "pk-sanctuary-actions";
    if (model.isMemorial) {
      // No button, and no "home again tomorrow morning". The reducer
      // refuses the retrieve at every distance in time; the card must say
      // the same thing rather than let the player discover it by tapping.
      const note = document.createElement("div");
      note.className = "pk-sanctuary-memorial-note";
      note.textContent = "Some visits are just visits.";
      actions.appendChild(note);
    } else if (model.settled) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pk-sanctuary-retrieve";
      btn.textContent = "Ask them home";
      btn.addEventListener("click", () => {
        sound("ui.tap");
        deps.dispatch({
          type: "RETRIEVE_PIP",
          pipId: model.pipId,
          at: deps.clock.now(),
        });
        const outcome = deps.getState().lastSanctuaryOutcome;
        if (outcome?.action === "retrieve" && !outcome.ok) {
          toast.textContent = RETRIEVE_REFUSAL_COPY[outcome.reason];
          toast.classList.add("pk-sanctuary-toast--in");
          window.setTimeout(() => toast.classList.remove("pk-sanctuary-toast--in"), 3400);
        }
      });
      actions.appendChild(btn);
    } else {
      const note = document.createElement("div");
      note.className = "pk-sanctuary-settling";
      note.textContent = "Settling in — home again tomorrow morning.";
      actions.appendChild(note);
    }
    card.appendChild(actions);

    return card;
  }

  const toast = document.createElement("div");
  toast.className = "pk-sanctuary-toast";

  function renderList(state: GameState): void {
    listPanel.replaceChildren();

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pk-sanctuary-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close the Long Meadow";
    closeBtn.setAttribute("aria-label", "Close the Long Meadow");
    closeBtn.addEventListener("click", () => {
      sound("ui.tap");
      closeList();
    });

    const header = document.createElement("div");
    header.className = "pk-sanctuary-header";
    const title = document.createElement("div");
    title.className = "pk-sanctuary-title";
    title.textContent = "The Long Meadow";
    const model = buildSanctuaryListModel(state, deps.clock.now());

    const blurb = document.createElement("div");
    blurb.className = "pk-sanctuary-blurb";
    blurb.textContent = sanctuaryBlurb(model.hasMemorial);
    header.append(title, blurb);

    // The gate signs, carved into the header (bible §4.3). Shown above the
    // residents because that is where a sign at a gate actually is.
    for (const sign of model.gateSigns) {
      const signEl = document.createElement("div");
      signEl.className = "pk-sanctuary-sign";
      signEl.textContent = `${sign.glyph} “${sign.name}” — ${sign.note}`;
      header.appendChild(signEl);
    }
    const list = document.createElement("div");
    list.className = "pk-sanctuary-list";

    if (model.residents.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pk-sanctuary-empty";
      empty.textContent =
        "Nobody's out at the Long Meadow right now — everyone's right here in the Keep.";
      list.appendChild(empty);
    } else {
      for (const resident of model.residents) {
        list.appendChild(renderResidentCard(resident));
      }
    }

    listPanel.append(closeBtn, header, toast, list);
  }

  /**
   * Pure paint from the CACHED `confirmModel`/`confirmMessage`/
   * `confirmResolved` (module doc on those variables) — never re-derives
   * anything from `deps.getState()`. Safe to call as many times as
   * needed (Confirm/Cancel handlers, the success timer) with no risk of
   * the "Pip already left `state.pips`" race.
   */
  function paintConfirm(): void {
    confirmPanel.replaceChildren();
    const model = confirmModel;
    if (model === null) return;

    confirmPanel.appendChild(buildPortraitEl(model.portraitVisual, "small"));

    const heading = document.createElement("div");
    heading.className = "pk-sanctuary-confirm-heading";
    heading.textContent = `Send ${model.name} to the Long Meadow?`;
    confirmPanel.appendChild(heading);

    const copy = document.createElement("div");
    copy.className = "pk-sanctuary-confirm-copy";
    copy.textContent =
      `${model.name} will be helping out at the Long Meadow. Same name, same freckles, ` +
      "same everything — and you can ask them home whenever you like. The clock stops " +
      "while they're there: nothing is lost and nothing sneaks ahead.";
    confirmPanel.appendChild(copy);

    if (confirmMessage !== null) {
      const msg = document.createElement("div");
      msg.className = `pk-sanctuary-confirm-message pk-sanctuary-confirm-message--${confirmMessage.tone}`;
      msg.textContent = confirmMessage.text;
      confirmPanel.appendChild(msg);
    }

    const actions = document.createElement("div");
    actions.className = "pk-sanctuary-confirm-actions";

    if (confirmResolved) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "pk-sanctuary-confirm-cancel";
      close.textContent = "Alright";
      close.addEventListener("click", () => {
        sound("ui.tap");
        closeConfirm();
      });
      actions.appendChild(close);
      confirmPanel.appendChild(actions);
      return;
    }

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "pk-sanctuary-confirm-cancel";
    cancel.textContent = "Not yet";
    cancel.addEventListener("click", () => {
      sound("ui.tap");
      closeConfirm();
    });

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "pk-sanctuary-confirm-send";
    confirm.textContent = "Send them off";
    confirm.addEventListener("click", () => {
      sound("ui.tap");
      deps.dispatch({ type: "RETIRE_PIP", pipId: model.pipId, at: deps.clock.now() });
      // Read the outcome AFTER dispatch (synchronous, spec's one-way
      // flow) — but paint from the CACHED model, never a fresh
      // `buildRetireConfirmModel(deps.getState(), ...)` (module doc).
      const outcome = deps.getState().lastSanctuaryOutcome;
      if (outcome?.action === "retire" && outcome.ok) {
        confirmMessage = {
          text: `${model.name} is off to the Long Meadow — safe, happy, and welcome home any time.`,
          tone: "success",
        };
        confirmResolved = true;
        paintConfirm();
        confirmSuccessTimer = window.setTimeout(() => {
          closeConfirm();
        }, 1800);
      } else if (outcome?.action === "retire" && !outcome.ok) {
        confirmMessage = { text: RETIRE_REFUSAL_COPY[outcome.reason], tone: "refusal" };
        confirmResolved = true;
        paintConfirm();
      }
    });

    actions.append(cancel, confirm);
    confirmPanel.appendChild(actions);
  }

  return {
    el: root,

    get isOpen(): boolean {
      return isOpen;
    },

    open(): void {
      const state = deps.getState();
      lastState = state;
      isOpen = true;
      sound("ui.sheet");
      renderList(state);
      listWrap.classList.add("pk-sanctuary-wrap--open");
    },

    close: closeList,

    sync(state: GameState): void {
      const prev = lastState;
      lastState = state;
      if (isOpen && prev !== state) renderList(state);
      // The confirm dialog paints from its own cached model and is
      // otherwise driven only by its Confirm/Cancel handlers — see
      // `paintConfirm`'s module doc for why it must NOT re-derive from
      // live state here.
    },

    openRetireConfirm(pipId: string): void {
      const state = deps.getState();
      lastState = state;
      const model = buildRetireConfirmModel(state, pipId);
      if (model === null) return; // defensive — caller shouldn't offer a dead id
      confirmModel = model;
      confirmMessage = null;
      confirmResolved = false;
      sound("ui.sheet");
      paintConfirm();
      confirmWrap.classList.add("pk-sanctuary-confirm-wrap--open");
    },
  };
}
