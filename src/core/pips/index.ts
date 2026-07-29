/**
 * Pip domain (spec §4) — needs, personality, mood, lifecycle, state machine.
 *
 * Phase 1 implements the logic. Phase 0 provides only the shared vocabulary
 * types so content/ can be fully typed today.
 */

export type PipId = string;

/** The four needs, each 0–100, 100 = fully satisfied (spec §4.1). */
export const NEED_IDS = ["hunger", "cleanliness", "happiness", "energy"] as const;
export type NeedId = (typeof NEED_IDS)[number];

/** Life stages (spec §4.6). Vocabulary per spec §0: `LifeStage.Pipling`. */
export const LifeStage = {
  Pipling: "pipling",
  Adult: "adult",
} as const;
export type LifeStage = (typeof LifeStage)[keyof typeof LifeStage];

/**
 * Pip state machine states (spec §4.7). Transitions arrive in Phase 1.
 *
 * NOTE(Phase 1): spec §0's vocabulary table requires a `PipState` code
 * identifier. `PipActivity` is only the activity enum — when Phase 1 lands,
 * the aggregate per-Pip state type MUST be named `PipState` (with
 * `PipActivity` kept as the enum, or folded into it). Do not name the
 * aggregate anything else.
 */
export const PipActivity = {
  Idle: "idle",
  Resting: "resting",
  AssignedJob: "assignedJob",
  OnExpedition: "onExpedition",
  Returning: "returning",
  Sulking: "sulking",
} as const;
export type PipActivity = (typeof PipActivity)[keyof typeof PipActivity];

/** Derived moods (spec §4.3). Precedence: Miserable → Grumpy → Beaming → Content. */
export const MOODS = ["beaming", "content", "grumpy", "miserable"] as const;
export type Mood = (typeof MOODS)[number];
