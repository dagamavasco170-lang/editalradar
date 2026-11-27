import test from "node:test";
import assert from "node:assert/strict";
import {
  createGeminiRequestRateLimiter,
  MAX_SCHEDULED_TOPICS_PER_BATCH,
  selectScheduledTopics
} from "../supabase/functions/question-factory/gemini-rate-limit.mjs";

test("batch scheduled keeps the daily budget but caps each invocation at four topics", () => {
  const topics = Array.from({ length: 8 }, (_, index) => index);
  assert.equal(MAX_SCHEDULED_TOPICS_PER_BATCH, 4);
  assert.deepEqual(selectScheduledTopics(topics, 8), [0, 1, 2, 3]);
  assert.deepEqual(selectScheduledTopics(topics, 3), [0, 1, 2]);
  assert.deepEqual(selectScheduledTopics(topics, 0), []);
  assert.deepEqual(selectScheduledTopics(topics, -2), []);
  assert.deepEqual(selectScheduledTopics(null, 4), []);
});

test("Gemini request limiter enforces minimum spacing without waiting on first request", async () => {
  let now = 0;
  const waits = [];
  const waitForRequestSlot = createGeminiRequestRateLimiter({
    intervalMs: 5000,
    now: () => now,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    }
  });
  await waitForRequestSlot();
  now += 1000;
  await waitForRequestSlot();
  assert.deepEqual(waits, [4000]);
  now += 6000;
  await waitForRequestSlot();
  assert.deepEqual(waits, [4000]);
});
