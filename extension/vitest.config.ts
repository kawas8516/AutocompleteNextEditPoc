import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      core: path.resolve(rootDir, "..", "core"),
    },
  },
  test: {
    include: ["test/**/*.vitest.ts"],
    exclude: ["**/node_modules/**"],
  },
});
