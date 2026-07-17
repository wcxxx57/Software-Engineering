import { defineConfig } from "@playwright/test";

const port = Number(process.env.PORT || 3100);

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npm run build && npm start",
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
