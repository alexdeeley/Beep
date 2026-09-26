import { defineConfig } from "@playwright/test";

/**
 * The multi-client acceptance test manages its own server lifecycle (it
 * needs to kill and restart the backend mid-test to verify persistence
 * across a restart), so there's no `webServer` here - that spec starts the
 * Vite dev server and the API/WS backend itself in `test.beforeAll`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    viewport: { width: 1000, height: 700 },
  },
});
