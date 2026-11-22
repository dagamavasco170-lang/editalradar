const FCM_ERROR_TYPE = "type.googleapis.com/google.firebase.fcm.v1.FcmError";

export const DEFAULT_PUSH_TTL_SECONDS = 3600;

function parseRetryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.max(0, Math.ceil(Number(trimmed) * 1000));
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

function parseTimestamp(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

// New queue entries carry an absolute expiry. Legacy entries use their original
// PGMQ enqueue time so upgrading the worker never grants an old message a fresh TTL.
export function resolvePushExpiryMs(expiresAt, enqueuedAt, ttlSeconds = DEFAULT_PUSH_TTL_SECONDS) {
  if (expiresAt !== undefined) return parseTimestamp(expiresAt);
  const queuedAt = parseTimestamp(enqueuedAt);
  if (queuedAt === null) return null;
  return queuedAt + Math.max(1, Number(ttlSeconds) || DEFAULT_PUSH_TTL_SECONDS) * 1000;
}

export function remainingPushTtlSeconds(expiresAt, now = Date.now()) {
  const expiry = parseTimestamp(expiresAt);
  if (expiry === null) return 0;
  return Math.max(0, Math.ceil((expiry - now) / 1000));
}

export function canScheduleBeforePushExpiry(expiresAt, delaySeconds, now = Date.now()) {
  const remainingSeconds = remainingPushTtlSeconds(expiresAt, now);
  const delay = Math.max(0, Math.ceil(Number(delaySeconds) || 0));
  return remainingSeconds > delay;
}

export function classifyWorkerFcmFailure(httpStatus, payload = {}, retryAfter = null) {
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  const fcmDetail = details.find((item) => item?.["@type"] === FCM_ERROR_TYPE);
  const fcmCode = String(fcmDetail?.errorCode || "");
  const statusCode = String(payload?.error?.status || "");
  const code = fcmCode || statusCode || `HTTP_${httpStatus}`;
  return {
    code,
    permanentTokenError: code === "UNREGISTERED"
      || (fcmCode === "INVALID_ARGUMENT" && statusCode === "INVALID_ARGUMENT"),
    quotaLimited: httpStatus === 429 || code === "QUOTA_EXCEEDED",
    retryable: httpStatus === 429 || code === "QUOTA_EXCEEDED"
      || httpStatus === 500 || httpStatus === 503
      || code === "INTERNAL" || code === "UNAVAILABLE",
    retryAfter,
  };
}

// The message stores the number of failed sends before it entered the queue.
// Each subsequent PGMQ read is another delivery attempt, including recoveries
// after a worker crash or a visibility timeout.
export function currentPushDeliveryAttempt(messageAttempt, readCount) {
  const previousFailures = Math.max(1, Number(messageAttempt) || 1);
  const deliveryNumber = Math.max(1, Number(readCount) || 1);
  return previousFailures + deliveryNumber;
}

export function hasPushRetryBudget(currentAttempt, maxAttempts = 7) {
  return Number(currentAttempt) < maxAttempts;
}

export function getWorkerRetryDelaySeconds(failure, retryNumber, now = Date.now(), random = Math.random) {
  const safeRetryNumber = Math.max(1, Math.min(8, Math.trunc(retryNumber) || 1));
  const exponentialDelay = 1000 * (2 ** (safeRetryNumber - 1));
  const minimumDelay = failure?.quotaLimited ? 60_000 : 0;
  const retryAfterDelay = parseRetryAfterMs(failure?.retryAfter, now) || 0;
  const jitterLimit = failure?.quotaLimited ? 5_000 : 1_000;
  const jitter = Math.floor(Math.max(0, Math.min(0.999999, random())) * jitterLimit);
  return Math.ceil((Math.max(exponentialDelay, minimumDelay, retryAfterDelay) + jitter) / 1000);
}
