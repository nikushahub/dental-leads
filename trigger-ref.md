# Trigger.dev API Reference

Full code examples for Trigger.dev SDK v4. All tasks use `@trigger.dev/sdk`.

> Last verified against the official docs on 2026-10-19 (latest SDK/CLI: **v4.7.4**).
> Docs: https://trigger.dev/docs — Changelog: https://trigger.dev/changelog

---

## Basic Task

```ts
import { task } from "@trigger.dev/sdk";

export const processData = task({
  id: "process-data", // must be unique across the project
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30_000,
  },
  maxDuration: 300, // optional: stop the run after 300 seconds (default: no limit)
  run: async (payload: { userId: string; data: any[] }, { ctx }) => {
    console.log(`Processing ${payload.data.length} items for user ${payload.userId}`);
    return { processed: payload.data.length }; // return value must be JSON-serializable
  },
});
```

Other useful task options: `machine: "large-1x"` (more CPU/RAM), `ttl: "10m"` (expire runs
that sit in the queue too long), and `concurrency` (see **Concurrency Limits** below).

---

## Scheduled Task (Cron)

```ts
import { schedules } from "@trigger.dev/sdk";

export const dailyReport = schedules.task({
  id: "daily-report",
  cron: "0 9 * * *", // a plain string is always interpreted as UTC

  run: async (payload) => {
    // payload.timestamp      — when this run was scheduled (Date)
    // payload.lastTimestamp  — when it last ran (Date | undefined) — handy as a "since" cursor
    // payload.timezone       — IANA timezone of the schedule (default "UTC")
    // payload.scheduleId, payload.externalId, payload.upcoming (next 10 Dates)
    console.log("Running daily report");
    return { status: "done" };
  },
});
```

To run in a local timezone, or only in some environments, pass an object:

```ts
export const morningDigest = schedules.task({
  id: "morning-digest",
  cron: {
    pattern: "0 9 * * *",
    timezone: "America/New_York", // IANA name — handles daylight saving automatically
    environments: ["PRODUCTION"], // optional: PRODUCTION | STAGING | PREVIEW | DEVELOPMENT
  },
  run: async (payload) => {
    /* ... */
  },
});
```

Common cron expressions:
- `"*/30 * * * *"` — every 30 minutes
- `"0 * * * *"` — every hour
- `"0 */8 * * *"` — every 8 hours
- `"0 9 * * *"` — 9am daily
- `"0 8 * * 1"` — every Monday at 8am

> **Dev environment:** scheduled tasks only fire while `npx trigger.dev@latest dev` is running.
> Declarative schedules sync when you run `dev` or `deploy`. When testing a scheduled task from
> the dashboard, `scheduleId` will be the placeholder `sched_1234`.

---

## Schema Task (with Zod validation)

```ts
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod"; // Zod 4 is the default since SDK v4.6.0

export const validatedTask = schemaTask({
  id: "validated-task",
  schema: z.object({
    name: z.string(),
    videoId: z.string(),
    publishedAt: z.string(),
  }),
  run: async (payload) => {
    // payload is fully typed and validated before run() is called
    return { message: `Processing ${payload.name}` };
  },
});
```

---

## Triggering Tasks from Backend Code

```ts
import { tasks } from "@trigger.dev/sdk";
import type { processData } from "./trigger/tasks"; // type-only import: task code isn't bundled into your app

// Single trigger — fire and forget
const handle = await tasks.trigger<typeof processData>("process-data", {
  userId: "123",
  data: [{ id: 1 }, { id: 2 }],
});

// Batch trigger — up to 1,000 items per call (SDK 4.3.1+; 500 on older versions)
const batchHandle = await tasks.batchTrigger<typeof processData>("process-data", [
  { payload: { userId: "123", data: [{ id: 1 }] } },
  { payload: { userId: "456", data: [{ id: 2 }] } },
]);
```

**Size limits:** payloads have a hard limit of **10MB** (anything over 512KB is offloaded to
object storage automatically). Task outputs are limited to 100MB. For big files, upload them to
your own storage and pass a URL in the payload instead.

**All trigger options:** `delay`, `ttl`, `idempotencyKey`, `idempotencyKeyTTL`, `debounce`,
`queue`, `concurrencyKey`, `maxAttempts`, `tags`, `metadata`, `maxDuration`, `priority`,
`region`, `machine`.

---

## Triggering from Inside a Task

```ts
import { task, batch } from "@trigger.dev/sdk";

export const parentTask = task({
  id: "parent-task",
  run: async (payload) => {

    // Fire and forget — don't wait for result
    await childTask.trigger({ data: "value" });

    // Trigger and wait — returns a Result object, NOT the raw output
    const result = await childTask.triggerAndWait({ data: "value" });
    if (result.ok) {
      console.log("Output:", result.output); // the return value of childTask.run()
    } else {
      console.error("Failed:", result.error);
    }

    // Unwrap shorthand — throws a SubtaskUnwrapError on failure instead of checking result.ok
    const output = await childTask.triggerAndWait({ data: "value" }).unwrap();

    // Batch trigger and wait — the results are in `.runs`
    const batchResult = await childTask.batchTriggerAndWait([
      { payload: { data: "item1" } },
      { payload: { data: "item2" } },
    ]);
    for (const run of batchResult.runs) {
      if (run.ok) console.log("Success:", run.output);
      else console.error("Failed:", run.error);
    }

    // Batch across DIFFERENT tasks, fully typed
    const { runs } = await batch.triggerByTaskAndWait([
      { task: childTask, payload: { data: "a" } },
      { task: otherTask, payload: { count: 1 } },
    ]);
    if (runs[0].ok) console.log(runs[0].output); // typed as childTask's output
  },
});

export const childTask = task({
  id: "child-task",
  run: async (payload: { data: string }) => {
    return { processed: payload.data };
  },
});

export const otherTask = task({
  id: "other-task",
  run: async (payload: { count: number }) => {
    return { doubled: payload.count * 2 };
  },
});
```

> **Never** wrap `triggerAndWait`, `batchTriggerAndWait`, or `wait.*` in `Promise.all`.
> It isn't supported. Use `batchTriggerAndWait()` to run children in parallel, or a sequential
> `for` loop.
>
> `triggerAndWait` / `batchTriggerAndWait` only work **inside a task**. Called from backend code,
> they throw.

---

## Idempotency Keys (prevent duplicate processing)

A repeat trigger with the same key returns the original run instead of creating a new one.
Keys are kept for **30 days** by default. Override that with `idempotencyKeyTTL` (`"60s"`,
`"10m"`, `"24h"`, `"7d"`).

> ⚠️ **Scope changed in SDK v4.3.1.** Inside a task, a raw string key now defaults to
> **`run` scope**: it's hashed with the *parent run's ID*, so it only dedupes within that one
> parent run. A **new** scheduled run gets a new parent ID, so the same item **will be
> processed again**. To dedupe across runs (e.g., a polling schedule), use **`global` scope**.

```ts
import { idempotencyKeys } from "@trigger.dev/sdk";

// Dedupe ACROSS runs. Use this in scheduled/polling orchestrators.
const key = await idempotencyKeys.create(`video-${videoId}`, { scope: "global" });
await processVideo.trigger({ videoId, title }, { idempotencyKey: key });

// Dedupe only within the current parent run (the default for raw strings inside a task).
// Protects against the parent retrying and re-triggering the same child.
await processVideo.trigger({ videoId, title }, { idempotencyKey: `video-${videoId}` });
```

| Scope | Behavior |
|---|---|
| `run` (default) | Key is combined with the parent run ID. Dedupes within one parent run. |
| `attempt` | Key is combined with the parent run ID **and** attempt number, so children re-run on each retry. |
| `global` | Key is used as-is. The item runs once (until the TTL expires), regardless of parent. |

Outside a task (backend code), there's no parent run, so every scope behaves like `global`.
Build keys from the work itself (an order ID, video ID, etc.). A random value never matches, so
it never dedupes. Idempotency keys take precedence over debounce keys.

---

## Waits

```ts
import { task, wait } from "@trigger.dev/sdk";

export const taskWithWaits = task({
  id: "task-with-waits",
  run: async (payload) => {

    // Wait for a duration
    await wait.for({ seconds: 30 });
    await wait.for({ minutes: 5 });
    await wait.for({ hours: 1 });

    // Wait until a specific date
    await wait.until({ date: new Date("2027-01-01T09:00:00Z") });

    return { status: "completed" };
  },
});
```

> Waits longer than 5 seconds don't count towards compute usage. But a `wait.for`/`wait.until`
> only releases its **concurrency slot** 60 seconds into the wait. Shorter waits hold the slot
> for their whole duration.

### Wait for an external signal (e.g., human approval) — Wait Tokens

A token is created first, its ID or URL is sent somewhere (email, Slack, webhook), and the task
pauses until something completes it.

```ts
import { task, wait } from "@trigger.dev/sdk";

type ApprovalToken = { status: "approved" | "rejected" };

export const approvalFlow = task({
  id: "approval-flow",
  run: async (payload) => {
    // 1. Create the token
    const token = await wait.createToken({
      timeout: "1h", // "30s", "10m", "4w", or a Date. Omit for no timeout
      // idempotencyKey, idempotencyKeyTTL, tags are also supported
    });
    // token.id  → "waitpoint_..."
    // token.url → POST JSON to this URL to complete the token (great for webhooks)

    // 2. Send token.id or token.url to whoever needs to approve (Slack, email, etc.)

    // 3. Pause until completed. Returns a Result, like triggerAndWait
    const result = await wait.forToken<ApprovalToken>(token);
    if (!result.ok) {
      // the only possible error is a timeout
      return { status: "timed-out" };
    }
    return { status: result.output.status };

    // Or: const approval = await wait.forToken<ApprovalToken>(token).unwrap(); // throws on timeout
  },
});

// Complete the token from anywhere: another task, backend code, an API route
await wait.completeToken<ApprovalToken>(tokenId, { status: "approved" });
```

---

## Debounced Triggering

Consolidate multiple rapid triggers into a single execution:

```ts
// Leading mode (default) — executes with the FIRST payload, delays on subsequent triggers
await myTask.trigger(
  { userId: "123" },
  {
    debounce: {
      key: "user-123-update", // scoped to this task
      delay: "5s",            // minimum 1s; supports s / m / h (or hr) / d / w
    },
  }
);

// Trailing mode — executes with the LAST payload after the delay window
await myTask.trigger(
  { data: "latest-value" },
  {
    debounce: {
      key: "trailing-example",
      delay: "10s",
      mode: "trailing",
      maxDelay: "5m", // cap: the run MUST execute within 5m of the first trigger
    },
  }
);
```

> Without `maxDelay`, a steady stream of triggers can postpone the run **forever**. Set
> `maxDelay` when triggers may arrive continuously, and keep `delay` well below it. In trailing
> mode, each new trigger also replaces the run's metadata, tags, maxAttempts, maxDuration, and
> machine.

---

## Retry Configuration

```ts
export const resilientTask = task({
  id: "resilient-task",
  retry: {
    maxAttempts: 10,      // default is 3 (project default can be set in trigger.config.ts)
    factor: 1.8,          // exponential backoff multiplier
    minTimeoutInMs: 500,
    maxTimeoutInMs: 30_000,
    randomize: false,     // jitter
  },
  run: async (payload) => {
    // If this throws, Trigger.dev will retry automatically
    return { done: true };
  },
});
```

---

## Concurrency Limits

Use these to avoid hitting a third-party API's rate limit. The `concurrency` option replaces the
older `queue: { concurrencyLimit }`, which still works but is deprecated.

```ts
import { task, concurrencyLimit } from "@trigger.dev/sdk";

// Only one run of this task at a time
export const oneAtATime = task({
  id: "one-at-a-time",
  concurrency: { total: 1 },
  run: async (payload) => { /* ... */ },
});

// Max 1 run per concurrencyKey (e.g., per user), max 10 overall
export const perUser = task({
  id: "per-user",
  concurrency: { perKey: 1, total: 10 },
  run: async (payload) => { /* ... */ },
});
// trigger with: perUser.trigger(payload, { concurrencyKey: userId })

// A named limit shared by several tasks (e.g., all tasks that call OpenAI)
export const openaiLimit = concurrencyLimit({ name: "openai", total: 25 });

export const summarize = task({
  id: "summarize",
  concurrency: openaiLimit,
  run: async (payload) => { /* ... */ },
});
```

---

## Lifecycle Hooks (optional)

```ts
export const withHooks = task({
  id: "with-hooks",
  onStartAttempt: async ({ payload, ctx }) => {}, // before each attempt (replaces deprecated onStart)
  onSuccess: async ({ payload, output, ctx }) => {},
  onFailure: async ({ payload, error, ctx }) => {}, // only after ALL retries are exhausted
  onComplete: async ({ payload, result, ctx }) => {}, // success or failure
  run: async (payload) => { /* ... */ },
});
```

- `init` / `cleanup` are deprecated. Use `middleware` + `locals` instead.
- Global hooks for every task (e.g., `tasks.onFailure(...)` to send failure alerts) go in
  `src/trigger/init.ts`, which is loaded automatically.

---

## Orchestrator + Processor Pattern

The standard pattern for automations that poll for new items and process each one:

```ts
// check-task.ts — runs on a schedule, lightweight
import { schedules, idempotencyKeys } from "@trigger.dev/sdk";
import { processItem } from "./process-item.js";

export const checkTask = schedules.task({
  id: "check-task",
  cron: "0 */8 * * *", // every 8 hours

  run: async (payload) => {
    const items = await fetchNewItems(); // poll your source
    for (const item of items) {
      // GLOBAL scope: dedupes across scheduled runs, so an item seen in two
      // consecutive polling windows is only processed once.
      const idempotencyKey = await idempotencyKeys.create(`item-${item.id}`, {
        scope: "global",
      });
      await processItem.trigger({ id: item.id, data: item }, { idempotencyKey });
    }
    return { dispatched: items.length };
  },
});

// process-item.ts — handles heavy work per item
import { task } from "@trigger.dev/sdk";

export const processItem = task({
  id: "process-item",
  run: async (payload: { id: string; data: any }) => {
    // Do the heavy lifting: LLM calls, API requests, output posting
    return { processed: payload.id };
  },
});
```

> The global key is remembered for 30 days by default. If the source can resurface an item
> after that, store processed IDs yourself or set a longer `idempotencyKeyTTL`.

---

## NEVER Use (v2 — breaks everything)

```ts
// ❌ This is Trigger.dev v2 syntax — DO NOT USE
client.defineJob({
  id: "job-id",
  run: async (payload, io) => { /* ... */ },
});
```

Always use `task()`, `schedules.task()`, or `schemaTask()` from `@trigger.dev/sdk`.
