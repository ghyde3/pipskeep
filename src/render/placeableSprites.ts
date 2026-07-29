/**
 * Placeable/decoration sprite resolver (spec §11 SpriteResolver
 * conventions, applied to the Keep's items): the single mapping
 * `itemId → composed Pixi display object`. Everything that draws a
 * placed item goes through `resolvePlaceableSprite` — dropping in real
 * item art later means swapping this file's internals, nothing else.
 *
 * Anchor convention (render/gridLayout.ts `footprintAnchor`): local
 * (0, 0) is the BOTTOM-CENTER of the item's footprint rect; standing
 * items draw upward (negative y), flat decals draw around it. All
 * dimensions derive from the tile size so items scale with the diorama.
 *
 * The returned rig:
 *   view (positioned by the scene at the footprint anchor)
 *   └─ wrap (drop/squash animations — pivot at the anchor)
 * plus `flat`: ground decals (pebble path, shell mosaic) render UNDER
 * pips (no depth sorting against them) and never block wandering.
 *
 * Pure construction — no timers, no state reads, no randomness.
 */

import { Container, Graphics } from "pixi.js";
import type { FootprintView } from "./gridLayout";

export interface PlaceableSprite {
  /** Root — position at the footprint's bottom-center anchor. */
  readonly view: Container;
  /** Animation target (drop squash, move hop) — pivot at the anchor. */
  readonly wrap: Container;
  /** Ground decal: y-sorts under pips and does not block wandering. */
  readonly flat: boolean;
  destroy(): void;
}

/** Render-side placeholder tones for items (soft pastels, spec §11). */
const tone = {
  woodLight: "#d9b98c",
  wood: "#c49a6b",
  woodDark: "#9a7449",
  wicker: "#d8b878",
  wickerDark: "#b3924f",
  berry: "#e0607e",
  berryLeaf: "#7fb371",
  fiber: "#e8d9b0",
  cushion: "#aac6e8",
  cushionEdge: "#7d9cc4",
  pillow: "#f3f6fb",
  pebble: "#c9c3b8",
  pebbleDark: "#a8a297",
  moss: "#8fbf79",
  mossDark: "#6b9d58",
  soil: "#8a6f52",
  shellPink: "#f2c8c2",
  shellCream: "#f6ead8",
  shellBlue: "#bfd9e2",
  lanternGlow: "#ffd98a",
  lanternBody: "#e8b45c",
  metal: "#8d8577",
  shadow: 0x3a4a3a,
} as const;

type DrawFn = (wrap: Container, w: number, h: number, tileW: number) => void;

function ground(wrap: Container, w: number): void {
  const g = new Graphics()
    .ellipse(0, 0, w * 0.42, w * 0.13)
    .fill({ color: tone.shadow, alpha: 0.12 });
  wrap.addChild(g);
}

// ---------------------------------------------------------------------------
// Stations (content/placeables.ts)
// ---------------------------------------------------------------------------

const drawFoodBowl: DrawFn = (wrap, w) => {
  ground(wrap, w);
  const g = new Graphics();
  const bw = w * 0.36; // bowl half-width
  // Bowl body: squat rounded dish.
  g.ellipse(0, -bw * 0.34, bw, bw * 0.42).fill(tone.wood);
  g.ellipse(0, -bw * 0.62, bw * 0.94, bw * 0.3).fill(tone.woodDark);
  g.ellipse(0, -bw * 0.62, bw * 0.78, bw * 0.22).fill("#6f5233");
  // Berries heaped inside.
  for (const [bx, by, r] of [
    [-bw * 0.34, -bw * 0.66, bw * 0.2],
    [bw * 0.1, -bw * 0.78, bw * 0.22],
    [bw * 0.42, -bw * 0.6, bw * 0.18],
  ] as const) {
    g.circle(bx, by, r).fill(tone.berry);
    g.circle(bx - r * 0.3, by - r * 0.35, r * 0.3).fill({
      color: 0xffffff,
      alpha: 0.35,
    });
  }
  // A leafy sprig.
  g.ellipse(-bw * 0.05, -bw * 1.02, bw * 0.16, bw * 0.08).fill(tone.berryLeaf);
  g.ellipse(0, -bw * 0.14, bw, bw * 0.36).stroke({
    width: Math.max(1.5, w * 0.02),
    color: tone.woodDark,
    alpha: 0.5,
  });
  wrap.addChild(g);
};

const drawBed: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w);
  const g = new Graphics();
  const bw = w * 0.86;
  const bh = tileW * 0.52;
  // Cushion: fat rounded slab.
  g.roundRect(-bw / 2, -bh, bw, bh, bh * 0.48)
    .fill(tone.cushion)
    .stroke({ width: Math.max(1.5, tileW * 0.03), color: tone.cushionEdge, alpha: 0.55 });
  // Top surface highlight.
  g.roundRect(-bw / 2 + bh * 0.16, -bh + bh * 0.14, bw - bh * 0.32, bh * 0.42, bh * 0.3)
    .fill({ color: 0xffffff, alpha: 0.22 });
  // Pillow at the left end.
  g.roundRect(-bw / 2 + bh * 0.18, -bh - bh * 0.28, bh * 1.15, bh * 0.62, bh * 0.28)
    .fill(tone.pillow)
    .stroke({ width: 1.5, color: tone.cushionEdge, alpha: 0.4 });
  // Stitch dimples.
  for (const sx of [-bw * 0.12, bw * 0.14, bw * 0.34]) {
    g.circle(sx, -bh * 0.5, Math.max(1.2, bh * 0.05)).fill({
      color: tone.cushionEdge,
      alpha: 0.5,
    });
  }
  wrap.addChild(g);
};

const drawGatheringStation: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.9);
  const g = new Graphics();
  const bw = w * 0.34; // basket half-width
  const bh = tileW * 0.72; // basket height
  const stroke = Math.max(1.5, tileW * 0.03);
  // Big wicker basket: flared sides.
  g.poly([-bw, -bh, bw, -bh, bw * 0.74, 0, -bw * 0.74, 0])
    .fill(tone.wicker)
    .stroke({ width: stroke, color: tone.wickerDark, alpha: 0.7 });
  // Weave bands.
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const y = -bh * (1 - t);
    const half = bw * (1 - 0.26 * t);
    g.moveTo(-half, y)
      .quadraticCurveTo(0, y + bh * 0.06, half, y)
      .stroke({ width: stroke * 0.8, color: tone.wickerDark, alpha: 0.45 });
  }
  // Rim + gathered goods peeking out.
  g.ellipse(0, -bh, bw * 1.04, bh * 0.14).fill(tone.wickerDark);
  g.circle(-bw * 0.4, -bh * 1.08, bw * 0.2).fill(tone.berry);
  g.circle(bw * 0.05, -bh * 1.16, bw * 0.22).fill(tone.fiber);
  g.circle(bw * 0.48, -bh * 1.06, bw * 0.18).fill(tone.berry);
  // Leaning gathering tool: a long-handled rake.
  const hx = bw * 1.5;
  g.moveTo(hx, -tileW * 1.5)
    .lineTo(bw * 0.95, 0)
    .stroke({ width: stroke * 1.4, color: tone.woodDark, cap: "round" });
  for (const spread of [-0.16, 0, 0.16]) {
    g.moveTo(hx, -tileW * 1.5)
      .lineTo(hx + tileW * (spread + 0.06), -tileW * 1.78)
      .stroke({ width: stroke, color: tone.woodDark, cap: "round" });
  }
  // A small crate beside the basket.
  const cw = bw * 0.6;
  g.roundRect(-bw - cw * 1.3, -cw, cw * 1.3, cw, cw * 0.16)
    .fill(tone.woodLight)
    .stroke({ width: stroke * 0.8, color: tone.woodDark, alpha: 0.6 });
  g.moveTo(-bw - cw * 1.3, -cw * 0.5)
    .lineTo(-bw, -cw * 0.5)
    .stroke({ width: stroke * 0.7, color: tone.woodDark, alpha: 0.4 });
  wrap.addChild(g);
};

// ---------------------------------------------------------------------------
// Decorations (content/decorations.ts) — six placeholder looks
// ---------------------------------------------------------------------------

const drawPebblePath: DrawFn = (wrap, w) => {
  const g = new Graphics();
  const u = w * 0.5;
  const pebbles: readonly (readonly [number, number, number, number])[] = [
    [-u * 0.5, -u * 0.34, u * 0.24, u * 0.15],
    [u * 0.28, -u * 0.42, u * 0.2, u * 0.13],
    [-u * 0.05, -u * 0.12, u * 0.27, u * 0.17],
    [u * 0.52, -u * 0.1, u * 0.18, u * 0.12],
    [-u * 0.55, u * 0.04, u * 0.16, u * 0.11],
  ];
  pebbles.forEach(([px, py, rx, ry], i) => {
    g.ellipse(px, py - u * 0.3, rx, ry).fill(
      i % 2 === 0 ? tone.pebble : tone.pebbleDark,
    );
    g.ellipse(px - rx * 0.25, py - u * 0.3 - ry * 0.3, rx * 0.4, ry * 0.35).fill({
      color: 0xffffff,
      alpha: 0.25,
    });
  });
  wrap.addChild(g);
};

const drawMossTuft: DrawFn = (wrap, w) => {
  ground(wrap, w * 0.8);
  const g = new Graphics();
  const u = w * 0.5;
  // Mossy mound.
  g.ellipse(0, -u * 0.22, u * 0.62, u * 0.34).fill(tone.moss);
  g.ellipse(-u * 0.16, -u * 0.34, u * 0.36, u * 0.22).fill(tone.mossDark);
  // Grass blades.
  for (const [bx, lean] of [
    [-u * 0.4, -0.5],
    [-u * 0.1, -0.12],
    [u * 0.18, 0.2],
    [u * 0.44, 0.55],
  ] as const) {
    g.moveTo(bx, -u * 0.3)
      .quadraticCurveTo(bx + lean * u * 0.25, -u * 0.75, bx + lean * u * 0.45, -u * 0.95)
      .stroke({ width: Math.max(1.5, u * 0.07), color: tone.mossDark, cap: "round" });
  }
  // One tiny flower.
  g.circle(u * 0.1, -u * 0.62, u * 0.08).fill("#f6a8b8");
  wrap.addChild(g);
};

const drawBerryPlanter: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w);
  const g = new Graphics();
  const u = w * 0.5;
  const stroke = Math.max(1.5, tileW * 0.03);
  // Wooden box.
  g.roundRect(-u * 0.7, -u * 0.62, u * 1.4, u * 0.62, u * 0.08)
    .fill(tone.woodLight)
    .stroke({ width: stroke, color: tone.woodDark, alpha: 0.65 });
  g.moveTo(-u * 0.7, -u * 0.32)
    .lineTo(u * 0.7, -u * 0.32)
    .stroke({ width: stroke * 0.8, color: tone.woodDark, alpha: 0.4 });
  // Soil line + bush.
  g.ellipse(0, -u * 0.6, u * 0.62, u * 0.12).fill(tone.soil);
  g.ellipse(0, -u * 0.92, u * 0.5, u * 0.34).fill(tone.berryLeaf);
  g.ellipse(-u * 0.28, -u * 0.8, u * 0.24, u * 0.18).fill(tone.mossDark);
  for (const [bx, by] of [
    [-u * 0.26, -u * 0.98],
    [u * 0.06, -u * 1.1],
    [u * 0.32, -u * 0.9],
  ] as const) {
    g.circle(bx, by, u * 0.11).fill(tone.berry);
  }
  wrap.addChild(g);
};

const drawDriftwoodArch: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.95);
  const g = new Graphics();
  const half = w * 0.36;
  const top = -tileW * 1.7;
  const stroke = Math.max(2.5, tileW * 0.09);
  // Two bowed driftwood posts meeting in a lintel curve.
  g.moveTo(-half, 0)
    .quadraticCurveTo(-half * 1.25, top * 0.55, -half * 0.55, top)
    .quadraticCurveTo(0, top * 1.18, half * 0.55, top)
    .quadraticCurveTo(half * 1.25, top * 0.55, half, 0)
    .stroke({ width: stroke, color: tone.woodLight, cap: "round" });
  // Grain streaks + knots.
  g.moveTo(-half * 0.95, -tileW * 0.35)
    .quadraticCurveTo(-half * 1.05, top * 0.5, -half * 0.6, top * 0.9)
    .stroke({ width: stroke * 0.3, color: tone.woodDark, alpha: 0.45, cap: "round" });
  g.moveTo(half * 0.95, -tileW * 0.35)
    .quadraticCurveTo(half * 1.05, top * 0.5, half * 0.6, top * 0.9)
    .stroke({ width: stroke * 0.3, color: tone.woodDark, alpha: 0.45, cap: "round" });
  g.circle(-half * 0.98, -tileW * 0.6, stroke * 0.28).fill({
    color: tone.woodDark,
    alpha: 0.55,
  });
  g.circle(half * 0.9, -tileW * 0.9, stroke * 0.24).fill({
    color: tone.woodDark,
    alpha: 0.55,
  });
  // A sprout on the lintel.
  g.ellipse(0, top * 1.12, stroke * 0.55, stroke * 0.3).fill(tone.moss);
  wrap.addChild(g);
};

const drawShellMosaic: DrawFn = (wrap, w) => {
  const g = new Graphics();
  const u = w * 0.5;
  // Sandy base disc (flat decal).
  g.ellipse(0, -u * 0.3, u * 0.8, u * 0.42).fill({
    color: tone.shellCream,
    alpha: 0.9,
  });
  g.ellipse(0, -u * 0.3, u * 0.8, u * 0.42).stroke({
    width: Math.max(1.5, u * 0.03),
    color: tone.pebbleDark,
    alpha: 0.4,
  });
  // Ring of shells.
  const shellColors = [tone.shellPink, tone.shellBlue, tone.shellCream];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const sx = Math.cos(a) * u * 0.55;
    const sy = -u * 0.3 + Math.sin(a) * u * 0.26;
    g.ellipse(sx, sy, u * 0.1, u * 0.075).fill(shellColors[i % 3] ?? tone.shellCream);
    g.moveTo(sx - u * 0.05, sy)
      .lineTo(sx + u * 0.05, sy)
      .stroke({ width: 1, color: tone.pebbleDark, alpha: 0.35 });
  }
  // Center spiral shell.
  g.circle(0, -u * 0.3, u * 0.14).fill(tone.shellPink);
  g.circle(u * 0.03, -u * 0.32, u * 0.07).fill(tone.shellCream);
  wrap.addChild(g);
};

const drawCozyLantern: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.8);
  const g = new Graphics();
  const u = w * 0.5;
  const stroke = Math.max(1.5, tileW * 0.035);
  // Warm halo behind everything.
  g.circle(0, -tileW * 1.05, u * 0.85).fill({ color: tone.lanternGlow, alpha: 0.28 });
  // Post.
  g.roundRect(-u * 0.08, -tileW * 0.95, u * 0.16, tileW * 0.95, u * 0.06).fill(
    tone.woodDark,
  );
  // Lantern box.
  const lw = u * 0.52;
  const ly = -tileW * 1.05;
  g.roundRect(-lw / 2, ly - lw * 0.6, lw, lw * 1.2, lw * 0.14)
    .fill(tone.lanternBody)
    .stroke({ width: stroke, color: tone.metal, alpha: 0.7 });
  // Glowing pane + flame.
  g.roundRect(-lw * 0.32, ly - lw * 0.42, lw * 0.64, lw * 0.84, lw * 0.1).fill(
    tone.lanternGlow,
  );
  g.ellipse(0, ly + lw * 0.1, lw * 0.13, lw * 0.2).fill("#f28c3b");
  // Cap + ring.
  g.poly([-lw * 0.6, ly - lw * 0.6, lw * 0.6, ly - lw * 0.6, 0, ly - lw * 1.05]).fill(
    tone.metal,
  );
  g.circle(0, ly - lw * 1.12, lw * 0.12).stroke({ width: stroke, color: tone.metal });
  wrap.addChild(g);
};

/** Unknown item id — a friendly placeholder crate, never a crash. */
const drawFallbackCrate: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w);
  const g = new Graphics();
  const u = Math.min(w, tileW * 1.4) * 0.5;
  g.roundRect(-u * 0.6, -u * 1.1, u * 1.2, u * 1.1, u * 0.12)
    .fill(tone.woodLight)
    .stroke({ width: Math.max(1.5, u * 0.06), color: tone.woodDark, alpha: 0.6 });
  g.moveTo(-u * 0.6, -u * 0.55)
    .lineTo(u * 0.6, -u * 0.55)
    .stroke({ width: Math.max(1, u * 0.05), color: tone.woodDark, alpha: 0.45 });
  g.circle(0, -u * 0.55, u * 0.16).stroke({
    width: Math.max(1.5, u * 0.06),
    color: tone.woodDark,
    alpha: 0.5,
  });
  wrap.addChild(g);
};

/** THE mapping. Flat entries are ground decals (walkable, under pips). */
const RESOLVERS: Readonly<Record<string, { draw: DrawFn; flat: boolean }>> = {
  "food-bowl": { draw: drawFoodBowl, flat: false },
  bed: { draw: drawBed, flat: false },
  "gathering-station": { draw: drawGatheringStation, flat: false },
  "pebble-path": { draw: drawPebblePath, flat: true },
  "moss-tuft": { draw: drawMossTuft, flat: false },
  "berry-planter": { draw: drawBerryPlanter, flat: false },
  "driftwood-arch": { draw: drawDriftwoodArch, flat: false },
  "shell-mosaic": { draw: drawShellMosaic, flat: true },
  "cozy-lantern": { draw: drawCozyLantern, flat: false },
};

/** Item ids that render as flat ground decals (also consulted by the
 * scene's wander occupancy — flat items never block pips). */
export function isFlatItem(itemId: string): boolean {
  return RESOLVERS[itemId]?.flat ?? false;
}

/**
 * Compose the placeholder sprite for a placed item. `footprint` and the
 * tile dimensions size the drawing; unknown ids get the fallback crate
 * (content validation warns loudly in dev — rendering never crashes).
 */
export function resolvePlaceableSprite(
  itemId: string,
  footprint: FootprintView,
  tileW: number,
  tileH: number,
): PlaceableSprite {
  const view = new Container();
  const wrap = new Container();
  view.addChild(wrap);

  const entry = RESOLVERS[itemId] ?? { draw: drawFallbackCrate, flat: false };
  entry.draw(wrap, footprint.w * tileW, footprint.h * tileH, tileW);

  return {
    view,
    wrap,
    flat: entry.flat,
    destroy(): void {
      view.removeFromParent();
      view.destroy({ children: true });
    },
  };
}
