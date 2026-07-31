/**
 * THE CRAFT TABLE — the Crafting screen (docs/economy-bible.md §3–§4,
 * §6.3's visibility table). Reached from the Nook menu, alongside the
 * Album and the Long Meadow: browse the recipe book (every recipe, tier-
 * locked ones VISIBLE with their unlock condition — "an invisible recipe
 * book teaches nothing"), see what's in flight at every placed Craft
 * Table (who's working it, what's active, what's queued, remaining
 * time), and queue a recipe.
 *
 * WHAT THIS FILE DOES NOT DO: assign a Pip to a station. That flow already
 * exists — `ui/focusView.ts`'s `buildJobRows` lists every station
 * (Crafting included, "with zero UI changes" per its own doc comment) on
 * a Pip's own page, and ASSIGN_JOB/UNASSIGN_JOB are dispatched from
 * there. This screen only ever reads "who is working here" — staffing a
 * bench is the Pip's page's job, same as Gathering/Mending/Simmering.
 *
 * MULTIPLE CRAFT TABLES: every placed one gets its own status card
 * (worker, active order, queue). The recipe book is ONE shared list —
 * recipes are content, not per-station — and tapping "Craft" enqueues at
 * the first station that is staffed AND has room in its queue
 * (`targetStationId`). A named simplification: with more than one
 * qualifying station this always picks the same one rather than offering
 * a picker. Multiple Craft Tables are a late-game structural choice
 * (bible §3.1); a picker is a small, clearly-scoped follow-up, not a gap
 * that ships silently — noted here rather than discovered later.
 *
 * Split like every sibling module: PURE model (`craftingSheetModel`,
 * node-testable, no DOM) + a dumb DOM shell (`createCraftingView`) that
 * only dispatches ENQUEUE_CRAFT/CANCEL_CRAFT and re-syncs.
 */

import "./crafting.css";
import type { Clock } from "../core/clock";
import type { GameAction, GameState } from "../core/state";
import type { CraftOutcome } from "../core/crafting";
import type { PlacementId } from "../core/keep";
import { recipes as contentRecipes } from "../content/recipes";
import type { RecipeDef } from "../content/recipes";
import { jobs as contentJobs } from "../content/jobs";
import { decorations as contentDecorations } from "../content/decorations";
import { tuning as contentTuning } from "../content/tuning";
import { formatDurationShort } from "./focusView";
import { resourceDisplayName, formatMissing } from "./buildMode";
import { itemColors, itemFallbackColor } from "../content/palette";
import type { IconSpec } from "../content/icons";
import { renderIcon } from "./icons";
import { sound } from "../app/sound";

// ---------------------------------------------------------------------------
// Pure model
// ---------------------------------------------------------------------------

/** One recipe input (a resource OR a Satchel item — bible §3.3 keeps the
 * two ledgers separate in content, but the player just sees "what do I
 * need" as one warm list). */
export interface CraftInputRowModel {
  readonly id: string;
  readonly name: string;
  readonly need: number;
  readonly have: number;
  /** `max(0, need - have)` — 0 means this input is covered. */
  readonly short: number;
}

export interface RecipeCardModel {
  readonly id: string;
  readonly name: string;
  readonly resolvedIcon: IconSpec;
  readonly tint: string;
  readonly flavor: string;
  /** THE "why would I make this" line (bible §4.6) — required on every
   * shipped `RecipeDef`, shown verbatim. */
  readonly effectCopy: string;
  /** "2 × Toastnut" / "1 × Poultice". */
  readonly outputLabel: string;
  /** "Takes 75 min" — the recipe's own base duration (§3.4). The exact
   * EFFECTIVE time (building/Pip-level speed) is a per-station fact,
   * shown on the in-progress order instead — see `CraftingStationModel`. */
  readonly durationLabel: string;
  readonly inputs: readonly CraftInputRowModel[];
  readonly locked: boolean;
  /** "Unlocks at Keep level 6" — null once unlocked. */
  readonly lockLabel: string | null;
  readonly affordable: boolean;
  /** "Needs 2 more Lodestone" — "" when affordable or locked. */
  readonly missingLabel: string;
  /** Unlocked AND affordable AND some station can take the order right
   * now. Drives the Craft button's disabled state. */
  readonly craftable: boolean;
}

export interface CraftQueueEntryModel {
  readonly recipeId: string;
  readonly name: string;
  /** Position in `CraftOrder.queue` — what a CANCEL_CRAFT `{kind:"queued"}`
   * target needs. */
  readonly queueIndex: number;
}

export interface CraftingStationModel {
  readonly placementId: PlacementId;
  /** "Craft Table" — "Craft Table 2" once a second is placed. */
  readonly label: string;
  /** The Pip currently assigned here, or null (unstaffed). */
  readonly workerName: string | null;
  readonly active: {
    readonly name: string;
    /** "ready in 41 min" / "ready any moment now". */
    readonly remainingLabel: string;
  } | null;
  readonly queue: readonly CraftQueueEntryModel[];
  /** True once `queue.length >= tuning.crafting.queueMax`. */
  readonly queueFull: boolean;
  /** Staffed AND not queue-full — this station could take a fresh order
   * right now. */
  readonly acceptsNewOrders: boolean;
}

export interface CraftingSheetModel {
  readonly stations: readonly CraftingStationModel[];
  /** The station a "Craft" tap enqueues at — the first `acceptsNewOrders`
   * station, or null when none does (see module doc's named
   * simplification). */
  readonly targetStationId: PlacementId | null;
  readonly readyRecipes: readonly RecipeCardModel[];
  readonly lockedRecipes: readonly RecipeCardModel[];
  /** One warm line explaining why nothing can be queued right now — null
   * once at least one station accepts orders. Shown once, above the
   * book, rather than repeated on every card. */
  readonly bookNote: string | null;
  /**
   * ROUND 2J FIX STAGE — the echo of the LAST ENQUEUE/CANCEL, rendered.
   *
   * `state.lastCraftOutcome` was written by the reducer and read by
   * nobody: the sheet recomputed affordability itself, so the typed
   * `cannotAfford` shortfall bundle that `core/crafting`'s module doc says
   * exists "so the UI can say '12 more Lodestone needed'" was pure dead
   * state. Now it is the sheet's own confirmation line — a tap that
   * queues something says so, and a tap that could not says why in the
   * refusal's own words.
   */
  readonly outcomeNote: string | null;
}

/** Every placed item id that hosts a `"crafting"`-kind job — mirrors
 * `core/crafting`'s own private `isCraftingStationItem` scan (module-
 * private there; this is the UI's own copy of the same tiny lookup, spec
 * §6.2's registry seam: a second crafting station needs only a content
 * entry, never a UI change). */
function craftingStationItemIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const job of Object.values(contentJobs)) {
    if (job.kind === "crafting") ids.add(job.stationItemId);
  }
  return ids;
}

/** The Pip currently assigned to a station, by name — a reverse scan of
 * `state.jobs`, same relationship `focusView.ts`'s `buildJobRows` and
 * `buildSheet.ts`'s rearrange rows already read the other direction. */
function workingPipNameAt(state: GameState, placementId: PlacementId): string | null {
  for (const [pipId, job] of Object.entries(state.jobs)) {
    if (job.stationPlacementId === placementId) {
      return state.pips[pipId]?.name ?? null;
    }
  }
  return null;
}

function recipeNameOf(recipeId: string): string {
  return (contentRecipes as Readonly<Record<string, RecipeDef>>)[recipeId]?.name ?? recipeId;
}

/**
 * ROUND 2J FIX STAGE — what a recipe MAKES, in the player's words.
 *
 * `resourceDisplayName` only knows resources and foods, so a keepsake
 * output rendered as the raw id, title-cased: "1 × Lodestone-cairn". The
 * five craft-only keepsakes are decorations, so their display name lives
 * in `content/decorations.ts` — which is also the registry that has to
 * resolve for the keepsake to be placeable at all.
 */
function outputDisplayName(recipe: RecipeDef): string {
  if (recipe.output.kind === "keepsake") {
    const decoration = contentDecorations.find((d) => d.id === recipe.output.itemId);
    if (decoration !== undefined) return decoration.name;
  }
  return resourceDisplayName(recipe.output.itemId);
}

/** A card's tint: the output item's own colour when it has one (foods and
 * resources do), otherwise the neutral fallback — a keepsake's identity
 * comes from its motif, not from `itemColors`. */
function outputTint(itemId: string): string {
  return itemColors[itemId] ?? itemFallbackColor;
}

/** "ready in 41 min" / "ready any moment now" — the same floor
 * `formatDurationShort` itself doesn't need to know about; a remainder
 * under a minute reads as "any moment", never "ready in 0 min". */
function remainingLabelFor(remainingMs: number): string {
  if (remainingMs <= 60_000) return "ready any moment now";
  return `ready in ${formatDurationShort(remainingMs)}`;
}

function craftingStationModel(
  state: GameState,
  now: number,
  placementId: PlacementId,
  index: number,
  total: number,
): CraftingStationModel {
  const order = (state.crafts ?? {})[placementId];
  const workerName = workingPipNameAt(state, placementId);
  const queueMax = contentTuning.crafting.queueMax;

  const active =
    order === undefined
      ? null
      : {
          name: recipeNameOf(order.recipeId),
          remainingLabel: remainingLabelFor(order.startedAt + order.effectiveMs - now),
        };

  const queue: CraftQueueEntryModel[] = (order?.queue ?? []).map((recipeId, i) => ({
    recipeId,
    name: recipeNameOf(recipeId),
    queueIndex: i,
  }));

  const queueFull = order !== undefined && order.queue.length >= queueMax;

  return {
    placementId,
    label: total > 1 ? `Craft Table ${index + 1}` : "Craft Table",
    workerName,
    active,
    queue,
    queueFull,
    acceptsNewOrders: workerName !== null && !queueFull,
  };
}

/** Every input (resources + Satchel items) as one combined, warm list. */
function inputRowsFor(state: GameState, recipe: RecipeDef): CraftInputRowModel[] {
  const rows: CraftInputRowModel[] = [];
  for (const [id, need] of Object.entries(recipe.resources)) {
    const have = state.resources[id] ?? 0;
    rows.push({ id, name: resourceDisplayName(id), need, have, short: Math.max(0, need - have) });
  }
  for (const [id, need] of Object.entries(recipe.items ?? {})) {
    const have = state.inventory[id] ?? 0;
    rows.push({ id, name: resourceDisplayName(id), need, have, short: Math.max(0, need - have) });
  }
  return rows;
}

function recipeCard(
  state: GameState,
  recipe: RecipeDef,
  targetStationId: PlacementId | null,
): RecipeCardModel {
  const locked = recipe.unlockKeepLevel > state.keep.level;
  const inputs = inputRowsFor(state, recipe);
  const affordable = inputs.every((row) => row.short === 0);
  const missing: Record<string, number> = {};
  for (const row of inputs) if (row.short > 0) missing[row.id] = row.short;

  return {
    id: recipe.id,
    name: recipe.name,
    resolvedIcon: recipe.icon,
    tint: outputTint(recipe.output.itemId),
    flavor: recipe.flavor,
    effectCopy: recipe.effectCopy,
    outputLabel: `${recipe.output.count} × ${outputDisplayName(recipe)}`,
    durationLabel: `Takes ${formatDurationShort(recipe.durationMs)}`,
    inputs,
    locked,
    lockLabel: locked ? `Unlocks at Keep level ${recipe.unlockKeepLevel}` : null,
    affordable,
    missingLabel: affordable || locked ? "" : formatMissing(missing),
    craftable: !locked && affordable && targetStationId !== null,
  };
}

function bookNoteFor(stations: readonly CraftingStationModel[], keepLevel: number): string | null {
  if (stations.length === 0) {
    return keepLevel >= contentTuning.crafting.unlockKeepLevel
      ? "Build a Craft Table from the Build sheet to start crafting."
      : `The Craft Table opens at Keep level ${contentTuning.crafting.unlockKeepLevel} — build one from the Build sheet once it does.`;
  }
  if (stations.every((s) => s.workerName === null)) {
    return "No Craft Table is staffed right now — visit a Pip's own page to put them to work.";
  }
  if (stations.every((s) => s.queueFull)) {
    return "Every Craft Table's queue is full for now — check back once one clears.";
  }
  return null;
}

/** The whole Crafting screen's view model. Pure — `now` is threaded
 * through explicitly (the same discipline `focusView.ts`'s countdown rows
 * use) rather than read from a clock, so this stays node-testable with no
 * fake timers. */
export function craftingSheetModel(state: GameState, now: number): CraftingSheetModel {
  const stationItemIds = craftingStationItemIds();
  const placementIds = Object.entries(state.keep.placements)
    .filter(([, placement]) => stationItemIds.has(placement.itemId))
    .map(([placementId]) => placementId);

  const stations = placementIds.map((placementId, i) =>
    craftingStationModel(state, now, placementId, i, placementIds.length),
  );

  const target = stations.find((s) => s.acceptsNewOrders) ?? null;
  const targetStationId = target?.placementId ?? null;

  const allRecipes = Object.values(contentRecipes).sort(
    (a, b) => a.unlockKeepLevel - b.unlockKeepLevel || a.name.localeCompare(b.name),
  );
  const readyRecipes: RecipeCardModel[] = [];
  const lockedRecipes: RecipeCardModel[] = [];
  for (const recipe of allRecipes) {
    const card = recipeCard(state, recipe, targetStationId);
    (card.locked ? lockedRecipes : readyRecipes).push(card);
  }

  return {
    stations,
    targetStationId,
    readyRecipes,
    lockedRecipes,
    bookNote: bookNoteFor(stations, state.keep.level),
    outcomeNote: craftOutcomeNote(state.lastCraftOutcome ?? null, now),
  };
}

/** How long an enqueue/cancel echo stays on the sheet. Long enough to
 * read after the tap that caused it, short enough that a reload never
 * shows a stale one. */
export const CRAFT_OUTCOME_TTL_MS = 90_000;

/**
 * The last enqueue/cancel, in the player's words. Round 2J shipped the
 * typed outcome and rendered none of it; the `cannotAfford` branch in
 * particular carries a shortfall bundle the module doc promises the UI
 * will speak aloud.
 */
export function craftOutcomeNote(outcome: CraftOutcome | null, now?: number): string | null {
  if (outcome === null) return null;
  // `lastCraftOutcome` is an echo, not a log: it survives a reload, so a
  // note from three days ago must not greet the player on boot. Absent
  // `now` (direct unit calls) skips the freshness gate.
  if (now !== undefined && now - outcome.at > CRAFT_OUTCOME_TTL_MS) return null;
  if (outcome.action === "cancelCraft") {
    return outcome.ok ? `${recipeNameOf(outcome.recipeId)} cancelled — everything it cost is back.` : null;
  }
  const name = recipeNameOf(outcome.recipeId);
  if (outcome.ok) {
    return outcome.startedImmediately
      ? `${name} is on the bench now.`
      : `${name} is queued — it starts when the bench is free.`;
  }
  switch (outcome.reason) {
    case "cannotAfford":
      return `Not enough for a ${name} yet — ${formatMissing(outcome.missing ?? {})
        .replace(/^Needs /, "")}.`;
    case "queueFull":
      return "That bench's queue is full — cancel something or wait for it to clear.";
    case "unstaffed":
      return "Nobody's working that bench yet.";
    case "locked":
      return `${name} isn't in the book yet.`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface CraftingViewDeps {
  dispatch(action: GameAction): void;
  getState(): GameState;
  clock: Clock;
}

export interface CraftingView {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  sync(state: GameState): void;
}

export function createCraftingView(deps: CraftingViewDeps): CraftingView {
  const el = document.createElement("div");
  el.className = "pk-craft-wrap";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-craft-backdrop";

  const sheet = document.createElement("div");
  sheet.className = "pk-craft-sheet";

  const handle = document.createElement("div");
  handle.className = "pk-craft-handle";

  const header = document.createElement("div");
  header.className = "pk-craft-header";
  const title = document.createElement("div");
  title.className = "pk-craft-title";
  title.textContent = "The Craft Table";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "pk-craft-close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close");
  header.append(title, closeBtn);

  const stationsList = document.createElement("div");
  stationsList.className = "pk-craft-stations";

  const bookNote = document.createElement("div");
  bookNote.className = "pk-craft-note";

  // ROUND 2J FIX STAGE — the enqueue/cancel echo, finally on a surface.
  const outcomeNote = document.createElement("div");
  outcomeNote.className = "pk-craft-outcome";
  outcomeNote.setAttribute("role", "status");

  const readyTitle = document.createElement("div");
  readyTitle.className = "pk-craft-group-title";
  readyTitle.textContent = "Ready to craft";
  const readyGrid = document.createElement("div");
  readyGrid.className = "pk-craft-grid";

  const lockedWrap = document.createElement("div");
  lockedWrap.className = "pk-craft-group";

  sheet.append(
    handle,
    header,
    stationsList,
    outcomeNote,
    bookNote,
    readyTitle,
    readyGrid,
    lockedWrap,
  );
  el.append(backdrop, sheet);

  let isOpen = false;
  let lastState: GameState | null = null;
  /** Per-instance, not persisted (same convention `buildSheet.ts`'s locked
   * catalogue collapse uses) — reopening the sheet starts tidy again. */
  let lockedExpanded = false;

  const close = (): void => {
    isOpen = false;
    el.classList.remove("pk-craft-wrap--open");
  };
  backdrop.addEventListener("click", () => {
    sound("ui.tap");
    close();
  });
  closeBtn.addEventListener("click", () => {
    sound("ui.tap");
    close();
  });

  const renderStation = (station: CraftingStationModel): HTMLElement => {
    const card = document.createElement("div");
    card.className = "pk-craft-station";

    const label = document.createElement("div");
    label.className = "pk-craft-station-label";
    label.textContent = station.label;
    card.appendChild(label);

    const worker = document.createElement("div");
    worker.className = "pk-craft-station-worker";
    worker.textContent =
      station.workerName !== null
        ? `${station.workerName} is working here.`
        : "Nobody's working this one yet.";
    card.appendChild(worker);

    if (station.active !== null) {
      const row = document.createElement("div");
      row.className = "pk-craft-order";
      const name = document.createElement("span");
      name.className = "pk-craft-order-name";
      name.textContent = station.active.name;
      const remaining = document.createElement("span");
      remaining.className = "pk-craft-order-remaining";
      remaining.textContent = station.active.remainingLabel;
      row.append(name, remaining);

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "pk-craft-cancel";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        sound("ui.tap");
        deps.dispatch({
          type: "CANCEL_CRAFT",
          stationPlacementId: station.placementId,
          target: { kind: "active" },
          at: deps.clock.now(),
        });
      });
      row.appendChild(cancel);
      card.appendChild(row);
    }

    for (const entry of station.queue) {
      const row = document.createElement("div");
      row.className = "pk-craft-order pk-craft-order--queued";
      const name = document.createElement("span");
      name.className = "pk-craft-order-name";
      name.textContent = `${entry.name} — queued`;
      row.appendChild(name);

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "pk-craft-cancel";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        sound("ui.tap");
        deps.dispatch({
          type: "CANCEL_CRAFT",
          stationPlacementId: station.placementId,
          target: { kind: "queued", index: entry.queueIndex },
          at: deps.clock.now(),
        });
      });
      row.appendChild(cancel);
      card.appendChild(row);
    }

    return card;
  };

  const renderRecipeCard = (recipe: RecipeCardModel, targetStationId: PlacementId | null): HTMLElement => {
    const card = document.createElement("button");
    card.type = "button";
    const classes = ["pk-item", "pk-craft-card"];
    if (recipe.locked) classes.push("pk-craft-card--locked");
    card.className = classes.join(" ");
    card.disabled = !recipe.craftable;

    const head = document.createElement("div");
    head.className = "pk-craft-card-head";
    head.appendChild(renderIcon(recipe.resolvedIcon, recipe.tint, "md"));
    const nameWrap = document.createElement("div");
    nameWrap.className = "pk-craft-card-name-wrap";
    const name = document.createElement("div");
    name.className = "pk-item-name";
    name.textContent = recipe.name;
    const output = document.createElement("div");
    output.className = "pk-craft-output";
    output.textContent = `${recipe.outputLabel} · ${recipe.durationLabel}`;
    nameWrap.append(name, output);
    head.appendChild(nameWrap);
    card.appendChild(head);

    const effect = document.createElement("div");
    effect.className = "pk-craft-effect";
    effect.textContent = recipe.effectCopy;
    card.appendChild(effect);

    const inputsList = document.createElement("div");
    inputsList.className = "pk-craft-inputs";
    for (const input of recipe.inputs) {
      const row = document.createElement("span");
      row.className = input.short > 0 ? "pk-craft-input pk-craft-input--short" : "pk-craft-input";
      row.textContent =
        input.short > 0 ? `${input.need} ${input.name} (have ${input.have})` : `${input.need} ${input.name}`;
      inputsList.appendChild(row);
    }
    card.appendChild(inputsList);

    const flavor = document.createElement("div");
    flavor.className = "pk-craft-flavor";
    flavor.textContent = recipe.flavor;
    card.appendChild(flavor);

    if (recipe.locked) {
      const lock = document.createElement("div");
      lock.className = "pk-craft-lock";
      lock.textContent = recipe.lockLabel ?? "";
      card.appendChild(lock);
    } else if (!recipe.affordable) {
      const missing = document.createElement("div");
      missing.className = "pk-craft-missing";
      missing.textContent = recipe.missingLabel;
      card.appendChild(missing);
    }

    card.addEventListener("click", () => {
      if (card.disabled || targetStationId === null) return;
      sound("ui.tap");
      deps.dispatch({
        type: "ENQUEUE_CRAFT",
        stationPlacementId: targetStationId,
        recipeId: recipe.id,
        at: deps.clock.now(),
      });
    });

    return card;
  };

  const rebuild = (state: GameState): void => {
    const model = craftingSheetModel(state, deps.clock.now());

    stationsList.replaceChildren();
    for (const station of model.stations) stationsList.appendChild(renderStation(station));
    stationsList.hidden = model.stations.length === 0;

    bookNote.textContent = model.bookNote ?? "";
    bookNote.hidden = model.bookNote === null;

    outcomeNote.textContent = model.outcomeNote ?? "";
    outcomeNote.hidden = model.outcomeNote === null;

    readyGrid.replaceChildren();
    for (const recipe of model.readyRecipes) {
      readyGrid.appendChild(renderRecipeCard(recipe, model.targetStationId));
    }
    // ROUND 2J FIX STAGE — "Ready to craft" sat above cards you could not
    // craft, directly under "Build a Craft Table to start crafting". The
    // heading now says what the list actually is.
    readyTitle.textContent =
      model.targetStationId === null ? "In the book" : "Ready to craft";
    readyTitle.hidden = model.readyRecipes.length === 0;
    readyGrid.hidden = model.readyRecipes.length === 0;

    lockedWrap.replaceChildren();
    lockedWrap.hidden = model.lockedRecipes.length === 0;
    if (model.lockedRecipes.length > 0) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "pk-craft-group-title pk-craft-group-toggle";
      toggle.setAttribute("aria-expanded", lockedExpanded ? "true" : "false");
      toggle.textContent = `${lockedExpanded ? "▾" : "▸"} Coming as the Keep grows · ${model.lockedRecipes.length}`;
      toggle.addEventListener("click", () => {
        sound("ui.tap");
        lockedExpanded = !lockedExpanded;
        if (lastState !== null) rebuild(lastState);
      });
      lockedWrap.appendChild(toggle);
      if (lockedExpanded) {
        const grid = document.createElement("div");
        grid.className = "pk-craft-grid";
        for (const recipe of model.lockedRecipes) {
          grid.appendChild(renderRecipeCard(recipe, model.targetStationId));
        }
        lockedWrap.appendChild(grid);
      }
    }
  };

  return {
    el,
    open(): void {
      isOpen = true;
      sound("ui.sheet");
      lastState = deps.getState();
      rebuild(lastState);
      el.classList.add("pk-craft-wrap--open");
    },
    close,
    sync(state: GameState): void {
      lastState = state;
      if (isOpen) rebuild(state);
    },
  };
}
