import { defineConfig, devices } from "@playwright/test";

const PORT = 3101;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Mode mock : aucun backend requis. Build-time env inlinée par Next.
    command: `./node_modules/.bin/next dev -p ${String(PORT)}`,
    url: `http://localhost:${String(PORT)}/watch`,
    reuseExistingServer: !process.env.CI,
    // Dossier de build séparé : sans ça, ce serveur en mode mock écrase les chunks du dev
    // server (cf. next.config.mjs, distDir).
    env: { NEXT_PUBLIC_BACKEND_MODE: "mock", NEXT_DIST_DIR: ".next-e2e" },
    timeout: 120_000,
  },
});
