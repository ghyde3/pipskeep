/**
 * ROUND 2F — THE "NO PLACEHOLDER CRATES" GUARD.
 *
 * The round doubled the build catalog from 24 items to 45 to answer the
 * owner's "we need reasons to build items", and shipped with `RESOLVERS`
 * still holding 24 entries: 21 items — INCLUDING every new station, i.e. the
 * headline unlock of tiers 2, 3, 6, 7, 8, 10 and 12 — fell through to
 * `drawFallbackCrate`. A fully-built Keep was ~20 identical brown boxes, so
 * the visible result of building the tier-10 Beacon (12 Wood + 5 Shell + 3
 * Driftwood) was indistinguishable from a 3-Fiber Clover Patch.
 *
 * That is spec §16 v1.3's standing rule in its purest form: "written to
 * state" and "visible to the player" are SEPARATE acceptance criteria. These
 * tests make the second one mechanical, so the next content round cannot add
 * an item without art and still ship green.
 *
 * No Pixi is constructed here — the assertions are over the id TABLE, which
 * is why this file needs no canvas/WebGL environment.
 */

import { describe, expect, it } from "vitest";
import { placeables } from "../content/placeables";
import { decorations } from "../content/decorations";

/**
 * `pixi.js` reads `navigator` at IMPORT time (its `isSafari` probe), and this
 * repo's vitest environment is `node` — deliberately, since `core/` and
 * `content/` are pure and jsdom is outside the spec §1 dependency allowlist.
 * Six characters of shim plus a dynamic import is the whole cost of testing a
 * `render/` module here; nothing below touches a canvas or a GL context.
 */
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "node" },
  configurable: true,
});
const { drawableItemIds, isFlatItem } = await import("./placeableSprites");

const catalogIds = [...placeables.map((p) => p.id), ...decorations.map((d) => d.id)];

describe("placeableSprites — every catalog item has real art", () => {
  it("EVERY placeable and decoration in content resolves to its own drawing, never the fallback crate", () => {
    const drawable = new Set(drawableItemIds());
    const missing = catalogIds.filter((id) => !drawable.has(id));
    expect(missing).toEqual([]);
  });

  it("covers the whole catalog and nothing else — no orphan resolver for a deleted item", () => {
    const catalog = new Set(catalogIds);
    const orphans = drawableItemIds().filter((id) => !catalog.has(id));
    expect(orphans).toEqual([]);
  });

  it("the catalog is the bible's §5 target, plus 2H's Poultice Shelf, 2J's Craft Table and 2J's five craft-only keepsakes", () => {
    // ROUND 2H (docs/lifecycle-bible.md §3.5) adds one station — the
    // Poultice Shelf — on top of the 45 items round 2F's bible §5 named.
    // ROUND 2J (docs/economy-bible.md §3.1) adds one more — the Craft Table
    // — and its FIX STAGE adds the five craft-only keepsakes (§4.4), which
    // are decorations you cannot buy. ROUND 2K (docs/liveliness-bible.md
    // §1.2) adds the six attractions, one per biome. Round 2F's brown-crate
    // lesson applies to every one of them: each has its own drawing above.
    expect(placeables.length).toBe(21);
    expect(decorations.length).toBe(37);
    expect(decorations.filter((d) => d.craftOnly === true).length).toBe(5);
    expect(drawableItemIds().length).toBe(58);
  });

  /**
   * ROUND 2K — the six attractions are the round's whole premise ("what you
   * build shapes who visits"), so each must be visually distinct from the
   * others AND from every shipped item. `drawableItemIds` proves they are
   * not the fallback crate; this proves they are not each other, by
   * asserting the six draw calls produce six different geometry payloads.
   */
  it("each of the six attractions draws its own distinct shape", async () => {
    const { resolvePlaceableSprite } = await import("./placeableSprites");
    const attractionIds = placeables
      .filter((p) => p.effects?.some((e) => e.kind === "attraction") === true)
      .map((p) => p.id);
    expect(attractionIds).toEqual([
      "clover-ring",
      "thicket-feeder",
      "sap-bucket",
      "snow-bell",
      "tidewrack",
      "lampwell",
    ]);
    const signatures = new Set<string>();
    for (const id of attractionIds) {
      const def = placeables.find((p) => p.id === id);
      const sprite = resolvePlaceableSprite(id, def?.footprint ?? { w: 1, h: 1 }, 40, 24);
      // Every drawing is a `Graphics` tree under `wrap`; its serialized
      // instruction count + bounds is a cheap, stable fingerprint.
      const b = sprite.wrap.getLocalBounds();
      signatures.add(
        [
          sprite.wrap.children.length,
          Math.round(b.x),
          Math.round(b.y),
          Math.round(b.width),
          Math.round(b.height),
        ].join(":"),
      );
      sprite.destroy();
    }
    expect(signatures.size).toBe(6);
  });
});

describe("placeableSprites — the flat list is the walkability mitigation (bible §5.2)", () => {
  /**
   * `isFlatItem` reads `RESOLVERS[id].flat` and nothing else, so a missing
   * resolver entry silently returns false and the item BLOCKS pip movement.
   * Content bible §9.11 warned that 20 decorations on an 8×12 grid can wall a
   * pip in; 32 decorations on a 12×14 grid makes the generous flat list the
   * whole mitigation (the real walkability validator is a named seam, bible
   * §7.6), so each of these is pinned by id.
   */
  const flatByDesign = [
    // Shipped before this round.
    "pebble-path",
    "shell-mosaic",
    "toadstool-ring",
    "tide-basin",
    // Added by bible §5.2's explicit call-out.
    "clover-patch",
    "fern-cluster",
    "sled",
    "glow-pool",
    "warm-stones",
    // ROUND 2J FIX STAGE — the Compass Rose is laid INTO the ground at the
    // gate; the other four craft-only keepsakes stand and block.
    "compass-rose",
  ];

  for (const id of flatByDesign) {
    it(`${id} is flat — a pip walks over it`, () => {
      expect(isFlatItem(id)).toBe(true);
    });
  }

  it("stations are never flat — a pip walks AROUND the thing it uses", () => {
    for (const def of placeables) {
      expect(isFlatItem(def.id)).toBe(false);
    }
  });

  it("nothing outside the pinned list is flat, so a new decoration cannot quietly become walkable", () => {
    const actuallyFlat = drawableItemIds().filter((id) => isFlatItem(id)).sort();
    expect(actuallyFlat).toEqual([...flatByDesign].sort());
  });

  it("an unknown id is not flat and does not throw (the fallback still has to be safe)", () => {
    expect(isFlatItem("no-such-item")).toBe(false);
  });
});
