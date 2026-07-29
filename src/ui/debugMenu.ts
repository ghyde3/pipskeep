/**
 * Debug menu (spec §14 — DEV BUILDS ONLY).
 *
 * This module is reachable solely through the `import.meta.env.DEV`
 * dynamic import in src/app/main.ts, so production builds tree-shake it
 * away entirely (verified by grepping dist/ for DEBUG_MENU_MARKER).
 *
 * Split like recovery.ts for node-environment testability:
 * - `createDebugMenuController` — the logic: time skew (+TICK so decay
 *   applies immediately), grants, export/import, corrupt-my-save. Fully
 *   unit-tested with injected seams in debugMenu.test.ts.
 * - `initDebugMenu` — the DOM shell: a wrench button + panel, toggled by
 *   the button or the backquote key. Styles are inlined here (NOT in
 *   ui.css) so nothing debug-flavored ships in the production bundle.
 *
 * Time skew is the QA fast-forward: it shifts the ONE shared OffsetClock
 * (src/app/appClock.ts), so every timestamp consumer — TICK decay now,
 * expedition/egg timers in Phase 4 — moves together. Skews do not
 * persist: after a skewed session, a plain reload sees `savedAt` in the
 * future and §4.5 clamps the negative elapsed to 0. That is the desired
 * QA semantics (nothing double-decays).
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
  /** Shift the shared clock by `ms`, then TICK so decay (and, from
   * Phase 4, expedition/egg timer checks) applies immediately. */
  skewBy(ms: number): void;
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
    skewBy(ms: number): void {
      deps.clock.skew(ms);
      deps.store.dispatch({ type: "TICK", at: deps.clock.now() });
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

/** "+0s", "+1h", "+25h", "+1h 30m", "-45m" — the offset readout. */
export function formatOffset(ms: number): string {
  const sign = ms < 0 ? "-" : "+";
  let rest = Math.abs(ms);
  const h = Math.floor(rest / HOUR_MS);
  rest -= h * HOUR_MS;
  const m = Math.floor(rest / MINUTE_MS);
  rest -= m * MINUTE_MS;
  const s = rest / SECOND_MS;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0) parts.push(`${s}s`);
  if (parts.length === 0) parts.push("0s");
  return sign + parts.join(" ");
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
.pk-debug-root { position: fixed; right: 10px; bottom: 132px; z-index: 60;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.pk-debug-toggle { position: absolute; right: 0; bottom: 0; width: 34px; height: 34px;
  border-radius: 50%; border: 1.5px solid rgba(95, 138, 94, 0.4);
  background: rgba(255, 253, 246, 0.9); cursor: pointer; font-size: 16px;
  line-height: 1; padding: 0; opacity: 0.65; }
.pk-debug-toggle:hover { opacity: 1; }
.pk-debug-panel { position: absolute; right: 0; bottom: 40px; width: 232px;
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
  padding: 5px 6px; font: inherit; cursor: pointer; white-space: nowrap; }
.pk-debug-row > button:hover { background: rgba(232, 240, 228, 0.18); }
.pk-debug-row > button:disabled { opacity: 0.4; cursor: default; }
.pk-debug-danger { border-color: rgba(255, 138, 92, 0.5) !important;
  color: #ffb08a !important; }
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

  const skewRow = document.createElement("div");
  skewRow.className = "pk-debug-row";
  for (const hours of [1, 6, 24]) {
    skewRow.appendChild(
      button(`+${hours}h`, () => {
        controller.skewBy(hours * HOUR_MS);
        syncOffset();
      }),
    );
  }

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

  panel.append(title, skewRow, grantRow, saveRow, dangerRow);
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
