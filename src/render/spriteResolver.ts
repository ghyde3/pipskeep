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
 */

import { Container, Graphics } from "pixi.js";
import { LifeStage } from "../core/pips/types";
import type { TraitGenome } from "../core/pips/types";
import { resolvePipPalette } from "../content/palette";
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
const SILHOUETTES: Readonly<Record<Silhouette, {
  readonly wFrac: number;
  readonly hFrac: number;
  readonly cornerFrac: number;
  readonly shadowScale: number;
  readonly eyeScale: number;
}>> = {
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

/** This species' silhouette, content-driven (absent → "round", so Mosspip/
 * Grovepip and any species that never sets the field are unaffected). */
function resolveSilhouette(speciesId: SpeciesId): Silhouette {
  return contentSpecies[speciesId]?.sprite.silhouette ?? "round";
}

export interface PipSprite {
  /** Root — position at the Pip's feet; never scaled by animations. */
  readonly view: Container;
  /** Animation rig — squash/stretch/rotate/offset this. Pivot at feet. */
  readonly rig: Container;
  /** Accessory anchor point (spec §11) at the top of the head. Phase 5+
   * accessories attach here; `genome.accessorySlots` says how many. */
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
 * Compose the placeholder Pip for `(genome, stage)` (spec §11).
 * Pure construction: no timers, no state reads — the scene drives blinks,
 * poses, and lifecycles.
 *
 * `variantId` (content-bible §8.2.2): when given, used instead of
 * `genome.palette` to resolve the palette — the evolution gift variant's
 * look (`content/palette.ts`'s per-species `variants` map is keyed by
 * BOTH birth palette ids and gift-variant ids, so this is the same
 * lookup, just a different key).
 */
export function resolvePipSprite(
  genome: TraitGenome,
  stage: LifeStage,
  variantId?: string,
): PipSprite {
  const silhouette = resolveSilhouette(genome.speciesId);
  const metrics = SILHOUETTES[silhouette];
  const bw = PIP_BODY_WIDTH * metrics.wFrac;
  const bh = PIP_BODY_HEIGHT * metrics.hFrac;
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
  const eyeScale = metrics.eyeScale;
  const eyeY = -bh * 0.58;
  const eyes = new Container();
  eyes.position.set(0, eyeY);
  eyes.scale.set(eyeScale);
  const eyeballs = new Graphics()
    .circle(-21, 0, 9.5)
    .circle(21, 0, 9.5)
    .fill("#403a4d")
    .circle(-24, -3, 3.2)
    .circle(18, -3, 3.2)
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
  const headTopY = -bh - 2;
  const sprout = new Graphics()
    .moveTo(0, headTopY + 4)
    .quadraticCurveTo(2, headTopY - 6, 6, headTopY - 12)
    .stroke({ width: 3, color: palette.accent, cap: "round" })
    .ellipse(9, headTopY - 15, 7, 4)
    .fill(palette.accent)
    .ellipse(-1, headTopY - 12, 5.5, 3.2)
    .fill({ color: palette.accent, alpha: 0.85 });
  sprout.rotation = -0.12;
  rig.addChild(sprout);
  tintable.push(sprout);

  // Accessory anchor (spec §11) — empty, at the crown.
  const accessoryAnchor = new Container();
  accessoryAnchor.position.set(0, headTopY);
  rig.addChild(accessoryAnchor);

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
