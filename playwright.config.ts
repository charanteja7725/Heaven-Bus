import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    headless: process.env.PW_SHOWCASE ? false : undefined,
    viewport: process.env.PW_SHOWCASE ? null : { width: 1280, height: 720 },
    launchOptions: process.env.PW_SHOWCASE
      ? {
          slowMo: 500,
          args: ["--start-maximized"],
        }
      : undefined,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: [
    {
      command: "npx tsx tests/local-demo.ts",
      url: "http://localhost:4000/api/health/ready",
      timeout: process.env.PW_SHOWCASE ? 300000 : 180000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npx vite --host 127.0.0.1",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
  workers: 1,
});
