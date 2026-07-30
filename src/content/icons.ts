/**
 * ICON VOCABULARY (docs/progression-bible.md §4.2) — the data half of the
 * "procedural glyph, no assets" answer to the owner's complaint that build
 * items need real info and "if we can use some icons for them that would
 * be great". Three orthogonal axes, composed at render time:
 *
 *   - MOTIF  — what the thing IS. Authored per catalog item, below.
 *   - BADGE  — what the thing DOES. Deliberately NEVER authored in content
 *     — bible §4.2: "derived from the item's first effect, not authored...
 *     so the badge can never lie." `ui/icons.ts` (the
 *     ownership; not touched by this module) computes it from an item's
 *     `effects` list at render time. `IconSpec.badge` exists on the type
 *     only so the fully-resolved (motif + derived badge) spec can be
 *     passed through one shape to the SVG renderer — no entry in
 *     `content/placeables.ts` / `content/decorations.ts` ever sets it.
 *   - TINT   — what FAMILY it belongs to. One hex per decoration set
 *     (`content/decorSets.ts`'s six ids) plus one neutral tint for
 *     stations, which carry no `setId`. `ICON_TINTS` is the "sourced from
 *     content" half of that rule; `ui/icons.ts` reads it, keyed by an
 *     item's `setId` (or `STATION_ICON_TINT_KEY` when absent).
 *
 * 16 motifs × 5 derived badges × 7 tints is 560 visually distinct
 * combinations from ~16 authored ids here — no bespoke drawing per item,
 * no asset pipeline, no new files in `public/`.
 *
 * `content/validate.ts` cross-checks every catalog item's `icon.motif`
 * against `MOTIF_IDS` (an unauthored/typo'd motif id is exactly the kind
 * of silently-broken content this round's validator exists to catch).
 */

export type MotifId =
  | "bowl"
  | "nest"
  | "basket"
  | "pot"
  | "leaf"
  | "shell"
  | "flame"
  | "lantern"
  | "stone"
  | "droplet"
  | "snowflake"
  | "spark"
  | "arch"
  | "post"
  | "bench"
  | "chime";

export const MOTIF_IDS: readonly MotifId[] = [
  "bowl",
  "nest",
  "basket",
  "pot",
  "leaf",
  "shell",
  "flame",
  "lantern",
  "stone",
  "droplet",
  "snowflake",
  "spark",
  "arch",
  "post",
  "bench",
  "chime",
];

/** One per effect FAMILY (bible §4.2): heart=comfort, moon=rest,
 * boot=expedition, star=Keep XP, gear=hosts a job. Never authored on a
 * content entry — see the module doc. */
export type BadgeId = "heart" | "moon" | "boot" | "star" | "gear";

export const BADGE_IDS: readonly BadgeId[] = ["heart", "moon", "boot", "star", "gear"];

export interface IconSpec {
  readonly motif: MotifId;
  /** What the thing DOES — derived at render time from `effects`, never
   * authored here (see module doc). Optional so content can supply a
   * motif-only spec. */
  readonly badge?: BadgeId;
}

/** The neutral tint key every `PlaceableDef` resolves to — stations carry
 * no `setId` (they are not part of a themed decoration set). */
export const STATION_ICON_TINT_KEY = "station";

/** One hex per `content/decorSets.ts` id, plus the neutral station tint.
 * `content/validate.ts` does not currently cross-check this map against
 * `decorSets` ids (both are hand-authored together, in this same file's
 * neighbourhood); a set added without a tint entry falls back to
 * `ui/icons.ts`'s own default, which is a cosmetic-only gap, never a
 * broken build. */
export const ICON_TINTS: Readonly<Record<string, string>> = {
  "meadow-green": "#8ac926",
  "bramble-twine": "#c98b45",
  "deep-wood": "#4c9a6a",
  "first-snow": "#4cc9f0",
  tideline: "#00b4d8",
  "lantern-ember": "#ff9505",
  [STATION_ICON_TINT_KEY]: "#a89478",
};
