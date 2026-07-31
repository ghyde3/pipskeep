/**
 * Pip GEOMETRY — the pure half of the placeholder standard (spec §11):
 * the fixed sprite box, the five silhouettes, and the per-individual
 * jitter. No Pixi, no DOM, no clock, no `Math.random()`.
 *
 * WHY THIS IS ITS OWN FILE (round 2D fix stage): `render/spriteResolver.ts`
 * imports `pixi.js`, which touches `navigator` at MODULE-EVALUATION time,
 * so importing anything from it drags a browser dependency into every
 * consumer — and the round's fix needs the silhouette table and the
 * jitter on the DOM portrait surfaces (`ui/pipdex.ts`, `ui/focusView.ts`,
 * `ui/topBar.ts`), which run under vitest's `node` environment. Splitting
 * the pure geometry out is what lets those surfaces share ONE table and
 * ONE jitter function with the Keep instead of hand-copying them — which
 * is exactly the divergence this round exists to end.
 *
 * `render/spriteResolver.ts` re-exports everything here, so every existing
 * import site is unchanged.
 */

import { fnv1a } from "../core/rng";
import { species as contentSpecies } from "../content/species";
import type { SpeciesId } from "../content/species";

/** Piplings render at 0.7 scale (spec task/§11 placeholder standard). */
export const PIPLING_SCALE = 0.7;

/** Body metrics (view-local px, adult scale). Exported for scene layout.
 * THE TAP-HIT / SELECTION-RING / SHADOW / PARTICLE-BOX CONTRACT — not
 * per-species. Silhouettes (below) vary the drawn shape inside this box;
 * they never exceed it (content-bible §1.4). */
export const PIP_BODY_WIDTH = 118;
export const PIP_BODY_HEIGHT = 98;

export type Silhouette = "round" | "chunky" | "wide" | "tall" | "tiny";

/** Per-silhouette body metrics (content-bible §1.4's table). `wFrac`/
 * `hFrac` are fractions of PIP_BODY_WIDTH/HEIGHT; `cornerFrac` is the
 * roundRect corner radius as a fraction of the silhouette's own width;
 * `shadowScale` and `eyeScale` are extra multipliers layered on top.
 * "round" reproduces today's drawing exactly (wFrac/hFrac/shadowScale/
 * eyeScale all 1, cornerFrac 0.46 — the pre-expansion literal). */
export interface SilhouetteMetrics {
  readonly wFrac: number;
  readonly hFrac: number;
  readonly cornerFrac: number;
  readonly shadowScale: number;
  readonly eyeScale: number;
}

const SILHOUETTES: Readonly<Record<Silhouette, SilhouetteMetrics>> = {
  round: { wFrac: 1.0, hFrac: 1.0, cornerFrac: 0.46, shadowScale: 1.0, eyeScale: 1.0 },
  // "Reads as heavy": full width, squashed height, blockier corners, a
  // slightly wider shadow to sell the weight.
  chunky: { wFrac: 1.0, hFrac: 0.82, cornerFrac: 0.34, shadowScale: 1.12, eyeScale: 1.0 },
  // "Reads as limpet": very low flattened dome, flat base.
  wide: { wFrac: 1.0, hFrac: 0.72, cornerFrac: 0.5, shadowScale: 1.05, eyeScale: 1.0 },
  // "Reads as wispy": narrower base, full height, narrower shadow.
  tall: { wFrac: 0.8, hFrac: 1.0, cornerFrac: 0.5, shadowScale: 0.85, eyeScale: 1.0 },
  // "Reads as baby-brained": small round body, deliberately oversized eyes.
  tiny: { wFrac: 0.78, hFrac: 0.76, cornerFrac: 0.5, shadowScale: 0.8, eyeScale: 1.15 },
};

/**
 * The width/height fractions of `SILHOUETTES` above, exported for the DOM
 * portrait surfaces (`ui/pipdex.ts`, `ui/focusView.ts`, `ui/topBar.ts`)
 * so the flat portraits read as the SAME five body shapes the Keep draws.
 *
 * ROUND 2D FIX STAGE: `ui/pipdex.ts` used to keep its own hand-copied
 * table with a comment arguing a cross-module dependency wasn't worth it
 * for five rows. That was defensible while there was one DOM portrait;
 * this round needed the table on three surfaces, and "the Album honours
 * the silhouette, the starter pick screen doesn't" was one of the round's
 * own findings. One table, derived — a silhouette added here cannot be
 * forgotten anywhere.
 */
export const SILHOUETTE_FRACTIONS: Readonly<
  Record<Silhouette, { readonly w: number; readonly h: number }>
> = Object.fromEntries(
  Object.entries(SILHOUETTES).map(([id, m]) => [id, { w: m.wFrac, h: m.hFrac }]),
) as Readonly<Record<Silhouette, { readonly w: number; readonly h: number }>>;

/** This species' silhouette, content-driven (absent → "round", so Mosspip/
 * Grovepip and any species that never sets the field are unaffected). */
export function resolveSilhouette(speciesId: SpeciesId): Silhouette {
  return contentSpecies[speciesId]?.sprite.silhouette ?? "round";
}

/** The full metric row for a silhouette (the Pixi resolver needs
 * `cornerFrac`/`shadowScale`/`eyeScale` too, not just the fractions). */
export function silhouetteMetrics(silhouette: Silhouette): SilhouetteMetrics {
  return SILHOUETTES[silhouette];
}

/**
 * ROUND 2D item 4 — PER-INDIVIDUAL JITTER.
 *
 * Every field here is a small, BOUNDED delta, never an absolute value, so
 * applying it is always "nudge the existing drawing", never "redesign the
 * shape". Two different safety strategies, chosen per field:
 *
 * - `bodyShrink{W,H}` are SHRINK-ONLY (range [0, JITTER_MAX_BODY_SHRINK]).
 *   "round" (and "chunky"/"wide", which are full-width) already draw at
 *   `wFrac = 1.0` — i.e. the silhouette ALREADY fills `PIP_BODY_WIDTH`
 *   exactly — so any GROWTH would immediately break the fixed-box
 *   contract this module's doc calls out. Shrinking can never do that:
 *   the box is defined as the maximum, and multiplying by a factor in
 *   [1 − JITTER_MAX_BODY_SHRINK, 1] can only move a silhouette closer to
 *   its own center.
 * - Every other field is a tiny pixel offset (≤ `JITTER_MAX_EYE_PX` /
 *   `JITTER_MAX_MARK_PX`), small enough that even added atop the
 *   SMALLEST silhouette's already-small margins it cannot push drawn
 *   geometry outside the box — proven numerically (not by eye, per the
 *   round's own instruction) in `spriteResolver.test.ts`.
 */
export interface Jitter {
  /** Fraction shaved off the drawn body WIDTH, [0, JITTER_MAX_BODY_SHRINK]. */
  readonly bodyShrinkW: number;
  /** Fraction shaved off the drawn body HEIGHT, [0, JITTER_MAX_BODY_SHRINK]. */
  readonly bodyShrinkH: number;
  /** Added to (and subtracted from) each eye's x-offset symmetrically —
   * widens or narrows the gap between the eyes, px. */
  readonly eyeSpacingPx: number;
  /** Per-eye horizontal radius delta, px ("shape"). */
  readonly eyeRadiusXPx: number;
  /** Per-eye vertical radius delta, px ("shape"). */
  readonly eyeRadiusYPx: number;
  /** Vertical offset of the whole eye row, px. */
  readonly eyeRowYPx: number;
  /** Pattern-overlay content offset (marking placement), px. */
  readonly markingDxPx: number;
  readonly markingDyPx: number;
}

/**
 * See `Jitter`'s doc: the hard ceiling that keeps body-proportion jitter
 * shrink-only-and-safe for every silhouette, "round" (wFrac = hFrac = 1.0,
 * already filling the box) included.
 *
 * ROUND 2D FIX STAGE — raised 0.06 → 0.08. The shipped budget was
 * measured as invisible in practice: at Keep scale the 118-px design box
 * renders about 46 CSS px wide, so a 6 % shrink is ~2.7 px and the whole
 * eye budget was under one CSS pixel. Two changes fix that together —
 * a slightly larger budget here, and (the bigger half) applying jitter on
 * the DOM portrait surfaces too, which draw the same box at 58-112 px
 * instead of 46. See `jitterStyleVars`.
 */
export const JITTER_MAX_BODY_SHRINK = 0.08;
/**
 * Half-ranges (px, in design-box units) for the three eye-geometry axes,
 * SEPARATE because they are not interchangeable: the gap between the eyes
 * tolerates a much larger nudge than the radius does before a Pip stops
 * reading as its own species. Their sum is what the box-containment
 * arithmetic below (and `spriteResolver.test.ts`) has to clear on the
 * narrowest silhouette, so they are tuned as a group.
 */
export const JITTER_MAX_EYE_SPACING_PX = 3;
export const JITTER_MAX_EYE_RADIUS_PX = 1.8;
export const JITTER_MAX_EYE_ROW_PX = 3;
/** Half-range (px) for the marking-placement offset. Deliberately small:
 * the pattern mask deliberately does NOT move with the overlay, so an
 * offset larger than each pattern's own edge margin slides the marking
 * out of the mask and the pattern vanishes entirely (round 2E's exact
 * "missing pattern overlay" bug). Pinned to a literal in
 * `spriteResolver.test.ts` for that reason. */
export const JITTER_MAX_MARK_PX = 3;

/** Un-jittered eye geometry (design-box px) — the literals the eye draw
 * below starts from, named so the jitter ranges above and the DOM
 * surfaces' unitless scale factors can be derived from the same numbers
 * instead of re-typing them. */
export const BASE_EYE_GAP_PX = 21;
export const BASE_EYE_RADIUS_PX = 9.5;

/**
 * A 32-bit avalanche finalizer (the well-known `lowbias32` constants).
 *
 * ROUND 2D FIX STAGE — this is a correctness fix, not a flourish. FNV-1a's
 * last step is `hash ^= byte; hash *= prime`, so two salts differing only
 * in their FINAL character produce hashes differing by exactly one
 * multiple of the prime: `fnv1a("…erx")` and `fnv1a("…ery")` differed by
 * 16777619, i.e. by exactly 1/256 of the 32-bit range. Measured over 200
 * Pip ids, that made `eyeRadiusX` and `eyeRadiusY` differ by 0.0039 —
 * min AND max — so the eyes only ever scaled UNIFORMLY and the "eye
 * shape" variation this round promised could not occur; likewise
 * markings only ever shifted on the 45° diagonal, and body height was a
 * fixed function of body width. Two of the four advertised jitter axes
 * were mathematically dead. Running the hash through a finalizer (and
 * keying fields by an integer rather than a near-identical string)
 * decorrelates them completely.
 */
function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Distinct jitter axes, as integers — see `mix32`'s doc for why these
 * are not strings any more. */
const enum JitterField {
  BodyW = 0,
  BodyH = 1,
  EyeSpacing = 2,
  EyeRadiusX = 3,
  EyeRadiusY = 4,
  EyeRowY = 5,
  MarkingDx = 6,
  MarkingDy = 7,
}

/** `fnv1a` (core/rng.ts) + an avalanche finalizer, as a stable [0, 1)
 * unit-interval draw for a given (seed, field) pair — the render-local
 * "no Math.random() outside core/rng.ts" pattern render/keepScene.ts and
 * render/particles.ts already use, just parameterized per named quantity
 * instead of per index. Pure: same inputs, same output, forever (no
 * stream, no cursor, no GameState footprint — this never advances
 * anything gameplay reads). */
function jitterUnit(seed: string, field: JitterField): number {
  const base = fnv1a(`jitter:${seed}`);
  return mix32(base ^ Math.imul(field + 1, 0x9e3779b9)) / 4294967296;
}

/** `min + unit(seed, field) * (max - min)`, i.e. one named jitter draw. */
function jitterRange(
  seed: string,
  field: JitterField,
  min: number,
  max: number,
): number {
  return min + jitterUnit(seed, field) * (max - min);
}

/**
 * Deterministic per-individual jitter from a stable string seed (a Pip id
 * when the caller has a live Pip; the genome's own fields otherwise — see
 * `resolvePipSprite`'s `jitterSeed` param doc). Same seed → byte-identical
 * `Jitter` forever; different seeds are independent draws per field, and
 * (since the fix stage) so are the FIELDS of a single seed — see `mix32`.
 */
export function computeJitter(seed: string): Jitter {
  return {
    bodyShrinkW: jitterRange(seed, JitterField.BodyW, 0, JITTER_MAX_BODY_SHRINK),
    bodyShrinkH: jitterRange(seed, JitterField.BodyH, 0, JITTER_MAX_BODY_SHRINK),
    eyeSpacingPx: jitterRange(
      seed,
      JitterField.EyeSpacing,
      -JITTER_MAX_EYE_SPACING_PX,
      JITTER_MAX_EYE_SPACING_PX,
    ),
    eyeRadiusXPx: jitterRange(
      seed,
      JitterField.EyeRadiusX,
      -JITTER_MAX_EYE_RADIUS_PX,
      JITTER_MAX_EYE_RADIUS_PX,
    ),
    eyeRadiusYPx: jitterRange(
      seed,
      JitterField.EyeRadiusY,
      -JITTER_MAX_EYE_RADIUS_PX,
      JITTER_MAX_EYE_RADIUS_PX,
    ),
    eyeRowYPx: jitterRange(
      seed,
      JitterField.EyeRowY,
      -JITTER_MAX_EYE_ROW_PX,
      JITTER_MAX_EYE_ROW_PX,
    ),
    markingDxPx: jitterRange(
      seed,
      JitterField.MarkingDx,
      -JITTER_MAX_MARK_PX,
      JITTER_MAX_MARK_PX,
    ),
    markingDyPx: jitterRange(
      seed,
      JitterField.MarkingDy,
      -JITTER_MAX_MARK_PX,
      JITTER_MAX_MARK_PX,
    ),
  };
}

/**
 * ROUND 2D item 4, FIX STAGE — the same per-individual jitter, expressed
 * as UNITLESS CSS custom properties so the DOM portrait surfaces can wear
 * it too.
 *
 * The shipped pass applied jitter at exactly ONE production call site
 * (`render/keepScene.ts`'s `resolveActorSprite`), which is also the
 * SMALLEST Pip in the game — every other surface (focus portrait, Album,
 * Long Meadow, Nursery, memorial, cast strip, starter cards) drew two
 * Pips with the same genome byte-identically. Unitless multipliers scale
 * correctly across all of those boxes (42 px chip → 112 px Album detail)
 * from one computation, which is why they are ratios rather than pixels.
 *
 * Pure, DOM-free (returns data, not elements) — `ui/pipdex.ts` and
 * `ui/focusView.ts` apply them.
 */
export function jitterStyleVars(seed: string): Readonly<Record<string, string>> {
  const j = computeJitter(seed);
  return {
    "--pk-jw": (1 - j.bodyShrinkW).toFixed(4),
    "--pk-jh": (1 - j.bodyShrinkH).toFixed(4),
    "--pk-jgap": ((BASE_EYE_GAP_PX + j.eyeSpacingPx) / BASE_EYE_GAP_PX).toFixed(4),
    "--pk-jeye-w": (
      (BASE_EYE_RADIUS_PX + j.eyeRadiusXPx) /
      BASE_EYE_RADIUS_PX
    ).toFixed(4),
    "--pk-jeye-h": (
      (BASE_EYE_RADIUS_PX + j.eyeRadiusYPx) /
      BASE_EYE_RADIUS_PX
    ).toFixed(4),
    // Percent of body height, as a bare number (`calc(… * 1%)` at the
    // use site) — the eye row's own `top` is already a percentage.
    "--pk-jeye-dy": ((j.eyeRowYPx / PIP_BODY_HEIGHT) * 100).toFixed(3),
  };
}

