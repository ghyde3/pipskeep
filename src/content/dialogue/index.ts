/**
 * Dialogue registry (spec §3), keyed `personality × context`.
 * Contexts = the four moods (§4.3) + Sulking (§4.4) + Refusal (§5) +
 * Greeting (round 2K, §4.5 — Pip to Pip, not Pip to player).
 *
 * AUTHORING LAYOUT: each personality's lines live in their own sibling
 * file (`lazy.ts`, `curious.ts`, `hardworking.ts`, `chaotic.ts`,
 * `clingy.ts`) — one plain object of six string arrays, nothing else —
 * so writers can fill pools in parallel without merge conflicts or
 * touching any logic. This index merges them and owns every type.
 *
 * Launch minimum is REQUIRED_LINES_PER_CONTEXT per pool (7 contexts ×
 * 5 personalities × 8 = 280 lines since round 2K added `greeting`). The Phase 2 authoring pass landed;
 * an underfilled pool is now a spec §3 violation and hard-fails
 * validation (validate.ts routes findUnderfilledDialoguePools into the
 * errors bucket).
 */

import type { PersonalityId } from "../personalities";
import { PERSONALITY_IDS } from "../personalities";
import { lazy } from "./lazy";
import { curious } from "./curious";
import { hardworking } from "./hardworking";
import { chaotic } from "./chaotic";
import { clingy } from "./clingy";

export const DIALOGUE_CONTEXTS = [
  "beaming",
  "content",
  "grumpy",
  "miserable",
  "sulking",
  "refusal",
  // ROUND 2K (docs/liveliness-bible.md §4.5) — what a Pip says to
  // ANOTHER PIP. The only context whose audience is not the player.
  "greeting",
] as const;
export type DialogueContext = (typeof DIALOGUE_CONTEXTS)[number];

/** Launch minimum lines per `personality × context` pool (spec §3). */
export const REQUIRED_LINES_PER_CONTEXT = 8;

/** One personality's lines: one array of strings per context. This is
 * the whole authoring surface of a personality file. */
export type DialoguePool = Readonly<Record<DialogueContext, readonly string[]>>;

export type DialoguePools = Readonly<Record<PersonalityId, DialoguePool>>;

export const dialogue: DialoguePools = {
  lazy,
  curious,
  hardworking,
  chaotic,
  clingy,
};

/**
 * Returns one issue string per underfilled `personality × context` pool.
 * Since the Phase 2 authoring pass, validate.ts treats these as ERRORS
 * (spec §3: under-writing dialogue is a spec violation).
 */
export function findUnderfilledDialoguePools(
  pools: DialoguePools = dialogue,
  requiredLines: number = REQUIRED_LINES_PER_CONTEXT,
): string[] {
  const warnings: string[] = [];
  for (const personality of PERSONALITY_IDS) {
    for (const context of DIALOGUE_CONTEXTS) {
      const lines = pools[personality]?.[context];
      const count = lines?.length ?? 0;
      if (count < requiredLines) {
        warnings.push(
          `dialogue: pool ${personality}/${context} has ${count}/${requiredLines} lines (launch minimum, spec §3)`,
        );
      }
    }
  }
  return warnings;
}
