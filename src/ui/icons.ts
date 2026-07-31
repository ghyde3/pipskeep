/**
 * PROCEDURAL GLYPH RENDERER (docs/progression-bible.md §4.2) — the "if we
 * can use some icons for them that would be great" half of the owner's
 * complaint, answered with zero new assets and zero new dependencies.
 *
 * `content/icons.ts` owns the VOCABULARY (motif ids, badge ids, the
 * per-set tint table) as pure data; this module owns turning one resolved
 * `IconSpec` + tint into a self-contained inline `<svg>`, plus the two
 * small derivations bible §4.2 requires to live OUTSIDE content so a
 * badge can never be authored (and therefore never lie):
 *
 *   - `badgeForEffects()` — the item's FIRST effect picks its badge
 *     family (heart/moon/boot/star/gear). A decoration with only a 1%
 *     comfort effect still wears the heart — "it does something" is the
 *     whole point of the badge.
 *   - `tintForSetId()` — a decoration's `setId` (or the neutral station
 *     tint when absent) picks which of `content/icons.ts`'s `ICON_TINTS`
 *     colours the glyph wears.
 *
 * `renderIcon(spec, tint, size)` is the one DOM entry point every owning
 * surface calls (the Build sheet's cards, the Rearrange rows, the
 * placement-mode pill, the Keep Comfort readout, the Satchel). It returns
 * a plain `<span>` wrapper — dumb DOM, no framework, matches every other
 * `ui/` module's "state/spec in, element out" shape.
 *
 * 16 motifs × 5 derived badges × 7 tints = 560 visually distinct
 * combinations from the ~16 authored motif shapes below — no bespoke
 * drawing per catalog item, no asset pipeline, no new files in `public/`.
 */

import type { BadgeId, IconSpec, MotifId } from "../content/icons";
import { ICON_TINTS, STATION_ICON_TINT_KEY } from "../content/icons";
import { itemColors } from "../content/palette";
import type { BuildingEffect } from "../content/buildingEffects";
import "./icons.css";

// ---------------------------------------------------------------------------
// Badge derivation (bible §4.2: "derived from the item's first effect, not
// authored — so the badge can never lie").
// ---------------------------------------------------------------------------

/**
 * One badge family per `BuildingEffect` kind. Two intentional
 * compressions onto a shared badge: `expeditionSpeed`/`expeditionLoot`/
 * `eggChancePoints` all read as "something about a trip going better", so
 * all three wear the boot; `incubationSpeed` reads as "something finishes
 * waiting sooner", the same idea `restSpeed` already owns, so it shares
 * the moon. Only 5 badges exist (bible §4.2) — compressing is the point,
 * not a gap.
 */
const BADGE_FOR_EFFECT_KIND: Readonly<Record<BuildingEffect["kind"], BadgeId>> = {
  comfort: "heart",
  restSpeed: "moon",
  incubationSpeed: "moon",
  expeditionSpeed: "boot",
  expeditionLoot: "boot",
  eggChancePoints: "boot",
  job: "gear",
  xpBonus: "star",
  // ROUND 2J FIX STAGE — the three kinds widened in the same patch that
  // wired them (`content/buildingEffects.ts`'s discharged 2H note): a
  // remedy is care (heart), a longer life is care (heart), a faster bench
  // is work (gear). This map is EXHAUSTIVE by type, which is exactly why
  // widening the union is a coordinated content+ui edit rather than a
  // content-only one.
  remedy: "heart",
  longevity: "heart",
  craftSpeed: "gear",
};

/** The badge a catalog item's icon wears — derived from its FIRST effect,
 * `undefined` when the item carries none (a plain motif, no corner mark). */
export function badgeForEffects(
  effects: readonly BuildingEffect[] | undefined,
): BadgeId | undefined {
  const first = effects?.[0];
  return first === undefined ? undefined : BADGE_FOR_EFFECT_KIND[first.kind];
}

// ---------------------------------------------------------------------------
// Tint resolution (bible §4.2: "sourced from content/palette.ts" via
// content/icons.ts's ICON_TINTS, keyed by a decoration's setId).
// ---------------------------------------------------------------------------

/** The same neutral hex `content/icons.ts` already ships for
 * `STATION_ICON_TINT_KEY` — the safe fallback content/icons.ts's own doc
 * comment names for a set id that (future content pass) forgets a tint
 * entry. Never a broken build; at worst a slightly duller card. */
const DEFAULT_TINT = ICON_TINTS[STATION_ICON_TINT_KEY] ?? "#a89478";

/** A station (no `setId`) gets the neutral tint; a decoration gets its
 * set's tint, or the neutral default if the set is somehow untinted. */
export function tintForSetId(setId: string | undefined): string {
  const key = setId ?? STATION_ICON_TINT_KEY;
  return ICON_TINTS[key] ?? DEFAULT_TINT;
}

/** One-call convenience for a Build-sheet catalog item: resolves the
 * fully-derived `IconSpec` (motif + derived badge) and its tint together,
 * so callers never juggle the two derivations separately. */
export function resolveItemIcon(
  icon: IconSpec,
  effects: readonly BuildingEffect[] | undefined,
  setId: string | undefined,
): { readonly spec: IconSpec; readonly tint: string } {
  return {
    spec: { motif: icon.motif, badge: badgeForEffects(effects) },
    tint: tintForSetId(setId),
  };
}

// ---------------------------------------------------------------------------
// Foods carry no IconSpec in content (content/foods.ts predates this
// round's icon vocabulary and adding one is a content-authoring change
// outside this task's ownership) — this small UI-local map gives every
// shipped food a motif so the Satchel is never bare. Foods use their OWN
// long-shipped colour (content/palette.ts's itemColors) as the tint
// instead of a set tint — they carry no setId, and reusing the colour a
// player has already learned keeps every Satchel card's shade unchanged.
// ---------------------------------------------------------------------------

const FOOD_MOTIFS: Readonly<Record<string, MotifId>> = {
  berry: "leaf",
  stew: "pot",
  honeydrop: "droplet",
  toastnut: "leaf",
  frostberry: "snowflake",
  cocoabun: "flame",
  glowcap: "spark",
  tideroll: "shell",
  emberloaf: "flame",
  feastpot: "pot",
};

/** Motif-only spec for an inventory item (food) — no badge; a badge is a
 * BUILDING-effect signal (bible §4.2) and a food's effects are shown as
 * text, not a corner mark. Unknown ids (a future food content forgot to
 * list here) fall back to "leaf" rather than rendering nothing. */
export function foodIconSpec(foodId: string): IconSpec {
  return { motif: FOOD_MOTIFS[foodId] ?? "leaf" };
}

// ---------------------------------------------------------------------------
// ROUND 2J — the five BASE RESOURCES (`core/economy`'s `RESOURCE_IDS`) carry
// no `IconSpec`/tint of their own either, for the same reason foods didn't:
// `content/economy` predates this icon vocabulary, and giving five ids a
// motif is a content-authoring change outside this round's core/content
// ownership. Before this round no surface rendered a resource icon at all
// (the Satchel showed only foods; resources had no viewing surface — see
// docs/hud-redesign.md §2.5). Motifs picked to read as the THING, not just
// "a swatch": wood is a post, fiber is a leaf, shell reuses the existing
// shell glyph, driftwood is a curved arch (a piece of bleached wood), and
// lodestone is the "stone" motif — the same one the Cairn recipe describes
// as "three stones, balanced, pointing" (docs/economy-bible.md §1.1).
// ---------------------------------------------------------------------------

const RESOURCE_MOTIFS: Readonly<Record<string, MotifId>> = {
  wood: "post",
  fiber: "leaf",
  shell: "shell",
  driftwood: "arch",
  lodestone: "stone",
};

/** Motif-only spec for a base resource — mirrors `foodIconSpec`. Unknown
 * ids (a future sixth resource) fall back to "stone" rather than nothing. */
export function resourceIconSpec(resourceId: string): IconSpec {
  return { motif: RESOURCE_MOTIFS[resourceId] ?? "stone" };
}

/**
 * A resource's own tint — never a decoration set's, since resources carry
 * no `setId`. Falls back to the neutral station tint, same discipline as
 * `tintForSetId`.
 *
 * ROUND 2J FIX STAGE: this READS `content/palette.ts`'s `itemColors`
 * rather than keeping its own private table. The private table was the
 * bug: the Satchel's Materials list rendered Lodestone in slate-blue
 * while `ui/lootReveal.ts` — which tints from `itemColors` — rendered it
 * as the generic tan fallback, because `itemColors` had no resource
 * entries at all. One map, one identity per material, on every surface.
 */
export function resourceTint(resourceId: string): string {
  return itemColors[resourceId] ?? DEFAULT_TINT;
}

// ---------------------------------------------------------------------------
// Motif + badge markup (0 0 24 24 viewBox). Abstract, geometric shapes —
// procedural glyphs, not bespoke illustration; each is legible at both
// build-card size (~28px) and Satchel-swatch size (~26px, the existing
// `.pk-item-swatch` footprint).
// ---------------------------------------------------------------------------

const MOTIF_MARKUP: Readonly<Record<MotifId, string>> = {
  bowl:
    '<ellipse cx="12" cy="9" rx="8" ry="2.4"/>' +
    '<path d="M4.3 9.6C4.3 14.7 7.8 18.4 12 18.4S19.7 14.7 19.7 9.6Z"/>',
  nest:
    '<path d="M3 14.6C3 12 6.6 11.2 12 11.2S21 12 21 14.6C21 16.8 16.9 18 12 18S3 16.8 3 14.6Z"/>' +
    '<ellipse cx="12" cy="13.6" rx="2.7" ry="2.2" opacity=".55"/>',
  basket:
    '<path d="M8 10.4C8 6.6 9.8 4.4 12 4.4S16 6.6 16 10.4" fill="none" stroke="var(--pk-icon-tint)" stroke-width="1.7"/>' +
    '<path d="M5.4 10.4H18.6L17.3 18.6C17.1 19.7 16.2 20.4 15 20.4H9C7.8 20.4 6.9 19.7 6.7 18.6Z"/>',
  pot:
    '<ellipse cx="12" cy="10" rx="7.2" ry="1.8"/>' +
    '<circle cx="12" cy="7.4" r="1.1"/>' +
    '<circle cx="4.6" cy="10.6" r="1.3"/><circle cx="19.4" cy="10.6" r="1.3"/>' +
    '<path d="M5 10.4H19L18 18.2C17.8 19.5 17.5 20.4 15.9 20.4H8.1C6.5 20.4 6.2 19.5 6 18.2Z"/>',
  leaf:
    '<path d="M6 18.2C5 12 8 6.4 18 5.2C19 14.4 15 18.6 6 18.2Z"/>' +
    '<line x1="7.6" y1="16.6" x2="16.4" y2="6.6" stroke="var(--pk-icon-tint)" stroke-width="1.1" opacity=".5"/>',
  shell:
    '<path d="M12 4C16 7 18.6 11.6 18.6 18H5.4C5.4 11.6 8 7 12 4Z"/>' +
    '<line x1="12" y1="18" x2="12" y2="5.4" stroke="var(--pk-icon-tint)" stroke-width="1" opacity=".5"/>' +
    '<line x1="9" y1="18" x2="8" y2="8.6" stroke="var(--pk-icon-tint)" stroke-width="1" opacity=".5"/>' +
    '<line x1="15" y1="18" x2="16" y2="8.6" stroke="var(--pk-icon-tint)" stroke-width="1" opacity=".5"/>',
  flame:
    '<path d="M12 3C13 6 9 7 9 10.5A3 3 0 0 0 15 10.5C15 9.6 14.6 8.9 14.6 8.9C16 9.8 17 11.6 17 13.4A5 5 0 0 1 7 13.4C7 8.9 12 8 12 3Z"/>',
  lantern:
    '<path d="M11 3.4H13" fill="none" stroke="var(--pk-icon-tint)" stroke-width="1.5" stroke-linecap="round"/>' +
    '<rect x="7" y="5.4" width="10" height="12.4" rx="2.6"/>' +
    '<circle cx="12" cy="11.6" r="2.3" opacity=".55"/>' +
    '<rect x="9.4" y="17.8" width="5.2" height="2" rx="0.7"/>',
  stone:
    '<ellipse cx="12" cy="18.2" rx="7" ry="2.4"/>' +
    '<ellipse cx="12" cy="13.6" rx="5" ry="2.1"/>' +
    '<ellipse cx="12" cy="9.6" rx="3" ry="1.7"/>',
  droplet:
    '<path d="M12 3C15.2 7.6 18 11.4 18 14.8A6 6 0 1 1 6 14.8C6 11.4 8.8 7.6 12 3Z"/>',
  snowflake:
    '<line x1="12" y1="3.4" x2="12" y2="20.6" stroke="var(--pk-icon-tint)" stroke-width="1.6" stroke-linecap="round"/>' +
    '<line x1="4.9" y1="7.9" x2="19.1" y2="16.1" stroke="var(--pk-icon-tint)" stroke-width="1.6" stroke-linecap="round"/>' +
    '<line x1="4.9" y1="16.1" x2="19.1" y2="7.9" stroke="var(--pk-icon-tint)" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="12" cy="12" r="1.3"/>',
  spark:
    '<path d="M12 2.2C12.6 6.4 14 9.6 17 10.6C14 11.6 12.6 14.8 12 19C11.4 14.8 10 11.6 7 10.6C10 9.6 11.4 6.4 12 2.2Z"/>' +
    '<path d="M18.4 3.8C18.7 5.4 19.3 6.4 20.4 6.8C19.3 7.2 18.7 8.2 18.4 9.8C18.1 8.2 17.5 7.2 16.4 6.8C17.5 6.4 18.1 5.4 18.4 3.8Z" opacity=".7"/>',
  arch:
    '<path d="M5 20.4V12A7 7 0 0 1 19 12V20.4" fill="none" stroke="var(--pk-icon-tint)" stroke-width="2.3" stroke-linecap="round"/>',
  post:
    '<rect x="11" y="4" width="2" height="16.4" rx="1"/>' +
    '<path d="M13 7.2H19L17.4 9.7L19 12.2H13Z"/>',
  bench:
    '<rect x="3" y="5" width="18" height="2.1" rx="1"/>' +
    '<rect x="3" y="10.2" width="18" height="2.3" rx="1"/>' +
    '<rect x="5" y="6.9" width="1.6" height="3.6"/><rect x="17.4" y="6.9" width="1.6" height="3.6"/>' +
    '<rect x="5.2" y="12.7" width="2" height="6" rx="0.6"/><rect x="16.8" y="12.7" width="2" height="6" rx="0.6"/>',
  chime:
    '<rect x="4" y="4" width="16" height="1.8" rx="0.9"/>' +
    '<rect x="6.6" y="7.4" width="1.7" height="9.4" rx="0.85"/>' +
    '<rect x="11.15" y="7.4" width="1.7" height="11.6" rx="0.85"/>' +
    '<rect x="15.7" y="7.4" width="1.7" height="7.8" rx="0.85"/>',
};

/** Small (~9×9-equivalent) corner marks, each with its own contrasting
 * background disc so a badge stays legible over any motif or tint
 * (bible §4.2's "corner mark" — drawn LAST so it sits on top). */
const BADGE_MARKUP: Readonly<Record<BadgeId, string>> = {
  heart:
    '<circle cx="18.4" cy="18.4" r="5.3" fill="#fffdf6" stroke="rgba(61,74,61,.28)" stroke-width="1"/>' +
    '<path d="M18.4 20.4C16.1 18.9 15.1 17.7 15.1 16.5A1.8 1.8 0 0 1 18.4 15.5A1.8 1.8 0 0 1 21.7 16.5C21.7 17.7 20.7 18.9 18.4 20.4Z" fill="#e0607e"/>',
  moon:
    '<circle cx="18.4" cy="18.4" r="5.3" fill="#fffdf6" stroke="rgba(61,74,61,.28)" stroke-width="1"/>' +
    '<path d="M20.5 16.6A3.4 3.4 0 1 1 16 12.3A4.2 4.2 0 1 0 20.5 16.6Z" fill="#6a8fd8"/>',
  boot:
    '<circle cx="18.4" cy="18.4" r="5.3" fill="#fffdf6" stroke="rgba(61,74,61,.28)" stroke-width="1"/>' +
    '<path d="M16.4 20.6C16.4 19.7 16.6 19 16.6 18.2C16.6 17.3 16.2 16.7 16.2 15.9C16.2 15.3 16.7 14.9 17.2 14.9C17.7 14.9 18.1 15.3 18.2 15.8C18.4 16.7 19 17.3 19.9 17.6L21.4 18.1C21.8 18.3 22.1 18.6 22.1 19.1V20.2C22.1 20.5 21.8 20.7 21.5 20.7Z" fill="#c98b45"/>',
  star:
    '<circle cx="18.4" cy="18.4" r="5.3" fill="#fffdf6" stroke="rgba(61,74,61,.28)" stroke-width="1"/>' +
    '<path d="M18.4 15C18.7 16.5 19.3 17.3 20.6 17.6C19.3 17.9 18.7 18.7 18.4 20.2C18.1 18.7 17.5 17.9 16.2 17.6C17.5 17.3 18.1 16.5 18.4 15Z" fill="#f0b429"/>',
  gear:
    '<circle cx="18.4" cy="18.4" r="5.3" fill="#fffdf6" stroke="rgba(61,74,61,.28)" stroke-width="1"/>' +
    '<path fill-rule="evenodd" d="M18.4 20.6A2.4 2.4 0 1 0 18.4 15.8A2.4 2.4 0 0 0 18.4 20.6ZM18.4 19.4A1.2 1.2 0 1 1 18.4 17A1.2 1.2 0 0 1 18.4 19.4Z" fill="#7a8a7a"/>' +
    '<rect x="17.8" y="14.1" width="1.2" height="1.2" fill="#7a8a7a"/>' +
    '<rect x="17.8" y="21.5" width="1.2" height="1.2" fill="#7a8a7a"/>' +
    '<rect x="14.7" y="17.8" width="1.2" height="1.2" fill="#7a8a7a"/>' +
    '<rect x="22.1" y="17.8" width="1.2" height="1.2" fill="#7a8a7a"/>',
};

/** The raw inline-SVG markup for one `IconSpec` — exported mainly for
 * testing (string assertions are cheap and don't need a DOM); `renderIcon`
 * is what every real caller uses. */
export function iconSvgMarkup(spec: IconSpec): string {
  const motif = MOTIF_MARKUP[spec.motif];
  const badge = spec.badge !== undefined ? BADGE_MARKUP[spec.badge] : "";
  return (
    '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">' +
    `<g fill="var(--pk-icon-tint)">${motif}</g>${badge}` +
    "</svg>"
  );
}

export type IconSize = "sm" | "md" | "lg";

/**
 * The one DOM entry point (brief: "one renderer, `renderIcon(iconId)`").
 * Returns a plain `<span class="pk-icon pk-icon--{size}">` with the tint
 * set as the `--pk-icon-tint` custom property `icons.css`'s paths read —
 * dumb DOM, no framework, safe to drop into any card/row this round adds.
 */
export function renderIcon(spec: IconSpec, tint: string, size: IconSize = "md"): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = `pk-icon pk-icon--${size}`;
  wrap.style.setProperty("--pk-icon-tint", tint);
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = iconSvgMarkup(spec);
  return wrap;
}
