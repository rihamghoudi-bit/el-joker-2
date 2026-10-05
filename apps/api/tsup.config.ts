import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (it ships TypeScript source); keep npm deps external.
  noExternal: ["@eljoker/shared"],
  external: ["node:sqlite"],
  // node:sqlite exists only with the node: prefix; keep it.
  removeNodeProtocol: false,
});
