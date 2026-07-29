/**
 * Corrupt-save recovery (spec §8: "offer Start Fresh with the broken blob
 * exported to a downloadable file — never silently wipe").
 *
 * Split for testability under the node test environment:
 *
 * - `createRecoveryController` is PURE decision logic: serializes the raw
 *   blob for export, names the download file, and guarantees the fresh
 *   start fires exactly once and only on an explicit choice. Fully unit-
 *   tested in recovery.test.ts with an injected `download` seam.
 * - `showRecoveryModal` is the thin DOM shell around the controller: a
 *   blocking overlay with exactly two actions (Download broken save /
 *   Start Fresh) and NO dismissal path — the game cannot proceed without
 *   a decision, so there is nothing to dismiss to.
 *
 * Tone (spec §15.5): warm and a little mischievous, never scary. The
 * player's save broke; the player did nothing wrong.
 *
 * The quarantine copy ("kept safe on this device") is honest at every
 * moment: while the modal is up nothing writes to storage at all, and
 * the Start Fresh path stashes the broken blob under a quarantine key
 * before the first autosave can touch it (src/app/persistence.ts).
 */

import { isoStamp } from "../core/clock";
import type { SaveBlobError } from "../core/save/serialize";

/** Filename for the exported broken blob, derived only from the injected
 * timestamp (deterministic; colons/dots swapped out for portability).
 * Formatting goes through clock.ts's isoStamp — spec §2 rule 2 keeps
 * every Date construction inside clock.ts. */
export function brokenSaveFilename(exportedAt: number): string {
  const stamp = isoStamp(exportedAt).replace(/[:.]/g, "-");
  return `pipskeep-broken-save-${stamp}.json`;
}

export interface RecoveryControllerDeps {
  /** The corrupt blob exactly as storage produced it. */
  readonly rawBlob: unknown;
  /** Timestamp (from the app Clock) used to name the export file. */
  readonly exportedAt: number;
  /** Receives (filename, json) when the player asks for the download.
   * The DOM shell injects a real anchor-click download; tests a spy. */
  download(filename: string, json: string): void;
  /** Called exactly once, ONLY after an explicit Start Fresh choice. */
  onStartFresh(): void;
}

export interface RecoveryController {
  /** The export filename (stable for the life of the modal). */
  readonly filename: string;
  /** The broken blob as pretty JSON. Never throws: a blob that defeats
   * JSON.stringify (cycles, BigInt…) falls back to String(blob) — a poor
   * export beats a crash inside the recovery flow itself. */
  exportJson(): string;
  /** "Download broken save": hands the JSON to the download seam. May be
   * used any number of times; never starts a fresh game. */
  downloadBrokenSave(): void;
  /** "Start Fresh": fires onStartFresh on the first call and returns
   * true; every later call is ignored and returns false. */
  chooseStartFresh(): boolean;
  hasStartedFresh(): boolean;
}

export function createRecoveryController(
  deps: RecoveryControllerDeps,
): RecoveryController {
  const filename = brokenSaveFilename(deps.exportedAt);
  let startedFresh = false;

  const exportJson = (): string => {
    try {
      const json = JSON.stringify(deps.rawBlob, null, 2);
      // JSON.stringify(undefined) is undefined, not a string.
      return json === undefined ? String(deps.rawBlob) : json;
    } catch {
      return String(deps.rawBlob);
    }
  };

  return {
    filename,
    exportJson,
    downloadBrokenSave(): void {
      deps.download(filename, exportJson());
    },
    chooseStartFresh(): boolean {
      if (startedFresh) return false;
      startedFresh = true;
      deps.onStartFresh();
      return true;
    },
    hasStartedFresh: () => startedFresh,
  };
}

// ---------------------------------------------------------------------------
// DOM shell
// ---------------------------------------------------------------------------

/** Real download: a Blob behind a transient anchor click. Shared with
 * the debug menu's Export save (spec §8/§14). */
export function domDownload(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export interface RecoveryModalDeps {
  /** Where the overlay mounts (document.body at boot — the game UI does
   * not exist yet on this path). */
  readonly mount: HTMLElement;
  readonly loadError: SaveBlobError;
  readonly rawBlob: unknown;
  /** Timestamp (from the app Clock) for the export filename. */
  readonly exportedAt: number;
  /** Boot continuation: create the new game. Runs once, post-click. */
  onStartFresh(): void;
  /** Test seam; defaults to the real anchor-click download. */
  download?(filename: string, json: string): void;
}

export interface RecoveryModal {
  readonly el: HTMLElement;
  readonly controller: RecoveryController;
}

/**
 * Mount the blocking recovery modal. Two buttons, no close affordance,
 * no backdrop dismiss, no Escape: the game cannot proceed without a
 * decision, and a corrupt save must never be resolved by accident.
 */
export function showRecoveryModal(deps: RecoveryModalDeps): RecoveryModal {
  const controller = createRecoveryController({
    rawBlob: deps.rawBlob,
    exportedAt: deps.exportedAt,
    download: deps.download ?? domDownload,
    onStartFresh: deps.onStartFresh,
  });

  const overlay = document.createElement("div");
  overlay.className = "pk-recovery";
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "pk-recovery-title");

  const card = document.createElement("div");
  card.className = "pk-recovery-card";

  const title = document.createElement("h2");
  title.id = "pk-recovery-title";
  title.className = "pk-recovery-title";
  title.textContent = "Your save file got a bit scrambled.";

  const body = document.createElement("p");
  body.className = "pk-recovery-body";
  body.textContent =
    "Something nibbled the save on this device and it wouldn't load. " +
    "Rather than guess at your Pips' memories, we stopped right here — " +
    "nothing has been overwritten.";

  const detail = document.createElement("p");
  detail.className = "pk-recovery-detail";
  detail.textContent = `The technical bit: ${deps.loadError.message}${
    deps.loadError.path !== "" ? ` (at ${deps.loadError.path})` : ""
  }`;

  const reassurance = document.createElement("p");
  reassurance.className = "pk-recovery-safe";
  reassurance.textContent =
    "Either way, the broken file stays tucked away safe on this device.";

  const actions = document.createElement("div");
  actions.className = "pk-recovery-actions";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "pk-recovery-btn pk-recovery-btn--download";
  downloadBtn.textContent = "Download broken save";
  downloadBtn.addEventListener("click", () => {
    controller.downloadBrokenSave();
    downloadBtn.textContent = "Downloaded — grab another any time";
  });

  const freshBtn = document.createElement("button");
  freshBtn.type = "button";
  freshBtn.className = "pk-recovery-btn pk-recovery-btn--fresh";
  freshBtn.textContent = "Start Fresh";
  freshBtn.addEventListener("click", () => {
    if (!controller.chooseStartFresh()) return;
    downloadBtn.disabled = true;
    freshBtn.disabled = true;
    overlay.remove();
  });

  actions.append(downloadBtn, freshBtn);
  card.append(title, body, detail, reassurance, actions);
  overlay.appendChild(card);
  deps.mount.appendChild(overlay);
  freshBtn.focus();

  return { el: overlay, controller };
}
