/**
 * SpriteResolver (spec §11): the single mapping
 * `(genome, stage) → composed Pixi display object`.
 *
 * EVERYTHING that draws a Pip goes through `resolvePipSprite` — dropping
 * in real sprite sheets later means swapping this file's internals,
 * nothing else. Placeholder standard per spec §11: layered Pixi Graphics
 * — rounded blob body + big blinking eyes + palette (content/palette.ts)
 * + pattern overlay + accessory anchor. Piplings render at 0.7 scale.
 *
 * The resolved sprite is a small rig:
 *   view (positioned by the scene; ground shadow lives here)
 *   └─ rig (squash/stretch, bounce, shake — pivot at the feet)
 *       └─ body layers + eyes + accessoryAnchor
 * so care animations can mangle `rig` while the shadow stays grounded.
 *
 * ROUND 2B CONTENT EXPANSION (content-bible §1.4/§1.5) adds two new
 * procedural primitives, both driven entirely by content (no per-species
 * render code, so a species stays addable from content/ alone — spec §3):
 *
 * - SILHOUETTE (`content/species.ts` `sprite.silhouette`, optional,
 *   defaults to "round"): varies body width/height fractions, corner
 *   radius, shadow size and eye scale. Silhouettes vary the shape INSIDE
 *   the fixed `PIP_BODY_WIDTH`×`PIP_BODY_HEIGHT` box — they never exceed
 *   it, because `render/keepScene.ts` uses those two constants (not a
 *   per-species value) for tap hit-testing, the selection ring, the
 *   ground shadow and particle spawn boxes. "round" is byte-identical to
 *   the pre-expansion drawing, so Mosspip/Grovepip do not change
 *   appearance.
 * - Six new PATTERN primitives (banded/ripple/ember/flake/puff/glowdot),
 *   added to the existing dots/stripes/swirl set. Same deal: masked to
 *   the body silhouette, unknown ids still fall back to stripes so a
 *   typo'd pattern id is visible-but-boring rather than invisible.
 *
 * `resolvePipSprite` also grew an optional `variantId` param (content-
 * bible §8.2.2): when provided (a Pip's stored evolution gift variant,
 * `pip.evolved?.variantId`) it is used as the palette lookup key INSTEAD
 * of `genome.palette` — the birth palette a Pip keeps through evolution.
 * Wiring `render/keepScene.ts` to pass it (and fold it into the sprite
 * cache key) is outside this file's fence (content-bible §8.2.2); this
 * file only needs to be ready to receive it, which it now is.
 *
 * ROUND 2D (docs/BACKLOG.md "Round 2D" items 3 & 4) adds two more
 * per-individual layers, both still driven entirely through this one
 * resolver (no per-species render code, spec §3):
 *
 * - ACCESSORY (item 3): `genome.accessoryId` resolves through
 *   `content/accessories.ts`'s `resolveAccessory` (which already collapses
 *   every "bare" spelling — `undefined`/`null`/the `"none"` sentinel/an
 *   unrecognized id — to `null`) and, when non-null, draws into the
 *   `accessoryAnchor` this file has built and left empty since Phase 5.
 *   Works for every species/stage/shininess automatically because it
 *   reads only the anchor's local origin and the content def's colors —
 *   nothing here branches on `genome.speciesId`.
 * - JITTER (item 4): `resolvePipSprite`'s new optional `jitterSeed` param
 *   (the caller's Pip id when one exists, e.g. `render/keepScene.ts`;
 *   falls back to a hash of the genome's own fields so a caller with no
 *   live Pip — a save-fixture preview, a future gift-shop swatch — still
 *   gets a *stable*, non-uniform look) drives `computeJitter`, a pure,
 *   deterministic hash (via `core/rng.ts`'s `fnv1a` — the SAME "render-
 *   local fixed seed, no `Math.random()`" pattern `render/keepScene.ts`
 *   already uses for its bed/corner assignment, and `render/particles.ts`'s
 *   module doc names as the repo rule). No stream, no cursor, no GameState
 *   footprint: this is cosmetic-only, exactly like the particle jitter.
 *   Every jittered quantity is either SHRINK-ONLY (body width/height — see
 *   `computeJitter`'s doc for why growth is unsafe) or a tiny, bounded
 *   pixel offset (eye spacing/shape, marking position) — `spriteResolver.
 *   test.ts` proves numerically that even the extreme of every jitter
 *   range stays inside `PIP_BODY_WIDTH`×`PIP_BODY_HEIGHT` for every
 *   silhouette, "tiny" (the tightest) included.
 */

import { Container, Graphics } from "pixi.js";
import { LifeStage } from "../core/pips/types";
import type { TraitGenome } from "../core/pips/types";
import { resolvePipPalette } from "../content/palette";
import { resolveAccessory } from "../content/accessories";
import type { AccessoryDef } from "../content/accessories";
import {
  PIPLING_SCALE,
  PIP_BODY_HEIGHT,
  PIP_BODY_WIDTH,
  computeJitter,
  resolveSilhouette,
  silhouetteMetrics,
} from "./pipGeometry";

export {
  PIPLING_SCALE,
  PIP_BODY_WIDTH,
  PIP_BODY_HEIGHT,
  SILHOUETTE_FRACTIONS,
  JITTER_MAX_BODY_SHRINK,
  JITTER_MAX_EYE_SPACING_PX,
  JITTER_MAX_EYE_RADIUS_PX,
  JITTER_MAX_EYE_ROW_PX,
  JITTER_MAX_MARK_PX,
  BASE_EYE_GAP_PX,
  BASE_EYE_RADIUS_PX,
  computeJitter,
  jitterStyleVars,
  resolveSilhouette,
} from "./pipGeometry";
export type { Silhouette, Jitter } from "./pipGeometry";

/** Fallback jitter seed when the caller has no live Pip id (see
 * `resolvePipSprite`'s `jitterSeed` param) — every genome field folded
 * into one string, so at least a DIFFERENT genome still jitters
 * differently, even though (as documented on `TraitGenome.accessoryId`)
 * two Pips that happen to roll an identical genome would then also share
 * this fallback seed and so look pixel-identical; a live Pip id (always
 * unique) avoids that entirely, which is why every real gameplay caller
 * (render/keepScene.ts) passes one. */
function genomeJitterSeed(genome: TraitGenome): string {
  return [
    genome.speciesId,
    genome.palette,
    genome.pattern,
    genome.personalityId,
    genome.shiny ? "1" : "0",
    genome.accessoryId ?? "",
  ].join("|");
}

export interface PipSprite {
  /** Root — position at the Pip's feet; never scaled by animations. */
  readonly view: Container;
  /** Animation rig — squash/stretch/rotate/offset this. Pivot at feet. */
  readonly rig: Container;
  /** Accessory anchor point (spec §11) at the top of the head. Round 2D's
   * `drawAccessory` is what attaches to it. ONE anchor, ONE accessory:
   * the per-genome `accessorySlots` count that used to imply otherwise
   * was dead data and is gone (spec §16 v1.7, core/pips/types.ts). */
  readonly accessoryAnchor: Container;
  readonly genome: TraitGenome;
  readonly stage: LifeStage;
  /** Head top in view-local px (negative y, before view scaling) — the
   * scene anchors speech bubbles / hearts / Z's off this. Varies with
   * silhouette height, so a shorter Pip's speech bubble lands correctly
   * for free (content-bible §1.4). */
  readonly headTopY: number;
  /** 1 = wide open, 0 = shut. Blinking is the scene's timer. */
  setEyesOpen(openness: number): void;
  /** Sulking look (spec task): greyed tint; pose slump is the rig's job. */
  setSulkTint(on: boolean): void;
  destroy(): void;
}

type PatternKind =
  | "none"
  | "dots"
  | "stripes"
  | "swirl"
  | "banded"
  | "ripple"
  | "ember"
  | "flake"
  | "puff"
  | "glowdot";

/** Genome pattern id → placeholder overlay. Unknown ids get stripes so a
 * new content pattern is VISIBLE (spec §11: variants visible now). */
function patternKind(patternId: string): PatternKind {
  switch (patternId) {
    case "plain":
      return "none";
    case "speckled":
    case "dots":
      return "dots";
    case "swirl":
      return "swirl";
    // ROUND 2B CONTENT EXPANSION (content-bible §1.5) — six new primitives.
    case "banded":
      return "banded";
    case "ripple":
      return "ripple";
    case "ember":
      return "ember";
    case "flake":
      return "flake";
    case "puff":
      return "puff";
    case "glowdot":
      return "glowdot";
    default:
      return "stripes";
  }
}

/** Fixed speckle layout (deterministic — same genome, same look). */
const SPECKLES: readonly (readonly [number, number, number])[] = [
  [-30, -74, 4.5],
  [-8, -86, 3.5],
  [22, -78, 5],
  [38, -58, 3.5],
  [-40, -50, 3.5],
  [12, -30, 4],
  [-16, -22, 3],
];

function drawBlobPath(g: Graphics, bw: number, bh: number, cornerFrac: number): Graphics {
  // Rounded blob: a fat roundRect reads as a soft bean at high radius.
  return g.roundRect(-bw / 2, -bh, bw, bh, bw * cornerFrac);
}

/**
 * ROUND 2D item 3 — draw one accessory into `accessoryAnchor`'s LOCAL
 * space: origin (0, 0) is the crown (the anchor's own position IS
 * `headTopY`, spec §11's existing point), +y toward the feet, matching
 * every other layer's own convention. `bw`/`bh` are THIS Pip's already-
 * jittered body dimensions, so an accessory scales sensibly with
 * silhouette even though nothing here branches on `speciesId` — spec §3's
 * "no per-species render code" holds exactly like it does for patterns.
 *
 * Twelve distinct silhouette families (cap / crown / floating / neck /
 * shoulder / hanging) so no two are confusable even as small placeholder
 * shapes (spec §11 "placeholder standard" — simple layered Graphics, not
 * final art). Colors come from `content/accessories.ts`'s `AccessoryDef`
 * (content-as-data, spec §3); a couple of small incidental tones (a
 * lantern's hook, a berry sprig) are hardcoded here exactly the way
 * `eyeballs`'/`mouth`'s own incidental tones already are above.
 *
 * Returns every Graphics node drawn, so the caller can fold them into
 * `tintable` — an accessory greys out with the rest of the Pip while
 * sulking, the same as every other layer.
 */
/** A fixed dark contour every filled accessory shape strokes with, so a
 * pale accessory (the shell's cream, the snowcap's near-white) stays
 * legible against ANY body palette — including a similarly pale/warm one
 * (Hearthpip's tan, Pebblepip's stone grey) where primary/secondary alone
 * read as camouflage. Same role `palette.outline` plays on the body blob
 * itself (spec §11), just accessory-side and palette-independent since an
 * accessory's wearer is not known at content-authoring time. */
const ACCESSORY_OUTLINE = "#33302b";

/**
 * ROUND 2D FIX STAGE — the body-zone constants, in the anchor's LOCAL
 * space (origin = crown, +y toward the feet), derived from `bh` the same
 * way every other layer positions itself.
 *
 * The landmarks this has to sit between, converted into the same local
 * space (local = rigY + bh + 2, since the anchor sits at `headTopY`):
 *
 *   body top    local 2          eyes    local 0.42·bh
 *   blush       local 0.58·bh    mouth   local 0.60·bh
 *   belly ctr   local 0.70·bh    feet    local bh
 *
 * The shipped values put `neckY` at 0.85·bh — BELOW the belly's centre,
 * with the scarf's 20 px tail landing past the feet and floating on the
 * grass — while the DOM surfaces put the same band at 62 %, which is
 * exactly mouth height. Both are now derived from these two numbers.
 */
const NECK_Y_FRAC = 0.72;
const SHOULDER_Y_FRAC = 0.68;
/** How far a `crown` accessory drops so it OVERLAPS the head instead of
 * hovering over it (local px — the anchor sits 2 px above the body top,
 * so anything ≥ 3 makes contact). See the tuck at the end of
 * `drawAccessory`. */
const CROWN_TUCK_PX = 6;

function drawAccessory(
  anchor: Container,
  def: AccessoryDef,
  bw: number,
  bh: number,
): readonly Graphics[] {
  const primary = def.primaryColor;
  const secondary = def.secondaryColor ?? def.primaryColor;
  const parts: Graphics[] = [];
  const add = (g: Graphics): void => {
    anchor.addChild(g);
    parts.push(g);
  };
  // Just BELOW the mouth (0.60·bh) and across the top of the belly — where
  // a scarf sits on a creature with no actual neck. See NECK_Y_FRAC.
  const neckY = bh * NECK_Y_FRAC;
  const shoulderY = bh * SHOULDER_Y_FRAC;
  const sideX = bw * 0.36;

  switch (def.id) {
    case "leafcap": {
      const leaf = new Graphics()
        .ellipse(0, -6, 12, 6.5)
        .fill(primary)
        .stroke({ width: 1, color: ACCESSORY_OUTLINE, alpha: 0.4 })
        .moveTo(-9, -6)
        .lineTo(9, -6)
        .stroke({ width: 1.3, color: secondary, alpha: 0.8, cap: "round" });
      leaf.rotation = -0.3;
      add(leaf);
      break;
    }
    case "flower": {
      const flower = new Graphics();
      for (let i = 0; i < 5; i++) {
        const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        flower.circle(Math.cos(a) * 6, -10 + Math.sin(a) * 6, 4.2);
      }
      flower.fill(primary).stroke({ width: 0.9, color: ACCESSORY_OUTLINE, alpha: 0.35 });
      flower
        .circle(0, -10, 3)
        .fill(secondary)
        .stroke({ width: 0.8, color: ACCESSORY_OUTLINE, alpha: 0.35 });
      add(flower);
      break;
    }
    case "scarf": {
      // Band + KNOT + short tail. The band alone read as a bar drawn
      // across the face; the knot and the tail are what make it a worn
      // scarf rather than a stripe, and the tail is kept short enough to
      // stay above the feet on the shortest silhouette ("wide", hFrac
      // 0.72): neckY + 16 = 0.72·bh + 16 < bh for every bh the box allows.
      const bandY = neckY - 5.5;
      const knotX = bw * 0.17;
      const scarf = new Graphics()
        .roundRect(-bw * 0.3, bandY, bw * 0.6, 11, 5.5)
        .fill(primary)
        .stroke({ width: 1.4, color: secondary, alpha: 0.65 })
        .moveTo(knotX - 4, neckY + 4)
        .lineTo(knotX + 5, neckY + 4)
        .lineTo(knotX + 3.5, neckY + 16)
        .lineTo(knotX - 5.5, neckY + 14)
        .closePath()
        .fill(primary)
        .stroke({ width: 1, color: ACCESSORY_OUTLINE, alpha: 0.3 })
        .circle(knotX, neckY, 5)
        .fill(secondary)
        .stroke({ width: 1, color: ACCESSORY_OUTLINE, alpha: 0.4 });
      add(scarf);
      break;
    }
    case "shellpauldron": {
      // Fan lines drawn AFTER (on top of) the fill, and every shape gets a
      // dark contour stroke — a light shell on a light/tan body (Hearthpip,
      // Pebblepip) was nearly invisible without one; the body blob itself
      // stays legible against ANY palette the exact same way (`palette.
      // outline` stroke below in the main body draw, spec §11).
      // On the FLANK at shoulder height, not on the cheek: the shipped
      // version sat at neckY − 8 with neckY at 0.85·bh, which on the DOM
      // surfaces landed squarely on the blush. Also enlarged (7.5 → 9.5
      // radius) because at Keep scale the old one was invisible.
      const cx = bw * 0.38;
      const cy = shoulderY;
      const shell = new Graphics()
        .circle(cx, cy, 9.5)
        .fill(primary)
        .stroke({ width: 1.3, color: ACCESSORY_OUTLINE, alpha: 0.55 });
      for (let i = 0; i < 5; i++) {
        const a = -0.9 + i * 0.42;
        shell.moveTo(cx, cy).lineTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9 - 2);
      }
      shell.stroke({ width: 1.4, color: secondary, alpha: 0.85, cap: "round" });
      add(shell);
      break;
    }
    case "lantern": {
      // HANGS on the flank, well outside the eye row. The shipped version
      // started its hook at −0.05·bh — ABOVE the crown — and put the
      // lantern body straight over the right eye, with the cord running
      // down between the eyes.
      const x = bw * 0.4;
      const topY = bh * 0.42;
      const bodyY = bh * 0.68;
      const lantern = new Graphics()
        .moveTo(x, topY)
        .lineTo(x, bodyY - 7)
        .stroke({ width: 1.3, color: "#5a4a30", alpha: 0.85 })
        .circle(x, bodyY, 10)
        .fill({ color: secondary, alpha: 0.22 })
        .roundRect(x - 6, bodyY - 7, 12, 13, 3)
        .fill(primary)
        .stroke({ width: 1.2, color: ACCESSORY_OUTLINE, alpha: 0.5 });
      add(lantern);
      break;
    }
    case "pebblecrown": {
      const outline = { width: 0.9, color: ACCESSORY_OUTLINE, alpha: 0.4 } as const;
      const cairn = new Graphics()
        .ellipse(0, -3, 8, 4.5)
        .fill(primary)
        .stroke(outline)
        .ellipse(1, -9, 6, 3.6)
        .fill(secondary)
        .stroke(outline)
        .ellipse(-0.5, -14, 4, 2.6)
        .fill(primary)
        .stroke(outline);
      add(cairn);
      break;
    }
    case "berrycrown": {
      const berries = new Graphics();
      for (const [bx, by] of [
        [-9, -4],
        [0, -8],
        [9, -4],
      ] as const) {
        berries.circle(bx, by, 4.2);
      }
      berries.fill(primary).stroke({ width: 0.9, color: ACCESSORY_OUTLINE, alpha: 0.4 });
      berries.ellipse(0, -12, 5, 2.6).fill({ color: secondary, alpha: 0.85 });
      add(berries);
      break;
    }
    case "snowcap": {
      // Snowcap's own colors are deliberately pale (spec bible: an icy
      // cap) — exactly the "pale on pale" camouflage content/palette.ts's
      // module doc warns about, since Snowpip/Frostpip's OWN body tones
      // are just as pale. A hairline ACCESSORY_OUTLINE (in addition to the
      // colored stroke below) keeps the silhouette readable regardless.
      const cap = new Graphics()
        .roundRect(-11, -12, 22, 10, 5)
        .fill(primary)
        .stroke({ width: 1.2, color: secondary, alpha: 0.7 })
        .roundRect(-11, -12, 22, 10, 5)
        .stroke({ width: 0.8, color: ACCESSORY_OUTLINE, alpha: 0.3 });
      for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        cap
          .moveTo(-Math.cos(a) * 5, -16 - Math.sin(a) * 5)
          .lineTo(Math.cos(a) * 5, -16 + Math.sin(a) * 5);
      }
      cap.stroke({ width: 1.1, color: secondary, alpha: 0.85, cap: "round" });
      add(cap);
      break;
    }
    case "cloudwisp": {
      const cloud = new Graphics();
      // Authored lower than the other crown shapes (round 2D fix stage):
      // even with CROWN_TUCK_PX the original y's left this one hovering
      // clear of the skull, which `spriteResolver.test.ts` now catches.
      for (const [cx, cy, r] of [
        [-7, -8, 6],
        [2, -11, 7],
        [10, -7, 5],
      ] as const) {
        cloud.circle(cx, cy, r);
      }
      cloud
        .fill({ color: primary, alpha: 0.95 })
        .stroke({ width: 0.9, color: ACCESSORY_OUTLINE, alpha: 0.25 });
      add(cloud);
      break;
    }
    case "emberbead": {
      // A pendant on a SHORT cord that reads as going round the neck —
      // the shipped version drew its cord from −0.02·bh (just under the
      // crown) all the way down across the face to a bead on the belly.
      const y = neckY + 3;
      const bead = new Graphics()
        .moveTo(-bw * 0.13, y - 11)
        .lineTo(0, y - 3)
        .lineTo(bw * 0.13, y - 11)
        .stroke({ width: 1.2, color: "#6b4a30", alpha: 0.75 })
        .circle(0, y, 8)
        .fill({ color: secondary, alpha: 0.22 })
        .circle(0, y, 4.8)
        .fill(primary)
        .stroke({ width: 0.9, color: ACCESSORY_OUTLINE, alpha: 0.45 });
      add(bead);
      break;
    }
    case "acorncap": {
      const acorn = new Graphics()
        .ellipse(0, -9, 10, 6.5)
        .fill(primary)
        .stroke({ width: 1.2, color: secondary, alpha: 0.6 })
        .roundRect(-1.6, -17, 3.2, 6, 1.5)
        .fill(secondary);
      add(acorn);
      break;
    }
    default: {
      // "bowtie" (also the safe fallback for any future id this switch
      // hasn't been taught yet — visible-but-simple, never invisible,
      // matching `patternKind`'s own unknown-id precedent).
      const y = neckY;
      const bowOutline = { width: 0.9, color: ACCESSORY_OUTLINE, alpha: 0.35 } as const;
      const bow = new Graphics()
        .moveTo(-1, y)
        .lineTo(-11, y - 6)
        .lineTo(-11, y + 6)
        .closePath()
        .fill(primary)
        .stroke(bowOutline)
        .moveTo(1, y)
        .lineTo(11, y - 6)
        .lineTo(11, y + 6)
        .closePath()
        .fill(primary)
        .stroke(bowOutline)
        .circle(0, y, 3)
        .fill(secondary)
        .stroke(bowOutline);
      add(bow);
      break;
    }
  }
  // ROUND 2D FIX STAGE — crown accessories are TUCKED DOWN onto the head.
  // Every one of them was authored with its lowest edge at or above local
  // y = 0, i.e. at or above `headTopY`, which is itself 2 px clear of the
  // body — so all seven read as FLOATING, with a band of background
  // showing between the hat and the skull. Dropping the whole family by a
  // few px (rather than re-tuning seven shapes independently) makes them
  // overlap the crown and sit ON the head, and shortens the family's
  // upward overshoot past the fixed box by the same amount.
  if (def.slot === "crown") {
    for (const part of parts) part.y += CROWN_TUCK_PX;
  }
  return parts;
}

/**
 * Compose the placeholder Pip for `(genome, stage)` (spec §11).
 * Pure construction: no timers, no state reads — the scene drives blinks,
 * poses, and lifecycles.
 *
 * `variantId` (content-bible §8.2.2): when given, used instead of
 * `genome.palette` to resolve the palette — the evolution gift variant's
 * look (`content/palette.ts`'s per-species `variants` map is keyed by
 * BOTH birth palette ids and gift-variant ids, so this is the same
 * lookup, just a different key).
 *
 * `jitterSeed` (round 2D item 4): a stable string seed for `computeJitter`
 * — pass the Pip's own id when one exists (unique per Pip, so even two
 * Pips with an identical rolled genome still look distinct; `render/
 * keepScene.ts` does this). Falls back to a hash of the genome's own
 * fields when omitted, so every caller still gets a deterministic,
 * non-uniform look with zero required changes (this param is optional).
 */
export function resolvePipSprite(
  genome: TraitGenome,
  stage: LifeStage,
  variantId?: string,
  jitterSeed?: string,
): PipSprite {
  const silhouette = resolveSilhouette(genome.speciesId);
  const metrics = silhouetteMetrics(silhouette);
  const jitter = computeJitter(jitterSeed ?? genomeJitterSeed(genome));
  // Shrink-only (Jitter's own doc): safe for every silhouette, including
  // "round"/"chunky"/"wide" which already draw at wFrac = 1.0 (the full
  // box width) — see JITTER_MAX_BODY_SHRINK's doc.
  const bw = PIP_BODY_WIDTH * metrics.wFrac * (1 - jitter.bodyShrinkW);
  const bh = PIP_BODY_HEIGHT * metrics.hFrac * (1 - jitter.bodyShrinkH);
  const paletteId = variantId ?? genome.palette;
  const palette = resolvePipPalette(genome.speciesId, paletteId);
  const view = new Container();
  const rig = new Container();
  const tintable: Graphics[] = [];

  // Ground shadow — outside the rig so squashes don't lift it.
  const shadow = new Graphics()
    .ellipse(0, 4, bw * 0.38 * metrics.shadowScale, 9)
    .fill({ color: 0x3a4a3a, alpha: 0.14 });
  view.addChild(shadow);
  view.addChild(rig);

  // Body blob.
  const body = drawBlobPath(new Graphics(), bw, bh, metrics.cornerFrac)
    .fill(palette.body)
    .stroke({ width: 3, color: palette.outline, alpha: 0.35 });
  rig.addChild(body);
  tintable.push(body);

  // Belly patch.
  const belly = new Graphics()
    .ellipse(0, -bh * 0.3, bw * 0.27, bh * 0.21)
    .fill({ color: palette.belly, alpha: 0.95 });
  rig.addChild(belly);
  tintable.push(belly);

  // Pattern overlay, masked to the body silhouette.
  const kind = patternKind(genome.pattern);
  if (kind !== "none") {
    const overlay = new Graphics();
    // ROUND 2D item 4 — marking-placement jitter: a tiny content-only
    // offset (the mask below stays put), small enough that every pattern's
    // existing "kept away from the edges" margin (see each kind's own
    // comment) absorbs it without visibly clipping.
    overlay.position.set(jitter.markingDxPx, jitter.markingDyPx);
    if (kind === "dots") {
      for (const [x, y, r] of SPECKLES) {
        overlay.circle(x, y, r);
      }
      overlay.fill({ color: palette.pattern, alpha: 0.75 });
    } else if (kind === "stripes") {
      for (const off of [-34, 2, 38]) {
        overlay
          .roundRect(off - 7, -bh - 8, 14, bh + 16, 7)
          .fill({ color: palette.pattern, alpha: 0.4 });
      }
    } else if (kind === "swirl") {
      // Moss swirl: a spiral polyline over the upper flank.
      const cx = 24;
      const cy = -bh * 0.62;
      overlay.moveTo(cx, cy);
      for (let a = 0; a <= Math.PI * 3.6; a += 0.25) {
        const r = 2.5 + a * 3.1;
        overlay.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85);
      }
      overlay.stroke({
        width: 4.5,
        color: palette.pattern,
        alpha: 0.65,
        cap: "round",
        join: "round",
      });
    } else if (kind === "banded") {
      // Sedimentary strata: 2-3 soft horizontal bands across the lower
      // flank, like layered rock (content-bible §1.5).
      for (const y of [-bh * 0.32, -bh * 0.19, -bh * 0.07]) {
        overlay
          .roundRect(-bw * 0.42, y - bh * 0.035, bw * 0.84, bh * 0.07, bh * 0.035)
          .fill({ color: palette.pattern, alpha: 0.45 });
      }
    } else if (kind === "ripple") {
      // Tide mark: 3 nested arcs sweeping the flank, thin stroke.
      const cx = bw * 0.08;
      const cy = -bh * 0.3;
      for (const r of [bh * 0.22, bh * 0.32, bh * 0.42]) {
        overlay.moveTo(cx + r, cy);
        overlay.arc(cx, cy, r, 0, Math.PI * 1.1);
      }
      overlay.stroke({ width: 2.5, color: palette.pattern, alpha: 0.55, cap: "round" });
    } else if (kind === "ember") {
      // Rising flecks, scaled roughly 3→1 from feet to crown; the top two
      // get an extra halo ring at higher alpha.
      const flecks: readonly (readonly [number, number, number])[] = [
        [-10, -bh * 0.14, 3.2],
        [14, -bh * 0.23, 3.0],
        [-4, -bh * 0.35, 2.6],
        [20, -bh * 0.44, 2.2],
        [-16, -bh * 0.53, 1.8],
        [8, -bh * 0.65, 1.4],
        [-2, -bh * 0.77, 1.1],
      ];
      flecks.forEach(([x, y, r], i) => {
        const isTop = i >= flecks.length - 2;
        if (isTop) {
          overlay.circle(x, y, r * 2).fill({ color: palette.pattern, alpha: 0.18 });
        }
        overlay.circle(x, y, r).fill({ color: palette.pattern, alpha: isTop ? 0.9 : 0.6 });
      });
    } else if (kind === "flake") {
      // Crystal specks: six-point stars (three crossed strokes each), one
      // large + five small.
      const specks: readonly (readonly [number, number, number])[] = [
        [0, -bh * 0.55, 7],
        [-26, -bh * 0.3, 3.5],
        [20, -bh * 0.75, 3],
        [-14, -bh * 0.68, 3],
        [28, -bh * 0.42, 3.2],
        [-8, -bh * 0.85, 2.6],
      ];
      for (const [x, y, r] of specks) {
        for (const angle of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
          overlay
            .moveTo(x - Math.cos(angle) * r, y - Math.sin(angle) * r)
            .lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
        }
      }
      overlay.stroke({ width: 1.4, color: palette.pattern, alpha: 0.6, cap: "round" });
    } else if (kind === "puff") {
      // Scalloped lobes hugging the upper silhouette edge — the body
      // reads as cloud-lobed.
      const lobes: readonly (readonly [number, number, number])[] = [
        [-bw * 0.3, -bh * 0.88, bw * 0.22],
        [-bw * 0.08, -bh * 0.95, bw * 0.24],
        [bw * 0.16, -bh * 0.92, bw * 0.22],
        [bw * 0.34, -bh * 0.82, bw * 0.18],
      ];
      for (const [x, y, r] of lobes) {
        overlay.circle(x, y, r);
      }
      overlay.fill({ color: palette.pattern, alpha: 0.3 });
    } else {
      // glowdot — bioluminescent cluster: 5 dots in a loose arc, each with
      // a 2× halo in the ACCENT color (the one place the accent appears
      // on the body, content-bible §1.5).
      const dots: readonly (readonly [number, number, number])[] = [
        [-28, -bh * 0.32, 3.4],
        [-10, -bh * 0.5, 3.8],
        [12, -bh * 0.58, 3.2],
        [30, -bh * 0.44, 3.0],
        [4, -bh * 0.7, 2.6],
      ];
      for (const [x, y, r] of dots) {
        overlay.circle(x, y, r * 2).fill({ color: palette.accent, alpha: 0.2 });
      }
      for (const [x, y, r] of dots) {
        overlay.circle(x, y, r).fill({ color: palette.pattern, alpha: 0.85 });
      }
    }
    const mask = drawBlobPath(new Graphics(), bw, bh, metrics.cornerFrac).fill(0xffffff);
    overlay.mask = mask;
    rig.addChild(mask);
    rig.addChild(overlay);
    tintable.push(overlay);
  }

  // Rare iridescent variant (genome.shiny): a soft opal sheen — three
  // translucent pastel bands sweeping the upper flank, masked to the
  // body, plus a mother-of-pearl highlight. Subtle on purpose: it should
  // read as "wait… is that shimmer?" on second glance, not a recolor.
  // The scene layers occasional sparkle particles on top.
  if (genome.shiny) {
    const sheen = new Graphics();
    const bands: readonly (readonly [string, number, number])[] = [
      ["#ffd9ec", -bh * 0.82, 0.2], // pink
      ["#d3f4e2", -bh * 0.62, 0.18], // mint
      ["#dbe4ff", -bh * 0.42, 0.16], // periwinkle
    ];
    for (const [color, cy, alpha] of bands) {
      sheen.ellipse(-bw * 0.08, cy, bw * 0.56, 13).fill({ color, alpha });
    }
    sheen.ellipse(-bw * 0.22, -bh * 0.78, 14, 7).fill({ color: 0xffffff, alpha: 0.35 });
    sheen.rotation = -0.16;
    const sheenMask = drawBlobPath(new Graphics(), bw, bh, metrics.cornerFrac).fill(0xffffff);
    sheen.mask = sheenMask;
    rig.addChild(sheenMask);
    rig.addChild(sheen);
    tintable.push(sheen);
  }

  // Cheek blush.
  const blush = new Graphics()
    .circle(-bw * 0.3, -bh * 0.42, 6)
    .circle(bw * 0.3, -bh * 0.42, 6)
    .fill({ color: palette.blush, alpha: 0.55 });
  rig.addChild(blush);
  tintable.push(blush);

  // Big eyes — in their own pivoted container so blinks scale in place.
  // `eyeScale` (silhouette metric, e.g. tiny's 1.15) is a multiplier laid
  // on top of the openness scale, not a substitute for it.
  //
  // ROUND 2D item 4 — eye shape/spacing jitter: `eyeGapX` widens/narrows
  // the gap symmetrically; `eyeRx`/`eyeRy` (drawn as an ellipse — a
  // per-axis radius delta IS "eye shape" — a circle has none) vary
  // independently, so a Pip can read as slightly wide-eyed or
  // slightly squinty. `eyeRowYPx` nudges the whole row up/down. All
  // three are ≤ JITTER_MAX_EYE_PX, so at their extreme the eyeballs
  // still sit well inside even the "tiny" silhouette's body width —
  // proven in spriteResolver.test.ts. Zero jitter reproduces the exact
  // pre-2D geometry (circle r=9.5, gap 21, y −bh·0.58).
  const eyeScale = metrics.eyeScale;
  const eyeY = -bh * 0.58 + jitter.eyeRowYPx;
  const eyes = new Container();
  eyes.position.set(0, eyeY);
  eyes.scale.set(eyeScale);
  const eyeGapX = 21 + jitter.eyeSpacingPx;
  const eyeRx = 9.5 + jitter.eyeRadiusXPx;
  const eyeRy = 9.5 + jitter.eyeRadiusYPx;
  const eyeballs = new Graphics()
    .ellipse(-eyeGapX, 0, eyeRx, eyeRy)
    .ellipse(eyeGapX, 0, eyeRx, eyeRy)
    .fill("#403a4d")
    .circle(-eyeGapX - 3, -3, 3.2)
    .circle(eyeGapX - 3, -3, 3.2)
    .fill({ color: 0xffffff, alpha: 0.92 });
  eyes.addChild(eyeballs);
  rig.addChild(eyes);
  tintable.push(eyeballs);

  // Tiny contented mouth.
  const mouth = new Graphics()
    .moveTo(-6, -bh * 0.4)
    .quadraticCurveTo(0, -bh * 0.36, 6, -bh * 0.4)
    .stroke({ width: 2.5, color: palette.outline, alpha: 0.7, cap: "round" });
  rig.addChild(mouth);
  tintable.push(mouth);

  // Accent sprout — the species' one vibrant note (spec §11).
  //
  // ROUND 2D FIX STAGE: the sprout and every `crown` accessory occupy the
  // same few square pixels at the top of the head, and the shipped pass
  // let them collide — a leaf cap cut straight through an orange sprout,
  // while a red sprout appeared to sit on top of a snow cap (not a
  // z-order bug: the accessory is always drawn after, but the sprout's
  // leaf simply reached HIGHER than the cap). Displacing the sprout
  // sideways when a crown accessory is worn makes it emerge from beside
  // the hat instead of through it, and the layering then reads
  // consistently for all seven. Deliberately sideways-only: raising it
  // would push the sprout — already the tallest thing on a Pip — further
  // past the fixed box.
  const accessoryDef = resolveAccessory(genome.accessoryId);
  const wearsCrown = accessoryDef?.slot === "crown";
  const headTopY = -bh - 2;
  const sprout = new Graphics()
    .moveTo(0, headTopY + 4)
    .quadraticCurveTo(2, headTopY - 6, 6, headTopY - 12)
    .stroke({ width: 3, color: palette.accent, cap: "round" })
    .ellipse(9, headTopY - 15, 7, 4)
    .fill(palette.accent)
    .ellipse(-1, headTopY - 12, 5.5, 3.2)
    .fill({ color: palette.accent, alpha: 0.85 });
  sprout.rotation = wearsCrown ? 0.24 : -0.12;
  if (wearsCrown) sprout.position.set(7, 0);
  rig.addChild(sprout);
  tintable.push(sprout);

  // Accessory anchor (spec §11) — at the crown; round 2D item 3 is the
  // first thing that ever attaches to it (see drawAccessory's doc).
  const accessoryAnchor = new Container();
  accessoryAnchor.position.set(0, headTopY);
  rig.addChild(accessoryAnchor);
  if (accessoryDef !== null) {
    tintable.push(...drawAccessory(accessoryAnchor, accessoryDef, bw, bh));
  }

  if (stage === LifeStage.Pipling) {
    view.scale.set(PIPLING_SCALE);
  }

  return {
    view,
    rig,
    accessoryAnchor,
    genome,
    stage,
    headTopY,
    setEyesOpen(openness: number): void {
      eyes.scale.y = eyeScale * Math.max(0.08, Math.min(1, openness));
    },
    setSulkTint(on: boolean): void {
      const tint = on ? 0x9fa8a4 : 0xffffff;
      for (const part of tintable) part.tint = tint;
    },
    destroy(): void {
      view.removeFromParent();
      view.destroy({ children: true });
    },
  };
}
