import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    // Fixed port per CLAUDE.md — 5173 belongs to other local projects.
    port: 5317,
    strictPort: true,
  },
  plugins: [
    // PWA (spec §1): installable manifest + offline-capable service
    // worker. generateSW precaches every built asset (cache-first), and
    // gameplay makes zero network calls, so the whole game runs offline.
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "PipsKeep",
        short_name: "PipsKeep",
        description:
          "A tiny keep full of tiny Pips. Feed them, send them adventuring, and they will be politely smug about it.",
        orientation: "portrait",
        display: "standalone",
        start_url: ".",
        // Palette (src/content/palette.ts): keepPalette.skyTop / skyBottom.
        theme_color: "#cfe8f7",
        background_color: "#eef7ea",
        icons: [
          {
            src: "icons/pip-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/pip-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/pip-maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/pip-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache EVERYTHING the build emits — icons included — so a
        // cold offline launch still has the full game (spec §1
        // "network-independent gameplay").
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Split Pixi (and its transitive deps) into its own chunk so the
        // spec §1 budget — app code ≤ 350 KB gz EXCLUDING Pixi — stays
        // directly measurable from the build output. `idb` (the only
        // other runtime dep, ~1 KB gz) counts as app code.
        manualChunks(id: string): string | undefined {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("node_modules/idb/")) return undefined;
          return "pixi";
        },
      },
    },
  },
  test: {
    // core/ and content/ are pure logic — no DOM needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
