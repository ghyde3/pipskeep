/**
 * THE LIVE KEEP'S SPRITE WIRING.
 *
 * `render/keepScene.ts` is a 2700-line file that had no test at all, and
 * it holds the ONLY production call site of `resolvePipSprite` — so both
 * of round 2D's render wirings lived in five untested lines. Mutation
 * testing confirmed it:
 *
 *  - forcing `accessoryId: undefined` into the genome handed to the
 *    resolver made every Pip in the actual Keep — the main play surface —
 *    render bare. 2789/2789 passed. `spriteResolver.test.ts` proves the
 *    resolver CAN draw an accessory; nothing proved the scene ever hands
 *    it one.
 *  - changing the jitter seed from `pip.id` to `` `${pip.id}:${Date.now()}` ``
 *    made every Pip look different on every reload — the exact opposite
 *    of item 4's player-visible promise. `computeJitter`'s own
 *    determinism IS guarded; its only real call site could feed it
 *    anything.
 *
 * The two functions those mutations touched are module-level and exported
 * for exactly this reason (they close over nothing). Everything else in
 * keepScene needs a canvas and belongs in the browser pass.
 *
 * `pixi.js` reads `navigator` at IMPORT time — same shim
 * `spriteResolver.test.ts` and `placeableSprites.test.ts` already use.
 */

import { describe, expect, it } from "vitest";

Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "node" },
  configurable: true,
});

const { resolveActorSprite, actorSpriteKey } = await import("./keepScene");
const { computeJitter } = await import("./pipGeometry");
const { LifeStage, PipActivity, NEED_MAX } = await import("../core/pips/types");
const { ACCESSORY_IDS } = await import("../content/accessories");

type AnyPip = Parameters<typeof resolveActorSprite>[0];

function makePip(overrides: Partial<AnyPip> = {}): AnyPip {
  return {
    id: "pip-1",
    speciesId: "mosspip",
    name: "Thimble",
    genome: {
      speciesId: "mosspip",
      palette: "fern",
      pattern: "speckled",
      personalityId: "curious",
      shiny: false,
      accessoryId: null,
    },
    personalityId: "curious",
    lifeStage: LifeStage.Adult,
    hatchedAt: 0,
    ageMs: 0,
    happinessIntegral: 0,
    needs: {
      hunger: NEED_MAX,
      cleanliness: NEED_MAX,
      happiness: NEED_MAX,
      energy: NEED_MAX,
    },
    activity: PipActivity.Idle,
    pendingSulk: false,
    sulking: false,
    readyToEvolve: false,
    evolved: null,
    lastGiftItemId: null,
    expedition: null,
    needsUpdatedAt: 0,
    ...overrides,
  } as AnyPip;
}

function withAccessory(accessoryId: string | null): AnyPip {
  const base = makePip();
  return { ...base, genome: { ...base.genome, accessoryId } } as AnyPip;
}

describe("resolveActorSprite — the Keep really wears the accessory (round 2D item 3)", () => {
  it.each(ACCESSORY_IDS)("forwards '%s' into the resolver's accessoryAnchor", (accessoryId) => {
    const sprite = resolveActorSprite(withAccessory(accessoryId));
    try {
      expect(
        sprite.accessoryAnchor.children.length,
        `the Keep dropped accessoryId "${accessoryId}" on its way to the resolver`,
      ).toBeGreaterThan(0);
    } finally {
      sprite.destroy();
    }
  });

  it("a bare Pip stays bare (the flag is forwarded, not fabricated)", () => {
    const sprite = resolveActorSprite(withAccessory(null));
    try {
      expect(sprite.accessoryAnchor.children.length).toBe(0);
    } finally {
      sprite.destroy();
    }
  });

  it("resolves with the LIVE species, not the genome's birth species (evolution, spec §4.6)", () => {
    const base = makePip();
    const evolved = { ...base, speciesId: "grovepip" } as AnyPip;
    const sprite = resolveActorSprite(evolved);
    try {
      expect(sprite.genome.speciesId).toBe("grovepip");
    } finally {
      sprite.destroy();
    }
  });
});

describe("resolveActorSprite — the jitter seed is the Pip's own id (round 2D item 4)", () => {
  it("passes `pip.id` VERBATIM, so a Pip looks the same every session", () => {
    // The mutation this exists for seeded the jitter with `Date.now()`.
    // Comparing two resolves is not enough on its own (a within-run clock
    // barely moves), so this compares the sprite's REAL geometry against
    // the geometry `computeJitter(pip.id)` predicts.
    const pip = makePip({ id: "pip-42" });
    const expected = computeJitter("pip-42");
    const sprite = resolveActorSprite(pip);
    try {
      const masked = sprite.rig.children.find(
        (c) => (c as { mask?: unknown }).mask != null,
      );
      expect(masked, "the fixture's pattern drew no masked overlay").toBeDefined();
      // The pattern overlay's offset IS `markingD{x,y}Px` — a direct read
      // of the jitter the scene actually asked for.
      expect(masked?.position.x).toBeCloseTo(expected.markingDxPx, 6);
      expect(masked?.position.y).toBeCloseTo(expected.markingDyPx, 6);
    } finally {
      sprite.destroy();
    }
  });

  it("two resolves of the same Pip are byte-identical geometry", () => {
    const pip = makePip({ id: "pip-7" });
    const a = resolveActorSprite(pip);
    const b = resolveActorSprite(pip);
    try {
      expect(b.rig.getLocalBounds().width).toBe(a.rig.getLocalBounds().width);
      expect(b.rig.getLocalBounds().height).toBe(a.rig.getLocalBounds().height);
    } finally {
      a.destroy();
      b.destroy();
    }
  });

  it("two Pips with an IDENTICAL genome but different ids look different", () => {
    // The whole promise of item 4, at its only production call site.
    const a = resolveActorSprite(makePip({ id: "pip-1" }));
    const b = resolveActorSprite(makePip({ id: "pip-2" }));
    try {
      const ab = a.rig.getLocalBounds();
      const bb = b.rig.getLocalBounds();
      expect(`${ab.width}x${ab.height}`).not.toBe(`${bb.width}x${bb.height}`);
    } finally {
      a.destroy();
      b.destroy();
    }
  });
});

describe("actorSpriteKey — every input resolveActorSprite reads is in the key", () => {
  it("changes when the worn accessory changes", () => {
    // Safe today only because `pip.id` leads the key, which is luck, not
    // design: a Pip whose accessory changes in place would otherwise keep
    // its cached bare sprite forever.
    expect(actorSpriteKey(withAccessory("leafcap"))).not.toBe(
      actorSpriteKey(withAccessory("scarf")),
    );
    expect(actorSpriteKey(withAccessory(null))).not.toBe(
      actorSpriteKey(withAccessory("leafcap")),
    );
  });

  it("changes with id, stage, live species, palette, pattern and gift variant", () => {
    const base = makePip();
    const key = actorSpriteKey(base);
    expect(actorSpriteKey({ ...base, id: "pip-2" } as AnyPip)).not.toBe(key);
    expect(actorSpriteKey({ ...base, lifeStage: LifeStage.Pipling } as AnyPip)).not.toBe(
      key,
    );
    expect(actorSpriteKey({ ...base, speciesId: "grovepip" } as AnyPip)).not.toBe(key);
    expect(
      actorSpriteKey({
        ...base,
        genome: { ...base.genome, palette: "lichen" },
      } as AnyPip),
    ).not.toBe(key);
    expect(
      actorSpriteKey({
        ...base,
        genome: { ...base.genome, pattern: "swirl" },
      } as AnyPip),
    ).not.toBe(key);
    expect(
      actorSpriteKey({
        ...base,
        evolved: { at: 0, variantId: "sunlit" },
      } as unknown as AnyPip),
    ).not.toBe(key);
  });

  it("is stable for an unchanged Pip (or the cache would thrash every frame)", () => {
    expect(actorSpriteKey(makePip())).toBe(actorSpriteKey(makePip()));
  });
});
