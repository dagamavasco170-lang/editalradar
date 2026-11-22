const FCM_ERROR_TYPE = "type.googleapis.com/google.firebase.fcm.v1.FcmError";

function parseRetryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.ceil(Number(trimmed) * 1000));
  }
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

export function classifyFcmFailure(httpStatus, payload = {}) {
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  const fcmDetail = details.find((item) => item?.["@type"] === FCM_ERROR_TYPE);
  const fcmCode = String(fcmDetail?.errorCode || "");
  const statusCode = String(payload?.error?.status || "");
  const code = fcmCode || statusCode || `HTTP_${httpStatus}`;
  const permanentTokenError = code === "UNREGISTERED"
    || (fcmCode === "INVALID_ARGUMENT" && statusCode === "INVALID_ARGUMENT");
  const quotaLimited = httpStatus === 429 || code === "QUOTA_EXCEEDED";
  const retryable = quotaLimited
    || httpStatus === 500
    || httpStatus === 503
    || code === "INTERNAL"
    || code === "UNAVAILABLE";

  return { code, permanentTokenError, retryable, quotaLimited };
}

export function canRetryFcmFailure(failure, retriesMade = 0) {
  if (!failure?.retryable || failure?.permanentTokenError) return false;
  const maxRetries = failure.quotaLimited ? 1 : 2;
  return retriesMade < maxRetries;
}

export function getFcmRetryDelayMs(failure, retryNumber = 1, now = Date.now(), random = Math.random) {
  const safeRetryNumber = Math.max(1, Math.min(8, Math.trunc(retryNumber) || 1));
  const exponentialDelay = 1000 * (2 ** (safeRetryNumber - 1));
  const minimumDelay = failure?.quotaLimited ? 60_000 : 0;
  const retryAfterDelay = parseRetryAfterMs(failure?.retryAfter, now) || 0;
  const baseDelay = Math.max(exponentialDelay, minimumDelay, retryAfterDelay);
  const jitterLimit = failure?.quotaLimited ? 5_000 : 1_000;
  const jitter = Math.floor(Math.max(0, Math.min(0.999999, random())) * jitterLimit);
  return baseDelay + jitter;
}
