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
 */

import { Container, Graphics } from "pixi.js";
import { LifeStage } from "../core/pips/types";
import type { TraitGenome } from "../core/pips/types";
import { resolvePipPalette } from "../content/palette";

/** Piplings render at 0.7 scale (spec task/§11 placeholder standard). */
export const PIPLING_SCALE = 0.7;

/** Body metrics (view-local px, adult scale). Exported for scene layout. */
export const PIP_BODY_WIDTH = 118;
export const PIP_BODY_HEIGHT = 98;

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
   * scene anchors speech bubbles / hearts / Z's off this. */
  readonly headTopY: number;
  /** 1 = wide open, 0 = shut. Blinking is the scene's timer. */
  setEyesOpen(openness: number): void;
  /** Sulking look (spec task): greyed tint; pose slump is the rig's job. */
  setSulkTint(on: boolean): void;
  destroy(): void;
}

type PatternKind = "none" | "dots" | "stripes" | "swirl";

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

function drawBlobPath(g: Graphics): Graphics {
  // Rounded blob: a fat roundRect reads as a soft bean at high radius.
  return g.roundRect(
    -PIP_BODY_WIDTH / 2,
    -PIP_BODY_HEIGHT,
    PIP_BODY_WIDTH,
    PIP_BODY_HEIGHT,
    PIP_BODY_WIDTH * 0.46,
  );
}

/**
 * Compose the placeholder Pip for `(genome, stage)` (spec §11).
 * Pure construction: no timers, no state reads — the scene drives blinks,
 * poses, and lifecycles.
 */
export function resolvePipSprite(
  genome: TraitGenome,
  stage: LifeStage,
): PipSprite {
  const palette = resolvePipPalette(genome.speciesId, genome.palette);
  const view = new Container();
  const rig = new Container();
  const tintable: Graphics[] = [];

  // Ground shadow — outside the rig so squashes don't lift it.
  const shadow = new Graphics()
    .ellipse(0, 4, PIP_BODY_WIDTH * 0.38, 9)
    .fill({ color: 0x3a4a3a, alpha: 0.14 });
  view.addChild(shadow);
  view.addChild(rig);

  // Body blob.
  const body = drawBlobPath(new Graphics())
    .fill(palette.body)
    .stroke({ width: 3, color: palette.outline, alpha: 0.35 });
  rig.addChild(body);
  tintable.push(body);

  // Belly patch.
  const belly = new Graphics()
    .ellipse(0, -PIP_BODY_HEIGHT * 0.3, PIP_BODY_WIDTH * 0.27, PIP_BODY_HEIGHT * 0.21)
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
          .roundRect(off - 7, -PIP_BODY_HEIGHT - 8, 14, PIP_BODY_HEIGHT + 16, 7)
          .fill({ color: palette.pattern, alpha: 0.4 });
      }
    } else {
      // Moss swirl: a spiral polyline over the upper flank.
      const cx = 24;
      const cy = -PIP_BODY_HEIGHT * 0.62;
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
    }
    const mask = drawBlobPath(new Graphics()).fill(0xffffff);
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
      ["#ffd9ec", -PIP_BODY_HEIGHT * 0.82, 0.2], // pink
      ["#d3f4e2", -PIP_BODY_HEIGHT * 0.62, 0.18], // mint
      ["#dbe4ff", -PIP_BODY_HEIGHT * 0.42, 0.16], // periwinkle
    ];
    for (const [color, cy, alpha] of bands) {
      sheen
        .ellipse(-PIP_BODY_WIDTH * 0.08, cy, PIP_BODY_WIDTH * 0.56, 13)
        .fill({ color, alpha });
    }
    sheen
      .ellipse(-PIP_BODY_WIDTH * 0.22, -PIP_BODY_HEIGHT * 0.78, 14, 7)
      .fill({ color: 0xffffff, alpha: 0.35 });
    sheen.rotation = -0.16;
    const sheenMask = drawBlobPath(new Graphics()).fill(0xffffff);
    sheen.mask = sheenMask;
    rig.addChild(sheenMask);
    rig.addChild(sheen);
    tintable.push(sheen);
  }

  // Cheek blush.
  const blush = new Graphics()
    .circle(-PIP_BODY_WIDTH * 0.3, -PIP_BODY_HEIGHT * 0.42, 6)
    .circle(PIP_BODY_WIDTH * 0.3, -PIP_BODY_HEIGHT * 0.42, 6)
    .fill({ color: palette.blush, alpha: 0.55 });
  rig.addChild(blush);
  tintable.push(blush);

  // Big eyes — in their own pivoted container so blinks scale in place.
  const eyeY = -PIP_BODY_HEIGHT * 0.58;
  const eyes = new Container();
  eyes.position.set(0, eyeY);
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
    .moveTo(-6, -PIP_BODY_HEIGHT * 0.4)
    .quadraticCurveTo(0, -PIP_BODY_HEIGHT * 0.36, 6, -PIP_BODY_HEIGHT * 0.4)
    .stroke({ width: 2.5, color: palette.outline, alpha: 0.7, cap: "round" });
  rig.addChild(mouth);
  tintable.push(mouth);

  // Accent sprout — the species' one vibrant note (spec §11).
  const headTopY = -PIP_BODY_HEIGHT - 2;
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
      eyes.scale.y = Math.max(0.08, Math.min(1, openness));
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
