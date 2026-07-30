/**
 * The Album ("the Pipdex" internally — docs/retention-bible.md §1, and see
 * that section's own naming note: "pipdex" stays the code id, "the Album"
 * is the only surface name). A scrapbook, not a spreadsheet (bible §1.3):
 *
 * - a BOOK of every species the registry knows about — two portrait-shaped
 *   pages per spread with a binding down the middle and folio numbers in the
 *   corner, NEVER a 14-cell grid (bible §1.3.2 names the grid as the
 *   anti-pattern: "a grid is a checklist"; §14 risk 19 says the §1.3 choices
 *   ARE the feature). Ordered the way `state.pipdex.discoveryOrder`
 *   remembers meeting them (a diary, not a sorted table), with any never-met
 *   species tacked on the end, forever blank;
 * - three honest tiers per entry (bible §1.1) — Blank page (nothing),
 *   Field note (a neutral silhouette + the home biome(s) + the species'
 *   own voice + the pool odds — no portrait, no date), Portrait (the
 *   individual's frozen first look, name, personality, found-line,
 *   caught date, shiny stamp, and — for a base species — the evolution
 *   ribbon, the Grove Ledger's three leaves);
 * - completion phrased warmly at the top, in the exact three targets the
 *   bible declares (§1.2): the Album (14/14 forms — headline), the Grove
 *   Ledger (21/21 gift leaves — the RNG-free long-haul target), and
 *   Glimmers (shiny — no denominator, ever, on purpose);
 * - and the cover's FLAIR (bible §4.3): earned stamps pressed into it,
 *   ribbons tied along it, the one earned page frame drawn on the book, and a
 *   line naming any flourish that shows elsewhere in the Keep (a Pip's title,
 *   a Long Meadow gate sign) so nothing earned is ever invisible.
 *
 * Pure-controller pattern (same shape as `focusView.ts`): every model
 * builder below is `state (+ maybe a speciesId) → plain data`, unit-tested
 * without a DOM; `createPipdexView` is the dumb shell that renders those
 * models and dispatches nothing at all — the Album has no actions of its
 * own, only a door in and a door out (spec §10's two-views pattern, a
 * third view added by this round).
 *
 * `buildPortraitEl`/`PortraitVisual` are exported for `sanctuary.ts` (a
 * sibling module I also own) to reuse verbatim — a Long Meadow resident's
 * card wants the exact same procedural look, just fed a live Pip's genome
 * instead of a frozen `firstPortrait` snapshot.
 */

import "./pipdex.css";
import type { GameState } from "../core/state";
import type { PipdexEntry, PipdexPortrait } from "../core/pipdex";
import { pipdexCompletion } from "../core/pipdex";
import { isoStamp } from "../core/clock";
import { LifeStage } from "../core/pips/types";
import { species as contentSpecies } from "../content/species";
import type { SpeciesDef } from "../content/species";
// Type-only import (erased at compile, no pixi.js in this bundle — spec §2
// rule 1 stays intact): `Silhouette` is the render module's own vocabulary
// for the same content-bible §1.4 axis this file draws in DOM instead of
// Pixi, so it is reused rather than re-declared.
import type { Silhouette } from "../render/spriteResolver";
import { EXPEDITION_IDS, expeditions } from "../content/expeditions";
import type { ExpeditionId } from "../content/expeditions";
import { foods } from "../content/foods";
import { personalities } from "../content/personalities";
import type { PersonalityId } from "../content/personalities";
import { tuning } from "../content/tuning";
import { resolvePipPalette } from "../content/palette";
import { pickSpeciesLine } from "../content/speciesLines";
import { activePageFrame, earnedFlairOfKind } from "../content/flair";
import type { FlairDef } from "../content/flair";
import { sound } from "../app/sound";

// ---------------------------------------------------------------------------
// Pure model layer
// ---------------------------------------------------------------------------

export type PipdexTier = "blank" | "field-note" | "portrait";

/** Bible §1.1's three-tier derivation, restated for the UI: a Portrait
 * needs nothing but `caughtAt`; a Field note needs `seenAt` with no catch
 * yet; anything else (no entry at all) is a Blank page. */
export function entryTier(entry: PipdexEntry | undefined): PipdexTier {
  if (entry?.caughtAt != null) return "portrait";
  if (entry?.seenAt != null) return "field-note";
  return "blank";
}

/** Page order (bible §1.3.1 "ordered by when you met them — the Album is
 * a diary"): `discoveryOrder` first, then every never-met species appended
 * in registry order so the book always has all 14 pages, forever-blank ones
 * simply having nothing to say for themselves yet. (Name kept as-is: it is
 * the exported identifier `pipdex.test.ts` and the detail view both use.) */
export function pipdexGridOrder(state: Pick<GameState, "pipdex">): readonly string[] {
  const met = new Set(state.pipdex.discoveryOrder);
  const rest = Object.keys(contentSpecies).filter((id) => !met.has(id));
  return [...state.pipdex.discoveryOrder, ...rest];
}

/** One biome this species can hatch from, plus the odds WITHIN that
 * biome's pool (content-only, rarity-weighted exactly as bible §3.6's own
 * table — no player state involved, so a Field note's "pool odds" line is
 * simply true, not a leaked secret: you already know the species exists
 * once you're reading this). */
export interface HomeBiomeModel {
  readonly id: string;
  readonly name: string;
  /** Share of this biome's egg pool this species claims, in [0, 100].
   * Null if the pool is empty or malformed (defensive only). */
  readonly oddsPct: number | null;
}

function poolOddsPct(speciesId: string, expeditionId: ExpeditionId): number | null {
  const pool = expeditions[expeditionId]?.eggSpecies;
  if (pool === undefined || !pool.includes(speciesId)) return null;
  const weights = tuning.eggs.rarityWeights as Readonly<Record<string, number>>;
  let total = 0;
  let mine = 0;
  for (const sid of pool) {
    const w = weights[contentSpecies[sid]?.rarity ?? "common"] ?? 0;
    total += w;
    if (sid === speciesId) mine = w;
  }
  return total > 0 ? (mine / total) * 100 : null;
}

/** Every biome whose egg pool contains this species (bible: "the home
 * biome(s)" — a fixed content fact, true the moment the species is met at
 * all). Lineage forms return an empty list — they carry rarity weight 0
 * and can never be in a pool (v1.3's standing rule); their page shows
 * "evolves from" instead (see `buildPipdexDetailModel`). */
export function homeBiomesOf(speciesId: string): readonly HomeBiomeModel[] {
  const out: HomeBiomeModel[] = [];
  for (const id of EXPEDITION_IDS) {
    const def = expeditions[id];
    if (def.eggSpecies?.includes(speciesId)) {
      out.push({ id, name: def.name, oddsPct: poolOddsPct(speciesId, id) });
    }
  }
  return out;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * "14 Mar 2026" from a Clock timestamp. Deterministic string slicing over
 * `isoStamp` (the one function `core/clock.ts` exports for exactly this —
 * spec §2 rule 2: this file never calls `new Date(` itself, so the
 * repo-wide grep for that stays at zero).
 */
export function formatCaughtDate(ts: number): string {
  const iso = isoStamp(ts);
  const year = iso.slice(0, 4);
  const monthIdx = Number(iso.slice(5, 7)) - 1;
  const day = Number(iso.slice(8, 10));
  return `${day} ${MONTHS[monthIdx] ?? "?"} ${year}`;
}

/** "Pipling" / "Adult" — the stage this individual was AT CATCH (frozen in
 * `firstPortrait`), not its stage today. */
function stageLabelAtCatch(stage: LifeStage): string {
  return stage === LifeStage.Pipling ? "a Pipling" : "an Adult";
}

/**
 * The hand-written found-line (bible §1.3.5): assembled from the source
 * expedition, the day, and whether this form was ever hatchable at all —
 * never a bare `foundIn: [...]` dump. Three honest shapes: hatched from an
 * egg (name the biome), grew into this shape (a lineage form — evolution
 * is earned, never hatched), or chose you on day one (the starter, the
 * only base-species catch with no source expedition).
 */
export function buildFoundLine(
  portrait: PipdexPortrait,
  caughtAt: number,
  isLineage: boolean,
): string {
  const date = formatCaughtDate(caughtAt);
  if (portrait.sourceExpeditionId !== null) {
    const place = expeditions[portrait.sourceExpeditionId as ExpeditionId]?.name;
    return place !== undefined
      ? `Came home from the ${place} in an egg — ${date}.`
      : `Came home in an egg — ${date}.`;
  }
  if (isLineage) {
    return `Grew into this shape through nothing but time and good care — ${date}.`;
  }
  return `Chose you, right at the very start — ${date}.`;
}

/** One genome snapshot worth drawing a portrait from — either a frozen
 * `firstPortrait.genome` (the Album) or a live Pip's `genome` (the Long
 * Meadow, via `sanctuary.ts`'s reuse of this module). */
export interface PortraitVisual {
  readonly speciesId: string;
  readonly paletteId: string;
  readonly pattern: string;
  readonly shiny: boolean;
}

export interface PipdexCardModel {
  readonly speciesId: string;
  readonly tier: PipdexTier;
  /** Null only for a Blank page — nothing has a name yet. */
  readonly displayName: string | null;
  readonly silhouette: Silhouette;
  /** Present only at Portrait tier. */
  readonly portraitVisual: PortraitVisual | null;
  readonly shinyBadge: boolean;
  /** Bible §1.4's "new" dot — `unreadEntryIds` as core hands it back,
   * unfiltered. The DOM shell reconciles this against a session-local
   * "already opened" set (core has no clearing action yet, and adding one
   * is outside this round's UI-only fence — see the module's tests). */
  readonly isNew: boolean;
}

export function buildPipdexCardModel(
  state: Pick<GameState, "pipdex">,
  speciesId: string,
): PipdexCardModel {
  const def = contentSpecies[speciesId] as SpeciesDef | undefined;
  const entry = state.pipdex.entries[speciesId];
  const tier = entryTier(entry);
  const portrait = entry?.firstPortrait ?? null;
  return {
    speciesId,
    tier,
    displayName: tier === "blank" ? null : (def?.name ?? speciesId),
    silhouette: def?.sprite.silhouette ?? "round",
    portraitVisual:
      tier === "portrait" && portrait !== null
        ? {
            speciesId,
            paletteId: portrait.genome.palette,
            pattern: portrait.genome.pattern,
            shiny: portrait.genome.shiny,
          }
        : null,
    shinyBadge: entry?.shinyCaughtAt != null,
    isNew: state.pipdex.unreadEntryIds.includes(speciesId),
  };
}

export interface PipdexOverviewModel {
  readonly totalForms: number;
  /** Species with SOME entry (Field note or Portrait) — bible §1.1's
   * "11 met, 3 pages still blank" framing. */
  readonly metCount: number;
  readonly blankCount: number;
  /** THE headline number (bible §1.2): forms actually caught. */
  readonly formsCaught: number;
  readonly albumTarget: number;
  readonly albumPct: number;
  /** The Grove Ledger — zero RNG, the long-haul target (bible §1.2). */
  readonly ledgerVariantsCaught: number;
  readonly ledgerTarget: number;
  readonly ledgerPct: number;
  /** Glimmers — deliberately no denominator (bible §1.2/§1.5). */
  readonly shiniesCaught: number;
  readonly cards: readonly PipdexCardModel[];
  /** FLAIR, earned (bible §4.3). Round 2C shipped 22 `kind: "flair"` rewards
   * against nothing that stored or drew them, so every long-haul target paid
   * literally nothing; these four fields are where they become visible. */
  readonly coverStamps: readonly FlairDef[];
  readonly ribbons: readonly FlairDef[];
  /** The one frame in force — the highest-ranked earned `pageFrame`. */
  readonly pageFrame: FlairDef | null;
  /** Flourishes that live somewhere else in the Keep (a Pip's title, a Long
   * Meadow gate sign) — listed here too so nothing earned is ever invisible,
   * with a line saying where it actually shows. */
  readonly elsewhereFlair: readonly FlairDef[];
}

export function buildPipdexOverviewModel(state: GameState): PipdexOverviewModel {
  const order = pipdexGridOrder(state);
  const completion = pipdexCompletion(
    state.pipdex,
    tuning.retention.pipdex.albumTarget,
    tuning.retention.pipdex.ledgerTarget,
  );
  const metCount = order.filter((id) => entryTier(state.pipdex.entries[id]) !== "blank").length;
  return {
    totalForms: order.length,
    metCount,
    blankCount: order.length - metCount,
    formsCaught: completion.formsCaught,
    albumTarget: completion.albumTarget,
    albumPct: completion.albumPct,
    ledgerVariantsCaught: completion.ledgerVariantsCaught,
    ledgerTarget: completion.ledgerTarget,
    ledgerPct: completion.ledgerPct,
    shiniesCaught: completion.shiniesCaught,
    cards: order.map((id) => buildPipdexCardModel(state, id)),
    coverStamps: earnedFlairOfKind(state.flair, "coverStamp"),
    ribbons: earnedFlairOfKind(state.flair, "ribbon"),
    pageFrame: activePageFrame(state.flair),
    elsewhereFlair: [
      ...earnedFlairOfKind(state.flair, "pipTitle"),
      ...earnedFlairOfKind(state.flair, "sanctuarySign"),
    ],
  };
}

export interface EvolutionLeafModel {
  readonly variantId: string;
  /** Null for the no-gift default leaf. */
  readonly foodId: string | null;
  readonly foodName: string | null;
  readonly witnessed: boolean;
  readonly witnessedAt: number | null;
}

/** The Grove Ledger ribbon for a BASE species' page (bible §1.3.6): two
 * gift leaves plus the default, in registry order, each captioned by the
 * food that causes it. Owning a base species' Portrait is a logical
 * prerequisite for ever witnessing one of its leaves (you cannot evolve a
 * Pip you never had), so this is only ever called for Portrait tier. */
function buildEvolutionRibbon(
  def: SpeciesDef,
  entry: PipdexEntry | undefined,
): readonly EvolutionLeafModel[] | null {
  const evo = def.evolution;
  if (evo === undefined) return null;
  const witnessed = entry?.variantsCaught ?? {};
  const leaves: EvolutionLeafModel[] = [];
  for (const [foodId, variantId] of Object.entries(evo.giftVariants)) {
    leaves.push({
      variantId,
      foodId,
      foodName: foods[foodId as keyof typeof foods]?.name ?? foodId,
      witnessed: witnessed[variantId] !== undefined,
      witnessedAt: witnessed[variantId] ?? null,
    });
  }
  leaves.push({
    variantId: evo.defaultVariantId,
    foodId: null,
    foodName: null,
    witnessed: witnessed[evo.defaultVariantId] !== undefined,
    witnessedAt: witnessed[evo.defaultVariantId] ?? null,
  });
  return leaves;
}

export interface PipdexDetailModel {
  readonly speciesId: string;
  readonly tier: Exclude<PipdexTier, "blank">;
  readonly speciesName: string;
  readonly silhouette: Silhouette;
  /** The individual's own name — Portrait tier only ("Mossy", not "Mosspip"). */
  readonly individualName: string | null;
  readonly personalityName: string | null;
  readonly stageLabel: string | null;
  /** The species' own voice (content/speciesLines.ts) — Field note reads
   * it keyed by species id (nobody specific yet); Portrait keys it by the
   * individual's own Pip id, per bible §1.3.6. */
  readonly speciesLine: string | null;
  readonly foundLine: string | null;
  readonly caughtDateLabel: string | null;
  readonly shiny: boolean;
  readonly portraitVisual: PortraitVisual | null;
  readonly homeBiomes: readonly HomeBiomeModel[];
  readonly isLineage: boolean;
  /** For a lineage form: the base species' display name. */
  readonly evolvesFrom: string | null;
  /** For a base species with an evolution target: its display name. */
  readonly evolvesInto: string | null;
  /** The Grove Ledger ribbon — only for a caught BASE species. */
  readonly evolutionRibbon: readonly EvolutionLeafModel[] | null;
}

/** Null for a Blank page (there is nothing yet to open) or an unknown id. */
export function buildPipdexDetailModel(
  state: GameState,
  speciesId: string,
): PipdexDetailModel | null {
  const def = contentSpecies[speciesId] as SpeciesDef | undefined;
  if (def === undefined) return null;
  const entry = state.pipdex.entries[speciesId];
  const tier = entryTier(entry);
  if (tier === "blank") return null;

  const portrait = entry?.firstPortrait ?? null;
  const isLineage = def.rarity === "lineage";
  const baseDef =
    isLineage
      ? Object.values(contentSpecies).find(
          (s) => s.evolution?.targetSpeciesId === speciesId,
        )
      : undefined;
  const lineKey = portrait?.pipId ?? speciesId;

  return {
    speciesId,
    tier,
    speciesName: def.name,
    silhouette: def.sprite.silhouette ?? "round",
    individualName: tier === "portrait" ? (portrait?.name ?? null) : null,
    personalityName:
      tier === "portrait" && portrait !== null
        ? (personalities[portrait.personalityId as PersonalityId]?.name ??
          portrait.personalityId)
        : null,
    stageLabel:
      tier === "portrait" && portrait !== null
        ? stageLabelAtCatch(portrait.lifeStageAtCatch)
        : null,
    speciesLine: pickSpeciesLine(speciesId, lineKey),
    foundLine:
      tier === "portrait" && portrait !== null && entry?.caughtAt != null
        ? buildFoundLine(portrait, entry.caughtAt, isLineage)
        : null,
    caughtDateLabel:
      tier === "portrait" && entry?.caughtAt != null
        ? formatCaughtDate(entry.caughtAt)
        : null,
    shiny: entry?.shinyCaughtAt != null,
    portraitVisual:
      tier === "portrait" && portrait !== null
        ? {
            speciesId,
            paletteId: portrait.genome.palette,
            pattern: portrait.genome.pattern,
            shiny: portrait.genome.shiny,
          }
        : null,
    homeBiomes: homeBiomesOf(speciesId),
    isLineage,
    evolvesFrom: baseDef?.name ?? null,
    evolvesInto:
      def.evolution !== undefined
        ? (contentSpecies[def.evolution.targetSpeciesId]?.name ??
          def.evolution.targetSpeciesId)
        : null,
    evolutionRibbon:
      tier === "portrait" ? buildEvolutionRibbon(def, entry) : null,
  };
}

// ---------------------------------------------------------------------------
// DOM shell — silhouette-aware procedural portrait (bible §1.3.3/§9.19)
// ---------------------------------------------------------------------------

/** Mirrors `render/spriteResolver.ts`'s `SILHOUETTES` table (content-bible
 * §1.4) so the Album's flat DOM portraits read as the same five body
 * shapes the Pixi renderer draws in the Keep — the whole point of a
 * silhouette axis is "identifiable at a glance", which a scrapbook full of
 * identical rounded blobs would quietly defeat. Duplicated locally rather
 * than imported (same call `focusView.ts`/`topBar.ts` already make for
 * their own small local constants — a five-row content table is cheaper
 * to keep in sync by comment than to add a cross-module dependency for). */
const SILHOUETTE_FRACTIONS: Readonly<Record<Silhouette, { w: number; h: number }>> = {
  round: { w: 1.0, h: 1.0 },
  chunky: { w: 1.0, h: 0.82 },
  wide: { w: 1.0, h: 0.72 },
  tall: { w: 0.8, h: 1.0 },
  tiny: { w: 0.78, h: 0.76 },
};

type PatternKind = "none" | "dots" | "swirl" | "banded" | "ripple" | "fleck";

/** Same fallback spirit as `spriteResolver.ts`'s `patternKind` (an unknown
 * or CSS-hard pattern id still renders as SOMETHING, never nothing) —
 * ember/flake/puff/glowdot collapse to one shared "fleck" treatment here
 * rather than four bespoke CSS recipes; the Pixi Keep is where their full
 * detail lives. */
function domPatternKind(patternId: string): PatternKind {
  switch (patternId) {
    case "plain":
      return "none";
    case "speckled":
    case "dots":
      return "dots";
    case "swirl":
      return "swirl";
    case "banded":
      return "banded";
    case "ripple":
      return "ripple";
    default:
      return "fleck";
  }
}

/** The full procedural portrait — Portrait tier only. `size` picks the box
 * (grid thumbnail vs. the big detail-page portrait); the shape inside it
 * follows the species' silhouette exactly as the Keep does. */
export function buildPortraitEl(
  visual: PortraitVisual,
  size: "small" | "large",
): HTMLElement {
  const def = contentSpecies[visual.speciesId] as SpeciesDef | undefined;
  const silhouette = def?.sprite.silhouette ?? "round";
  const fractions = SILHOUETTE_FRACTIONS[silhouette];
  const palette = resolvePipPalette(visual.speciesId, visual.paletteId);

  const el = document.createElement("div");
  el.className = `pk-pipdex-portrait pk-pipdex-portrait--${size}`;
  el.style.setProperty("--pk-wfrac", String(fractions.w));
  el.style.setProperty("--pk-hfrac", String(fractions.h));

  const blob = document.createElement("div");
  blob.className = `pk-pipdex-blob pk-pipdex-blob--pattern-${domPatternKind(visual.pattern)}`;
  blob.style.setProperty("--pk-body", palette.body);
  blob.style.setProperty("--pk-belly", palette.belly);
  blob.style.setProperty("--pk-pattern", palette.pattern);
  blob.style.setProperty("--pk-outline", palette.outline);
  blob.style.setProperty("--pk-blush", palette.blush);
  blob.style.setProperty("--pk-accent", palette.accent);

  const belly = document.createElement("div");
  belly.className = "pk-pipdex-belly";
  const eyes = document.createElement("div");
  eyes.className = "pk-pipdex-eyes";
  eyes.append(document.createElement("i"), document.createElement("i"));
  const blushL = document.createElement("span");
  blushL.className = "pk-pipdex-blush pk-pipdex-blush--l";
  const blushR = document.createElement("span");
  blushR.className = "pk-pipdex-blush pk-pipdex-blush--r";
  blob.append(belly, eyes, blushL, blushR);

  if (visual.shiny) {
    const shine = document.createElement("div");
    shine.className = "pk-pipdex-shine";
    blob.appendChild(shine);
  }

  el.appendChild(blob);
  return el;
}

/** Field note tier: the SAME silhouette shape, unfilled — a flat neutral
 * fill and no face, so it reads as "a shape you'd recognise" rather than
 * "a Pip you've met" (bible §1.1: no portrait, no genome revealed). */
export function buildSilhouetteEl(
  silhouette: Silhouette,
  size: "small" | "large",
): HTMLElement {
  const fractions = SILHOUETTE_FRACTIONS[silhouette];
  const el = document.createElement("div");
  el.className = `pk-pipdex-portrait pk-pipdex-portrait--${size}`;
  el.style.setProperty("--pk-wfrac", String(fractions.w));
  el.style.setProperty("--pk-hfrac", String(fractions.h));
  const blob = document.createElement("div");
  blob.className = "pk-pipdex-blob pk-pipdex-blob--silhouette";
  el.appendChild(blob);
  return el;
}

/** Blank page: the paper, nothing else (bible §1.1 — never a teasing
 * shape, never a name, just "the paper"). */
export function buildBlankPlaceholderEl(size: "small" | "large"): HTMLElement {
  const el = document.createElement("div");
  el.className = `pk-pipdex-portrait pk-pipdex-portrait--${size} pk-pipdex-portrait--blank`;
  const paper = document.createElement("div");
  paper.className = "pk-pipdex-blank-paper";
  el.appendChild(paper);
  return el;
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

export interface PipdexViewDeps {
  getState(): GameState;
}

export interface PipdexView {
  readonly el: HTMLElement;
  /** Opens on the grid (or wherever it was left — repeat opens keep the
   * player's place in the scrapbook rather than snapping back to page 1). */
  open(): void;
  /** Opens straight to one species' page (a toast/Doorstep deep link seam
   * for the integrate stage — e.g. "New page: Snowpip!"). */
  openDetail(speciesId: string): void;
  close(): void;
  readonly isOpen: boolean;
  sync(state: GameState): void;
}

export function createPipdexView(deps: PipdexViewDeps): PipdexView {
  const el = document.createElement("div");
  el.className = "pk-pipdex-wrap";

  const backdrop = document.createElement("div");
  backdrop.className = "pk-pipdex-backdrop";

  const panel = document.createElement("div");
  panel.className = "pk-pipdex";
  el.append(backdrop, panel);

  let isOpen = false;
  let mode: "grid" | "detail" = "grid";
  let detailSpeciesId: string | null = null;
  let lastState: GameState | null = null;
  // Session-local "already opened" set (module doc: core has no action to
  // clear `unreadEntryIds` yet, so the "new" dot is approximated here —
  // opening a page during THIS session retires its dot; a fresh load
  // shows every core-unread id once more, which is a harmless, honest
  // degrade rather than a stuck-forever dot).
  const openedThisSession = new Set<string>();

  const close = (): void => {
    isOpen = false;
    el.classList.remove("pk-pipdex-wrap--open");
  };
  backdrop.addEventListener("click", close);

  const showDetail = (speciesId: string): void => {
    mode = "detail";
    detailSpeciesId = speciesId;
    openedThisSession.add(speciesId);
    if (lastState !== null) render(lastState);
  };

  const showGrid = (): void => {
    mode = "grid";
    detailSpeciesId = null;
    if (lastState !== null) render(lastState);
  };

  function renderHeader(model: PipdexOverviewModel): HTMLElement {
    const header = document.createElement("div");
    header.className = "pk-pipdex-header";

    const title = document.createElement("div");
    title.className = "pk-pipdex-title";
    title.textContent = "The Album";

    const warmLine = document.createElement("div");
    warmLine.className = "pk-pipdex-warmline";
    warmLine.textContent =
      model.formsCaught === 0
        ? "Nobody's page is filled in yet — the Keep is waiting to introduce you."
        : model.formsCaught >= model.albumTarget
          ? "Every page filled in. The whole set, gathered with care."
          : `${model.formsCaught} of ${model.albumTarget} pages filled in.`;

    const stats = document.createElement("div");
    stats.className = "pk-pipdex-stats";

    const metStat = document.createElement("div");
    metStat.className = "pk-pipdex-stat";
    metStat.textContent =
      model.blankCount === 0
        ? `All ${model.totalForms} met.`
        : `${model.metCount} met · ${model.blankCount} page${model.blankCount === 1 ? "" : "s"} still blank`;

    const ledgerStat = document.createElement("div");
    ledgerStat.className = "pk-pipdex-stat";
    ledgerStat.textContent = `Grove Ledger: ${model.ledgerVariantsCaught} / ${model.ledgerTarget} gift leaves witnessed`;

    const shinyStat = document.createElement("div");
    shinyStat.className = "pk-pipdex-stat pk-pipdex-stat--shiny";
    shinyStat.textContent =
      model.shiniesCaught > 0
        ? `✨ ${model.shiniesCaught} glimmer${model.shiniesCaught === 1 ? "" : "s"} found`
        : "✨ No glimmers yet — they're rare, and lovely.";

    stats.append(metStat, ledgerStat, shinyStat);
    header.append(title, warmLine, stats);

    // FLAIR on the cover (bible §4.3). Stamps are pressed into the cover,
    // ribbons are tied along it, the frame is named, and anything that lives
    // elsewhere in the Keep still gets a line here — because a flourish the
    // player earned and cannot find is the bug this whole section fixes.
    if (model.coverStamps.length > 0) {
      const strip = document.createElement("div");
      strip.className = "pk-pipdex-stamps";
      for (const def of model.coverStamps) {
        const stamp = document.createElement("span");
        stamp.className = "pk-pipdex-stamp";
        stamp.title = `${def.name} — ${def.note}`;
        stamp.setAttribute("aria-label", `${def.name}. ${def.note}`);
        const glyph = document.createElement("span");
        glyph.className = "pk-pipdex-stamp-glyph";
        glyph.textContent = def.glyph;
        glyph.setAttribute("aria-hidden", "true");
        const name = document.createElement("span");
        name.className = "pk-pipdex-stamp-name";
        name.textContent = def.name;
        stamp.append(glyph, name);
        strip.appendChild(stamp);
      }
      header.appendChild(strip);
    }

    for (const def of model.ribbons) {
      const ribbon = document.createElement("div");
      ribbon.className = "pk-pipdex-cover-ribbon";
      ribbon.textContent = `${def.glyph} ${def.name} — ${def.note}`;
      header.appendChild(ribbon);
    }

    if (model.pageFrame !== null) {
      const frameNote = document.createElement("div");
      frameNote.className = "pk-pipdex-frame-note";
      frameNote.textContent = `${model.pageFrame.glyph} Pages framed with the ${model.pageFrame.name}. ${model.pageFrame.note}`;
      header.appendChild(frameNote);
    }

    if (model.elsewhereFlair.length > 0) {
      const note = document.createElement("div");
      note.className = "pk-pipdex-frame-note";
      note.textContent = `Also earned, and showing elsewhere: ${model.elsewhereFlair
        .map((f) => `${f.glyph} ${f.name}`)
        .join(" · ")}.`;
      header.appendChild(note);
    }

    return header;
  }

  /**
   * The index, as a BOOK rather than a checklist (bible §1.3.2: "Two pages
   * per spread, portrait-sized. Never a 14-cell grid — a grid is a
   * checklist"). Round 2C shipped exactly the grid that clause names by
   * name; this is the shape the bible asked for:
   *
   * - two portrait-shaped pages per spread, with a binding down the middle;
   * - sequential page numbers, so the Album reads as a diary you are part
   *   way through rather than a set you are N/14 of the way through;
   * - discovery order preserved (`pipdexGridOrder`), blank pages just blank
   *   paper — no teasing shape, no denominator anywhere on the page.
   *
   * §14 risk 19: the six §1.3 choices "are not optional decoration — they
   * ARE the feature", so this is not a styling preference.
   */
  function renderIndex(state: GameState): HTMLElement {
    const model = buildPipdexOverviewModel(state);
    const wrap = document.createElement("div");
    wrap.append(renderHeader(model));

    const book = document.createElement("div");
    book.className = "pk-pipdex-book";
    if (model.pageFrame !== null) {
      book.classList.add("pk-pipdex-book--framed");
    }

    const pageEl = (card: PipdexCardModel, pageNumber: number): HTMLElement => {
      const page = document.createElement(card.tier === "blank" ? "div" : "button");
      page.className = `pk-pipdex-page pk-pipdex-page--${card.tier}`;
      if (card.tier !== "blank" && page instanceof HTMLButtonElement) {
        page.type = "button";
        page.addEventListener("click", () => {
          sound("ui.tap");
          showDetail(card.speciesId);
        });
      }

      if (card.tier === "portrait" && card.portraitVisual !== null) {
        page.appendChild(buildPortraitEl(card.portraitVisual, "small"));
      } else if (card.tier === "field-note") {
        page.appendChild(buildSilhouetteEl(card.silhouette, "small"));
      } else {
        page.appendChild(buildBlankPlaceholderEl("small"));
      }

      if (card.displayName !== null) {
        const name = document.createElement("div");
        name.className = "pk-pipdex-page-name";
        name.textContent = card.displayName;
        page.appendChild(name);
      }

      if (card.tier === "field-note") {
        const hint = document.createElement("div");
        hint.className = "pk-pipdex-page-hint";
        hint.textContent = "Field note";
        page.appendChild(hint);
      }

      if (card.shinyBadge) {
        const badge = document.createElement("span");
        badge.className = "pk-pipdex-badge pk-pipdex-badge--shiny";
        badge.textContent = "✨";
        badge.title = "A glimmer of this one has been seen";
        page.appendChild(badge);
      }

      if (card.isNew && !openedThisSession.has(card.speciesId)) {
        const dot = document.createElement("span");
        dot.className = "pk-pipdex-new-dot";
        dot.setAttribute("aria-hidden", "true");
        page.appendChild(dot);
      }

      const folio = document.createElement("span");
      folio.className = "pk-pipdex-folio";
      folio.textContent = String(pageNumber);
      folio.setAttribute("aria-hidden", "true");
      page.appendChild(folio);

      if (card.tier === "blank") {
        page.setAttribute("aria-hidden", "true");
      } else {
        page.setAttribute(
          "aria-label",
          `${card.displayName ?? "Unknown"}${card.tier === "field-note" ? " — field note" : ""}`,
        );
      }
      return page;
    };

    for (let i = 0; i < model.cards.length; i += 2) {
      const spread = document.createElement("div");
      spread.className = "pk-pipdex-spread";
      const left = model.cards[i];
      const right = model.cards[i + 1];
      if (left !== undefined) spread.appendChild(pageEl(left, i + 1));
      const binding = document.createElement("div");
      binding.className = "pk-pipdex-binding";
      binding.setAttribute("aria-hidden", "true");
      spread.appendChild(binding);
      if (right !== undefined) spread.appendChild(pageEl(right, i + 2));
      book.appendChild(spread);
    }

    wrap.appendChild(book);
    return wrap;
  }

  function renderRibbon(ribbon: readonly EvolutionLeafModel[]): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "pk-pipdex-ribbon";
    const label = document.createElement("div");
    label.className = "pk-pipdex-ribbon-label";
    label.textContent = "The Grove Ledger";
    wrap.appendChild(label);

    const leaves = document.createElement("div");
    leaves.className = "pk-pipdex-leaves";
    for (const leaf of ribbon) {
      const leafEl = document.createElement("div");
      leafEl.className = `pk-pipdex-leaf ${leaf.witnessed ? "pk-pipdex-leaf--witnessed" : "pk-pipdex-leaf--dim"}`;
      const caption = document.createElement("span");
      caption.className = "pk-pipdex-leaf-caption";
      if (leaf.foodId === null) {
        caption.textContent = leaf.witnessed ? `Raised with love → ${leaf.variantId}` : "Raised with no gift → ?";
      } else {
        caption.textContent = leaf.witnessed
          ? `${leaf.foodName} → ${leaf.variantId}`
          : `${leaf.foodName} → ?`;
      }
      leafEl.appendChild(caption);
      leaves.appendChild(leafEl);
    }
    wrap.appendChild(leaves);
    return wrap;
  }

  function renderDetail(state: GameState, speciesId: string): HTMLElement {
    const model = buildPipdexDetailModel(state, speciesId);
    const wrap = document.createElement("div");
    wrap.className = "pk-pipdex-detail";
    if (model === null) {
      const empty = document.createElement("div");
      empty.className = "pk-pipdex-warmline";
      empty.textContent = "This page hasn't been written yet.";
      wrap.appendChild(empty);
      return wrap;
    }

    const portraitBox = document.createElement("div");
    portraitBox.className = "pk-pipdex-detail-portrait";
    portraitBox.appendChild(
      model.tier === "portrait" && model.portraitVisual !== null
        ? buildPortraitEl(model.portraitVisual, "large")
        : buildSilhouetteEl(model.silhouette, "large"),
    );
    if (model.shiny) {
      const badge = document.createElement("span");
      badge.className = "pk-pipdex-badge pk-pipdex-badge--shiny pk-pipdex-badge--corner";
      badge.textContent = "✨ glimmer";
      portraitBox.appendChild(badge);
    }
    wrap.appendChild(portraitBox);

    const heading = document.createElement("div");
    heading.className = "pk-pipdex-detail-heading";
    heading.textContent =
      model.individualName !== null
        ? `${model.individualName} — ${model.speciesName}`
        : model.speciesName;
    wrap.appendChild(heading);

    if (model.personalityName !== null) {
      const sub = document.createElement("div");
      sub.className = "pk-pipdex-detail-sub";
      sub.textContent = `${model.personalityName}${model.stageLabel !== null ? ` · caught as ${model.stageLabel}` : ""}`;
      wrap.appendChild(sub);
    } else {
      const sub = document.createElement("div");
      sub.className = "pk-pipdex-detail-sub";
      sub.textContent = "Field note — met, not yet caught";
      wrap.appendChild(sub);
    }

    if (model.speciesLine !== null) {
      const line = document.createElement("div");
      line.className = "pk-pipdex-detail-line";
      line.textContent = model.speciesLine;
      wrap.appendChild(line);
    }

    if (model.foundLine !== null) {
      const found = document.createElement("div");
      found.className = "pk-pipdex-detail-found";
      found.textContent = model.foundLine;
      wrap.appendChild(found);
    }

    const biomesLine = document.createElement("div");
    biomesLine.className = "pk-pipdex-detail-biomes";
    if (model.isLineage) {
      biomesLine.textContent =
        model.evolvesFrom !== null
          ? `Only reached by evolution, from ${model.evolvesFrom}.`
          : "Only reached by evolution.";
    } else if (model.homeBiomes.length > 0) {
      biomesLine.textContent = `Found at: ${model.homeBiomes
        .map((b) => (b.oddsPct !== null ? `${b.name} (${Math.round(b.oddsPct)}%)` : b.name))
        .join(", ")}`;
    } else {
      biomesLine.textContent = "Arrived some other way.";
    }
    wrap.appendChild(biomesLine);

    if (model.evolvesInto !== null && !model.isLineage) {
      const evo = document.createElement("div");
      evo.className = "pk-pipdex-detail-evolves";
      evo.textContent = `Grows, in time and with care, into ${model.evolvesInto}.`;
      wrap.appendChild(evo);
    }

    if (model.caughtDateLabel !== null) {
      const date = document.createElement("div");
      date.className = "pk-pipdex-detail-date";
      date.textContent = `First met: ${model.caughtDateLabel}`;
      wrap.appendChild(date);
    }

    if (model.evolutionRibbon !== null) {
      wrap.appendChild(renderRibbon(model.evolutionRibbon));
    }

    return wrap;
  }

  function render(state: GameState): void {
    panel.replaceChildren();

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pk-pipdex-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close the Album";
    closeBtn.setAttribute("aria-label", "Close the Album");
    closeBtn.addEventListener("click", () => {
      sound("ui.tap");
      close();
    });
    panel.appendChild(closeBtn);

    if (mode === "detail" && detailSpeciesId !== null) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "pk-pipdex-back";
      back.textContent = "‹ Back to the Album";
      back.addEventListener("click", () => {
        sound("ui.tap");
        showGrid();
      });
      panel.appendChild(back);
      panel.appendChild(renderDetail(state, detailSpeciesId));
    } else {
      panel.appendChild(renderIndex(state));
    }
  }

  return {
    el,

    get isOpen(): boolean {
      return isOpen;
    },

    open(): void {
      lastState = deps.getState();
      isOpen = true;
      sound("ui.sheet");
      render(lastState);
      el.classList.add("pk-pipdex-wrap--open");
    },

    openDetail(speciesId: string): void {
      lastState = deps.getState();
      isOpen = true;
      mode = "detail";
      detailSpeciesId = speciesId;
      openedThisSession.add(speciesId);
      sound("ui.sheet");
      render(lastState);
      el.classList.add("pk-pipdex-wrap--open");
    },

    close,

    sync(state: GameState): void {
      const prev = lastState;
      lastState = state;
      if (!isOpen) return;
      if (prev !== state) render(state);
    },
  };
}
