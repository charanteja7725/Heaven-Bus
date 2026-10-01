import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: [
    {
      command: "npx tsx tests/local-demo.ts",
      url: "http://localhost:4000/api/health/ready",
      timeout: 180000,
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
