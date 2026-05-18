import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["extensions/**/*.test.ts"],
    coverage: {
      include: ["extensions/**/*.ts"],
      exclude: ["extensions/**/*.test.ts"],
    },
  },
});
