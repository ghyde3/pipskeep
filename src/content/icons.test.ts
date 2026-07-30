/**
 * ICON VOCABULARY (docs/progression-bible.md §4.2) — registry-shape guard.
 * `content/validate.ts` cross-checks every catalog item's `icon` against
 * `MOTIF_IDS`/`BADGE_IDS`; this file guards the vocabulary itself: no
 * duplicate ids, a tint for every decoration set, and the "badge is never
 * authored in content" rule that keeps a badge from ever lying (bible
 * §4.2 — `ui/icons.ts` renders it, and `ui/buildMode.ts`'s `resolveItemIcon` derives the badge from an item's
 * `effects` at render time).
 */

import { describe, expect, it } from "vitest";
import { MOTIF_IDS, BADGE_IDS, ICON_TINTS, STATION_ICON_TINT_KEY } from "./icons";
import { decorSets } from "./decorSets";
import { placeables } from "./placeables";
import { decorations } from "./decorations";

describe("the icon vocabulary", () => {
  it("has no duplicate motif or badge ids", () => {
    expect(new Set(MOTIF_IDS).size).toBe(MOTIF_IDS.length);
    expect(new Set(BADGE_IDS).size).toBe(BADGE_IDS.length);
  });

  it("carries a tint for every decoration set, plus the neutral station tint", () => {
    for (const set of decorSets) {
      expect(ICON_TINTS[set.id], set.id).toBeDefined();
    }
    expect(ICON_TINTS[STATION_ICON_TINT_KEY]).toBeDefined();
  });

  it("every tint is a real hex colour (so a missing one can't silently fall through as undefined)", () => {
    for (const [id, hex] of Object.entries(ICON_TINTS)) {
      expect(hex, id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("no catalog item authors a badge — it is always derived, never written (bible §4.2)", () => {
    for (const item of [...placeables, ...decorations]) {
      expect(item.icon.badge, item.id).toBeUndefined();
    }
  });

  it("every catalog item's icon motif is in the authored vocabulary", () => {
    for (const item of [...placeables, ...decorations]) {
      expect(MOTIF_IDS as readonly string[], item.id).toContain(item.icon.motif);
    }
  });
});
