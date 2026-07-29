/**
 * Job registry (spec §6.2). Gathering (Gathering Station) shipped at MVP;
 * ROUND 2B adds Simmering (Stockpot, content bible §5.4) as PURE content —
 * `core/keep/jobs.ts` and `ui/focusView.ts` find a job by scanning this
 * registry for a placement whose `itemId` hosts one, so a second job is
 * no core/render change at all. Structured as a REGISTRY so
 * Crafting/Decorating slot in later the same way (spec §6.2's named
 * seam); numbers live in tuning.ts like every other tunable.
 */

import { tuning } from "./tuning";

export interface JobLootEntry {
  /** A resource id or food id; validation is the source of truth. */
  itemId: string;
  /** Relative weight, > 0. */
  weight: number;
}

export interface JobDef {
  id: string;
  name: string;
  /** Placeable that hosts this job (spec §6.2: a PLACED station). */
  stationItemId: string;
  /** One resource produced per this many ms (spec §6.2: 10 min default). */
  intervalMs: number;
  /** The station's weighted production table (Berries 70 / Fiber 30). */
  table: readonly JobLootEntry[];
  /**
   * ROUND 2B (content bible §8.2.4, a fence exception): present-participle
   * verb for the focus view's assigned-job note — "${pip.name} is
   * ${verbing} away". Without this, `ui/focusView.ts` hard-coded
   * "gathering", so a Pip working the Stockpot was described as gathering.
   */
  verbing: string;
  /** Shown in place of the assigned note when the working Pip is Resting
   * instead (content bible §8.2.4) — job-specific, so "the basket can
   * wait" doesn't describe a pot. */
  restingNote: string;
}

export const jobs: Readonly<Record<string, JobDef>> = {
  gathering: {
    id: "gathering",
    name: "Gathering",
    stationItemId: "gathering-station",
    intervalMs: tuning.gathering.intervalMs,
    table: Object.entries(tuning.gathering.table).map(([itemId, weight]) => ({
      itemId,
      weight,
    })),
    verbing: "gathering",
    restingNote: "Fast asleep. The basket can wait; the dream cannot.",
  },
  /**
   * ROUND 2B (content bible §5.4): the Stockpot's job — the pantry to
   * Gathering's materials faucet. Slower (30 min vs 10) and food-only
   * (Berry/Toastnut, deliberately no Stew — see tuning.ts's `jobs.simmering`
   * comment), so it never competes with Gathering as the wood/fiber route.
   */
  simmering: {
    id: "simmering",
    name: "Simmering",
    stationItemId: "stockpot",
    intervalMs: tuning.jobs.simmering.intervalMs,
    table: Object.entries(tuning.jobs.simmering.table).map(([itemId, weight]) => ({
      itemId,
      weight,
    })),
    verbing: "simmering",
    restingNote: "Fast asleep. The pot will keep without them; the dream cannot.",
  },
};
