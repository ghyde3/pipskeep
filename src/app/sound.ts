/**
 * Sound-slot seam (spec §12: Sound is deferred — "`sound(slotId)` no-op
 * hooks on actions" is the named seam, nothing more).
 *
 * Every care animation and juicy UI moment calls `sound("...")` with a
 * stable slot id; a future audio pass maps slot ids to assets HERE and
 * touches no call sites.
 */

/** Known slot ids (open set — new juice may add slots freely). */
export type SoundSlotId =
  | "care.feed"
  | "care.clean"
  | "care.play"
  | "care.pet"
  | "care.rest"
  | "care.wake"
  | "care.give"
  | "care.refuse"
  | "ui.tap"
  | "ui.sheet"
  | "notify.toast"
  | (string & {});

/** Deliberate no-op (spec §12). Do not implement audio here in MVP. */
export function sound(slotId: SoundSlotId): void {
  void slotId;
}
