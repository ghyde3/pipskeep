/**
 * Job registry (spec §6.2). MVP: one job — Gathering at a placed
 * Gathering Station. Structured as a REGISTRY so Crafting/Decorating
 * slot in later as new entries without core changes (spec §6.2's named
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
  },
};
