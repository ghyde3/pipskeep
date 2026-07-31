/**
 * ⚠️ ROUND 2K FIX STAGE — THE OBJECT BUDGET, MEASURED IN CI.
 *
 * `tuning.liveliness.perfBudget.maxSceneObjects` is 310, and the round
 * shipped at **346** — a 36-object breach found only because a human
 * opened a real Chromium and read `?perf=ambience`. The bible's own
 * per-feature cost table predicted 302, so the table under-counted by 44
 * and nothing anywhere noticed: the numbers lived in a doc comment.
 *
 * This suite makes the cost table SELF-MEASURING. It builds every sprite
 * the ambience scenario actually stands in the Keep — through the real
 * `resolvePipSprite` / `resolvePlaceableSprite` / `createAmbience`, from
 * the real `buildAmbiencePerfState` — and counts the display objects they
 * really allocate. A feature that quietly doubles its own sprite cost now
 * fails here, in seconds, instead of surviving to the one browser session
 * somebody remembers to run.
 *
 * WHAT IT CANNOT SEE: the scene's fixed chrome (background, grid overlay,
 * ghost, flash and the layer containers), which needs a canvas. That is
 * pinned as one measured constant below, and the arithmetic is calibrated
 * against the two real browser readings so the model reproduces them.
 * Frame TIME still belongs to `?perf` in a real browser — this is the
 * leading indicator, which is exactly what the tuning doc calls it.
 *
 * `pixi.js` reads `navigator` at IMPORT time — same shim
 * `spriteResolver.test.ts` / `ambience.test.ts` already use.
 */

import { describe, expect, it } from "vitest";

Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "node" },
  configurable: true,
});

const { createAmbience } = await import("../render/ambience");
const { resolvePipSprite } = await import("../render/spriteResolver");
const { resolvePlaceableSprite } = await import("../render/placeableSprites");
const { tuning } = await import("../content/tuning");
const { placeables } = await import("../content/placeables");
const { decorations } = await import("../content/decorations");
const { buildPerfState, buildAmbiencePerfState } = await import("./perfState");
const { LifeStage } = await import("../core/pips/types");

type Node = { readonly children?: readonly Node[] };

/** The same recursive count `?perf`'s HUD reports. */
function countObjects(node: Node): number {
  let n = 1;
  for (const child of node.children ?? []) n += countObjects(child);
  return n;
}

/**
 * The three things the headless model cannot build, each pinned from the
 * scene's own structure rather than fitted to the answer:
 *
 * - `SCENE_CHROME` — `background` (4), `gridOverlay` (2), `ghost` (1),
 *   `flash` (1) and the stage root, straight off the breakdown already
 *   written into `tuning.liveliness.perfBudget`'s own doc comment
 *   ("background 4, gridOverlay 2, world 189, ghost 1, particles 41,
 *   flash 1").
 * - `PARTICLE_POOL` — the pre-existing pooled emitter, the 41 in that
 *   same breakdown. It predates this round and is allocated up front.
 * - `PER_ACTOR_CHROME` — every Actor carries a `root` Container plus a
 *   `ring` and a `glow` Graphics beyond its PipSprite
 *   (render/keepScene.ts's `Actor`). Three per Pip AND per visitor, which
 *   is why it has to scale with the cast rather than hide in a constant.
 *
 * Cross-check that these are structural and not fitted: the model's
 * sprites-plus-actor-chrome for the baseline scenario comes to exactly
 * the **189** the breakdown calls "world". Two independently derived
 * numbers agreeing is what makes this a model rather than a guess, and
 * the calibration test below keeps it honest against the browser.
 */
const SCENE_CHROME = 9;
const PARTICLE_POOL = 41;
const PER_ACTOR_CHROME = 3;

/**
 * ⚠️ The thing the bible's cost table missed, found by making this model
 * disagree with the browser by exactly this much. At night, every placed
 * item whose `icon.motif` is `lantern` or `flame` grows a lazily-created
 * glow Graphics (render/keepScene.ts's `LANTERN_MOTIFS`) — one object per
 * item, allocated only once the sky is dark enough. It is invisible by
 * day, which is precisely why a daytime baseline reading never showed it
 * and the table under-counted the night scenario.
 */
const LANTERN_MOTIFS = new Set(["lantern", "flame"]);

/**
 * ⚠️ BOTH registries. Decorations and placeables are separate content
 * files, and reading only `placeables` is how this model first missed the
 * FIVE `cozy-lantern` decorations the perf scenario places — the exact
 * five objects by which it disagreed with the browser. Every lookup here
 * goes through this union for that reason.
 */
const ITEM_REGISTRY = [...placeables, ...decorations] as readonly {
  readonly id: string;
  readonly footprint?: { readonly w: number; readonly h: number };
  readonly icon?: { readonly motif?: string };
}[];

const itemDef = (id: string) => ITEM_REGISTRY.find((d) => d.id === id);

function lanternGlows(state: ReturnType<typeof buildPerfState>): number {
  let n = 0;
  for (const placement of Object.values(state.keep.placements)) {
    const motif = itemDef(placement.itemId)?.icon?.motif;
    if (motif !== undefined && LANTERN_MOTIFS.has(motif)) n += 1;
  }
  return n;
}

/** Everything the model accounts for that is not a sprite. */
function fixedOverhead(
  state: ReturnType<typeof buildPerfState>,
  night: boolean,
): number {
  const actors = Object.keys(state.pips).length + Object.keys(state.visitors ?? {}).length;
  return (
    SCENE_CHROME +
    PARTICLE_POOL +
    actors * PER_ACTOR_CHROME +
    (night ? lanternGlows(state) : 0)
  );
}

/** Tile size the scene lays out at (render/keepScene.ts's layout). */
const TILE_W = 44;
const TILE_H = 26;

const footprintOf = (itemId: string): { w: number; h: number } =>
  itemDef(itemId)?.footprint ?? { w: 1, h: 1 };

/** Every display object the pips and placements of `state` allocate. */
function countSceneSprites(state: ReturnType<typeof buildPerfState>): number {
  let n = 0;
  for (const pip of Object.values(state.pips)) {
    const sprite = resolvePipSprite(pip.genome, pip.lifeStage, undefined, pip.id);
    n += countObjects(sprite.view as unknown as Node);
    sprite.destroy();
  }
  for (const record of Object.values(state.visitors ?? {})) {
    // A visitor is a full Pip rig — that is the whole point of them.
    const sprite = resolvePipSprite(
      record.genome,
      LifeStage.Adult,
      undefined,
      `visitor:${record.placementId}`,
    );
    n += countObjects(sprite.view as unknown as Node);
    sprite.destroy();
  }
  for (const placement of Object.values(state.keep.placements)) {
    const f = footprintOf(placement.itemId);
    const sprite = resolvePlaceableSprite(placement.itemId, f, TILE_W, TILE_H);
    n += countObjects(sprite.view as unknown as Node);
    sprite.destroy();
  }
  return n;
}

const BOUNDS = { width: 390, height: 844, groundTop: 300 };

/** The ambience layer's own cost at a phase/weather combination. */
function ambienceObjects(phase: "day" | "dusk" | "night", kind: "clear" | "rain"): number {
  const layer = createAmbience(BOUNDS);
  layer.setPhase(phase);
  const counts = tuning.liveliness.weather.particleCount;
  layer.setWeather({
    kind,
    window: 0,
    progress: 0,
    desaturate: 0,
    sunGlowScale: 1,
    particleCount: kind === "rain" ? counts.rain : 0,
  });
  // Several seconds of frames, so anything transient has had every chance
  // to spawn and be counted at its worst.
  let worst = 0;
  for (let i = 0; i < 60 * 8; i += 1) {
    layer.update(16.7);
    worst = Math.max(worst, layer.objectCount());
  }
  layer.destroy();
  return worst;
}

describe("the scene object budget (bible §5.3's leading indicator)", () => {
  it("reproduces the measured BASELINE reading, so the model is calibrated", () => {
    const state = buildPerfState();
    const modelled =
      fixedOverhead(state, false) + countSceneSprites(state) + ambienceObjects("day", "clear");
    // Real Chromium, `?perf`, spec §1 scenario: 244 objects. A model that
    // cannot reproduce a number somebody actually read off the screen is
    // not measuring the same thing the budget is about. ±8 of the reading.
    expect(modelled, `modelled ${modelled} against a real reading of 244`).toBeGreaterThan(236);
    expect(modelled, `modelled ${modelled} against a real reading of 244`).toBeLessThan(252);
  });

  it("the AMBIENCE scenario stays inside maxSceneObjects", () => {
    const budget = tuning.liveliness.perfBudget.maxSceneObjects;
    const state = buildAmbiencePerfState();
    const modelled =
      fixedOverhead(state, true) + countSceneSprites(state) + ambienceObjects("night", "rain");
    expect(
      modelled,
      `night + rain + 4 attractions + 2 visitors models at ${modelled} objects against a ` +
        `budget of ${budget}. Cut, in the order bible §5.4 names — skybirds, flitters, ` +
        `weather particles — never raise the budget.`,
    ).toBeLessThanOrEqual(budget);
  });

  it("guards against a vacuous model: the scenario really is the heavy one", () => {
    const base = countSceneSprites(buildPerfState());
    const heavy = countSceneSprites(buildAmbiencePerfState());
    expect(heavy).toBeGreaterThan(base);
    expect(ambienceObjects("night", "rain")).toBeGreaterThan(ambienceObjects("day", "clear"));
  });
});
