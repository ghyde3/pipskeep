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
import type { AccessorySlot } from "../content/accessories";

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

/**
 * ROUND 2K FIX STAGE (docs/liveliness-bible.md §6.1) — the landmark table
 * every accessory zone below is derived from, and nothing else. Every
 * number here is copied from the SAME literals `resolvePipSprite` draws
 * the face with (mouth at `-bh * 0.4` in rig space, i.e. `bh * 0.6 + 2` in
 * this anchor-local space where local = rigY + bh + 2; a 2.5px stroke
 * plus the curve's control point sagging toward the feet by `0.04 * bh`
 * puts the mouth's PAINTED lower edge — the edge a neck accessory
 * actually has to clear — at `bh * 0.62 + 2 + 1.25`), so a future change
 * to the face moves the zones too, instead of silently re-opening the
 * round-2D/2K collision.
 */
export interface BodyLandmarks {
  /** The anchor's own origin sits this far above the drawn body (local
   * px) — see `resolvePipSprite`'s `headTopY = -bh - 2`. */
  readonly bodyTop: number;
  readonly eyeRow: number;
  readonly eyeRadius: number;
  /** The mouth's painted LOWER edge — the thing a neck/shoulder accessory
   * must clear, not the control point a point-containment check would
   * probe (docs/liveliness-bible.md §0.2 finding 1). */
  readonly faceBottom: number;
  readonly feet: number;
}

export function bodyLandmarks(bh: number, eyeScale: number): BodyLandmarks {
  return {
    bodyTop: 2,
    eyeRow: bh * 0.42 + 2,
    eyeRadius: BASE_EYE_RADIUS_PX * eyeScale,
    faceBottom: bh * 0.62 + 2 + 1.25,
    feet: bh,
  };
}

/** Clearance kept between an accessory's zone and the landmark it must
 * not touch (the mouth, the eyes, the crown). Same role as `computeJitter`'s
 * shrink-only budgets: a small, named, testable margin rather than "zero". */
export const ACCESSORY_ZONE_PAD_PX = 2;

/** How much further the PAINTED eye can reach, beyond `bodyLandmarks`'
 * un-jittered `eyeRow`/`eyeRadius`, at `computeJitter`'s own documented
 * extremes (`JITTER_MAX_EYE_ROW_PX` down the row, `JITTER_MAX_EYE_RADIUS_PX`
 * out the radius) — folded into every zone bound that borders the eyes
 * (`crown`'s floor, `side`'s ceiling) so the fixed PROBE_SEED used in
 * `spriteResolver.test.ts` isn't the only seed the zone is actually safe
 * for. Without this, a "side" accessory (no `ACCESSORY_ZONE_PAD_PX` of its
 * own — a cord legitimately starts AT the eye row) that just clears the
 * UN-jittered eye can still land on the eye of a Pip whose jitter rolled
 * the eye row down and the radius up. */
export const ACCESSORY_EYE_JITTER_MARGIN_PX =
  JITTER_MAX_EYE_ROW_PX + JITTER_MAX_EYE_RADIUS_PX;

/** The worst-case (max jitter) horizontal reach of an eye's OUTER edge
 * from the body's centre line, at a given `eyeScale` — what a `side`
 * accessory hanging level with the eyes has to clear laterally instead
 * of vertically. */
export function eyeOuterReachPx(eyeScale: number): number {
  return (
    (BASE_EYE_GAP_PX + JITTER_MAX_EYE_SPACING_PX + BASE_EYE_RADIUS_PX + JITTER_MAX_EYE_RADIUS_PX) *
    eyeScale
  );
}

/** A hanging `side` accessory needs at least this much clear flank width
 * (beyond the eye's own worst-case reach) to read as "beside the body"
 * rather than "on top of the eye" — roughly the lantern bulb's own
 * radius plus a pad, the only accessory that currently uses this slot. */
const MIN_SIDE_LATERAL_CLEARANCE_PX = 12;

/** The vertical band (anchor-local px) a slot may occupy. Only the
 * vertical axis is a hard limit here — bible §6.1.1's lateral bands are a
 * geometry the existing per-accessory x-offsets already satisfy, and are
 * asserted directly against the drawn bounds in `spriteResolver.test.ts`
 * rather than re-derived as a second number to keep in sync. */
export interface AccessoryZone {
  readonly top: number;
  readonly bottom: number;
}

/**
 * ROUND 2K FIX STAGE — one shared zone table, so `drawAccessory` (the
 * Pixi surface) and any DOM surface that wants the same band read off the
 * SAME landmarks instead of hand-picked fractions of `bh` that drift out
 * of sync with the face the moment a silhouette shrinks it (bible §0.2 /
 * §6.1.1's root-cause finding: absolute-pixel shapes hung off a
 * proportionally-scaled anchor, on a body whose height varies 28% across
 * the five silhouettes).
 *
 * `crown` has no upper bound (a tall hat is fine) — only a floor
 * (`bodyTop`, "touching, never floating") and a ceiling on how far DOWN it
 * may reach (clear of the eyes). `side` may start as high as the eye row
 * (a cord can reach up the flank) and run all the way to the feet — BUT
 * only on a silhouette wide enough (`bw`) to clear the eye's own
 * worst-case reach with `MIN_SIDE_LATERAL_CLEARANCE_PX` to spare; a
 * narrow silhouette ("tall"'s 0.8 wFrac, "tiny"'s 0.78) doesn't have that
 * flank room at ANY x, since the eyes sit at a fixed absolute offset
 * while the body narrows around them, so `side` falls back to the same
 * "below the face entirely" band `neck`/`shoulder` use. Every other slot
 * sits strictly below the mouth's painted lower edge and strictly above
 * the feet.
 */
export function accessoryZone(
  slot: AccessorySlot,
  bh: number,
  bw: number,
  eyeScale: number,
): AccessoryZone {
  const lm = bodyLandmarks(bh, eyeScale);
  const belowFace = {
    top: lm.faceBottom + ACCESSORY_ZONE_PAD_PX,
    bottom: lm.feet - ACCESSORY_ZONE_PAD_PX,
  };
  if (slot === "crown") {
    return {
      top: -Infinity,
      bottom: Math.max(
        lm.bodyTop,
        lm.eyeRow - lm.eyeRadius - ACCESSORY_ZONE_PAD_PX - ACCESSORY_EYE_JITTER_MARGIN_PX,
      ),
    };
  }
  if (slot === "side") {
    const lateralClearance = bw / 2 - eyeOuterReachPx(eyeScale) - ACCESSORY_ZONE_PAD_PX;
    if (lateralClearance >= MIN_SIDE_LATERAL_CLEARANCE_PX) {
      return {
        top: lm.eyeRow - lm.eyeRadius - ACCESSORY_EYE_JITTER_MARGIN_PX,
        bottom: lm.feet - ACCESSORY_ZONE_PAD_PX,
      };
    }
    // Not enough flank room beside the eyes on this silhouette — the only
    // safe band left is below the whole face, same as `neck`/`shoulder`.
    return {
      top: Math.max(
        belowFace.top,
        lm.eyeRow + lm.eyeRadius + ACCESSORY_EYE_JITTER_MARGIN_PX,
      ),
      bottom: belowFace.bottom,
    };
  }
  // "neck" and "shoulder": below the mouth, above the feet.
  return belowFace;
}

// ---------------------------------------------------------------------------
// ⚠️ FIX STAGE — THE SAME BAND, FOR THE TWO DOM PORTRAIT SURFACES
// (docs/liveliness-bible.md §6.1.1(c), the half of the anchor scheme that
// was specified and then never written).
// ---------------------------------------------------------------------------

/**
 * The Pixi half of §6.1.1 landed and works; the DOM half did not, and a
 * live sweep of 12 accessories × 5 silhouettes × 3 portrait surfaces found
 * 36 collisions — the scarf, the bowtie and the ember-bead drawn across
 * the mouth on EVERY silhouette, reading as a gag and a tongue. Root
 * cause, exactly as predicted: the stylesheets hung percentage-sized
 * shapes off `min-height` PIXEL floors, on a blob whose height varies 28%
 * across silhouettes and 3.5× across portrait boxes (a 26px cast chip to a
 * 100px focus portrait). At 26px a `min-height: 3px` mouth is 11% of the
 * body; at 100px it is 3%. Nothing authored against one is right for the
 * other.
 *
 * So the DOM landmarks below are PURE FRACTIONS — no pixel floors — and
 * both stylesheets are aligned to them. That is the fix: not "move the
 * scarf down 4%", which would re-break at the next box size.
 *
 * Why these fractions are not `bodyLandmarks`' own: the DOM portraits
 * always authored a different (higher, rounder, more chibi) face than the
 * Pixi rig — eyes at 30% against Pixi's 42%. Copying the Pixi numbers
 * would move every DOM Pip's face, which is a redesign, not a fix. What
 * matters, and what was missing, is that ONE table now defines the band
 * for both DOM surfaces and that the band is derived from the mouth
 * rather than guessed beside it. `portraitPatterns.test.ts` measures the
 * painted result against these numbers, so they cannot drift from the
 * stylesheets in silence.
 */
export const PORTRAIT_EYE_TOP_PCT = 30;

/** The mouth's top edge and depth, as fractions of portrait-body height.
 * Both stylesheets' `.pk-*-mouth` rules are authored from these two
 * numbers and nothing else. */
export const PORTRAIT_MOUTH_TOP_PCT = 50;
export const PORTRAIT_MOUTH_HEIGHT_PCT = 8;

/** The mouth's painted lower edge — the landmark a neck accessory has to
 * clear. The stroke itself (1.6–2 px, a border-width, which CSS cannot
 * express proportionally) is absorbed by the pad below rather than
 * pretended away. */
export const PORTRAIT_MOUTH_BOTTOM_PCT = PORTRAIT_MOUTH_TOP_PCT + PORTRAIT_MOUTH_HEIGHT_PCT;

/** Clearance kept between a zone and the landmark it must not touch —
 * `ACCESSORY_ZONE_PAD_PX` (2 px on a 98 px body) expressed as the fraction
 * it actually is, rounded up to 3 so that on the SMALLEST portrait box (a
 * 26 px cast chip, where 1% is a quarter of a pixel) it still leaves room
 * for the shared `drop-shadow` contour every accessory carries. */
export const ACCESSORY_ZONE_PAD_PCT = 3;

/**
 * ⚠️ THE EXPORT §6.1.1(c) ASKED FOR AND THE ROUND SHIPPED WITHOUT.
 * `grep ACCESSORY_ZONE_PCT src/` returned nothing; the guard that was
 * supposed to measure it did not exist either, which is why 36 collisions
 * shipped green.
 *
 * `ui/pipdex.ts` and `ui/focusView.ts` write these onto the accessory node
 * as `--pk-acc-zone-top` / `--pk-acc-zone-bottom`, and each stylesheet
 * positions its OWN independently-authored shapes inside that band. The
 * three-implementations pattern `portraitPatterns.test.ts` guards is
 * preserved exactly — only the BAND is shared, which is what was already
 * true of `AccessorySlot` itself and was never enforced.
 */
export const ACCESSORY_ZONE_PCT: Readonly<
  Record<AccessorySlot, { readonly top: number; readonly bottom: number }>
> = {
  // A hat may overhang the crown (no upper bound — that is what makes it
  // a hat), but must stop clear of the eyes.
  crown: { top: -20, bottom: PORTRAIT_EYE_TOP_PCT - ACCESSORY_ZONE_PAD_PCT },
  // Everything worn on the body sits strictly below the painted mouth and
  // strictly above the feet. `side` gets the same conservative band as
  // `neck`/`shoulder` here: the Pixi rig can hang a lantern beside the eyes
  // because a 118 px-wide body has flank room to spare, and a 44 px cast
  // chip does not.
  neck: {
    top: PORTRAIT_MOUTH_BOTTOM_PCT + ACCESSORY_ZONE_PAD_PCT,
    bottom: 100 - ACCESSORY_ZONE_PAD_PCT,
  },
  shoulder: {
    top: PORTRAIT_MOUTH_BOTTOM_PCT + ACCESSORY_ZONE_PAD_PCT,
    bottom: 100 - ACCESSORY_ZONE_PAD_PCT,
  },
  side: {
    top: PORTRAIT_MOUTH_BOTTOM_PCT + ACCESSORY_ZONE_PAD_PCT,
    bottom: 100 - ACCESSORY_ZONE_PAD_PCT,
  },
};

/** The two custom properties a DOM portrait writes on its accessory node,
 * so both surfaces spell them the same way and the guard has one place to
 * read them from. */
export function accessoryZoneStyleVars(
  slot: AccessorySlot,
): Readonly<Record<string, string>> {
  const zone = ACCESSORY_ZONE_PCT[slot];
  return {
    "--pk-acc-zone-top": `${zone.top}%`,
    "--pk-acc-zone-bottom": `${zone.bottom}%`,
  };
}

