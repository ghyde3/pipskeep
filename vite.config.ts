import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    // Fixed port per CLAUDE.md — 5173 belongs to other local projects.
    port: 5317,
    strictPort: true,
  },
  test: {
    // core/ and content/ are pure logic — no DOM needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
