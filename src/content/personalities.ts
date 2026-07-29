/**
 * Personality registry (spec §4.2). Five at launch.
 * Decay multipliers live in tuning.ts (single balancing file, spec §14).
 */

import type { NeedId } from "../core/pips";
import { tuning } from "./tuning";

export const PERSONALITY_IDS = [
  "lazy",
  "curious",
  "hardworking",
  "chaotic",
  "clingy",
] as const;
export type PersonalityId = (typeof PERSONALITY_IDS)[number];

export interface PersonalityDef {
  id: PersonalityId;
  name: string;
  /** Multipliers on base decay (spec §4.1/§4.2), stacked multiplicatively. */
  decayMultipliers: Readonly<Record<NeedId, number>>;
  /** Human-readable quirk summary; the numbers live in tuning.quirks. */
  quirk: string;
}

export const personalities: Readonly<Record<PersonalityId, PersonalityDef>> = {
  lazy: {
    id: "lazy",
    name: "Lazy",
    decayMultipliers: tuning.personalityDecayMultipliers.lazy,
    quirk: "Refuses Play per refusal rules; loves Rest.",
  },
  curious: {
    id: "curious",
    name: "Curious",
    decayMultipliers: tuning.personalityDecayMultipliers.curious,
    quirk: "+10% expedition loot.",
  },
  hardworking: {
    id: "hardworking",
    name: "Hardworking",
    decayMultipliers: tuning.personalityDecayMultipliers.hardworking,
    quirk: "-15% expedition duration.",
  },
  chaotic: {
    id: "chaotic",
    name: "Chaotic",
    decayMultipliers: tuning.personalityDecayMultipliers.chaotic,
    quirk: "Random reaction table; occasionally \"helps\" wrong.",
  },
  clingy: {
    id: "clingy",
    name: "Clingy",
    decayMultipliers: tuning.personalityDecayMultipliers.clingy,
    quirk: "Happiness x2.0 decay while on expedition; bonus from Pet.",
  },
};
