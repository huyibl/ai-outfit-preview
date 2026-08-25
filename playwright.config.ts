import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  outputDir: "demo/results",
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 900 },
    video: {
      mode: "on",
      size: { width: 1440, height: 900 },
    },
    launchOptions: {
      slowMo: 480,
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
