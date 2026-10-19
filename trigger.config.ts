import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_dmmlhwehzsbancyqjtpr",
  dirs: ["./src/trigger"],
  maxDuration: 300, // seconds — default limit for every task
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 5000,
      maxTimeoutInMs: 30_000,
    },
  },
});
