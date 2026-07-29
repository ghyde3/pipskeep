/**
 * Pip domain (spec §4) — needs, personality, mood, lifecycle, state machine.
 *
 * Barrel module. The vocabulary types Phase 0 defined here now live in
 * their Phase 1 homes:
 * - types.ts — PipId, NeedId/NEED_IDS, LifeStage, PipActivity, TraitGenome,
 *   and the aggregate `PipState` (spec §0 vocabulary).
 * - needs.ts — effectiveRates / applyNeedsDelta / accrueFrozenTime.
 * - mood.ts  — Mood/MOODS, DialogueContext, deriveMood, plus
 *   deriveDisplayedMood (Chaotic's one-step-off display quirk, §4.3).
 * - machine.ts — spec §4.7 state machine: requested transitions with typed
 *   refusals, Sulking entry/exit + Rest auto-wake evaluators, care legality.
 * - lifecycle.ts — life stages (Pipling → Adult) and evolution readiness /
 *   checkEvolution (spec §4.6).
 * - catchup.ts — offline catch-up (spec §4.5): runCatchup's chronological
 *   segmented pass with the 12h rate cap, CatchupEvent seam, and the
 *   CatchupSummary behind the "While you were away…" sheet.
 */

export * from "./types";
export * from "./needs";
export * from "./mood";
export * from "./machine";
export * from "./lifecycle";
export * from "./catchup";
