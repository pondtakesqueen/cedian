import { configDefaults, defineConfig } from "vitest/config";

// Worktrees under .claude/ (an agent's own checkouts) carry copies of the tests.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
});
