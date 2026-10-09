import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // demo.spec.ts 是 Playwright 录屏脚本，不进单测
    exclude: ["node_modules/**", "dist/**", "tests/demo.spec.ts"],
  },
});
