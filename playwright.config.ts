import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:3100/health",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
