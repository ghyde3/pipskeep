/**
 * Perf harness (?perf — DEV BUILDS ONLY, spec §1 performance budgets).
 *
 * Reached solely through the `import.meta.env.DEV` dynamic import in
 * main.ts, exactly like the debug menu, so production builds never ship
 * it. Open http://localhost:5317/?perf to use it.
 *
 * What it does INSTEAD of a normal boot:
 * - renders the spec §1 budget scenario — 5 animated Pips + 30
 *   decorations (perfState.ts) — through the REAL keep scene, sprite
 *   resolvers, wander/idle systems;
 * - never opens IndexedDB, never creates a store, never autosaves: the
 *   synthetic state exists only inside the scene layer, so the player's
 *   real save cannot be touched;
 * - overlays an fps meter fed by a raw requestAnimationFrame delta ring
 *   buffer (perfStats.ts): avg fps, p95/worst frame time, and a
 *   cumulative count of >50 ms spikes (the spec's spike budget).
 *
 * Measurement methodology (keep it honest): the meter uses the rAF
 * callback timestamps, NOT Pixi's ticker, so it observes real vsync
 * cadence including any time Pixi itself stalls. For the phone-profile
 * budget, run this under Chrome DevTools 4× CPU throttle.
 *
 * Styles are inlined (debugMenu convention) — nothing perf-flavored in
 * the shipped CSS.
 */

import { Application } from "pixi.js";
import { createKeepScene } from "../render/keepScene";
import { buildPerfState, PERF_DECORATION_COUNT, PERF_PIP_COUNT } from "./perfState";
import { createFrameStats, SPIKE_THRESHOLD_MS } from "./perfStats";

/** Unique needle for the prod-bundle tree-shake check (`grep dist/`). */
export const PERF_MODE_MARKER = "pipskeep-perf-mode";

/** HUD refresh cadence in frames (~2×/s at 60fps) — frame-counted so the
 * harness needs no interval timer of its own. */
const HUD_REFRESH_FRAMES = 30;

function buildHud(): { root: HTMLElement; readout: HTMLElement } {
  const root = document.createElement("div");
  root.dataset["marker"] = PERF_MODE_MARKER;
  root.style.cssText = [
    "position:fixed",
    "top:8px",
    "left:8px",
    "z-index:9999",
    "background:rgba(20,28,20,0.82)",
    "color:#d8f3d0",
    "font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace",
    "padding:8px 10px",
    "border-radius:8px",
    "pointer-events:none",
    "white-space:pre",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = `PERF MODE — synthetic scene (${PERF_PIP_COUNT} pips / ${PERF_DECORATION_COUNT} decorations), save untouched`;
  title.style.cssText = "font-weight:700;color:#ffe9a3;margin-bottom:4px";

  const readout = document.createElement("div");
  readout.textContent = "warming up…";

  root.append(title, readout);
  return { root, readout };
}

/** Boot the perf scene in place of the real game. Never returns to the
 * normal boot path. */
export async function startPerfMode(): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#eef7ea",
    resizeTo: window,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const mount = document.getElementById("app");
  if (!mount) {
    throw new Error("PipsKeep perf mode: #app mount point missing");
  }
  mount.appendChild(app.canvas);

  const scene = createKeepScene(app.screen.width, app.screen.height);
  app.stage.addChild(scene.view);
  scene.resize(app.screen.width, app.screen.height);
  window.addEventListener("resize", () => {
    scene.resize(window.innerWidth, window.innerHeight);
  });

  // The whole scenario in one sync — state never changes afterwards;
  // everything that moves from here on is scene-local animation.
  scene.sync(buildPerfState());
  app.ticker.add((ticker) => {
    scene.update(ticker.deltaMS);
  });

  // --- FPS meter: raw rAF delta ring buffer -----------------------------
  const stats = createFrameStats();
  const hud = buildHud();
  document.body.appendChild(hud.root);

  let lastTs: number | null = null;
  let framesSinceHud = 0;
  const loop = (ts: number): void => {
    if (lastTs !== null) stats.record(ts - lastTs);
    lastTs = ts;
    if (++framesSinceHud >= HUD_REFRESH_FRAMES) {
      framesSinceHud = 0;
      const s = stats.snapshot();
      hud.readout.textContent = [
        `fps (avg)   ${s.avgFps.toFixed(1)}`,
        `frame avg   ${s.avgFrameMs.toFixed(2)} ms`,
        `frame p95   ${s.p95FrameMs.toFixed(2)} ms`,
        `frame worst ${s.maxFrameMs.toFixed(2)} ms`,
        `spikes >${SPIKE_THRESHOLD_MS}ms  ${s.spikeCount} / ${s.totalFrames} frames`,
      ].join("\n");
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  console.info(
    `PipsKeep perf mode: budget scenario live (${PERF_PIP_COUNT} pips + ${PERF_DECORATION_COUNT} decorations). ` +
      "For the spec §1 phone profile, enable Chrome DevTools 4x CPU throttle.",
  );
}
