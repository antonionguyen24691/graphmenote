const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3010",
    headless: true,
  },
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:3010",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
