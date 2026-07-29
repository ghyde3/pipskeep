/**
 * Species flavor lines (content-bible §6.2). NOT the personality dialogue
 * corpus (`content/dialogue/`, keyed `personality × context`, spec §3) —
 * species are deliberately NOT a dialogue axis: 5 personalities × 6
 * contexts × 8 lines = 240 lines stays 240 lines. This is the small, typed
 * alternative for the three moments where a species (not a personality)
 * *is* the subject: hatch, evolution, and first meeting (the first time a
 * Pip of that species is opened in the focus view).
 *
 * EXACTLY four lines per species, 14 species, 56 lines — the tuple type is
 * the enforcement, not a runtime length check. Each line is written as
 * "the Keep noticing this Pip" and is deliberately moment-agnostic: four
 * lines that read correctly at hatch, evolution AND first-meeting beats
 * twelve lines that fragment the voice, and keeps the authoring cost at
 * one screen per species.
 *
 * Determinism (spec §2 rule 3): `pickSpeciesLine` is a pure hash of the
 * Pip's id, NOT an RNG stream roll — no cursor, no save impact, and the
 * same Pip always greets you with the same line.
 */

import type { SpeciesId } from "./species";

export type SpeciesLines = readonly [string, string, string, string];

export const SPECIES_LINE_COUNT = 4;

export const speciesLines: Readonly<Record<SpeciesId, SpeciesLines>> = {
  mosspip: [
    "Smells like rain on a warm stone. Immediately sits down.",
    "Mosspip has decided this spot is the spot. It is not.",
    "Hello! I brought moss. It's from your roof.",
    "Wobbles once, settles, and sighs the sigh of a Pip who has arrived.",
  ],
  grovepip: [
    "Taller now. Still puts moss in the soup.",
    "Grovepip stretches, and something small nests in it immediately.",
    "The Keep smells like a forest after rain. That's just Grovepip breathing.",
    "Grew up. Kept the habit of napping in doorways.",
  ],
  pebblepip: [
    "Landed with a clunk. Seems pleased about the clunk.",
    "Pebblepip has chosen a favorite tile and will be defending it.",
    "Heavier than it looks. Everything is heavier than Pebblepip looks.",
    "Rolled here from somewhere. Declines to say where.",
  ],
  cairnpip: [
    "Three stones tall and counting. Please don't count out loud.",
    "Cairnpip stacks itself a little higher when it thinks you're impressed.",
    "Marks the path home, and has never once been lost. Says so often.",
    "Somehow taller. Somehow still napping.",
  ],
  tidepip: [
    "Arrived damp. Has already found something to bring you.",
    "Tidepip turns over a stone, gasps, and shows you a completely normal stone.",
    "Smells of salt and enthusiasm.",
    "Left a small puddle as a gift. The puddle is the gift.",
  ],
  reefpip: [
    "Wearing a crown of coral it insists it grew itself.",
    "Reefpip has upgraded from puddles to tide pools. Congratulations to everyone.",
    "Every pocket is full of shells. Reefpip has no pockets.",
    "Bigger, brighter, still absolutely soaking.",
  ],
  emberpip: [
    "Warm! Warm warm warm. Sorry. Hello.",
    "Emberpip vibrates at a frequency only snacks can hear.",
    "Toasty little thing. Do not leave near the curtains.",
    "Popped out of the shell already talking.",
  ],
  hearthpip: [
    "Settled into a proper glow. Naps like a banked fire.",
    "Hearthpip has claimed the warmest corner, and is now the warmest corner.",
    "Still warm. Considerably more sensible about it.",
    "Everyone drifts over. Nobody admits why.",
  ],
  snowpip: [
    "Arrived cold and delighted about it.",
    "Snowpip is unbothered. Snowpip has always been unbothered.",
    "Leaves tiny frost prints and absolutely no apology.",
    "Quietly the smuggest Pip in the Keep.",
  ],
  frostpip: [
    "Has started drawing on the windows. The drawings are rude.",
    "Frostpip breathes out and it snows a little. Indoors.",
    "Colder. Calmer. Extremely pleased with itself.",
    "Winter walked in wearing a very small hat.",
  ],
  cloudpip: [
    "Drifted in through the door and forgot why.",
    "Cloudpip is listening. Cloudpip is not listening.",
    "Weighs approximately one idea.",
    "Hovers a bit. Insists it isn't.",
  ],
  thunderpip: [
    "Hiccups. Sparks. Apologizes. Hiccups again.",
    "Thunderpip rumbles when it's happy, which is alarming and lovely.",
    "Distant weather, arrived in person.",
    "Grew up moody in the most charming possible way.",
  ],
  lanternpip: [
    "Glows. Hides. Glows again from a slightly worse hiding spot.",
    "Lanternpip followed you home at a very polite distance.",
    "The reason you can see anything down here.",
    "Small, shy, and quietly the brightest thing in the Keep.",
  ],
  beaconpip: [
    "Steady light now. You can see the Keep from the shore.",
    "Beaconpip has stopped hiding and started guiding.",
    "Everyone finds their way home. That's Beaconpip's whole deal.",
    "Shy no longer — just quiet, and lit.",
  ],
};

/** Cheap deterministic string hash (djb2-ish) — NOT randomness (spec §2
 * rule 3 governs RNG streams; this touches none, so it costs nothing to
 * call from a render/UI path with no cursor to protect). */
function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = (h * 33 + key.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Deterministic pick — no RNG stream, no cursor, no save impact. `key` is
 * the Pip id; the same Pip always greets you the same way. Returns `null`
 * for an unknown species so call sites can fall back to today's copy.
 */
export function pickSpeciesLine(speciesId: SpeciesId, key: string): string | null {
  const lines = speciesLines[speciesId];
  if (lines === undefined) return null;
  return lines[hashKey(key) % SPECIES_LINE_COUNT] ?? null;
}
