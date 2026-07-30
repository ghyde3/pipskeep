/**
 * THE CHRONICLE (docs/progression-bible.md §2, Keep tier 9) — "a dated page
 * of everything the Keep has done".
 *
 * ROUND 2F INTEGRATE. Tier 9's headline named the Chronicle, the level-up
 * banner promised it, and the road-ahead ladder sold it — and nothing
 * existed. That is the exact failure spec §16 v1.3 made a standing rule
 * against ("written to state" and "visible to the player" are SEPARATE
 * acceptance criteria), in its worst form: a tier the player pays resources
 * and XP for, which hands back a sentence.
 *
 * It costs no new state, exactly as the bible said (§4's table: "Album /
 * history surfaces → `milestones.earned` (already `id → earnedAt`)"). Every
 * milestone has been stamped with its earn time since round 2C; this module
 * just sorts them newest-first and prints the date.
 *
 * Split like every other `ui/` module: a pure model builder (unit-tested
 * without a DOM) and a dumb renderer. It owns no sheet and no entry point —
 * `ui/dailies.ts` hosts it as the Nook's fourth tab, because the Nook is
 * already where the player goes to look back at what they have done.
 *
 * Purity note: dates come from `formatCaughtDate` (ui/pipdex.ts), which
 * slices `core/clock.ts`'s `isoStamp`. This file never calls `new Date(`,
 * so the repo-wide grep for it stays at zero.
 */

import type { GameState } from "../core/state";
import { MILESTONES } from "../content/milestones";
import type { MilestoneDef } from "../content/milestones";
import { formatCaughtDate } from "./pipdex";

/** The Keep tier that opens the Chronicle (progression bible §2, tier 9). */
export const CHRONICLE_KEEP_LEVEL = 9;

export interface ChronicleEntry {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** Clock timestamp the milestone was earned. */
  readonly at: number;
  /** "14 Mar 2026". */
  readonly dateLabel: string;
  /** The Keep XP that entry paid, for the running total below it. */
  readonly xp: number;
}

export interface ChronicleModel {
  /** False below tier 9 — the tab renders its "something to grow toward"
   * note instead of the page (the same shape `ui/buildSheet.ts` uses for a
   * locked station: shown, never hidden). */
  readonly unlocked: boolean;
  readonly lockLabel: string;
  /** Newest first — a chronicle is read from the top. */
  readonly entries: readonly ChronicleEntry[];
  /** Lifetime Keep XP, printed as the page's footer line. */
  readonly keepXp: number;
  readonly keepLevel: number;
  /** "3 of 42 written" — the page's own header line. */
  readonly countLabel: string;
}

/**
 * THE PURE MODEL. Reads only `milestones.earned` (`id → earnedAt`),
 * `keep.level` and `keepXp` — no clock, no dispatch.
 *
 * Deliberately tolerant of ids that are no longer in the registry: a save
 * from before a content edit must still render its own history rather than
 * dropping rows (spec §4.4's "never punish the player" applies to their
 * record of themselves too). Unknown ids fall back to the id as a name.
 */
export function buildChronicleModel(
  state: Pick<GameState, "milestones" | "keep" | "keepXp">,
  registry: readonly MilestoneDef[] = MILESTONES,
): ChronicleModel {
  const byId = new Map(registry.map((m) => [m.id, m]));
  const entries: ChronicleEntry[] = Object.entries(state.milestones.earned)
    .map(([id, at]) => {
      const def = byId.get(id);
      return {
        id,
        name: def?.name ?? id,
        blurb: def?.blurb ?? "",
        at,
        dateLabel: formatCaughtDate(at),
        xp: def?.xp ?? 0,
      };
    })
    // Newest first; ties broken by id so the order is stable across renders
    // (two milestones earned on the same dispatch share a timestamp).
    .sort((a, b) => (b.at - a.at) || a.id.localeCompare(b.id));

  const unlocked = state.keep.level >= CHRONICLE_KEEP_LEVEL;
  return {
    unlocked,
    lockLabel: `The Chronicle opens at Keep level ${CHRONICLE_KEEP_LEVEL} — something to grow toward.`,
    entries,
    keepXp: state.keepXp,
    keepLevel: state.keep.level,
    countLabel: `${entries.length} of ${registry.length} written`,
  };
}

/**
 * Renders the model into a fresh element. Returns a detached node the host
 * sheet appends — same contract as `ui/dailies.ts`'s own `renderStreak` /
 * `renderBounties` section builders.
 */
export function renderChronicle(model: ChronicleModel): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "pk-daily-section pk-chronicle";

  const title = document.createElement("div");
  title.className = "pk-daily-section-title";
  title.textContent = "The Chronicle";
  wrap.appendChild(title);

  if (!model.unlocked) {
    const locked = document.createElement("div");
    locked.className = "pk-chronicle-locked";
    locked.textContent = model.lockLabel;
    wrap.appendChild(locked);
    return wrap;
  }

  const header = document.createElement("div");
  header.className = "pk-chronicle-header";
  header.textContent = `${model.countLabel} · ${model.keepXp.toLocaleString("en-US")} Keep XP earned, all told`;
  wrap.appendChild(header);

  if (model.entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pk-chronicle-locked";
    empty.textContent = "Nothing written yet — the first page is waiting.";
    wrap.appendChild(empty);
    return wrap;
  }

  for (const entry of model.entries) {
    const row = document.createElement("div");
    row.className = "pk-chronicle-row";

    const date = document.createElement("div");
    date.className = "pk-chronicle-date";
    date.textContent = entry.dateLabel;

    const text = document.createElement("div");
    text.className = "pk-chronicle-text";
    const name = document.createElement("div");
    name.className = "pk-chronicle-name";
    name.textContent = entry.name;
    const blurb = document.createElement("div");
    blurb.className = "pk-chronicle-blurb";
    blurb.textContent = entry.blurb;
    text.append(name, blurb);

    row.append(date, text);

    if (entry.xp > 0) {
      const xp = document.createElement("span");
      xp.className = "pk-chronicle-xp";
      xp.textContent = `+${entry.xp}`;
      row.appendChild(xp);
    }

    wrap.appendChild(row);
  }

  return wrap;
}
