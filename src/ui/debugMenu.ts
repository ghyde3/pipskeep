/**
 * Debug menu (spec §14 — DEV BUILDS ONLY).
 *
 * This module is reachable solely through the `import.meta.env.DEV`
 * dynamic import in src/app/main.ts, so production builds tree-shake it
 * away entirely (verified by grepping dist/ for DEBUG_MENU_MARKER).
 *
 * Split like recovery.ts for node-environment testability:
 * - `createDebugMenuController` — the logic: time skew, grants,
 *   export/import, corrupt-my-save. Fully unit-tested with injected
 *   seams in debugMenu.test.ts.
 * - `createSkewSliderController` — a tiny PURE controller (no DOM, no
 *   clock) for the time slider: unit (Minutes/Hours/Days) → dynamic max
 *   → clamped value → ms conversion. Exists standalone so the model is
 *   unit-testable without touching the DOM shell.
 * - `initDebugMenu` — the DOM shell: a wrench button + panel, toggled by
 *   the button or the backquote key. Styles are inlined here (NOT in
 *   ui.css) so nothing debug-flavored ships in the production bundle.
 *
 * ROUND 2A FIX (playtest finding #4): time skew is the QA fast-forward —
 * it shifts the ONE shared OffsetClock (src/app/appClock.ts), so every
 * timestamp consumer moves together. Previously the skip dispatched a
 * plain TICK at the post-skew time, which applies RAW uncapped decay and
 * never exercises the §4.5 offline rate cap — so a 24h debug skip was far
 * harsher than a real 24h absence (and never ran the cap's segmentation,
 * expedition-return, or egg-completion handling either). The default skip
 * now dispatches `CATCHUP { savedAt: preSkewNow, now: postSkewNow }` —
 * EXACTLY what boot() does when it loads a save (src/app/main.ts): the
 * same engine, same cap, same events. A debug skip and "closing the tab"
 * for the same duration now produce identical state (see the
 * catchup-equivalence test in debugMenu.test.ts).
 *
 * A secondary "raw" mode is kept for QA that specifically wants to watch
 * uncapped live-tick decay (dispatches TICK, like the old default) — the
 * DOM shell exposes it as the honestly-labelled "live decay (no cap)"
 * toggle, off by default. Skews do not persist: after a skewed session, a
 * plain reload sees `savedAt` in the future and §4.5 clamps the negative
 * elapsed to 0 (nothing double-decays).
 *
 * Spawn egg (spec §14, Phase 4 — the seam, now filled): dispatches
 * DEBUG_SPAWN_EGG with `at` BACKDATED by the full incubation length,
 * then a TICK at now — settleDueEggs flips the brand-new egg straight to
 * Pipping, so QA gets an instantly tappable hatch moment without touching
 * the clock. (Timestamps are action payload data; backdating one is a
 * pure QA trick, not a clock read.)
 */

import type { Clock } from "../core/clock";
import type { Store } from "../core/store";
import type { GameAction, GameState } from "../core/state";
import { RESOURCE_IDS } from "../core/economy";
import { toSaveBlob } from "../core/save/serialize";
import type { SaveBlob, SaveBlobError } from "../core/save/serialize";
import { migrate } from "../core/save/migrate";
import { LATEST_SAVE_KEY } from "../app/persistence";
import type { SaveStore } from "../app/persistence";
import { domDownload } from "./recovery";
import { notify } from "./notify";
import { HOUR_MS, MINUTE_MS, SECOND_MS, tuning } from "../content/tuning";
import { resolveIncubationMs } from "../core/eggs";

/** Unique needle for the prod-bundle tree-shake check (`grep dist/`). */
export const DEBUG_MENU_MARKER = "pipskeep-debug-menu";

/** A calendar fact (24h/day), not a tuning literal — kept local since it
 * is structural, exactly like `tuning.ts`'s own `HOUR_MS = 60 * MINUTE_MS`. */
const DAY_MS = 24 * HOUR_MS;

export const DEBUG_EXPORT_FILENAME = "pipskeep-save.json";

/** What the grant buttons hand out (spec §14 "grant resources"). */
export const GRANT_BERRY_COUNT = 5;
export const GRANT_STEW_COUNT = 1;
export const GRANT_EACH_RESOURCE_COUNT = 10;

/** The garbage "Corrupt my save" writes over the latest slot. A bare
 * string fails migrate() with `not-an-object` — the exact class of blob
 * the §8 recovery flow exists for. */
export const CORRUPT_SENTINEL =
  "PIPSKEEP DEBUG: this save was deliberately corrupted by the debug menu's Corrupt-my-save button";

/** The one shared app clock, as the debug menu needs it (OffsetClock
 * satisfies this structurally). */
export interface SkewableClock extends Clock {
  skew(ms: number): void;
  offsetMs(): number;
}

export type DebugImportResult =
  | { readonly ok: true; readonly fromVersion: number }
  | { readonly ok: false; readonly error: SaveBlobError };

/**
 * How a time skip is applied (Round 2A, finding #4):
 * - `"catchup"` (default) — dispatches CATCHUP over the skewed window,
 *   simulating a real absence: segmentation, the §4.5 offline rate cap,
 *   and expedition/egg completions all run exactly as they would after
 *   closing the tab.
 * - `"raw"` — dispatches a plain TICK at the post-skew time: uncapped,
 *   instantaneous decay. Kept for QA that wants to watch live-tick
 *   behavior rather than an absence; exposed honestly in the DOM shell
 *   as "live decay (no cap)".
 */
export type SkewMode = "catchup" | "raw";

export interface DebugMenuControllerDeps {
  readonly store: Store<GameState, GameAction>;
  readonly clock: SkewableClock;
  readonly saveStore: SaveStore;
  /** Disposed before corrupting the save so no autosave / hidden flush /
   * pagehide flush can rewrite a valid blob before the reload. */
  readonly persistence: { dispose(): void };
  /** Receives (filename, json) for Export save. DOM shell: real anchor
   * download; tests: a spy. */
  download(filename: string, json: string): void;
}

export interface DebugMenuController {
  /** Shift the shared clock by `ms`, then apply the elapsed window via
   * `mode` (default `"catchup"` — see `SkewMode`). `mode: "raw"` reverts
   * to the old plain-TICK QA behavior for watching live decay. */
  skewBy(ms: number, mode?: SkewMode): void;
  offsetMs(): number;
  grantBerries(): void;
  grantStew(): void;
  /** +GRANT_EACH_RESOURCE_COUNT of every base resource (§6.3). */
  grantAllResources(): void;
  /** Spawn an instantly-Pipping egg (spec §14 "spawn egg"): the spawn is
   * backdated by its full incubation and the follow-up TICK flips it to
   * Pipping — tap it in the Keep to QA the hatch flow end to end. */
  spawnEgg(): void;
  /** Download the current world as pipskeep-save.json. Returns the
   * exported blob (handy for tests). */
  exportSave(): SaveBlob;
  /** Parse → migrate → validate → LOAD_SAVE + CATCHUP. Never throws;
   * invalid input comes back as the typed SaveBlobError and the running
   * game is left untouched. */
  importSaveText(text: string): DebugImportResult;
  /** Stop autosave, then overwrite the latest save with garbage. The
   * caller offers a reload, which walks the §8 recovery flow. */
  corruptSave(): Promise<void>;
}

export function createDebugMenuController(
  deps: DebugMenuControllerDeps,
): DebugMenuController {
  return {
    skewBy(ms: number, mode: SkewMode = "catchup"): void {
      const savedAt = deps.clock.now();
      deps.clock.skew(ms);
      const now = deps.clock.now();
      if (mode === "raw") {
        deps.store.dispatch({ type: "TICK", at: now });
      } else {
        // Simulate a real absence (finding #4): the same CATCHUP action
        // boot() dispatches over `savedAt → now` on load, so a debug skip
        // and closing the tab for the same span land identically.
        deps.store.dispatch({ type: "CATCHUP", savedAt, now });
      }
    },

    offsetMs: () => deps.clock.offsetMs(),

    grantBerries(): void {
      deps.store.dispatch({
        type: "DEBUG_GRANT",
        items: { berry: GRANT_BERRY_COUNT },
      });
    },

    grantStew(): void {
      deps.store.dispatch({
        type: "DEBUG_GRANT",
        items: { stew: GRANT_STEW_COUNT },
      });
    },

    grantAllResources(): void {
      const resources: Record<string, number> = {};
      for (const id of RESOURCE_IDS) {
        resources[id] = GRANT_EACH_RESOURCE_COUNT;
      }
      deps.store.dispatch({ type: "DEBUG_GRANT", resources });
    },

    spawnEgg(): void {
      const now = deps.clock.now();
      const incubationMs = resolveIncubationMs(tuning.eggs.expeditionEggRarity);
      deps.store.dispatch({ type: "DEBUG_SPAWN_EGG", at: now - incubationMs });
      // settleDueEggs is inclusive at the boundary, so this TICK flips the
      // backdated egg straight to Pipping.
      deps.store.dispatch({ type: "TICK", at: now });
    },

    exportSave(): SaveBlob {
      const blob = toSaveBlob(deps.store.getState(), deps.clock.now());
      deps.download(DEBUG_EXPORT_FILENAME, JSON.stringify(blob, null, 2));
      return blob;
    },

    importSaveText(text: string): DebugImportResult {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (failure) {
        return {
          ok: false,
          error: {
            code: "not-an-object",
            path: "",
            message: `not valid JSON: ${
              failure instanceof Error ? failure.message : String(failure)
            }`,
          },
        };
      }
      const result = migrate(parsed);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      // Replace-and-re-init, exactly like boot: swap the world in, then
      // CATCHUP over savedAt → now. The persistence subscription is
      // still attached, so the imported state autosaves within 2s.
      deps.store.dispatch({ type: "LOAD_SAVE", state: result.save.state });
      deps.store.dispatch({
        type: "CATCHUP",
        savedAt: result.save.savedAt,
        now: deps.clock.now(),
      });
      return { ok: true, fromVersion: result.fromVersion };
    },

    async corruptSave(): Promise<void> {
      // Order matters: dispose FIRST, or the debounced autosave / the
      // pagehide flush during the upcoming reload would overwrite the
      // garbage with a valid blob and the recovery flow never triggers.
      deps.persistence.dispose();
      await deps.saveStore.put(LATEST_SAVE_KEY, CORRUPT_SENTINEL);
    },
  };
}

/**
 * Human-friendly total offset readout (item #3): "+0s", "+1h", "+1d 1h",
 * "+2d 6h", "+1h 30m", "-45m". Shows at most the two most-significant
 * non-zero units (days→hours→minutes→seconds) so a multi-day skew reads
 * as "clock +2d 6h" rather than a pile of tiny units.
 */
export function formatOffset(ms: number): string {
  const sign = ms < 0 ? "-" : "+";
  let rest = Math.abs(ms);
  const d = Math.floor(rest / DAY_MS);
  rest -= d * DAY_MS;
  const h = Math.floor(rest / HOUR_MS);
  rest -= h * HOUR_MS;
  const m = Math.floor(rest / MINUTE_MS);
  rest -= m * MINUTE_MS;
  const s = rest / SECOND_MS;
  const all: string[] = [];
  if (d > 0) all.push(`${d}d`);
  if (h > 0) all.push(`${h}h`);
  if (m > 0) all.push(`${m}m`);
  if (s > 0) all.push(`${s}s`);
  const parts = all.slice(0, 2);
  if (parts.length === 0) parts.push("0s");
  return sign + parts.join(" ");
}

// ---------------------------------------------------------------------------
// Time slider — pure controller (item #2)
// ---------------------------------------------------------------------------

/** The slider's unit toggle. */
export const SKEW_UNITS = ["minutes", "hours", "days"] as const;
export type SkewUnit = (typeof SKEW_UNITS)[number];

/** Dynamic slider max per unit, as requested: minutes 60 / hours 24 /
 * days 30. */
export const SKEW_UNIT_MAX: Readonly<Record<SkewUnit, number>> = {
  minutes: 60,
  hours: 24,
  days: 30,
};

const SKEW_UNIT_MS: Readonly<Record<SkewUnit, number>> = {
  minutes: MINUTE_MS,
  hours: HOUR_MS,
  days: DAY_MS,
};

/** Clamp a raw slider value to `[1, SKEW_UNIT_MAX[unit]]`, rounding to a
 * whole number (non-finite input falls back to 1 rather than propagating
 * NaN into the clock). */
export function clampSkewValue(unit: SkewUnit, value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), SKEW_UNIT_MAX[unit]);
}

/** The clamped `unit`/`value` converted to milliseconds — what the Skip
 * button hands to `skewBy`. */
export function skewValueToMs(unit: SkewUnit, value: number): number {
  return clampSkewValue(unit, value) * SKEW_UNIT_MS[unit];
}

export interface SkewSliderState {
  readonly unit: SkewUnit;
  readonly value: number;
}

/**
 * Pure model for the time slider: unit → dynamic max → clamped value →
 * ms conversion. No DOM, no clock — the DOM shell below is a thin
 * wrapper around this, and it is exactly what debugMenu.test.ts drives
 * directly (unit → max → clamped value → ms conversion, as requested).
 */
export interface SkewSliderController {
  getState(): SkewSliderState;
  /** The current unit's slider max (60 / 24 / 30). */
  getMax(): number;
  /** Switch units, re-clamping the existing numeric value to the new
   * max (e.g. 45 minutes → switching to Days re-clamps to 30). */
  setUnit(unit: SkewUnit): SkewSliderState;
  /** Set the raw slider value, clamped to the current unit's range. */
  setValue(value: number): SkewSliderState;
  /** The selected amount converted to milliseconds. */
  toMs(): number;
}

export function createSkewSliderController(
  initial: Partial<SkewSliderState> = {},
): SkewSliderController {
  let unit: SkewUnit = initial.unit ?? "hours";
  let value = clampSkewValue(unit, initial.value ?? 1);

  return {
    getState: () => ({ unit, value }),
    getMax: () => SKEW_UNIT_MAX[unit],
    setUnit(next: SkewUnit): SkewSliderState {
      unit = next;
      value = clampSkewValue(unit, value);
      return { unit, value };
    },
    setValue(next: number): SkewSliderState {
      value = clampSkewValue(unit, next);
      return { unit, value };
    },
    toMs: () => skewValueToMs(unit, value),
  };
}

// ---------------------------------------------------------------------------
// DOM shell (dev only — dead code in production builds)
// ---------------------------------------------------------------------------

export interface DebugMenuDeps {
  readonly mount: HTMLElement;
  readonly store: Store<GameState, GameAction>;
  readonly clock: SkewableClock;
  readonly saveStore: SaveStore;
  readonly persistence: { dispose(): void };
  /** Seams; default to the real anchor download / location.reload(). */
  download?(filename: string, json: string): void;
  reload?(): void;
}

export interface DebugMenu {
  readonly el: HTMLElement;
  readonly controller: DebugMenuController;
  toggle(open?: boolean): void;
  dispose(): void;
}

const DEBUG_STYLES = `
/* ROUND 2G INTEGRATE: keyed to \`--pk-hud-bottom\` (published by xpBar.ts's
   ResizeObserver) instead of the old \`bottom: 132px\`. 132px landed inside
   the new Keep strip's band (84px→157px), so at 375x812 this dev toggle
   covered 30% of the Build button and won the hit-test on its top-right
   corner. Dev-only, so it never shipped — but it broke the QA tool used to
   verify the strip it was sitting on. The +69px stacks this 8px ABOVE the
   sound toggle (which sits at +21px with a 40px box), so the two right-edge
   floats queue up the column instead of sitting on each other. */
.pk-debug-root { position: fixed; right: 10px; bottom: calc(var(--pk-hud-bottom, 157px) + 69px); z-index: 60;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.pk-debug-toggle { position: absolute; right: 0; bottom: 0; width: 34px; height: 34px;
  border-radius: 50%; border: 1.5px solid rgba(95, 138, 94, 0.4);
  background: rgba(255, 253, 246, 0.9); cursor: pointer; font-size: 16px;
  line-height: 1; padding: 0; opacity: 0.65; }
.pk-debug-toggle:hover { opacity: 1; }
.pk-debug-panel { position: absolute; right: 0; bottom: 40px; width: 260px;
  background: rgba(38, 46, 38, 0.94); color: #e8f0e4; border-radius: 12px;
  padding: 10px; display: flex; flex-direction: column; gap: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35); }
.pk-debug-panel[hidden] { display: none; }
.pk-debug-title { display: flex; justify-content: space-between; align-items: baseline;
  font-weight: 700; letter-spacing: 0.04em; }
.pk-debug-offset { font-weight: 400; opacity: 0.8; }
.pk-debug-row { display: flex; gap: 6px; flex-wrap: wrap; }
.pk-debug-row > button { flex: 1 1 auto; border: 1px solid rgba(232, 240, 228, 0.25);
  background: rgba(232, 240, 228, 0.08); color: inherit; border-radius: 8px;
  padding: 5px 6px; font: inherit; cursor: pointer; white-space: nowrap;
  min-height: 30px; }
.pk-debug-row > button:hover { background: rgba(232, 240, 228, 0.18); }
.pk-debug-row > button:disabled { opacity: 0.4; cursor: default; }
.pk-debug-danger { border-color: rgba(255, 138, 92, 0.5) !important;
  color: #ffb08a !important; }
.pk-debug-slider { border: 1px solid rgba(232, 240, 228, 0.18); border-radius: 10px;
  padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.pk-debug-unit-row > button { min-height: 34px; }
.pk-debug-unit-row > button[aria-pressed="true"] {
  background: rgba(151, 196, 132, 0.35); border-color: rgba(151, 196, 132, 0.6); }
.pk-debug-range-row { display: flex; align-items: center; gap: 8px; }
.pk-debug-range-row input[type="range"] { flex: 1 1 auto; height: 32px;
  touch-action: pan-y; accent-color: #97c484; }
.pk-debug-range-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 26px; height: 26px;
  border-radius: 50%; background: #97c484; border: 1.5px solid #e8f0e4; cursor: pointer; }
.pk-debug-range-row input[type="range"]::-moz-range-thumb {
  width: 26px; height: 26px; border-radius: 50%; background: #97c484;
  border: 1.5px solid #e8f0e4; cursor: pointer; }
.pk-debug-readout { min-width: 48px; text-align: right; font-weight: 700; }
.pk-debug-skip-btn { min-height: 38px; font-weight: 700; }
.pk-debug-toggle-row { display: flex; align-items: center; gap: 8px;
  padding: 4px 2px; cursor: pointer; }
.pk-debug-toggle-row input[type="checkbox"] { width: 18px; height: 18px; margin: 0; }
`;

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function importErrorMessage(error: SaveBlobError): string {
  const at = error.path !== "" ? ` (at ${error.path})` : "";
  return `Import rejected [${error.code}]: ${error.message}${at}`;
}

/** Mount the debug menu. Toggle with the wrench button or backquote. */
export function initDebugMenu(deps: DebugMenuDeps): DebugMenu {
  const controller = createDebugMenuController({
    store: deps.store,
    clock: deps.clock,
    saveStore: deps.saveStore,
    persistence: deps.persistence,
    download: deps.download ?? domDownload,
  });
  const reload = deps.reload ?? ((): void => window.location.reload());

  const root = document.createElement("div");
  root.className = "pk-debug-root";
  root.dataset["marker"] = DEBUG_MENU_MARKER;

  const style = document.createElement("style");
  style.textContent = DEBUG_STYLES;

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "pk-debug-toggle";
  toggleBtn.title = "PipsKeep debug menu (`)";
  toggleBtn.setAttribute("aria-label", "Toggle the debug menu");
  toggleBtn.textContent = "\u{1F527}"; // wrench

  const panel = document.createElement("div");
  panel.className = "pk-debug-panel";
  panel.hidden = true;

  const title = document.createElement("div");
  title.className = "pk-debug-title";
  const titleText = document.createElement("span");
  titleText.textContent = "debug";
  const offsetEl = document.createElement("span");
  offsetEl.className = "pk-debug-offset";
  title.append(titleText, offsetEl);

  const syncOffset = (): void => {
    offsetEl.textContent = `clock ${formatOffset(controller.offsetMs())}`;
  };

  const button = (
    label: string,
    onClick: () => void,
    className?: string,
  ): HTMLButtonElement => {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    if (className !== undefined) el.className = className;
    el.addEventListener("click", onClick);
    return el;
  };

  // Live-decay toggle: off (default) → skips dispatch CATCHUP (simulates
  // a real absence, finding #4); on → raw uncapped TICK, for QA that
  // wants to watch live-tick decay instead. Labelled honestly, per spec.
  let rawMode = false;
  const applySkew = (ms: number): void => {
    controller.skewBy(ms, rawMode ? "raw" : "catchup");
    syncOffset();
  };

  const quickJumpRow = document.createElement("div");
  quickJumpRow.className = "pk-debug-row";
  const quickJumps: readonly { readonly label: string; readonly ms: number }[] = [
    { label: "+5m", ms: 5 * MINUTE_MS },
    { label: "+15m", ms: 15 * MINUTE_MS },
    { label: "+1h", ms: HOUR_MS },
    { label: "+6h", ms: 6 * HOUR_MS },
    { label: "+24h", ms: 24 * HOUR_MS },
  ];
  for (const jump of quickJumps) {
    quickJumpRow.appendChild(button(jump.label, () => applySkew(jump.ms)));
  }

  // --- Time slider (item #2): unit toggle → dynamic-max range → Skip ---
  const sliderController = createSkewSliderController({ unit: "hours", value: 1 });
  const UNIT_LABEL: Readonly<Record<SkewUnit, string>> = {
    minutes: "Min",
    hours: "Hrs",
    days: "Days",
  };
  const UNIT_SUFFIX: Readonly<Record<SkewUnit, string>> = {
    minutes: "m",
    hours: "h",
    days: "d",
  };

  const unitRow = document.createElement("div");
  unitRow.className = "pk-debug-row pk-debug-unit-row";
  const unitButtons = new Map<SkewUnit, HTMLButtonElement>();

  const rangeInput = document.createElement("input");
  rangeInput.type = "range";
  rangeInput.min = "1";
  rangeInput.setAttribute("aria-label", "Time to skip");

  const readout = document.createElement("span");
  readout.className = "pk-debug-readout";

  const syncSlider = (): void => {
    const state = sliderController.getState();
    rangeInput.max = String(sliderController.getMax());
    rangeInput.value = String(state.value);
    readout.textContent = `${state.value}${UNIT_SUFFIX[state.unit]}`;
    for (const [unit, el] of unitButtons) {
      el.setAttribute("aria-pressed", String(unit === state.unit));
    }
  };

  for (const unit of SKEW_UNITS) {
    const el = button(UNIT_LABEL[unit], () => {
      sliderController.setUnit(unit);
      syncSlider();
    });
    el.setAttribute("aria-pressed", "false");
    unitButtons.set(unit, el);
    unitRow.appendChild(el);
  }

  rangeInput.addEventListener("input", () => {
    sliderController.setValue(Number(rangeInput.value));
    syncSlider();
  });

  const rangeRow = document.createElement("div");
  rangeRow.className = "pk-debug-range-row";
  rangeRow.append(rangeInput, readout);

  const skipBtn = button("Skip", () => applySkew(sliderController.toMs()), "pk-debug-skip-btn");

  const sliderBox = document.createElement("div");
  sliderBox.className = "pk-debug-slider";
  sliderBox.append(unitRow, rangeRow, skipBtn);

  syncSlider();

  const rawModeToggle = document.createElement("label");
  rawModeToggle.className = "pk-debug-toggle-row";
  const rawModeInput = document.createElement("input");
  rawModeInput.type = "checkbox";
  rawModeInput.addEventListener("change", () => {
    rawMode = rawModeInput.checked;
  });
  const rawModeText = document.createElement("span");
  rawModeText.textContent = "live decay (no cap)";
  rawModeToggle.append(rawModeInput, rawModeText);

  const grantRow = document.createElement("div");
  grantRow.className = "pk-debug-row";
  grantRow.append(
    button(`+${GRANT_BERRY_COUNT} Berries`, () => controller.grantBerries()),
    button(`+${GRANT_STEW_COUNT} Stew`, () => controller.grantStew()),
    button(`+${GRANT_EACH_RESOURCE_COUNT} of each resource`, () =>
      controller.grantAllResources(),
    ),
    button("Spawn egg", () => controller.spawnEgg()),
  );

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/json,.json";
  fileInput.hidden = true;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // allow re-picking the same file
    if (file === undefined) return;
    file.text().then(
      (text) => {
        const result = controller.importSaveText(text);
        notify({
          kind: "info",
          message: result.ok
            ? "Save imported — the Keep is as you left it."
            : importErrorMessage(result.error),
        });
      },
      () => {
        notify({ kind: "info", message: "Import failed: could not read that file." });
      },
    );
  });

  const saveRow = document.createElement("div");
  saveRow.className = "pk-debug-row";
  saveRow.append(
    button("Export save", () => controller.exportSave()),
    button("Import save", () => fileInput.click()),
  );

  const dangerRow = document.createElement("div");
  dangerRow.className = "pk-debug-row";
  let corrupted = false;
  const corruptBtn = button(
    "Corrupt my save",
    () => {
      if (corrupted) {
        reload();
        return;
      }
      corruptBtn.disabled = true;
      controller.corruptSave().then(
        () => {
          corrupted = true;
          corruptBtn.disabled = false;
          corruptBtn.textContent = "Corrupted — reload now";
          notify({
            kind: "info",
            message: "Save corrupted on disk. Reload to walk the recovery flow.",
          });
        },
        () => {
          corruptBtn.disabled = false;
          notify({ kind: "info", message: "Corrupting the save failed (!) — see console." });
        },
      );
    },
    "pk-debug-danger",
  );
  dangerRow.appendChild(corruptBtn);

  panel.append(
    title,
    sliderBox,
    quickJumpRow,
    rawModeToggle,
    grantRow,
    saveRow,
    dangerRow,
  );
  root.append(style, panel, toggleBtn, fileInput);
  deps.mount.appendChild(root);

  const toggle = (open?: boolean): void => {
    panel.hidden = open === undefined ? !panel.hidden : !open;
    if (!panel.hidden) syncOffset();
  };
  toggleBtn.addEventListener("click", () => toggle());

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.code !== "Backquote" || event.repeat || isTextEntry(event.target)) {
      return;
    }
    event.preventDefault();
    toggle();
  };
  window.addEventListener("keydown", onKeydown);

  syncOffset();

  return {
    el: root,
    controller,
    toggle,
    dispose(): void {
      window.removeEventListener("keydown", onKeydown);
      root.remove();
    },
  };
}
