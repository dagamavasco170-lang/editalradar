export const MAX_SCHEDULED_TOPICS_PER_BATCH = 4;
export const MIN_GEMINI_REQUEST_INTERVAL_MS = 5_000;

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function selectScheduledTopics(topics, remainingDailyRuns) {
  if (!Array.isArray(topics)) return [];
  const remaining = Math.max(0, Math.floor(Number(remainingDailyRuns) || 0));
  return topics.slice(0, Math.min(remaining, MAX_SCHEDULED_TOPICS_PER_BATCH));
}


export function createGeminiRequestRateLimiter({
  intervalMs = MIN_GEMINI_REQUEST_INTERVAL_MS,
  now = () => Date.now(),
  sleep = defaultSleep
} = {}) {
  let lastRequestStartedAt = null;
  return async function waitForRequestSlot() {
    if (lastRequestStartedAt !== null) {
      const delay = Math.max(0, lastRequestStartedAt + intervalMs - now());
      if (delay > 0) await sleep(delay);
    }
    lastRequestStartedAt = now();
  };
}
