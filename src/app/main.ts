/**
 * Bootstrap (spec §2 app/): Pixi v8 application, blank Keep-colored world.
 * Phase 0 gate: build produces a running blank canvas.
 */

import { Application } from "pixi.js";
import { validateContent } from "../content/validate";

async function boot(): Promise<void> {
  // Content registries are validated loudly at boot in dev mode (spec §3).
  if (import.meta.env.DEV) {
    validateContent();
  }

  const app = new Application();
  await app.init({
    background: "#f4ead5", // soft pastel — placeholder Keep ground tone (spec §11)
    resizeTo: window,
    antialias: true,
  });

  const mount = document.getElementById("app");
  if (!mount) {
    throw new Error("PipsKeep: #app mount point missing from index.html");
  }
  mount.appendChild(app.canvas);
}

void boot();
