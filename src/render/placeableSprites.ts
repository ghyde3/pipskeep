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
  // ROUND 2B (content bible §8.2.1) — the fourteen new decorations' + one
  // new placeable's own placeholder tones, kept in the same soft-pastel
  // family (spec §11) as the shipped six.
  driftLight: "#cbb89a",
  driftDark: "#a08768",
  thornGreen: "#5f8a4f",
  thornGreenDark: "#436439",
  berryRed: "#c2554a",
  paintRed: "#c2554a",
  paintBlue: "#4d7ea8",
  canvasA: "#f2b6a0",
  canvasB: "#f6d9a0",
  canvasEdge: "#d98f78",
  kitePaper: "#f4c66b",
  kiteAccent: "#e0607e",
  water: "#8fc7d9",
  waterDeep: "#5fa0b8",
  emberGlow: "#ff8a3d",
  emberCore: "#ffce6b",
  charcoal: "#4a423a",
  potBody: "#6b665e",
  potDark: "#4a463f",
  gold: "#e8c468",
  // ROUND 2F (progression bible §5.1/§5.2) — the nine new stations' and
  // twelve new decorations' own tones. Same soft-pastel family (spec §11).
  // WHY THIS BLOCK EXISTS: the round doubled the catalog to 45 items to
  // answer "we need reasons to build", and 21 of them had no `RESOLVERS`
  // entry — so the tier-10 Beacon (12 Wood + 5 Shell + 3 Driftwood) and a
  // 3-Fiber Clover Patch both rendered as the identical placeholder crate.
  // A build reward the player cannot SEE is the dead-feature class spec §16
  // v1.3 made a standing rule against, so every catalog id now draws.
  snow: "#eef4fb",
  snowShade: "#cbdcee",
  ice: "#c3e6f4",
  iceDeep: "#8ec7e0",
  hay: "#e6c56a",
  hayDark: "#bf9c43",
  pine: "#5c8d64",
  pineDark: "#3e6749",
  clover: "#84c46d",
  fernGreen: "#79ae6c",
  glowCool: "#a6ebda",
  glowCoolDeep: "#5cb7a6",
  linen: "#f1e7d4",
  soap: "#dbeaf5",
  stoneWarm: "#d6b39a",
  netTwine: "#cbb98f",
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

const drawStockpot: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.85);
  const g = new Graphics();
  const bw = w * 0.32; // pot half-width
  const bh = tileW * 0.6;
  const stroke = Math.max(1.5, tileW * 0.035);
  // Three stubby legs.
  for (const lx of [-bw * 0.55, 0, bw * 0.55]) {
    g.roundRect(lx - stroke * 0.5, -bh * 0.18, stroke, bh * 0.22, stroke * 0.4).fill(
      tone.potDark,
    );
  }
  // Round-bellied pot body.
  g.ellipse(0, -bh * 0.5, bw, bh * 0.42)
    .fill(tone.potBody)
    .stroke({ width: stroke, color: tone.potDark, alpha: 0.6 });
  g.ellipse(0, -bh * 0.5, bw * 0.7, bh * 0.24).fill({ color: 0xffffff, alpha: 0.08 });
  // Rim + two little handles.
  g.ellipse(0, -bh * 0.86, bw * 0.62, bw * 0.16).fill(tone.potDark);
  g.ellipse(-bw * 0.92, -bh * 0.72, bw * 0.14, bw * 0.1).stroke({
    width: stroke * 0.8,
    color: tone.potDark,
  });
  g.ellipse(bw * 0.92, -bh * 0.72, bw * 0.14, bw * 0.1).stroke({
    width: stroke * 0.8,
    color: tone.potDark,
  });
  // Something is always simmering: a soft glow and a wisp of steam.
  g.ellipse(0, -bh * 0.86, bw * 0.5, bw * 0.12).fill({
    color: tone.emberGlow,
    alpha: 0.22,
  });
  g.moveTo(-bw * 0.15, -bh * 0.95)
    .quadraticCurveTo(-bw * 0.35, -bh * 1.25, -bw * 0.1, -bh * 1.5)
    .stroke({ width: stroke * 0.6, color: 0xffffff, alpha: 0.35, cap: "round" });
  g.moveTo(bw * 0.18, -bh * 0.95)
    .quadraticCurveTo(bw * 0.02, -bh * 1.22, bw * 0.28, -bh * 1.48)
    .stroke({ width: stroke * 0.6, color: 0xffffff, alpha: 0.3, cap: "round" });
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

// ---------------------------------------------------------------------------
// ROUND 2B decorations (content bible §5.1/§8.2.1) — fourteen more looks,
// none of them a crate.
// ---------------------------------------------------------------------------

const drawWelcomeSign: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.7);
  const g = new Graphics();
  const u = w * 0.5;
  const stroke = Math.max(1.5, tileW * 0.035);
  // Post, planted a little crooked (spec §15.5: "completely sincere").
  g.moveTo(-u * 0.04, 0)
    .lineTo(u * 0.1, -tileW * 1.05)
    .stroke({ width: stroke * 1.4, color: tone.woodDark, cap: "round" });
  // Plank, hung slightly askew.
  g.roundRect(-u * 0.72, -tileW * 1.32, u * 1.44, tileW * 0.5, u * 0.06)
    .fill(tone.woodLight)
    .stroke({ width: stroke, color: tone.woodDark, alpha: 0.6 });
  // Hand-painted squiggle "lettering" — nobody claimed it was neat.
  for (const [dy, len] of [
    [-tileW * 1.14, 0.5],
    [-tileW * 1.0, 0.32],
  ] as const) {
    g.moveTo(-u * 0.5, dy)
      .quadraticCurveTo(-u * 0.5 + u * len * 0.5, dy - u * 0.06, -u * 0.5 + u * len, dy)
      .stroke({ width: stroke * 0.7, color: tone.paintRed, alpha: 0.85, cap: "round" });
  }
  wrap.addChild(g);
};

const drawToadstoolRing: DrawFn = (wrap, w) => {
  const g = new Graphics();
  const u = w * 0.5;
  // Flat decal (content bible §8.2.1): a ring you stand IN, not around.
  g.ellipse(0, -u * 0.28, u * 0.75, u * 0.24).fill({ color: tone.moss, alpha: 0.2 });
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cx = Math.cos(a) * u * 0.62;
    const cy = -u * 0.28 + Math.sin(a) * u * 0.2;
    const r = u * (0.09 + 0.02 * (i % 2));
    g.moveTo(cx, cy).lineTo(cx, cy - r * 1.6).stroke({ width: r * 0.35, color: "#f2e6d3" });
    g.ellipse(cx, cy - r * 1.7, r, r * 0.62).fill(tone.berryRed);
    for (const [ox, oy] of [
      [-r * 0.3, -r * 0.15],
      [r * 0.25, -r * 0.3],
    ] as const) {
      g.circle(cx + ox, cy - r * 1.7 + oy, r * 0.18).fill({ color: 0xffffff, alpha: 0.8 });
    }
  }
  wrap.addChild(g);
};

const drawBrambleArch: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.9);
  const g = new Graphics();
  const half = w * 0.36;
  const top = -tileW * 1.55;
  const stroke = Math.max(2, tileW * 0.07);
  // Two thorny hedge posts meeting overhead.
  g.moveTo(-half, 0)
    .quadraticCurveTo(-half * 1.1, top * 0.6, -half * 0.5, top)
    .quadraticCurveTo(0, top * 1.15, half * 0.5, top)
    .quadraticCurveTo(half * 1.1, top * 0.6, half, 0)
    .stroke({ width: stroke * 1.6, color: tone.thornGreen, cap: "round" });
  // Thorn spikes and a few defiant berries.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const x = -half * 0.9 + half * 1.8 * t;
    const y = top * (0.15 + 0.75 * Math.sin(Math.PI * t));
    const spike = stroke * 0.9;
    g.moveTo(x, y)
      .lineTo(x + (i % 2 === 0 ? spike : -spike), y - spike)
      .stroke({ width: stroke * 0.35, color: tone.thornGreenDark, cap: "round" });
    if (i % 3 === 1) g.circle(x, y - spike * 0.3, stroke * 0.4).fill(tone.berryRed);
  }
  wrap.addChild(g);
};

const drawTwineSwing: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.7);
  const g = new Graphics();
  const half = w * 0.4;
  const beamY = -tileW * 1.9;
  const seatY = -tileW * 0.55;
  const stroke = Math.max(1.5, tileW * 0.03);
  // Overhead beam (a convenient branch).
  g.moveTo(-half, beamY).lineTo(half, beamY).stroke({
    width: stroke * 1.6,
    color: tone.woodDark,
    cap: "round",
  });
  // Two twine ropes down to a plank seat.
  for (const rx of [-half * 0.4, half * 0.4]) {
    g.moveTo(rx, beamY).lineTo(rx * 0.65, seatY).stroke({
      width: stroke * 0.7,
      color: tone.fiber,
    });
  }
  g.roundRect(-half * 0.55, seatY, half * 1.1, tileW * 0.16, tileW * 0.04)
    .fill(tone.woodLight)
    .stroke({ width: stroke, color: tone.woodDark, alpha: 0.6 });
  wrap.addChild(g);
};

const drawStoryStump: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.9);
  const g = new Graphics();
  const u = w * 0.5;
  const bh = tileW * 0.5;
  const stroke = Math.max(1.5, tileW * 0.03);
  // Wide, worn-smooth stump.
  g.ellipse(0, -bh * 0.62, u * 0.72, bh * 0.42)
    .fill(tone.woodLight)
    .stroke({ width: stroke, color: tone.woodDark, alpha: 0.6 });
  g.ellipse(0, -bh, u * 0.7, bh * 0.4).fill(tone.woodLight);
  // Growth rings, worn smooth by generations of Pips sitting around it.
  for (const s of [0.5, 0.32, 0.15]) {
    g.ellipse(0, -bh, u * 0.7 * s, bh * 0.4 * s).stroke({
      width: stroke * 0.6,
      color: tone.woodDark,
      alpha: 0.4,
    });
  }
  g.ellipse(0, -bh * 0.62, u * 0.72, bh * 0.42).stroke({
    width: stroke,
    color: tone.woodDark,
    alpha: 0.5,
  });
  wrap.addChild(g);
};

const drawSunAwning: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.8);
  const g = new Graphics();
  const half = w * 0.46;
  const top = -tileW * 2.1;
  const postY = -tileW * 1.9;
  const stroke = Math.max(1.5, tileW * 0.03);
  // Two support posts.
  for (const px of [-half * 0.86, half * 0.86]) {
    g.moveTo(px, 0).lineTo(px, postY).stroke({ width: stroke * 1.3, color: tone.woodDark });
  }
  // Striped canvas top, scalloped along the front edge.
  const stripes = 6;
  for (let i = 0; i < stripes; i++) {
    const x0 = -half + (i / stripes) * half * 2;
    const x1 = -half + ((i + 1) / stripes) * half * 2;
    g.poly([x0, top, x1, top, x1, postY, x0, postY]).fill(
      i % 2 === 0 ? tone.canvasA : tone.canvasB,
    );
  }
  for (let i = 0; i < stripes; i++) {
    const cx = -half + ((i + 0.5) / stripes) * half * 2;
    g.moveTo(cx - half / stripes, postY)
      .quadraticCurveTo(cx, postY + tileW * 0.18, cx + half / stripes, postY)
      .fill(tone.canvasEdge);
  }
  g.moveTo(-half, top).lineTo(half, top).stroke({
    width: stroke * 0.8,
    color: tone.canvasEdge,
    alpha: 0.6,
  });
  wrap.addChild(g);
};

const drawCloudKite: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.6);
  const g = new Graphics();
  const u = w * 0.5;
  const stroke = Math.max(1.5, tileW * 0.03);
  const postTop = -tileW * 1.1;
  g.moveTo(0, 0).lineTo(u * 0.1, postTop).stroke({ width: stroke, color: tone.woodDark });
  // The kite: forever aloft, tethered by a lazy string curve.
  const kiteY = postTop - tileW * 1.3;
  g.moveTo(u * 0.1, postTop)
    .quadraticCurveTo(u * 0.4, postTop - tileW * 0.6, u * 0.15, kiteY + tileW * 0.15)
    .stroke({ width: 1, color: tone.metal, alpha: 0.5 });
  g.poly([u * 0.15, kiteY - u * 0.34, u * 0.4, kiteY, u * 0.15, kiteY + u * 0.34, -u * 0.1, kiteY])
    .fill(tone.kitePaper)
    .stroke({ width: stroke * 0.8, color: tone.kiteAccent, alpha: 0.7 });
  g.moveTo(u * 0.15, kiteY - u * 0.34)
    .lineTo(u * 0.15, kiteY + u * 0.34)
    .stroke({ width: stroke * 0.5, color: tone.kiteAccent, alpha: 0.5 });
  // Ribbon tail.
  for (const t of [0.3, 0.55, 0.8]) {
    const ty = kiteY + u * 0.34 + tileW * 0.55 * t;
    g.ellipse(u * 0.15 + Math.sin(t * 8) * u * 0.06, ty, u * 0.09, u * 0.05).fill(
      tone.kiteAccent,
    );
  }
  wrap.addChild(g);
};

const drawWindChime: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.6);
  const g = new Graphics();
  const u = w * 0.5;
  const barY = -tileW * 1.5;
  const stroke = Math.max(1.5, tileW * 0.03);
  g.moveTo(0, 0).lineTo(0, barY).stroke({ width: stroke, color: tone.woodDark });
  g.moveTo(-u * 0.5, barY).lineTo(u * 0.5, barY).stroke({
    width: stroke * 0.9,
    color: tone.metal,
  });
  const shells = [tone.shellPink, tone.shellBlue, tone.shellCream, tone.shellPink];
  for (let i = 0; i < shells.length; i++) {
    const cx = -u * 0.42 + (i / (shells.length - 1)) * u * 0.84;
    const len = tileW * (0.35 + 0.08 * (i % 2));
    g.moveTo(cx, barY).lineTo(cx, barY + len).stroke({ width: 1, color: tone.metal, alpha: 0.5 });
    g.roundRect(cx - u * 0.05, barY + len, u * 0.1, u * 0.16, u * 0.03).fill(
      shells[i] ?? tone.shellCream,
    );
  }
  wrap.addChild(g);
};

const drawTideBasin: DrawFn = (wrap, w) => {
  const g = new Graphics();
  const u = w * 0.5;
  // Flat decal (content bible §8.2.1): a shallow pool, walkable.
  g.ellipse(0, -u * 0.28, u * 0.78, u * 0.4)
    .fill(tone.shellCream)
    .stroke({ width: Math.max(1.5, u * 0.03), color: tone.pebbleDark, alpha: 0.4 });
  g.ellipse(0, -u * 0.28, u * 0.6, u * 0.3).fill(tone.water);
  g.ellipse(-u * 0.1, -u * 0.34, u * 0.28, u * 0.12).fill({
    color: 0xffffff,
    alpha: 0.35,
  });
  g.ellipse(0, -u * 0.28, u * 0.6, u * 0.3).stroke({
    width: Math.max(1, u * 0.02),
    color: tone.waterDeep,
    alpha: 0.4,
  });
  const rimShells = [tone.shellPink, tone.shellBlue, tone.shellCream];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sx = Math.cos(a) * u * 0.7;
    const sy = -u * 0.28 + Math.sin(a) * u * 0.36;
    g.ellipse(sx, sy, u * 0.07, u * 0.05).fill(rimShells[i % 3] ?? tone.shellCream);
  }
  wrap.addChild(g);
};

const drawDriftwoodBench: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.85);
  const g = new Graphics();
  const half = w * 0.44;
  const seatY = -tileW * 0.5;
  const stroke = Math.max(1.5, tileW * 0.03);
  // Two weathered plank legs.
  for (const lx of [-half * 0.7, half * 0.7]) {
    g.roundRect(lx - stroke * 0.7, seatY, stroke * 1.4, -seatY, stroke * 0.4).fill(
      tone.driftDark,
    );
  }
  // Seat: two soft driftwood planks laid side by side.
  g.roundRect(-half, seatY - tileW * 0.12, half * 2, tileW * 0.12, tileW * 0.04)
    .fill(tone.driftLight)
    .stroke({ width: stroke, color: tone.driftDark, alpha: 0.6 });
  g.moveTo(0, seatY - tileW * 0.1)
    .lineTo(0, seatY)
    .stroke({ width: stroke * 0.6, color: tone.driftDark, alpha: 0.4 });
  // Backrest, one weathered plank.
  g.roundRect(-half * 0.92, seatY - tileW * 0.7, half * 1.84, tileW * 0.12, tileW * 0.04)
    .fill(tone.driftLight)
    .stroke({ width: stroke, color: tone.driftDark, alpha: 0.5 });
  wrap.addChild(g);
};

const drawLanternRow: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.9);
  const g = new Graphics();
  const half = w * 0.46;
  const barY = -tileW * 1.35;
  const stroke = Math.max(1.5, tileW * 0.03);
  for (const px of [-half * 0.94, half * 0.94]) {
    g.moveTo(px, 0).lineTo(px, barY).stroke({ width: stroke * 1.2, color: tone.woodDark });
  }
  g.moveTo(-half, barY).lineTo(half, barY).stroke({ width: stroke * 0.7, color: tone.metal });
  for (let i = 0; i < 3; i++) {
    const cx = -half * 0.62 + i * half * 0.62;
    const lw = tileW * 0.22;
    g.circle(cx, barY + tileW * 0.05, lw * 1.4).fill({
      color: tone.lanternGlow,
      alpha: 0.2,
    });
    g.roundRect(cx - lw / 2, barY, lw, lw * 1.15, lw * 0.2)
      .fill(tone.lanternBody)
      .stroke({ width: stroke * 0.6, color: tone.metal, alpha: 0.6 });
    g.roundRect(cx - lw * 0.3, barY + lw * 0.18, lw * 0.6, lw * 0.7, lw * 0.12).fill(
      tone.lanternGlow,
    );
  }
  wrap.addChild(g);
};

const drawEmberBrazier: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.75);
  const g = new Graphics();
  const u = w * 0.5;
  const bowlY = -tileW * 0.62;
  const stroke = Math.max(1.5, tileW * 0.035);
  // Tripod legs.
  for (const dx of [-u * 0.55, 0, u * 0.55]) {
    g.moveTo(dx * 0.3, bowlY).lineTo(dx, 0).stroke({
      width: stroke,
      color: tone.metal,
      cap: "round",
    });
  }
  // Bowl.
  g.ellipse(0, bowlY, u * 0.5, u * 0.16)
    .fill(tone.metal)
    .stroke({ width: stroke, color: tone.charcoal, alpha: 0.6 });
  // Coals that never quite go out.
  g.ellipse(0, bowlY - u * 0.05, u * 0.36, u * 0.14).fill(tone.emberGlow);
  g.ellipse(0, bowlY - u * 0.05, u * 0.36, u * 0.14).fill({
    color: tone.charcoal,
    alpha: 0.3,
  });
  for (const [ex, r] of [
    [-u * 0.14, 0.09],
    [u * 0.08, 0.11],
    [u * 0.24, 0.07],
  ] as const) {
    g.circle(ex, bowlY - u * 0.08, u * r).fill(tone.emberCore);
  }
  // Heat shimmer glow above.
  g.circle(0, bowlY - u * 0.4, u * 0.42).fill({ color: tone.emberGlow, alpha: 0.14 });
  wrap.addChild(g);
};

const drawWishingCairn: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.7);
  const g = new Graphics();
  const u = w * 0.5;
  const stroke = Math.max(1, tileW * 0.02);
  const stones: readonly (readonly [number, number, number])[] = [
    [0, -u * 0.16, 0.5],
    [u * 0.03, -u * 0.42, 0.38],
    [-u * 0.02, -u * 0.62, 0.24],
  ];
  stones.forEach(([sx, sy, r], i) => {
    g.ellipse(sx, sy, u * r, u * r * 0.62).fill(
      i % 2 === 0 ? tone.pebble : tone.pebbleDark,
    );
    g.ellipse(sx - u * r * 0.28, sy - u * r * 0.2, u * r * 0.3, u * r * 0.18).fill({
      color: 0xffffff,
      alpha: 0.28,
    });
    g.ellipse(sx, sy, u * r, u * r * 0.62).stroke({
      width: stroke,
      color: tone.pebbleDark,
      alpha: 0.35,
    });
  });
  wrap.addChild(g);
};

const drawMossyFountain: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.9);
  const g = new Graphics();
  const u = w * 0.5;
  const bh = tileW * 0.85;
  const stroke = Math.max(1.5, tileW * 0.03);
  // Wide basin.
  g.ellipse(0, -bh * 0.14, u * 0.78, u * 0.28)
    .fill(tone.pebble)
    .stroke({ width: stroke, color: tone.pebbleDark, alpha: 0.5 });
  g.ellipse(0, -bh * 0.2, u * 0.6, u * 0.2).fill(tone.water);
  // A mossy central spout.
  g.roundRect(-u * 0.12, -bh, u * 0.24, bh * 0.86, u * 0.1).fill(tone.moss);
  g.ellipse(0, -bh, u * 0.16, u * 0.1).fill(tone.mossDark);
  // Water trickling from the top.
  g.moveTo(0, -bh + u * 0.06)
    .quadraticCurveTo(u * 0.06, -bh * 0.55, 0, -bh * 0.2)
    .stroke({ width: stroke * 0.8, color: tone.waterDeep, alpha: 0.5, cap: "round" });
  // Shell garnish at the rim.
  for (const a of [0.2, 1.4, 2.6, 3.9, 5.1]) {
    const sx = Math.cos(a) * u * 0.72;
    const sy = -bh * 0.14 + Math.sin(a) * u * 0.24;
    g.ellipse(sx, sy, u * 0.06, u * 0.045).fill(tone.shellPink);
  }
  wrap.addChild(g);
};

// ---------------------------------------------------------------------------
// ROUND 2F — the nine new stations (content/placeables.ts §5.1)
//
// Each one has to read as ITS OWN THING at a glance, because the Build card's
// promise ("every trip comes home sooner") is only legible if the thing you
// placed looks like the thing you paid for. Silhouette first: the Beacon is
// the tallest object in the Keep, the Larder is the widest closed box, the
// Weathervane is the only spinning thing, and so on.
// ---------------------------------------------------------------------------

const drawWashBasin: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.8);
  const g = new Graphics();
  const u = w * 0.5;
  const bh = tileW * 0.66;
  const stroke = Math.max(1.5, tileW * 0.03);
  // Pedestal.
  g.roundRect(-u * 0.16, -bh * 0.62, u * 0.32, bh * 0.62, u * 0.06).fill(tone.woodDark);
  // Wide shallow basin on top.
  g.ellipse(0, -bh * 0.68, u * 0.66, u * 0.26)
    .fill(tone.pebble)
    .stroke({ width: stroke, color: tone.pebbleDark, alpha: 0.6 });
  g.ellipse(0, -bh * 0.72, u * 0.52, u * 0.19).fill(tone.soap);
  // Suds: three bubbles cresting the rim.
  for (const [bx, by, r] of [
    [-u * 0.26, -bh * 0.86, u * 0.12],
    [u * 0.04, -bh * 0.96, u * 0.15],
    [u * 0.32, -bh * 0.84, u * 0.1],
  ] as const) {
    g.circle(bx, by, r).fill({ color: 0xffffff, alpha: 0.72 });
    g.circle(bx - r * 0.3, by - r * 0.3, r * 0.28).fill({ color: 0xffffff, alpha: 0.9 });
  }
  // A scrub brush hooked on the rim.
  g.roundRect(u * 0.5, -bh * 0.78, u * 0.3, u * 0.13, u * 0.05).fill(tone.wood);
  for (const t of [0.1, 0.35, 0.6, 0.85]) {
    g.moveTo(u * (0.5 + 0.3 * t), -bh * 0.65)
      .lineTo(u * (0.5 + 0.3 * t), -bh * 0.52)
      .stroke({ width: stroke * 0.7, color: tone.fiber, cap: "round" });
  }
  wrap.addChild(g);
};

const drawPlayPost: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.7);
  const g = new Graphics();
  const u = w * 0.5;
  const ph = tileW * 1.45;
  const stroke = Math.max(1.5, tileW * 0.032);
  // Post with a cross-arm.
  g.roundRect(-u * 0.08, -ph, u * 0.16, ph, u * 0.05)
    .fill(tone.wood)
    .stroke({ width: stroke * 0.7, color: tone.woodDark, alpha: 0.5 });
  g.moveTo(-u * 0.52, -ph * 0.92)
    .lineTo(u * 0.52, -ph * 0.92)
    .stroke({ width: stroke * 1.2, color: tone.woodDark, cap: "round" });
  // A ball on a string, mid-swing.
  g.moveTo(u * 0.44, -ph * 0.92)
    .quadraticCurveTo(u * 0.56, -ph * 0.6, u * 0.5, -ph * 0.44)
    .stroke({ width: stroke * 0.6, color: tone.fiber, cap: "round" });
  g.circle(u * 0.5, -ph * 0.36, u * 0.16).fill(tone.kiteAccent);
  g.circle(u * 0.44, -ph * 0.42, u * 0.05).fill({ color: 0xffffff, alpha: 0.5 });
  // A ribbon streamer on the other arm.
  g.moveTo(-u * 0.46, -ph * 0.92)
    .quadraticCurveTo(-u * 0.72, -ph * 0.7, -u * 0.4, -ph * 0.52)
    .quadraticCurveTo(-u * 0.68, -ph * 0.38, -u * 0.44, -ph * 0.24)
    .stroke({ width: stroke * 1.1, color: tone.paintBlue, alpha: 0.8, cap: "round" });
  // A knotted rope loop at the base to tug on.
  g.ellipse(-u * 0.02, -u * 0.14, u * 0.22, u * 0.1).stroke({
    width: stroke,
    color: tone.wickerDark,
  });
  wrap.addChild(g);
};

const drawLarder: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.9);
  const g = new Graphics();
  const u = w * 0.5;
  const bh = tileW * 1.5;
  const stroke = Math.max(1.5, tileW * 0.032);
  // Tall cupboard carcass — the widest closed box in the Keep.
  g.roundRect(-u * 0.7, -bh, u * 1.4, bh, u * 0.07)
    .fill(tone.woodLight)
    .stroke({ width: stroke, color: tone.woodDark, alpha: 0.7 });
  // Left door closed, right door ajar showing shelves.
  g.roundRect(-u * 0.64, -bh * 0.94, u * 0.6, bh * 0.88, u * 0.05)
    .fill(tone.wood)
    .stroke({ width: stroke * 0.7, color: tone.woodDark, alpha: 0.5 });
  g.circle(-u * 0.12, -bh * 0.5, u * 0.05).fill(tone.metal);
  g.roundRect(u * 0.06, -bh * 0.94, u * 0.58, bh * 0.88, u * 0.05).fill("#6f5233");
  for (const sy of [0.7, 0.44, 0.18]) {
    g.moveTo(u * 0.08, -bh * sy)
      .lineTo(u * 0.62, -bh * sy)
      .stroke({ width: stroke * 0.8, color: tone.woodDark });
  }
  // Preserve jars on the shelves — the pantry that keeps.
  for (const [jx, jy, col] of [
    [u * 0.2, 0.7, tone.berry],
    [u * 0.42, 0.7, tone.hay],
    [u * 0.24, 0.44, tone.mossDark],
    [u * 0.48, 0.44, tone.berryRed],
  ] as const) {
    g.roundRect(jx - u * 0.08, -bh * jy - u * 0.19, u * 0.16, u * 0.19, u * 0.04).fill(col);
    g.roundRect(jx - u * 0.09, -bh * jy - u * 0.23, u * 0.18, u * 0.06, u * 0.02).fill(
      tone.linen,
    );
  }
  // A garland of dried fiber under the top rail.
  g.moveTo(-u * 0.6, -bh * 0.98)
    .quadraticCurveTo(0, -bh * 0.9, u * 0.6, -bh * 0.98)
    .stroke({ width: stroke * 0.8, color: tone.fiber, alpha: 0.8 });
  wrap.addChild(g);
};

// ROUND 2H (docs/lifecycle-bible.md §3.5) — the Poultice Shelf: a small
// open shelf of wrapped bundles and jars, echoing the Larder's "the
// pantry that keeps" shape at a fraction of the footprint (1×1, like the
// Wash Basin it stands beside on the Build sheet).
const drawPoulticeShelf: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.75);
  const g = new Graphics();
  const u = w * 0.5;
  const bh = tileW * 0.9;
  const stroke = Math.max(1.5, tileW * 0.03);
  // A single open shelf plank on two brackets.
  g.roundRect(-u * 0.62, -bh * 0.42, u * 1.24, u * 0.12, u * 0.04)
    .fill(tone.woodLight)
    .stroke({ width: stroke * 0.7, color: tone.woodDark, alpha: 0.6 });
  g.roundRect(-u * 0.5, -bh * 0.3, u * 0.1, bh * 0.3, u * 0.03).fill(tone.woodDark);
  g.roundRect(u * 0.4, -bh * 0.3, u * 0.1, bh * 0.3, u * 0.03).fill(tone.woodDark);
  // A moss-green jar, stoppered in linen.
  g.roundRect(-u * 0.42, -bh * 0.78, u * 0.24, u * 0.36, u * 0.05)
    .fill(tone.moss)
    .stroke({ width: stroke * 0.6, color: tone.mossDark, alpha: 0.6 });
  g.roundRect(-u * 0.4, -bh * 0.86, u * 0.2, u * 0.1, u * 0.03).fill(tone.linen);
  // A wrapped bundle of leaves, tied off.
  g.roundRect(-u * 0.08, -bh * 0.74, u * 0.28, u * 0.32, u * 0.06)
    .fill(tone.linen)
    .stroke({ width: stroke * 0.6, color: tone.woodDark, alpha: 0.35 });
  g.moveTo(-u * 0.08, -bh * 0.58)
    .lineTo(u * 0.2, -bh * 0.58)
    .stroke({ width: stroke * 0.7, color: tone.fiber });
  // A small berry-red stoppered vial — the sharp-smelling something.
  g.roundRect(u * 0.24, -bh * 0.68, u * 0.16, u * 0.26, u * 0.05).fill(tone.berry);
  g.circle(u * 0.32, -bh * 0.68, u * 0.06).fill(tone.woodDark);
  wrap.addChild(g);
};

const drawNestWarmer: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.85);
  const g = new Graphics();
  const u = w * 0.5;
  const stroke = Math.max(1.5, tileW * 0.028);
  // A warm stone underneath, glowing out around the nest's rim.
  g.ellipse(0, -u * 0.16, u * 0.7, u * 0.24).fill(tone.emberGlow);
  g.ellipse(0, -u * 0.16, u * 0.7, u * 0.24).fill({ color: tone.emberCore, alpha: 0.35 });
  // Woven nest bowl.
  g.ellipse(0, -u * 0.42, u * 0.62, u * 0.3)
    .fill(tone.wicker)
    .stroke({ width: stroke, color: tone.wickerDark, alpha: 0.7 });
  g.ellipse(0, -u * 0.5, u * 0.44, u * 0.2).fill(tone.wickerDark);
  // Twig weave.
  for (const a of [0.3, 1.1, 2.0, 3.0, 3.9, 4.8, 5.7]) {
    const sx = Math.cos(a) * u * 0.6;
    const sy = -u * 0.42 + Math.sin(a) * u * 0.28;
    g.moveTo(sx, sy)
      .lineTo(sx * 0.7, sy - u * 0.1)
      .stroke({ width: stroke * 0.6, color: tone.wickerDark, alpha: 0.5, cap: "round" });
  }
  // The egg it keeps warm, with a soft halo.
  g.circle(0, -u * 0.66, u * 0.34).fill({ color: tone.lanternGlow, alpha: 0.22 });
  g.ellipse(0, -u * 0.62, u * 0.2, u * 0.26).fill(tone.shellCream);
  g.ellipse(-u * 0.06, -u * 0.7, u * 0.07, u * 0.09).fill({ color: 0xffffff, alpha: 0.6 });
  wrap.addChild(g);
};

const drawTrailPost: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.7);
  const g = new Graphics();
  const u = w * 0.5;
  const ph = tileW * 1.55;
  const stroke = Math.max(1.5, tileW * 0.03);
  // Signpost.
  g.roundRect(-u * 0.08, -ph, u * 0.16, ph, u * 0.05)
    .fill(tone.woodDark)
    .stroke({ width: stroke * 0.6, color: "#6f5233", alpha: 0.6 });
  // Three arrow boards pointing different ways — six trails, all named.
  const boards: readonly (readonly [number, number, string])[] = [
    [0.9, 1, tone.woodLight],
    [0.68, -1, tone.wicker],
    [0.46, 1, tone.driftLight],
  ];
  for (const [t, dir, col] of boards) {
    const y = -ph * t;
    const x0 = dir > 0 ? u * 0.06 : -u * 0.06 - u * 0.62;
    g.poly([
      x0,
      y - u * 0.11,
      x0 + u * 0.62,
      y - u * 0.11,
      x0 + u * (dir > 0 ? 0.74 : 0.62),
      y,
      x0 + u * (dir > 0 ? 0.62 : 0.62),
      y + u * 0.11,
      x0,
      y + u * 0.11,
    ])
      .fill(col)
      .stroke({ width: stroke * 0.7, color: tone.woodDark, alpha: 0.6 });
    g.moveTo(x0 + u * 0.1, y)
      .lineTo(x0 + u * 0.5, y)
      .stroke({ width: stroke * 0.6, color: tone.woodDark, alpha: 0.4 });
  }
  // A little lantern hung for late returns.
  g.circle(u * 0.3, -ph * 0.24, u * 0.13).fill(tone.lanternGlow);
  g.circle(u * 0.3, -ph * 0.24, u * 0.2).fill({ color: tone.lanternGlow, alpha: 0.18 });
  wrap.addChild(g);
};

const drawWorkbench: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.9);
  const g = new Graphics();
  const u = w * 0.5;
  const bh = tileW * 0.78;
  const stroke = Math.max(1.5, tileW * 0.032);
  // Legs.
  for (const lx of [-u * 0.6, u * 0.6]) {
    g.roundRect(lx - u * 0.06, -bh * 0.62, u * 0.12, bh * 0.62, u * 0.03).fill(tone.woodDark);
  }
  // Thick worktop.
  g.roundRect(-u * 0.78, -bh * 0.78, u * 1.56, bh * 0.2, u * 0.04)
    .fill(tone.woodLight)
    .stroke({ width: stroke, color: tone.woodDark, alpha: 0.7 });
  // Tool rack behind: saw, hammer, awl.
  g.moveTo(-u * 0.7, -bh * 0.78)
    .lineTo(-u * 0.7, -bh * 1.5)
    .stroke({ width: stroke, color: tone.woodDark });
  g.moveTo(u * 0.7, -bh * 0.78)
    .lineTo(u * 0.7, -bh * 1.5)
    .stroke({ width: stroke, color: tone.woodDark });
  g.moveTo(-u * 0.7, -bh * 1.46)
    .lineTo(u * 0.7, -bh * 1.46)
    .stroke({ width: stroke * 0.9, color: tone.woodDark, alpha: 0.7 });
  // Saw: a toothed blade.
  g.poly([-u * 0.5, -bh * 1.4, -u * 0.08, -bh * 1.4, -u * 0.12, -bh * 1.12, -u * 0.5, -bh * 1.2])
    .fill(tone.metal)
    .stroke({ width: stroke * 0.5, color: tone.charcoal, alpha: 0.5 });
  for (let i = 0; i < 6; i++) {
    const tx = -u * 0.48 + i * u * 0.07;
    g.moveTo(tx, -bh * (1.2 - i * 0.012))
      .lineTo(tx + u * 0.035, -bh * (1.15 - i * 0.012))
      .stroke({ width: stroke * 0.4, color: tone.charcoal, alpha: 0.6 });
  }
  // Hammer.
  g.roundRect(u * 0.16, -bh * 1.42, u * 0.06, u * 0.5, u * 0.02).fill(tone.wood);
  g.roundRect(u * 0.06, -bh * 1.44, u * 0.28, u * 0.14, u * 0.03).fill(tone.metal);
  // A half-mended thing and wood shavings on the top.
  g.roundRect(-u * 0.3, -bh * 0.96, u * 0.4, u * 0.18, u * 0.04).fill(tone.wicker);
  for (const [sx, sy] of [
    [u * 0.3, -bh * 0.8],
    [u * 0.46, -bh * 0.82],
    [-u * 0.56, -bh * 0.8],
  ] as const) {
    g.ellipse(sx, sy, u * 0.08, u * 0.03).fill({ color: tone.fiber, alpha: 0.9 });
  }
  wrap.addChild(g);
};

const drawSunBunks: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.92);
  const g = new Graphics();
  const u = w * 0.5;
  const bh = tileW * 1.3;
  const stroke = Math.max(1.5, tileW * 0.032);
  // Frame posts.
  for (const lx of [-u * 0.66, u * 0.66]) {
    g.roundRect(lx - u * 0.06, -bh, u * 0.12, bh, u * 0.03).fill(tone.woodDark);
  }
  // Lower bunk.
  g.roundRect(-u * 0.7, -bh * 0.34, u * 1.4, bh * 0.16, u * 0.06)
    .fill(tone.cushion)
    .stroke({ width: stroke * 0.8, color: tone.cushionEdge, alpha: 0.6 });
  g.roundRect(-u * 0.62, -bh * 0.42, u * 0.34, bh * 0.1, u * 0.05).fill(tone.pillow);
  // Upper bunk.
  g.roundRect(-u * 0.7, -bh * 0.72, u * 1.4, bh * 0.16, u * 0.06)
    .fill(tone.cushion)
    .stroke({ width: stroke * 0.8, color: tone.cushionEdge, alpha: 0.6 });
  g.roundRect(-u * 0.62, -bh * 0.8, u * 0.34, bh * 0.1, u * 0.05).fill(tone.pillow);
  // A little ladder between them.
  g.moveTo(u * 0.44, -bh * 0.72)
    .lineTo(u * 0.44, -bh * 0.2)
    .stroke({ width: stroke * 0.7, color: tone.wood });
  g.moveTo(u * 0.6, -bh * 0.72)
    .lineTo(u * 0.6, -bh * 0.2)
    .stroke({ width: stroke * 0.7, color: tone.wood });
  for (const ry of [0.3, 0.44, 0.58]) {
    g.moveTo(u * 0.44, -bh * ry)
      .lineTo(u * 0.6, -bh * ry)
      .stroke({ width: stroke * 0.6, color: tone.woodDark });
  }
  // The SUN half: a scalloped canopy over the top, and warm light under it.
  g.poly([-u * 0.82, -bh, u * 0.82, -bh, u * 0.66, -bh * 0.88, -u * 0.66, -bh * 0.88])
    .fill(tone.canvasB)
    .stroke({ width: stroke * 0.7, color: tone.canvasEdge, alpha: 0.7 });
  for (let i = 0; i < 5; i++) {
    const cx = -u * 0.62 + i * u * 0.31;
    g.ellipse(cx, -bh * 0.87, u * 0.16, u * 0.07).fill(tone.canvasA);
  }
  g.ellipse(0, -bh * 0.78, u * 0.66, u * 0.14).fill({ color: tone.lanternGlow, alpha: 0.2 });
  wrap.addChild(g);
};

const drawBeacon: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.8);
  const g = new Graphics();
  const u = w * 0.5;
  const bh = tileW * 2.5; // deliberately the TALLEST thing in the Keep.
  const stroke = Math.max(1.5, tileW * 0.034);
  // Stone base.
  g.poly([-u * 0.62, 0, u * 0.62, 0, u * 0.42, -bh * 0.18, -u * 0.42, -bh * 0.18])
    .fill(tone.pebbleDark)
    .stroke({ width: stroke, color: tone.charcoal, alpha: 0.5 });
  // Tapering tower, banded.
  g.poly([
    -u * 0.42,
    -bh * 0.18,
    u * 0.42,
    -bh * 0.18,
    u * 0.26,
    -bh * 0.78,
    -u * 0.26,
    -bh * 0.78,
  ])
    .fill(tone.linen)
    .stroke({ width: stroke, color: tone.pebbleDark, alpha: 0.7 });
  for (const [t, hw] of [
    [0.34, 0.38],
    [0.54, 0.33],
  ] as const) {
    g.roundRect(-u * hw, -bh * t, u * hw * 2, bh * 0.07, u * 0.03).fill({
      color: tone.paintRed,
      alpha: 0.8,
    });
  }
  // Gallery rail.
  g.roundRect(-u * 0.36, -bh * 0.84, u * 0.72, bh * 0.06, u * 0.02).fill(tone.metal);
  // The lamp room, lit.
  g.roundRect(-u * 0.24, -bh * 0.98, u * 0.48, bh * 0.15, u * 0.05)
    .fill(tone.lanternGlow)
    .stroke({ width: stroke * 0.8, color: tone.lanternBody, alpha: 0.8 });
  g.circle(0, -bh * 0.9, u * 0.42).fill({ color: tone.lanternGlow, alpha: 0.2 });
  // Two light beams sweeping out — the "every trip comes home sooner" tell.
  for (const dir of [-1, 1]) {
    g.poly([
      dir * u * 0.2,
      -bh * 0.93,
      dir * u * 1.5,
      -bh * 1.12,
      dir * u * 1.5,
      -bh * 0.7,
    ]).fill({ color: tone.lanternGlow, alpha: 0.13 });
  }
  // Cap and finial.
  g.poly([-u * 0.3, -bh * 0.98, u * 0.3, -bh * 0.98, 0, -bh * 1.1]).fill(tone.charcoal);
  g.circle(0, -bh * 1.13, u * 0.06).fill(tone.gold);
  wrap.addChild(g);
};

const drawWeathervane: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.6);
  const g = new Graphics();
  const u = w * 0.5;
  const ph = tileW * 1.85;
  const stroke = Math.max(1.5, tileW * 0.028);
  // Slim mast.
  g.moveTo(0, 0)
    .lineTo(0, -ph)
    .stroke({ width: stroke * 1.3, color: tone.metal, cap: "round" });
  // N/S/E/W crossbars with little letter ticks.
  const cy = -ph * 0.72;
  g.moveTo(-u * 0.42, cy)
    .lineTo(u * 0.42, cy)
    .stroke({ width: stroke * 0.8, color: tone.metal, cap: "round" });
  g.moveTo(0, cy - u * 0.3)
    .lineTo(0, cy + u * 0.3)
    .stroke({ width: stroke * 0.8, color: tone.metal, cap: "round" });
  for (const [tx, ty] of [
    [-u * 0.42, cy],
    [u * 0.42, cy],
    [0, cy - u * 0.3],
    [0, cy + u * 0.3],
  ] as const) {
    g.circle(tx, ty, u * 0.05).fill(tone.gold);
  }
  // The vane itself: an arrow with a swallowtail, up top where it spins.
  g.poly([
    -u * 0.46,
    -ph * 0.94,
    u * 0.1,
    -ph * 0.94,
    u * 0.1,
    -ph * 0.86,
    u * 0.5,
    -ph * 0.9,
    u * 0.1,
    -ph * 0.94,
  ]).fill(tone.gold);
  g.poly([
    -u * 0.46,
    -ph * 0.98,
    -u * 0.1,
    -ph * 0.9,
    -u * 0.46,
    -ph * 0.82,
  ]).fill(tone.lanternBody);
  g.circle(0, -ph, u * 0.07).fill(tone.gold);
  // A faint sparkle: the Keep XP bonus made visible.
  for (const [sx, sy] of [
    [u * 0.6, -ph * 1.02],
    [-u * 0.62, -ph * 0.7],
  ] as const) {
    g.moveTo(sx - u * 0.07, sy)
      .lineTo(sx + u * 0.07, sy)
      .stroke({ width: stroke * 0.6, color: tone.lanternGlow, alpha: 0.8, cap: "round" });
    g.moveTo(sx, sy - u * 0.07)
      .lineTo(sx, sy + u * 0.07)
      .stroke({ width: stroke * 0.6, color: tone.lanternGlow, alpha: 0.8, cap: "round" });
  }
  wrap.addChild(g);
};

// ---------------------------------------------------------------------------
// ROUND 2F — the twelve new decorations (content/decorations.ts §5.2)
//
// Five are FLAT per bible §5.2 (`clover-patch`, `fern-cluster`, `sled`,
// `glow-pool`, `warm-stones`): a `RESOLVERS` entry is the ONLY way
// `isFlatItem` can return true, so before this round all five silently
// blocked pip movement — which was the whole mitigation content bible §9.11
// asked for once 32 decorations share a 12×14 grid.
// ---------------------------------------------------------------------------

const drawCloverPatch: DrawFn = (wrap, w) => {
  const g = new Graphics();
  const u = w * 0.5;
  // A low spread of trefoils, drawn as ground cover (flat — walk over it).
  const leaves: readonly (readonly [number, number, number])[] = [
    [-u * 0.42, -u * 0.3, u * 0.15],
    [-u * 0.02, -u * 0.44, u * 0.18],
    [u * 0.38, -u * 0.26, u * 0.14],
    [u * 0.1, -u * 0.1, u * 0.16],
    [-u * 0.3, -u * 0.04, u * 0.13],
  ];
  for (const [cx, cy, r] of leaves) {
    for (const a of [-1.2, 0, 1.2]) {
      g.ellipse(cx + Math.sin(a) * r * 0.72, cy - Math.cos(a) * r * 0.72, r * 0.55, r * 0.62)
        .fill(tone.clover);
    }
    g.circle(cx, cy, r * 0.16).fill(tone.mossDark);
  }
  // Two lucky four-leafers, slightly brighter.
  g.circle(u * 0.1, -u * 0.1, u * 0.05).fill({ color: 0xffffff, alpha: 0.4 });
  wrap.addChild(g);
};

const drawHayBale: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.85);
  const g = new Graphics();
  const u = w * 0.5;
  const stroke = Math.max(1.5, tileW * 0.028);
  // A round bale, seen end-on.
  g.circle(0, -u * 0.52, u * 0.5)
    .fill(tone.hay)
    .stroke({ width: stroke, color: tone.hayDark, alpha: 0.7 });
  // Spiral of packed straw.
  for (const r of [0.36, 0.24, 0.12]) {
    g.circle(0, -u * 0.52, u * r).stroke({
      width: stroke * 0.7,
      color: tone.hayDark,
      alpha: 0.45,
    });
  }
  // Binding twine, two bands.
  for (const bx of [-u * 0.2, u * 0.2]) {
    g.moveTo(bx, -u * 0.52 - u * 0.46)
      .lineTo(bx, -u * 0.52 + u * 0.46)
      .stroke({ width: stroke * 0.8, color: tone.fiber, alpha: 0.9 });
  }
  // Loose wisps escaping the top.
  for (const [sx, lean] of [
    [-u * 0.2, -0.4],
    [u * 0.06, 0.1],
    [u * 0.26, 0.45],
  ] as const) {
    g.moveTo(sx, -u * 0.94)
      .lineTo(sx + lean * u * 0.3, -u * 1.16)
      .stroke({ width: stroke * 0.6, color: tone.hayDark, cap: "round" });
  }
  wrap.addChild(g);
};

const drawRopeLadder: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.6);
  const g = new Graphics();
  const u = w * 0.5;
  // 1×2 footprint: this one is TALL, so h drives the height.
  const lh = Math.max(h * 0.9, tileW * 1.6);
  const stroke = Math.max(1.5, tileW * 0.03);
  // A frame it hangs from.
  g.moveTo(-u * 0.6, -lh)
    .lineTo(u * 0.6, -lh)
    .stroke({ width: stroke * 1.4, color: tone.woodDark, cap: "round" });
  g.moveTo(u * 0.6, -lh)
    .lineTo(u * 0.66, 0)
    .stroke({ width: stroke * 1.2, color: tone.woodDark, cap: "round" });
  // Two slightly-swaying side ropes.
  for (const dir of [-1, 1]) {
    g.moveTo(dir * u * 0.3, -lh)
      .quadraticCurveTo(dir * u * 0.42, -lh * 0.5, dir * u * 0.26, -lh * 0.06)
      .stroke({ width: stroke, color: tone.netTwine, cap: "round" });
  }
  // Rungs, narrowing slightly toward the bottom.
  for (let i = 0; i < 6; i++) {
    const t = 0.1 + i * 0.145;
    const y = -lh * (0.92 - t * 0.86);
    const half = u * (0.3 + 0.1 * Math.sin(t * 3));
    g.roundRect(-half, y - u * 0.045, half * 2, u * 0.09, u * 0.035)
      .fill(tone.wood)
      .stroke({ width: stroke * 0.5, color: tone.woodDark, alpha: 0.6 });
  }
  wrap.addChild(g);
};

const drawPineMarker: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.75);
  const g = new Graphics();
  const u = w * 0.5;
  const th = tileW * 1.25;
  const stroke = Math.max(1.5, tileW * 0.028);
  // A small conical pine.
  g.roundRect(-u * 0.05, -th * 0.24, u * 0.1, th * 0.24, u * 0.03).fill(tone.woodDark);
  for (const [t, hw] of [
    [0.28, 0.44],
    [0.5, 0.35],
    [0.72, 0.24],
  ] as const) {
    g.poly([-u * hw, -th * t, u * hw, -th * t, 0, -th * (t + 0.3)])
      .fill(tone.pine)
      .stroke({ width: stroke * 0.5, color: tone.pineDark, alpha: 0.5 });
  }
  g.circle(0, -th * 1.04, u * 0.05).fill(tone.snow);
  // The marker stake beside it, with a carved notch.
  g.roundRect(u * 0.52, -th * 0.62, u * 0.14, th * 0.62, u * 0.04)
    .fill(tone.driftLight)
    .stroke({ width: stroke * 0.6, color: tone.driftDark, alpha: 0.7 });
  g.poly([u * 0.5, -th * 0.62, u * 0.68, -th * 0.62, u * 0.59, -th * 0.72]).fill(tone.driftDark);
  for (const ny of [0.5, 0.42]) {
    g.moveTo(u * 0.54, -th * ny)
      .lineTo(u * 0.64, -th * ny)
      .stroke({ width: stroke * 0.5, color: tone.woodDark, alpha: 0.6 });
  }
  wrap.addChild(g);
};

const drawLogPile: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.92);
  const g = new Graphics();
  const u = w * 0.5;
  const r = Math.min(u * 0.2, tileW * 0.2);
  const stroke = Math.max(1.5, tileW * 0.026);
  // Stacked cut logs, end-grain toward the player: 3 + 2 + 1.
  const rows: readonly (readonly [number, number])[][] = [
    [
      [-r * 2.1, 0],
      [0, 0],
      [r * 2.1, 0],
    ],
    [
      [-r * 1.05, 1],
      [r * 1.05, 1],
    ],
    [[0, 2]],
  ];
  for (const row of rows) {
    for (const [lx, tier] of row) {
      const cy = -r - tier * r * 1.82;
      g.circle(lx, cy, r)
        .fill(tone.woodLight)
        .stroke({ width: stroke, color: tone.woodDark, alpha: 0.75 });
      g.circle(lx, cy, r * 0.62).stroke({
        width: stroke * 0.6,
        color: tone.woodDark,
        alpha: 0.4,
      });
      g.circle(lx, cy, r * 0.26).stroke({
        width: stroke * 0.5,
        color: tone.woodDark,
        alpha: 0.35,
      });
    }
  }
  // A retaining stake at each end.
  for (const dir of [-1, 1]) {
    g.moveTo(dir * (r * 3.3), 0)
      .lineTo(dir * (r * 3.5), -r * 5.2)
      .stroke({ width: stroke * 1.2, color: tone.woodDark, cap: "round" });
  }
  wrap.addChild(g);
};

const drawFernCluster: DrawFn = (wrap, w) => {
  const g = new Graphics();
  const u = w * 0.5;
  // Flat: fronds spraying out low and wide, drawn as ground cover.
  const fronds: readonly (readonly [number, number])[] = [
    [-1, 0.15],
    [-0.62, 0.55],
    [0, 0.72],
    [0.62, 0.55],
    [1, 0.15],
  ];
  for (const [dx, dy] of fronds) {
    const tipX = dx * u * 0.72;
    const tipY = -u * 0.16 - dy * u * 0.44;
    g.moveTo(0, -u * 0.1)
      .quadraticCurveTo(tipX * 0.5, tipY * 1.15, tipX, tipY)
      .stroke({ width: Math.max(1.5, u * 0.07), color: tone.fernGreen, cap: "round" });
    // Pinnae along each frond.
    for (const t of [0.35, 0.55, 0.75]) {
      const px = tipX * t;
      const py = -u * 0.1 + (tipY + u * 0.1) * t;
      g.ellipse(px, py, u * 0.09, u * 0.045).fill({ color: tone.mossDark, alpha: 0.75 });
    }
  }
  g.ellipse(0, -u * 0.08, u * 0.14, u * 0.07).fill(tone.mossDark);
  wrap.addChild(g);
};

const drawSnowLantern: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.75);
  const g = new Graphics();
  const u = w * 0.5;
  const stroke = Math.max(1.5, tileW * 0.026);
  // Three snowballs, the top one hollowed for a candle.
  g.circle(0, -u * 0.3, u * 0.42)
    .fill(tone.snow)
    .stroke({ width: stroke * 0.7, color: tone.snowShade, alpha: 0.8 });
  g.circle(0, -u * 0.76, u * 0.32)
    .fill(tone.snow)
    .stroke({ width: stroke * 0.7, color: tone.snowShade, alpha: 0.8 });
  g.circle(0, -u * 1.1, u * 0.24)
    .fill(tone.snow)
    .stroke({ width: stroke * 0.7, color: tone.snowShade, alpha: 0.8 });
  // Candle glow shining out of the middle ball's little window.
  g.circle(0, -u * 0.76, u * 0.5).fill({ color: tone.lanternGlow, alpha: 0.18 });
  g.ellipse(0, -u * 0.76, u * 0.16, u * 0.19).fill(tone.lanternGlow);
  g.ellipse(0, -u * 0.8, u * 0.06, u * 0.1).fill(tone.emberCore);
  // Shading on the left of each ball so it reads as round, not flat.
  for (const [cy, r] of [
    [-u * 0.3, u * 0.42],
    [-u * 0.76, u * 0.32],
    [-u * 1.1, u * 0.24],
  ] as const) {
    g.ellipse(-r * 0.5, cy + r * 0.2, r * 0.32, r * 0.24).fill({
      color: tone.snowShade,
      alpha: 0.5,
    });
  }
  wrap.addChild(g);
};

const drawIcicleArch: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.85);
  const g = new Graphics();
  const u = w * 0.5;
  const ah = tileW * 1.5;
  const stroke = Math.max(1.5, tileW * 0.028);
  // Two legs and a curved lintel of packed snow.
  for (const dir of [-1, 1]) {
    g.roundRect(dir * u * 0.62 - u * 0.09, -ah * 0.72, u * 0.18, ah * 0.72, u * 0.05)
      .fill(tone.snow)
      .stroke({ width: stroke * 0.6, color: tone.snowShade, alpha: 0.7 });
  }
  g.moveTo(-u * 0.71, -ah * 0.7)
    .quadraticCurveTo(0, -ah * 1.06, u * 0.71, -ah * 0.7)
    .quadraticCurveTo(0, -ah * 0.92, -u * 0.71, -ah * 0.7)
    .fill(tone.snow);
  g.moveTo(-u * 0.71, -ah * 0.7)
    .quadraticCurveTo(0, -ah * 1.06, u * 0.71, -ah * 0.7)
    .stroke({ width: stroke * 0.8, color: tone.snowShade, alpha: 0.8 });
  // Icicles hanging from the underside, longest in the middle.
  const icicles: readonly (readonly [number, number])[] = [
    [-0.56, 0.16],
    [-0.32, 0.3],
    [-0.08, 0.4],
    [0.16, 0.34],
    [0.4, 0.24],
    [0.6, 0.14],
  ];
  for (const [dx, len] of icicles) {
    const x = dx * u;
    const y = -ah * (0.78 + 0.1 * (1 - Math.abs(dx)));
    g.poly([x - u * 0.06, y, x + u * 0.06, y, x, y + ah * len])
      .fill(tone.ice)
      .stroke({ width: stroke * 0.4, color: tone.iceDeep, alpha: 0.6 });
    g.moveTo(x - u * 0.015, y + ah * 0.03)
      .lineTo(x - u * 0.005, y + ah * len * 0.7)
      .stroke({ width: stroke * 0.4, color: 0xffffff, alpha: 0.6, cap: "round" });
  }
  wrap.addChild(g);
};

const drawSled: DrawFn = (wrap, w, h, tileW) => {
  // Flat (bible §5.2) — a sled sits ON the ground and a pip can hop over it.
  const g = new Graphics();
  const u = w * 0.5;
  const stroke = Math.max(1.5, tileW * 0.028);
  g.ellipse(0, -u * 0.06, u * 0.72, u * 0.16).fill({ color: tone.shadow, alpha: 0.1 });
  // Two curled runners.
  for (const oy of [-u * 0.16, -u * 0.02]) {
    g.moveTo(-u * 0.7, oy)
      .lineTo(u * 0.5, oy)
      .quadraticCurveTo(u * 0.78, oy, u * 0.72, oy - u * 0.2)
      .stroke({ width: stroke * 1.2, color: tone.metal, cap: "round" });
  }
  // Slatted deck.
  g.poly([-u * 0.66, -u * 0.24, u * 0.5, -u * 0.28, u * 0.5, -u * 0.06, -u * 0.66, -u * 0.02])
    .fill(tone.woodLight)
    .stroke({ width: stroke * 0.7, color: tone.woodDark, alpha: 0.7 });
  for (const t of [0.2, 0.45, 0.7]) {
    const x = -u * 0.66 + t * u * 1.16;
    g.moveTo(x, -u * 0.26)
      .lineTo(x, -u * 0.04)
      .stroke({ width: stroke * 0.5, color: tone.woodDark, alpha: 0.45 });
  }
  // A pull-rope coiled at the front.
  g.moveTo(u * 0.68, -u * 0.24)
    .quadraticCurveTo(u * 0.95, -u * 0.1, u * 0.74, u * 0.02)
    .stroke({ width: stroke * 0.7, color: tone.paintRed, alpha: 0.85, cap: "round" });
  wrap.addChild(g);
};

const drawNetFloat: DrawFn = (wrap, w, h, tileW) => {
  ground(wrap, w * 0.75);
  const g = new Graphics();
  const u = w * 0.5;
  const stroke = Math.max(1.5, tileW * 0.026);
  // A leaning driftwood stake.
  g.moveTo(u * 0.42, 0)
    .lineTo(u * 0.28, -u * 1.05)
    .stroke({ width: stroke * 1.4, color: tone.driftDark, cap: "round" });
  // The glass float: a big sea-green ball.
  g.circle(-u * 0.1, -u * 0.44, u * 0.42).fill(tone.shellBlue);
  g.circle(-u * 0.1, -u * 0.44, u * 0.42).stroke({
    width: stroke * 0.7,
    color: tone.waterDeep,
    alpha: 0.55,
  });
  g.ellipse(-u * 0.26, -u * 0.6, u * 0.14, u * 0.09).fill({ color: 0xffffff, alpha: 0.55 });
  // Net wrapped around it — diagonals both ways, knotted at the crossings.
  for (const d of [-1, 1]) {
    for (const off of [-0.28, 0, 0.28]) {
      g.moveTo(-u * 0.1 + d * u * 0.42 * 0.7, -u * 0.44 + u * (off - 0.3))
        .quadraticCurveTo(
          -u * 0.1 + off * u * 0.4,
          -u * 0.44 + off * u * 0.5,
          -u * 0.1 - d * u * 0.42 * 0.7,
          -u * 0.44 + u * (off + 0.3),
        )
        .stroke({ width: stroke * 0.5, color: tone.netTwine, alpha: 0.85 });
    }
  }
  // A tail of net draping to the ground.
  g.moveTo(-u * 0.5, -u * 0.3)
    .quadraticCurveTo(-u * 0.7, -u * 0.1, -u * 0.44, 0)
    .stroke({ width: stroke * 0.6, color: tone.netTwine, alpha: 0.7 });
  wrap.addChild(g);
};

const drawGlowPool: DrawFn = (wrap, w) => {
  // Flat (bible §5.2) — a pool you wade through, like the Tide Basin.
  const g = new Graphics();
  const u = w * 0.5;
  // Rock rim.
  g.ellipse(0, -u * 0.28, u * 0.76, u * 0.34)
    .fill(tone.pebbleDark)
    .stroke({ width: Math.max(1.5, u * 0.03), color: tone.charcoal, alpha: 0.35 });
  // Glowing water, two layers so the centre reads brighter.
  g.ellipse(0, -u * 0.3, u * 0.64, u * 0.27).fill(tone.glowCoolDeep);
  g.ellipse(0, -u * 0.31, u * 0.52, u * 0.21).fill(tone.glowCool);
  g.ellipse(0, -u * 0.32, u * 0.3, u * 0.12).fill({ color: 0xffffff, alpha: 0.4 });
  // Ripple rings.
  for (const r of [0.2, 0.36, 0.5] as const) {
    g.ellipse(u * 0.06, -u * 0.31, u * r, u * r * 0.42).stroke({
      width: Math.max(1, u * 0.02),
      color: 0xffffff,
      alpha: 0.3,
    });
  }
  // Motes of light drifting off the surface.
  for (const [mx, my, r] of [
    [-u * 0.34, -u * 0.5, u * 0.05],
    [u * 0.12, -u * 0.58, u * 0.04],
    [u * 0.42, -u * 0.46, u * 0.035],
  ] as const) {
    g.circle(mx, my, r * 2.4).fill({ color: tone.glowCool, alpha: 0.2 });
    g.circle(mx, my, r).fill({ color: 0xffffff, alpha: 0.8 });
  }
  // A few rim stones for silhouette.
  for (const a of [0.5, 2.1, 3.6, 5.2]) {
    g.ellipse(
      Math.cos(a) * u * 0.74,
      -u * 0.28 + Math.sin(a) * u * 0.32,
      u * 0.11,
      u * 0.07,
    ).fill(tone.pebble);
  }
  wrap.addChild(g);
};

const drawWarmStones: DrawFn = (wrap, w) => {
  // Flat (bible §5.2) — flat stones you stand on to warm your feet.
  const g = new Graphics();
  const u = w * 0.5;
  // Warm glow seeping out from between them.
  g.ellipse(0, -u * 0.26, u * 0.66, u * 0.3).fill({ color: tone.emberGlow, alpha: 0.2 });
  const stones: readonly (readonly [number, number, number, number])[] = [
    [-u * 0.34, -u * 0.34, u * 0.26, u * 0.15],
    [u * 0.14, -u * 0.42, u * 0.29, u * 0.16],
    [-u * 0.06, -u * 0.16, u * 0.31, u * 0.17],
    [u * 0.42, -u * 0.16, u * 0.2, u * 0.12],
  ];
  stones.forEach(([sx, sy, rx, ry], i) => {
    g.ellipse(sx, sy, rx, ry).fill(i % 2 === 0 ? tone.stoneWarm : tone.pebble);
    g.ellipse(sx - rx * 0.22, sy - ry * 0.28, rx * 0.42, ry * 0.36).fill({
      color: 0xffffff,
      alpha: 0.25,
    });
    g.ellipse(sx, sy, rx, ry).stroke({
      width: Math.max(1, u * 0.02),
      color: tone.emberGlow,
      alpha: 0.35,
    });
  });
  // Two curls of rising warmth.
  for (const [cx, dir] of [
    [-u * 0.2, 1],
    [u * 0.26, -1],
  ] as const) {
    g.moveTo(cx, -u * 0.5)
      .quadraticCurveTo(cx + dir * u * 0.12, -u * 0.68, cx, -u * 0.84)
      .stroke({
        width: Math.max(1, u * 0.025),
        color: tone.emberCore,
        alpha: 0.45,
        cap: "round",
      });
  }
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
  stockpot: { draw: drawStockpot, flat: false },
  "pebble-path": { draw: drawPebblePath, flat: true },
  "moss-tuft": { draw: drawMossTuft, flat: false },
  "berry-planter": { draw: drawBerryPlanter, flat: false },
  "driftwood-arch": { draw: drawDriftwoodArch, flat: false },
  "shell-mosaic": { draw: drawShellMosaic, flat: true },
  "cozy-lantern": { draw: drawCozyLantern, flat: false },
  // ROUND 2B (content bible §5.1/§8.2.1) — fourteen more, no crates.
  "welcome-sign": { draw: drawWelcomeSign, flat: false },
  // Flat per the bible's explicit call-out: a ring/pool you stand IN or
  // walk over, not around.
  "toadstool-ring": { draw: drawToadstoolRing, flat: true },
  "bramble-arch": { draw: drawBrambleArch, flat: false },
  "twine-swing": { draw: drawTwineSwing, flat: false },
  "story-stump": { draw: drawStoryStump, flat: false },
  "sun-awning": { draw: drawSunAwning, flat: false },
  "cloud-kite": { draw: drawCloudKite, flat: false },
  "wind-chime": { draw: drawWindChime, flat: false },
  "tide-basin": { draw: drawTideBasin, flat: true },
  "driftwood-bench": { draw: drawDriftwoodBench, flat: false },
  "lantern-row": { draw: drawLanternRow, flat: false },
  "ember-brazier": { draw: drawEmberBrazier, flat: false },
  "wishing-cairn": { draw: drawWishingCairn, flat: false },
  "mossy-fountain": { draw: drawMossyFountain, flat: false },
  // ROUND 2F (progression bible §5.1) — the nine new stations. Every tier
  // from 2 upward hands out one of these BY NAME, so a crate here would make
  // the ladder's headline unlock indistinguishable from a 3-Fiber decoration.
  "wash-basin": { draw: drawWashBasin, flat: false },
  "play-post": { draw: drawPlayPost, flat: false },
  larder: { draw: drawLarder, flat: false },
  // ROUND 2H (docs/lifecycle-bible.md §3.5) — the tenth station.
  "poultice-shelf": { draw: drawPoulticeShelf, flat: false },
  "nest-warmer": { draw: drawNestWarmer, flat: false },
  "trail-post": { draw: drawTrailPost, flat: false },
  workbench: { draw: drawWorkbench, flat: false },
  "sun-bunks": { draw: drawSunBunks, flat: false },
  beacon: { draw: drawBeacon, flat: false },
  weathervane: { draw: drawWeathervane, flat: false },
  // ROUND 2F (progression bible §5.2) — the twelve new decorations. The five
  // marked `flat: true` are the bible's explicit walkability mitigation:
  // `isFlatItem` reads THIS table and nothing else, so a missing entry does
  // not merely look wrong, it walls pips in.
  "clover-patch": { draw: drawCloverPatch, flat: true },
  "hay-bale": { draw: drawHayBale, flat: false },
  "rope-ladder": { draw: drawRopeLadder, flat: false },
  "pine-marker": { draw: drawPineMarker, flat: false },
  "log-pile": { draw: drawLogPile, flat: false },
  "fern-cluster": { draw: drawFernCluster, flat: true },
  "snow-lantern": { draw: drawSnowLantern, flat: false },
  "icicle-arch": { draw: drawIcicleArch, flat: false },
  sled: { draw: drawSled, flat: true },
  "net-float": { draw: drawNetFloat, flat: false },
  "glow-pool": { draw: drawGlowPool, flat: true },
  "warm-stones": { draw: drawWarmStones, flat: true },
};

/** Every item id this module can draw for real (i.e. NOT the fallback
 * crate). Exported so `render/placeableSprites.test.ts` can assert the
 * catalog and the resolver table agree — the guard that stops a content
 * round from doubling the build catalog while half of it renders as an
 * identical brown box (the round-2F finding this list exists to prevent). */
export function drawableItemIds(): readonly string[] {
  return Object.keys(RESOLVERS);
}

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
