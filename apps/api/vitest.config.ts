import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.testnet.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    pool: "forks",
  },
});
