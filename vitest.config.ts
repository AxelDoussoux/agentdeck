import { defineConfig } from "vitest/config";

// A fixed time zone with daylight saving time, so date tests read the same
// on every machine. Workers start after this and inherit it.
process.env.TZ = "Europe/Paris";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
