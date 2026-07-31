/**
 * THE VISITOR CARD (round 2K, docs/liveliness-bible.md §1.5/§1.7).
 *
 * ⚠️ THIS MODULE IS THE ROUND'S ANSWER TO THE STANDING RULE. Spec §16
 * v1.3 — "written to state" and "visible to the player" are SEPARATE
 * acceptance criteria — has been earned nine times. `core/attractions`
 * writes `state.visitors[placementId]` on every TICK and CATCHUP whether
 * or not this file exists; `render/keepScene.ts` walks a real Pip in from
 * the screen edge to stand by the attraction. Without a card, tapping
 * that Pip would do nothing, and the visitor would be a beautifully
 * animated tenth dead feature.
 *
 * DELIBERATELY NOT THE FOCUS VIEW (bible §1.5). A visitor is not your
 * Pip: it has no needs, no job, no expedition and no Growth. Showing it
 * in the focus view would offer four things the player cannot do and
 * imply a fifth (sending it away) that would be a bug. It gets a small
 * sheet with exactly two verbs, and it reaches this module through its
 * own `render/visitorTap` seam so that separation is structural.
 *
 * FULL DISCLOSURE, FROM VISIT ONE (bible §1.5): the three trust pips are
 * visible before the player has earned any of them, so "how do I keep
 * this one" is answered by looking rather than by guessing. And at the
 * roster cap the answer is *"they wait"* — never a refusal, never a
 * prompt to retire someone, never an upsell. Nothing expires, ever.
 *
 * Pure model layer + dumb DOM, the same shape as `ailment.ts` and
 * `sanctuary.ts`: every model builder below is state → data and is unit
 * tested without a DOM.
 */

import "./visitor.css";
import { tuning as contentTuning } from "../content/tuning";
import { foods as contentFoods } from "../content/foods";
import { expeditions as contentExpeditions } from "../content/expeditions";
import { species as contentSpecies } from "../content/species";
import { personalities as contentPersonalities } from "../content/personalities";
import { placeables as contentPlaceables } from "../content/placeables";
import {
  attractionBiomeIdFor,
  isBiomeFood,
  visitorIsPresent,
  visitorPool,
} from "../core/attractions";
import type { VisitorRecord } from "../core/attractions";
import type { GameAction, GameState } from "../core/state";
import type { ResourceBundle } from "../core/economy";
import { rosterCapFor } from "../core/state";
import type { Clock } from "../core/clock";
import { buildPortraitEl } from "./pipdex";
import type { PortraitVisual } from "./pipdex";
import { formatBundle, formatMissing, missingFor } from "./buildMode";
import { sound } from "../app/sound";

// ---------------------------------------------------------------------------
// Registry lookups
// ---------------------------------------------------------------------------
//
// Every content registry here is a Record keyed by a LITERAL union, and a
// visitor's ids arrive as plain strings (they came out of a save, and a
// save can hold an id a later build no longer defines). Widening once,
// here, keeps the model layer below free of casts — and every lookup
// falls back to the raw id rather than throwing, so an unknown species
// renders as its id instead of blanking the card.

function speciesNameOf(speciesId: string): string {
  return (contentSpecies as Readonly<Record<string, { name: string }>>)[speciesId]?.name ?? speciesId;
}

function personalityNameOf(personalityId: string): string {
  return (
    (contentPersonalities as Readonly<Record<string, { name: string }>>)[personalityId]?.name ??
    personalityId
  );
}

function expeditionOf(
  biomeId: string,
): { name: string; eggSpecies: readonly string[] } | undefined {
  return (
    contentExpeditions as Readonly<
      Record<string, { name: string; eggSpecies: readonly string[] }>
    >
  )[biomeId];
}

function biomeNameOf(biomeId: string): string {
  return expeditionOf(biomeId)?.name ?? biomeId;
}

// ---------------------------------------------------------------------------
// Pure model layer
// ---------------------------------------------------------------------------

/** One snack the player could offer, and whether it lands (bible §1.5). */
export interface SnackOption {
  readonly foodId: string;
  readonly name: string;
  readonly owned: number;
  /** From this visitor's own biome — the only kind that moves trust. */
  readonly fromBiome: boolean;
}

export interface VisitorCardModel {
  readonly placementId: string;
  readonly name: string;
  readonly speciesName: string;
  readonly personalityName: string;
  readonly biomeName: string;
  readonly portrait: PortraitVisual;
  readonly trust: number;
  readonly trustNeeded: number;
  /** "Come by twice before." — the returning-visitor line (bible §1.5). */
  readonly visitsLine: string;
  readonly fedThisVisit: boolean;
  readonly snacks: readonly SnackOption[];
  /** True once trust is at `welcomeTrust` AND there is room. */
  readonly canWelcome: boolean;
  /** True at full trust but the roster is full — the "they wait" state. */
  readonly waitingForRoom: boolean;
  readonly welcomeCostLabel: string;
  /** "" when affordable; otherwise "6 more Wood". */
  readonly welcomeMissingLabel: string;
  readonly canAffordWelcome: boolean;
  /** The one warm line under the buttons. Never a nag, never a countdown. */
  readonly footnote: string;
}

/** The visitor's genome, as the shared DOM portrait path wants it — the
 * SAME path every roster Pip's portrait uses, so accessories, patterns,
 * jitter and shininess all render for a stranger too (bible §7.4). */
export function visitorPortrait(placementId: string, record: VisitorRecord): PortraitVisual {
  return {
    speciesId: record.speciesId,
    paletteId: record.genome.palette,
    pattern: record.genome.pattern,
    shiny: record.genome.shiny,
    accessoryId: record.genome.accessoryId,
    // Namespaced exactly as `keepScene`'s visitor actor id is, so the
    // freckles on the card and the freckles in the Keep are the same
    // freckles. Two surfaces, one individual.
    jitterSeed: `visitor:${placementId}`,
  };
}

/** "Come by twice before." / "First time here." (bible §1.5). */
export function visitsLineFor(visits: number): string {
  if (visits <= 1) return "First time here.";
  if (visits === 2) return "Come by once before.";
  if (visits === 3) return "Come by twice before.";
  if (visits < 6) return `Come by ${visits - 1} times before.`;
  return "A regular, at this point.";
}

/**
 * The one line under the buttons.
 *
 * ⚠️ EVERY BRANCH IS A TONE DECISION, and the roster-cap one is the
 * important one (bible §1.7): *"Pipsqueak would stay, when there's
 * room."* Not a refusal, not "retire someone", not an upsell. The Long
 * Meadow is offered once, below, as an option — never as a requirement.
 */
export function visitorFootnote(model: {
  name: string;
  trust: number;
  trustNeeded: number;
  waitingForRoom: boolean;
  canAffordWelcome: boolean;
  fedThisVisit: boolean;
}): string {
  if (model.waitingForRoom) return `${model.name} would stay, when there's room.`;
  if (model.trust >= model.trustNeeded) {
    return model.canAffordWelcome
      ? `${model.name} would stay, if you asked.`
      : `${model.name} would stay — you're a little short on the welcome.`;
  }
  if (model.fedThisVisit) return "Fed for today. They'll be back around.";
  const left = model.trustNeeded - model.trust;
  return left === 1
    ? "One more good snack and they'd think about staying."
    : `A few more visits like this one and ${model.name} might stay.`;
}

/**
 * Build the card's whole model from state. Returns null when there is
 * nothing to show (no attraction, no visitor, or the visit has ended) —
 * the caller closes on null, so a visitor leaving while the card is open
 * closes the card rather than lying about who is standing outside.
 */
export function buildVisitorCardModel(
  state: GameState,
  placementId: string,
  now: number,
): VisitorCardModel | null {
  const record = (state.visitors ?? {})[placementId];
  if (record === undefined) return null;
  if (!visitorIsPresent(record, now)) return null;
  const placement = state.keep.placements[placementId];
  if (placement === undefined) return null;
  const biomeId = attractionBiomeIdFor(placement.itemId);
  if (biomeId === undefined) return null;

  const cfg = contentTuning.attractions;
  const trustNeeded = cfg.welcomeTrust;
  const roster = state.rosterOrder.length;
  const atCap = roster >= rosterCapFor(state);
  const cost = (cfg.welcomeCost as Readonly<Record<string, ResourceBundle>>)[biomeId] ?? {};
  const missing = missingFor(state.resources, cost);
  const canAffordWelcome = Object.keys(missing).length === 0;
  const atFullTrust = record.trust >= trustNeeded;

  const speciesDef = speciesNameOf(record.speciesId);
  const personality = personalityNameOf(record.genome.personalityId);
  const biomeName = biomeNameOf(biomeId);

  // The Satchel, filtered to what this visitor actually cares about —
  // biome-correct snacks first, then everything else the player owns.
  // NOTHING is hidden: a snack from elsewhere is still offerable, because
  // refusing a gift is not this game's tone (bible §1.5).
  const snacks: SnackOption[] = [];
  for (const [foodId, owned] of Object.entries(state.inventory)) {
    if (owned <= 0) continue;
    const def = (contentFoods as Readonly<Record<string, { name: string }>>)[foodId];
    if (def === undefined) continue;
    snacks.push({
      foodId,
      name: def.name,
      owned,
      fromBiome: isBiomeFood(biomeId, foodId),
    });
  }
  snacks.sort((a, b) =>
    a.fromBiome === b.fromBiome ? a.name.localeCompare(b.name) : a.fromBiome ? -1 : 1,
  );

  const name = record.name;
  const waitingForRoom = atFullTrust && atCap;
  return {
    placementId,
    name,
    speciesName: speciesDef,
    personalityName: personality,
    biomeName,
    portrait: visitorPortrait(placementId, record),
    trust: record.trust,
    trustNeeded,
    visitsLine: visitsLineFor(record.visits),
    fedThisVisit: record.fedThisVisit,
    snacks,
    canWelcome: atFullTrust && !atCap && canAffordWelcome,
    waitingForRoom,
    welcomeCostLabel: formatBundle(cost),
    welcomeMissingLabel: formatMissing(missing),
    canAffordWelcome,
    footnote: visitorFootnote({
      name,
      trust: record.trust,
      trustNeeded,
      waitingForRoom,
      canAffordWelcome,
      fedThisVisit: record.fedThisVisit,
    }),
  };
}

/**
 * THE POOL, NAMED (bible §7.4's "Its pool" row, §0.5 full disclosure).
 *
 * Every species that could ever turn up at this attraction, with whether
 * the player has met it. This is what makes attractions structurally NOT
 * a gacha: the outcomes are printed on the card by name, before the
 * player spends anything, and the pool is a strict subset of what they
 * have already caught (I1).
 */
export interface PoolEntry {
  readonly speciesId: string;
  readonly name: string;
  readonly caught: boolean;
}

export function attractionPoolEntries(state: GameState, itemId: string): readonly PoolEntry[] {
  const biomeId = attractionBiomeIdFor(itemId);
  if (biomeId === undefined) return [];
  const caught = new Set(visitorPool(biomeId, (id) => state.pipdex.entries[id]?.caughtAt != null));
  const all = expeditionOf(biomeId)?.eggSpecies ?? [];
  return all.map((speciesId) => ({
    speciesId,
    name: speciesNameOf(speciesId),
    caught: caught.has(speciesId),
  }));
}

/** The warm line for an attraction whose pool is empty (bible §7.4). */
export function emptyPoolLine(itemId: string): string {
  const biomeId = attractionBiomeIdFor(itemId);
  const itemName = contentPlaceables.find((p) => p.id === itemId)?.name ?? "It";
  const where = biomeId === undefined ? "the wild" : `the ${biomeNameOf(biomeId)}`;
  return `Nobody from ${where} knows the way here yet. ${itemName} is ready when they do.`;
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface VisitorCardOptions {
  readonly mount: HTMLElement;
  readonly clock: Clock;
  readonly dispatch: (action: GameAction) => void;
  /** "The Long Meadow has room…" — the ONE secondary link offered at the
   * roster cap (bible §1.7). Never pre-selected, never naming a Pip. */
  readonly onOpenLongMeadow: () => void;
}

export interface VisitorCardView {
  readonly el: HTMLElement;
  open(placementId: string): void;
  close(): void;
  isOpen(): boolean;
  sync(state: GameState): void;
}

export function createVisitorCardView(opts: VisitorCardOptions): VisitorCardView {
  const root = document.createElement("div");
  root.className = "pk-visitor-root";

  const wrap = document.createElement("div");
  wrap.className = "pk-visitor-wrap";
  const backdrop = document.createElement("div");
  backdrop.className = "pk-visitor-backdrop";
  const panel = document.createElement("div");
  panel.className = "pk-visitor-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "A visitor");
  wrap.append(backdrop, panel);
  root.append(wrap);
  opts.mount.append(root);

  let open = false;
  let placementId: string | null = null;
  let latest: GameState | null = null;
  let snacksOpen = false;

  function close(): void {
    if (!open) return;
    open = false;
    placementId = null;
    snacksOpen = false;
    wrap.classList.remove("pk-visitor-wrap--open");
  }

  backdrop.addEventListener("click", close);

  function render(): void {
    const state = latest;
    const pid = placementId;
    if (!open || state === null || pid === null) return;
    const model = buildVisitorCardModel(state, pid, opts.clock.now());
    if (model === null) {
      // They left while the card was open. Closing is the honest thing —
      // and nothing was lost, so nothing is phrased as loss.
      close();
      return;
    }

    panel.replaceChildren();

    const head = document.createElement("div");
    head.className = "pk-visitor-head";
    const portrait = buildPortraitEl(model.portrait, "small");
    const who = document.createElement("div");
    who.className = "pk-visitor-who";
    const nameEl = document.createElement("div");
    nameEl.className = "pk-visitor-name";
    nameEl.textContent = model.name;
    const subEl = document.createElement("div");
    subEl.className = "pk-visitor-sub";
    subEl.textContent = `${model.speciesName} · ${model.personalityName}`;
    const fromEl = document.createElement("div");
    fromEl.className = "pk-visitor-from";
    fromEl.textContent = `visiting from the ${model.biomeName}`;
    who.append(nameEl, subEl, fromEl);
    head.append(portrait, who);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pk-visitor-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", close);
    head.append(closeBtn);

    // Visits + the trust pips. THE TRUST PIPS ARE VISIBLE FROM VISIT ONE
    // — full disclosure is the whole reason this is not a gacha.
    const row = document.createElement("div");
    row.className = "pk-visitor-row";
    const visits = document.createElement("div");
    visits.className = "pk-visitor-visits";
    visits.textContent = `“${model.visitsLine}”`;
    const pips = document.createElement("div");
    pips.className = "pk-visitor-trust";
    pips.setAttribute(
      "aria-label",
      `Trust ${model.trust} of ${model.trustNeeded}`,
    );
    for (let i = 0; i < model.trustNeeded; i++) {
      const dot = document.createElement("span");
      dot.className =
        i < model.trust ? "pk-visitor-pip pk-visitor-pip--on" : "pk-visitor-pip";
      pips.append(dot);
    }
    row.append(visits, pips);

    const actions = document.createElement("div");
    actions.className = "pk-visitor-actions";

    // --- Offer a snack -------------------------------------------------
    const snackBtn = document.createElement("button");
    snackBtn.type = "button";
    snackBtn.className = "pk-visitor-btn";
    snackBtn.textContent = model.fedThisVisit ? "Offer another snack" : "Offer a snack";
    snackBtn.disabled = model.snacks.length === 0;
    if (model.snacks.length === 0) {
      snackBtn.textContent = "Nothing in the satchel";
    }
    snackBtn.addEventListener("click", () => {
      snacksOpen = !snacksOpen;
      sound("ui.tap");
      render();
    });
    actions.append(snackBtn);

    if (snacksOpen && model.snacks.length > 0) {
      const list = document.createElement("div");
      list.className = "pk-visitor-snacks";
      for (const snack of model.snacks) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = snack.fromBiome
          ? "pk-visitor-snack pk-visitor-snack--liked"
          : "pk-visitor-snack";
        const label = document.createElement("span");
        label.textContent = `${snack.name} ×${snack.owned}`;
        btn.append(label);
        if (snack.fromBiome) {
          const tag = document.createElement("span");
          tag.className = "pk-visitor-snack-tag";
          // Says the true thing, plainly: this is the one that counts.
          tag.textContent = model.fedThisVisit ? `from the ${model.biomeName}` : "a favourite";
          btn.append(tag);
        }
        btn.addEventListener("click", () => {
          opts.dispatch({
            type: "FEED_VISITOR",
            placementId: model.placementId,
            foodId: snack.foodId,
            at: opts.clock.now(),
          });
          snacksOpen = false;
          sound("care.feed");
        });
        list.append(btn);
      }
      actions.append(list);
    }

    // --- Ask them to stay ----------------------------------------------
    if (model.trust >= model.trustNeeded && !model.waitingForRoom) {
      const stayBtn = document.createElement("button");
      stayBtn.type = "button";
      stayBtn.className = "pk-visitor-btn pk-visitor-btn--primary";
      stayBtn.textContent = `Ask them to stay · ${model.welcomeCostLabel}`;
      stayBtn.disabled = !model.canAffordWelcome;
      stayBtn.addEventListener("click", () => {
        opts.dispatch({
          type: "WELCOME_VISITOR",
          placementId: model.placementId,
          at: opts.clock.now(),
        });
        close();
      });
      actions.append(stayBtn);
      if (!model.canAffordWelcome && model.welcomeMissingLabel !== "") {
        const missing = document.createElement("div");
        missing.className = "pk-visitor-missing";
        missing.textContent = model.welcomeMissingLabel;
        actions.append(missing);
      }
    }

    const foot = document.createElement("div");
    foot.className = "pk-visitor-foot";
    foot.textContent = model.footnote;
    actions.append(foot);

    // At the cap, the Long Meadow is offered ONCE, as an option. It names
    // no Pip, it is not pre-selected, and the copy says the true thing:
    // retirement is reversible and can never empty the Keep.
    if (model.waitingForRoom) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "pk-visitor-link";
      link.textContent =
        "The Long Meadow has room, if someone fancies a rest. You can ask them home whenever you like.";
      link.addEventListener("click", () => {
        close();
        opts.onOpenLongMeadow();
      });
      actions.append(link);
    }

    panel.append(head, row, actions);
  }

  return {
    el: root,

    open(nextPlacementId: string): void {
      placementId = nextPlacementId;
      snacksOpen = false;
      open = true;
      wrap.classList.add("pk-visitor-wrap--open");
      render();
    },

    close,
    isOpen: () => open,

    sync(state: GameState): void {
      latest = state;
      // Re-render on every store change so a fed snack fills a trust pip
      // in place, and so a visitor who leaves closes the card.
      if (open) render();
    },
  };
}
