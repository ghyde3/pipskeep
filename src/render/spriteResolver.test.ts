/**
 * ROUND 2D items 3 & 4 — accessory + jitter verification.
 *
 * `pixi.js` reads `navigator` at IMPORT time (its `isSafari` probe), and
 * this repo's vitest environment is `node` — same shim
 * `render/placeableSprites.test.ts` already uses to test a `render/`
 * module with no canvas/WebGL context.
 *
 * "Verify numerically, not by eye" (the round's own instruction): the
 * jitter tests below don't render anything to a screen — they measure
 * Pixi's OWN computed bounds (`getLocalBounds()`, pure geometry, no GPU
 * needed) against `PIP_BODY_WIDTH`/`PIP_BODY_HEIGHT`, and separately pin
 * `computeJitter`'s numeric ranges directly.
 */

import { describe, expect, it } from "vitest";

Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "node" },
  configurable: true,
});

const {
  computeJitter,
  resolvePipSprite,
  PIP_BODY_WIDTH,
  PIP_BODY_HEIGHT,
  PIPLING_SCALE,
  JITTER_MAX_BODY_SHRINK,
  JITTER_MAX_EYE_SPACING_PX,
  JITTER_MAX_EYE_RADIUS_PX,
  JITTER_MAX_EYE_ROW_PX,
  JITTER_MAX_MARK_PX,
  BASE_EYE_GAP_PX,
  BASE_EYE_RADIUS_PX,
  jitterStyleVars,
} = await import("./spriteResolver");
const { LifeStage } = await import("../core/pips/types");
const { species } = await import("../content/species");
const { ACCESSORY_IDS, NO_ACCESSORY_ID, accessories } = await import(
  "../content/accessories"
);

/** A full genome, defaulting to a bare Mosspip — override per test. */
function genome(overrides: Partial<Parameters<typeof resolvePipSprite>[0]> = {}) {
  return {
    speciesId: "mosspip",
    palette: "fern",
    pattern: "speckled",
    personalityId: "curious",
    shiny: false,
    accessoryId: null as string | null,
    ...overrides,
  };
}

/**
 * EVERY species in the registry.
 *
 * ROUND 2D FIX STAGE — the shipped sweep tested only the two "tiny"
 * silhouette species, justified in-file as having "the TIGHTEST body
 * margins of any silhouette, so proving bounds hold here is the worst
 * case". That reasoning is INVERTED for a containment property: a body
 * drawn at wFrac 0.78 inside a fixed box has the MOST room to spare, not
 * the least. The species that actually press on the box are the ten
 * round/chunky/wide ones (wFrac 1.0 — the silhouette IS the box) and the
 * two tall ones. Twelve of fourteen species went unswept, and they were
 * the twelve that mattered.
 */
const ALL_SPECIES_IDS = Object.values(species).map((s) => s.id);

/** Still called out by name — not because they are the worst case, but
 * because "tiny" is the silhouette the eye-containment arithmetic below
 * is computed against (smallest body ⇒ smallest half-width to fit the
 * eyes inside). */
const TINY_SPECIES_IDS = Object.values(species)
  .filter((s) => s.sprite.silhouette === "tiny")
  .map((s) => s.id);

describe("computeJitter — pure, deterministic, bounded", () => {
  it("is a real content axis to check (guards against a vacuous suite)", () => {
    expect(TINY_SPECIES_IDS.length).toBeGreaterThan(0);
  });

  it("same seed → byte-identical Jitter, every time", () => {
    const a = computeJitter("pip-42");
    const b = computeJitter("pip-42");
    expect(b).toEqual(a);
  });

  it("different seeds → (almost always) different Jitter", () => {
    const seeds = ["pip-1", "pip-2", "pip-3", "pip-4", "pip-5", "mosspip|fern|speckled"];
    const results = seeds.map((s) => JSON.stringify(computeJitter(s)));
    expect(new Set(results).size).toBe(seeds.length);
  });

  it("every field of every sampled seed's Jitter stays within its documented range", () => {
    for (let i = 0; i < 200; i++) {
      const j = computeJitter(`seed-${i}`);
      expect(j.bodyShrinkW).toBeGreaterThanOrEqual(0);
      expect(j.bodyShrinkW).toBeLessThanOrEqual(JITTER_MAX_BODY_SHRINK);
      expect(j.bodyShrinkH).toBeGreaterThanOrEqual(0);
      expect(j.bodyShrinkH).toBeLessThanOrEqual(JITTER_MAX_BODY_SHRINK);
      for (const [field, limit] of [
        [j.eyeSpacingPx, JITTER_MAX_EYE_SPACING_PX],
        [j.eyeRadiusXPx, JITTER_MAX_EYE_RADIUS_PX],
        [j.eyeRadiusYPx, JITTER_MAX_EYE_RADIUS_PX],
        [j.eyeRowYPx, JITTER_MAX_EYE_ROW_PX],
      ] as const) {
        expect(field).toBeGreaterThanOrEqual(-limit);
        expect(field).toBeLessThanOrEqual(limit);
      }
      for (const field of [j.markingDxPx, j.markingDyPx]) {
        expect(field).toBeGreaterThanOrEqual(-JITTER_MAX_MARK_PX);
        expect(field).toBeLessThanOrEqual(JITTER_MAX_MARK_PX);
      }
    }
  });

  it("body-proportion jitter is SHRINK-ONLY (never grows past the un-jittered silhouette)", () => {
    // The hard safety property JITTER_MAX_BODY_SHRINK's doc claims: for
    // "round"/"chunky"/"wide" (wFrac = 1.0, already filling the box), ANY
    // growth would break the fixed-box contract. Proven directly from the
    // exported range constant, not sampled — the range itself is the
    // guarantee.
    expect(JITTER_MAX_BODY_SHRINK).toBeGreaterThan(0);
    expect(JITTER_MAX_BODY_SHRINK).toBeLessThan(1);
    for (let i = 0; i < 100; i++) {
      const j = computeJitter(`shrink-check-${i}`);
      expect(1 - j.bodyShrinkW).toBeLessThanOrEqual(1);
      expect(1 - j.bodyShrinkH).toBeLessThanOrEqual(1);
      expect(1 - j.bodyShrinkW).toBeGreaterThan(0);
      expect(1 - j.bodyShrinkH).toBeGreaterThan(0);
    }
  });
});

describe("computeJitter — the four axes are INDEPENDENT", () => {
  // ROUND 2D FIX STAGE, and the reason `mix32` exists. FNV-1a's final step
  // is `hash ^= byte; hash *= prime`, so two salts differing only in their
  // LAST character produced hashes differing by exactly one multiple of
  // the prime — 1/256 of the range. Measured over 200 Pip ids that made
  // |eyeRadiusX − eyeRadiusY| exactly 0.0039 (min AND max), so eyes only
  // ever scaled UNIFORMLY and the "eye shape" axis this round advertised
  // could not vary; markings only ever moved on the 45° diagonal; and
  // body height was a deterministic function of body width. Two of four
  // advertised axes were mathematically dead while every range test
  // passed, because each field's DISTRIBUTION was fine in isolation.
  const seeds = Array.from({ length: 200 }, (_, i) => `pip-${i + 1}`);
  const samples = seeds.map((seed) => computeJitter(seed));

  const pairs = [
    ["eyeRadiusXPx", "eyeRadiusYPx", JITTER_MAX_EYE_RADIUS_PX],
    ["markingDxPx", "markingDyPx", JITTER_MAX_MARK_PX],
    ["bodyShrinkW", "bodyShrinkH", JITTER_MAX_BODY_SHRINK],
  ] as const;

  for (const [a, b, halfRange] of pairs) {
    it(`${a} and ${b} vary independently (not a fixed offset apart)`, () => {
      const deltas = samples.map((j) => Math.abs(j[a] - j[b]));
      // A fixed-offset collapse yields ONE distinct delta across every
      // seed. Real independence yields ~200.
      expect(new Set(deltas.map((d) => d.toFixed(6))).size).toBeGreaterThan(150);
      // And the spread has to be usable, not just non-constant: at least
      // one pair must differ by more than half the axis's own half-range.
      expect(Math.max(...deltas)).toBeGreaterThan(halfRange * 0.5);
    });
  }

  it("the ranges are PINNED to literals, not compared against themselves", () => {
    // The shipped range test asserted `markingDxPx` was within
    // ±JITTER_MAX_MARK_PX — the constant against itself — so raising the
    // constant moved the goalpost and the test still passed. These are
    // the numbers the containment arithmetic below is computed from;
    // changing one must be a deliberate edit here too.
    expect(JITTER_MAX_BODY_SHRINK).toBe(0.08);
    expect(JITTER_MAX_EYE_SPACING_PX).toBe(3);
    expect(JITTER_MAX_EYE_RADIUS_PX).toBe(1.8);
    expect(JITTER_MAX_EYE_ROW_PX).toBe(3);
    expect(JITTER_MAX_MARK_PX).toBe(3);
    expect(BASE_EYE_GAP_PX).toBe(21);
    expect(BASE_EYE_RADIUS_PX).toBe(9.5);
  });

  it("is a MEANINGFUL amount of variation, not a sub-pixel rounding error", () => {
    // The other half of "jitter was invisible": at Keep scale the 118px
    // design box renders ~46 CSS px, so the shipped 2.4px eye budget was
    // under one CSS pixel. Assert the budgets as FRACTIONS of the box, so
    // this stays honest at any render scale.
    expect(JITTER_MAX_BODY_SHRINK).toBeGreaterThanOrEqual(0.07);
    expect((JITTER_MAX_EYE_SPACING_PX * 2) / BASE_EYE_GAP_PX).toBeGreaterThan(0.25);
    expect((JITTER_MAX_EYE_RADIUS_PX * 2) / BASE_EYE_RADIUS_PX).toBeGreaterThan(0.3);
  });
});

describe("jitterStyleVars — the DOM portrait surfaces wear the same jitter", () => {
  it("is deterministic and derived from computeJitter's own numbers", () => {
    const seed = "pip-77";
    const j = computeJitter(seed);
    const vars = jitterStyleVars(seed);
    expect(jitterStyleVars(seed)).toEqual(vars);
    expect(Number(vars["--pk-jw"])).toBeCloseTo(1 - j.bodyShrinkW, 4);
    expect(Number(vars["--pk-jh"])).toBeCloseTo(1 - j.bodyShrinkH, 4);
    expect(Number(vars["--pk-jgap"])).toBeCloseTo(
      (BASE_EYE_GAP_PX + j.eyeSpacingPx) / BASE_EYE_GAP_PX,
      4,
    );
    expect(Number(vars["--pk-jeye-w"])).toBeCloseTo(
      (BASE_EYE_RADIUS_PX + j.eyeRadiusXPx) / BASE_EYE_RADIUS_PX,
      4,
    );
    expect(Number(vars["--pk-jeye-h"])).toBeCloseTo(
      (BASE_EYE_RADIUS_PX + j.eyeRadiusYPx) / BASE_EYE_RADIUS_PX,
      4,
    );
  });

  it("every multiplier stays in a sane band (a portrait can never invert or vanish)", () => {
    for (let i = 0; i < 200; i++) {
      const vars = jitterStyleVars(`seed-${i}`);
      for (const key of ["--pk-jw", "--pk-jh", "--pk-jgap", "--pk-jeye-w", "--pk-jeye-h"]) {
        const value = Number(vars[key]);
        expect(value).toBeGreaterThan(0.7);
        expect(value).toBeLessThan(1.35);
      }
      expect(Math.abs(Number(vars["--pk-jeye-dy"]))).toBeLessThanOrEqual(4);
    }
  });

  it("two different Pips get visibly different portrait geometry", () => {
    const a = jitterStyleVars("pip-1");
    const b = jitterStyleVars("pip-2");
    expect(a).not.toEqual(b);
  });
});

describe("resolvePipSprite — jittered geometry never exceeds the fixed 118×98 box", () => {
  it("PIP_BODY_WIDTH/PIP_BODY_HEIGHT are exactly the spec's fixed box (regression guard — keepScene hit-tests against these)", () => {
    expect(PIP_BODY_WIDTH).toBe(118);
    expect(PIP_BODY_HEIGHT).toBe(98);
  });

  it("sweeps EVERY species, not a hand-picked subset (guards against a vacuous suite)", () => {
    expect(ALL_SPECIES_IDS.length).toBe(Object.keys(species).length);
    expect(ALL_SPECIES_IDS.length).toBeGreaterThanOrEqual(14);
    expect(TINY_SPECIES_IDS.length).toBeGreaterThan(0);
  });

  // A LOT of seeds, across ALL FOURTEEN species, adult and Pipling, bare
  // and every accessory — the exhaustive numeric sweep the round's
  // instruction asks for ("verify numerically").
  const seeds = Array.from({ length: 40 }, (_, i) => `pip-${i}`);
  const stages = [LifeStage.Adult, LifeStage.Pipling] as const;

  /**
   * The MEASURED overshoot, not a generous guess.
   *
   * The shipped test allowed +24px of width and +30px of height, which
   * left the real worst case 5.7px of headroom while the (loosest)
   * species it actually tested had 29px. Re-measured across all 14
   * species × 40 seeds × every accessory, after the fix stage moved the
   * five mis-placed accessories back onto the body:
   *
   *   worst half-width 60.36 (box 59) — the BODY's own 3px stroke, whose
   *     outer half is 1.5px. No accessory reaches the body's edge.
   *   worst top 119.49 (box 98) — the accent SPROUT, which has poked
   *     above the crown since Phase 5 and is not an accessory at all.
   *   worst bottom 1.50 — the same stroke.
   *
   * Both exceptions are pre-existing and deliberate (the module doc says
   * so); the allowances below are those measurements plus ~1px, so a
   * regression in ANY species — not just the two loosest — fails here.
   */
  const OVERSHOOT_ALLOWANCE_W = 2.5;
  const OVERSHOOT_ALLOWANCE_H = 23;
  const BOTTOM_ALLOWANCE = 2.5;

  for (const speciesId of ALL_SPECIES_IDS) {
    for (const stage of stages) {
      it(`${speciesId} stays inside the box at ${stage}, across ${seeds.length} seeds and every accessory`, () => {
        const def = species[speciesId];
        const accessoryChoices = [null, NO_ACCESSORY_ID, ...ACCESSORY_IDS];
        for (let i = 0; i < seeds.length; i++) {
          const seed = seeds[i] as string;
          const accessoryId = accessoryChoices[i % accessoryChoices.length] ?? null;
          const sprite = resolvePipSprite(
            genome({
              speciesId,
              palette: def?.sprite.palettes[0] ?? "fern",
              pattern: def?.sprite.patterns[0] ?? "plain",
              accessoryId,
            }),
            stage,
            undefined,
            seed,
          );
          try {
            // `rig`'s geometry is STAGE-INDEPENDENT: Pipling scaling is
            // applied once, at `view.scale` (PIPLING_SCALE), entirely
            // OUTSIDE `rig`. So `rig`'s own local bounds are identical
            // geometry for both stages, and the comparison below is
            // against the RAW, unscaled fixed box for both.
            const rigBounds = sprite.rig.getLocalBounds();
            const expectedViewScale = stage === LifeStage.Pipling ? PIPLING_SCALE : 1;
            expect(sprite.view.scale.x).toBe(expectedViewScale);
            expect(sprite.view.scale.y).toBe(expectedViewScale);

            const where = `${speciesId}/${stage}/seed=${seed}/accessory=${String(accessoryId)}`;
            const halfBoxW = PIP_BODY_WIDTH / 2;
            expect(
              Math.max(Math.abs(rigBounds.x), Math.abs(rigBounds.x + rigBounds.width)),
              `${where}: rig bounds x=[${rigBounds.x}, ${rigBounds.x + rigBounds.width}] exceeds half-box ${halfBoxW} + ${OVERSHOOT_ALLOWANCE_W}`,
            ).toBeLessThanOrEqual(halfBoxW + OVERSHOOT_ALLOWANCE_W);
            expect(
              rigBounds.y,
              `${where}: rig top ${rigBounds.y} is above the box + ${OVERSHOOT_ALLOWANCE_H}`,
            ).toBeGreaterThanOrEqual(-PIP_BODY_HEIGHT - OVERSHOOT_ALLOWANCE_H);
            // Feet stay grounded near y=0: a shrink can only pull the
            // bottom edge UP toward the pivot, never push it past it, and
            // no accessory hangs below the body.
            expect(
              rigBounds.y + rigBounds.height,
              `${where}: rig bottom ${rigBounds.y + rigBounds.height} hangs below the feet`,
            ).toBeLessThanOrEqual(BOTTOM_ALLOWANCE);
          } finally {
            sprite.destroy();
          }
        }
      });
    }
  }

  it("the eyes stay within the drawn body's own half-width, at the jitter extremes (arithmetic, not a sample)", () => {
    const tinyWFrac = 0.78; // content/species.ts's "tiny" wFrac.
    const minBw = PIP_BODY_WIDTH * tinyWFrac * (1 - JITTER_MAX_BODY_SHRINK);
    const maxEyeGap = BASE_EYE_GAP_PX + JITTER_MAX_EYE_SPACING_PX;
    const maxEyeRadius = BASE_EYE_RADIUS_PX + JITTER_MAX_EYE_RADIUS_PX;
    const worstCaseEyeEdge = maxEyeGap + maxEyeRadius;
    const tinyEyeScale = 1.15; // content/species.ts's "tiny" eyeScale.
    expect(worstCaseEyeEdge * tinyEyeScale).toBeLessThan(minBw / 2);

    // Cross-check against real measured geometry: a large sample's
    // MINIMUM half-width must still exceed the eye edge computed above.
    let minHalfWidthSeen = Infinity;
    for (let i = 0; i < 60; i++) {
      const sprite = resolvePipSprite(
        genome({ speciesId: "emberpip", accessoryId: null }),
        LifeStage.Adult,
        undefined,
        `edge-${i}`,
      );
      const bodyBounds = sprite.rig.getLocalBounds();
      minHalfWidthSeen = Math.min(minHalfWidthSeen, bodyBounds.width / 2);
      sprite.destroy();
    }
    expect(minHalfWidthSeen).toBeGreaterThan(worstCaseEyeEdge * tinyEyeScale);
  });

  it("marking jitter is BOUNDED AGAINST THE MASK, which never moves with it", () => {
    // ROUND 2D FIX STAGE. Raising JITTER_MAX_MARK_PX from 3 to 40 used to
    // pass every test: the mask deliberately stays put while the overlay
    // slides, so a large offset pushes the pattern clean out of the mask
    // and it simply vanishes — round 2E's exact "missing pattern overlay"
    // bug. The box-bounds sweep above cannot see it, because a clipping
    // mask stops `rigBounds` from ever growing.
    for (const speciesId of ALL_SPECIES_IDS) {
      const def = species[speciesId];
      const seed = `mark-${speciesId}`;
      const sprite = resolvePipSprite(
        genome({
          speciesId,
          palette: def?.sprite.palettes[0] ?? "fern",
          pattern: def?.sprite.patterns[0] ?? "speckled",
          accessoryId: null,
        }),
        LifeStage.Adult,
        undefined,
        seed,
      );
      try {
        const masked = sprite.rig.children.find(
          (c) => (c as { mask?: unknown }).mask != null,
        );
        if (masked === undefined) continue; // "plain" species: no overlay.
        // The wiring itself: the overlay really is offset by THIS Pip's
        // jitter (not zero, not some other Pip's).
        const j = computeJitter(seed);
        expect(masked.position.x).toBeCloseTo(j.markingDxPx, 6);
        expect(masked.position.y).toBeCloseTo(j.markingDyPx, 6);

        // …and the offset stays a small fraction of the mask it must stay
        // inside, on the SMALLEST silhouette as much as the largest.
        const maskBounds = (
          (masked as { mask: { getLocalBounds(): { width: number; height: number } } }).mask
        ).getLocalBounds();
        expect(
          JITTER_MAX_MARK_PX,
          `${speciesId}: marking offset is large relative to its own mask (${maskBounds.width}×${maskBounds.height})`,
        ).toBeLessThanOrEqual(maskBounds.width * 0.05);
        expect(JITTER_MAX_MARK_PX).toBeLessThanOrEqual(maskBounds.height * 0.05);
      } finally {
        sprite.destroy();
      }
    }
  });
});

describe("accessories are worn on the RIGHT BODY PART (round 2D fix stage)", () => {
  // Five of twelve accessories shipped on the wrong body part: the scarf
  // straight across the mouth (it read as a gag), the lantern over an
  // eye, the bowtie and ember bead mid-belly where a mouth would be, the
  // shell pauldron on the blush. Every assertion here is in the anchor's
  // own local space (origin = the crown, +y toward the feet), which is
  // the coordinate system `content/accessories.ts`'s `slot` field names.
  // One fixed probe seed, so every landmark below is the EXACT geometry
  // the probed sprite was drawn with (jitter included) rather than an
  // un-jittered approximation.
  const PROBE_SEED = "zero-jitter-probe";
  const PROBE_JITTER = computeJitter(PROBE_SEED);
  // Mosspip is the "round" silhouette: wFrac = hFrac = 1.
  const BW = PIP_BODY_WIDTH * (1 - PROBE_JITTER.bodyShrinkW);
  const BH = PIP_BODY_HEIGHT * (1 - PROBE_JITTER.bodyShrinkH);
  // The body top sits at local y = 2 (the anchor is 2px above it); every
  // other landmark is `rigY + bh + 2`, matching resolvePipSprite's own
  // draw calls (eyes −0.58·bh, mouth −0.40·bh).
  const BODY_TOP_LOCAL = 2;
  const EYE_ROW_LOCAL = BH * 0.42 + BODY_TOP_LOCAL + PROBE_JITTER.eyeRowYPx;
  const MOUTH_LOCAL = BH * 0.6 + BODY_TOP_LOCAL;

  function anchorBounds(accessoryId: string): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const sprite = resolvePipSprite(
      genome({ speciesId: "mosspip", accessoryId }),
      LifeStage.Adult,
      undefined,
      PROBE_SEED,
    );
    try {
      const b = sprite.accessoryAnchor.getLocalBounds();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    } finally {
      sprite.destroy();
    }
  }

  function contains(
    b: { x: number; y: number; width: number; height: number },
    px: number,
    py: number,
  ): boolean {
    return px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height;
  }

  it.each(ACCESSORY_IDS)("'%s' never covers the mouth or an eye", (accessoryId) => {
    const b = anchorBounds(accessoryId);
    expect(
      contains(b, 0, MOUTH_LOCAL),
      `${accessoryId} covers the mouth (the "gag" bug)`,
    ).toBe(false);
    for (const eyeX of [-21, 21]) {
      expect(
        contains(b, eyeX, EYE_ROW_LOCAL),
        `${accessoryId} covers an eye`,
      ).toBe(false);
    }
  });

  it.each(ACCESSORY_IDS)("'%s' sits in the zone its content slot names", (accessoryId) => {
    const slot = accessories[accessoryId].slot;
    const b = anchorBounds(accessoryId);
    const centreY = b.y + b.height / 2;
    const centreX = b.x + b.width / 2;
    if (slot === "crown") {
      // Above the eyes…
      expect(b.y + b.height, `${accessoryId} hangs down past the crown`).toBeLessThan(
        EYE_ROW_LOCAL,
      );
      // …and TOUCHING the head, not hovering over it (the shipped
      // version left a band of background between hat and skull).
      expect(
        b.y + b.height,
        `${accessoryId} floats above the crown instead of resting on it`,
      ).toBeGreaterThanOrEqual(BODY_TOP_LOCAL);
    } else if (slot === "side") {
      // A hanging accessory legitimately starts high (the lantern's cord
      // reaches up the flank), so the vertical rule doesn't apply — the
      // horizontal clearance below is what keeps it off the face, and the
      // "never covers the mouth or an eye" test above is the real guard.
      expect(b.y, `${accessoryId} reaches above the crown`).toBeGreaterThan(
        BODY_TOP_LOCAL,
      );
      expect(b.y + b.height, `${accessoryId} hangs below the feet`).toBeLessThan(BH);
    } else {
      // Everything else is BELOW the mouth line, on the body.
      expect(centreY, `${accessoryId} sits on the face`).toBeGreaterThan(MOUTH_LOCAL);
      expect(centreY, `${accessoryId} sits below the feet`).toBeLessThan(BH);
    }
    if (slot === "shoulder" || slot === "side") {
      expect(
        Math.abs(centreX),
        `${accessoryId} is centred, not out on a flank`,
      ).toBeGreaterThan(BW * 0.2);
    }
    if (slot === "neck") {
      expect(
        Math.abs(centreX),
        `${accessoryId} is off to one side, not worn at the neck`,
      ).toBeLessThan(BW * 0.2);
    }
  });

  it("the crown family really is the family that collides with the accent sprout", () => {
    // Guards the `wearsCrown` branch in resolvePipSprite: a Pip wearing a
    // crown accessory displaces its sprout sideways so the two don't cut
    // through each other. If the branch is removed, the sprout is drawn
    // at the same place with and without a hat.
    const crownId = ACCESSORY_IDS.find((id) => accessories[id].slot === "crown");
    expect(crownId).toBeDefined();
    const bare = resolvePipSprite(genome({ accessoryId: null }), LifeStage.Adult, undefined, "s");
    const hatted = resolvePipSprite(
      genome({ accessoryId: crownId as string }),
      LifeStage.Adult,
      undefined,
      "s",
    );
    try {
      // The sprout is the last tintable body part added before the
      // anchor; compare the rig's own child transforms instead of
      // guessing an index: SOME child must have moved.
      const bareX = bare.rig.children.map((c) => `${c.position.x}:${c.rotation}`).join("|");
      const hattedX = hatted.rig.children
        .map((c) => `${c.position.x}:${c.rotation}`)
        .join("|");
      expect(hattedX).not.toBe(bareX);
    } finally {
      bare.destroy();
      hatted.destroy();
    }
  });
});

describe("resolvePipSprite — accessories render through the single accessoryAnchor path", () => {
  it("a bare genome (accessoryId null/undefined/'none') adds nothing to accessoryAnchor", () => {
    for (const accessoryId of [null, undefined, NO_ACCESSORY_ID] as const) {
      const sprite = resolvePipSprite(genome({ accessoryId }), LifeStage.Adult);
      expect(sprite.accessoryAnchor.children.length).toBe(0);
      sprite.destroy();
    }
  });

  it("every real accessory id adds at least one child to accessoryAnchor", () => {
    for (const accessoryId of ACCESSORY_IDS) {
      const sprite = resolvePipSprite(genome({ accessoryId }), LifeStage.Adult);
      expect(
        sprite.accessoryAnchor.children.length,
        `accessory "${accessoryId}" drew nothing`,
      ).toBeGreaterThan(0);
      sprite.destroy();
    }
  });

  it("an unrecognized accessory id degrades to bare rather than throwing", () => {
    expect(() => {
      const sprite = resolvePipSprite(
        genome({ accessoryId: "not-a-real-accessory" }),
        LifeStage.Adult,
      );
      expect(sprite.accessoryAnchor.children.length).toBe(0);
      sprite.destroy();
    }).not.toThrow();
  });

  it("works for every species, adult and Pipling, shiny and not, with an accessory on — no throw, anchor populated", () => {
    for (const speciesId of Object.keys(species)) {
      for (const stage of [LifeStage.Adult, LifeStage.Pipling] as const) {
        for (const shiny of [false, true]) {
          const def = species[speciesId];
          const paletteId = def?.sprite.palettes[0] ?? "fern";
          const patternId = def?.sprite.patterns[0] ?? "plain";
          const sprite = resolvePipSprite(
            genome({
              speciesId,
              palette: paletteId,
              pattern: patternId,
              shiny,
              accessoryId: "lantern",
            }),
            stage,
          );
          expect(sprite.accessoryAnchor.children.length).toBeGreaterThan(0);
          sprite.destroy();
        }
      }
    }
  });

  it("sulk-tinting also greys the worn accessory (it joins tintable, same as every other layer)", () => {
    const sprite = resolvePipSprite(genome({ accessoryId: "flower" }), LifeStage.Adult);
    const before = sprite.accessoryAnchor.children.map((c) =>
      "tint" in c ? (c as { tint: number }).tint : undefined,
    );
    sprite.setSulkTint(true);
    const after = sprite.accessoryAnchor.children.map((c) =>
      "tint" in c ? (c as { tint: number }).tint : undefined,
    );
    expect(after).not.toEqual(before);
    sprite.destroy();
  });
});
