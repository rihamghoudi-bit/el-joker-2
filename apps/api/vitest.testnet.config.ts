import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.testnet.test.ts"],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 60_000,
    pool: "forks",
    fileParallelism: false,
  },
});
