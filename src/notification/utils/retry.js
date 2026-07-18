const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 410]);

const TRANSIENT_MESSAGE_PATTERNS = [
  /timeout/i,
  /connection\s*(reset|refused|closed)/i,
  /econnrefused/i,
  /econnreset/i,
  /etimedout/i,
  /socket.*hang/i,
  /network.*error/i,
  /redis.*timeout/i,
  /rate.*limit/i,
  /too many requests/i,
  /service unavailable/i,
  /internal server error/i,
  /temporary failure/i,
  /quota.*exceeded/i,
  /limit.*exceeded/i,
];

const PERMANENT_MESSAGE_PATTERNS = [
  /invalid phone/i,
  /invalid email/i,
  /invalid number/i,
  /phone.*not.*exist/i,
  /email.*not.*exist/i,
  /template.*not found/i,
  /template.*not.*exist/i,
  /unregistered.*phone/i,
  /unregistered.*email/i,
  /invalid.*template/i,
  /not found/i,
  /forbidden/i,
  /unauthorized/i,
  /bad request/i,
];

export function isTransientError(error) {
  if (!error) return false;

  const statusCode = error.statusCode || error.status || error.response?.status;
  if (statusCode && TRANSIENT_HTTP_STATUSES.has(statusCode)) {
    return true;
  }

  if (statusCode && PERMANENT_HTTP_STATUSES.has(statusCode)) {
    return false;
  }

  const message = error.message || String(error);
  for (const pattern of TRANSIENT_MESSAGE_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }

  return false;
}

export function isPermanentError(error) {
  if (!error) return false;

  const statusCode = error.statusCode || error.status || error.response?.status;
  if (statusCode && PERMANENT_HTTP_STATUSES.has(statusCode)) {
    return true;
  }

  if (statusCode && TRANSIENT_HTTP_STATUSES.has(statusCode)) {
    return false;
  }

  const message = error.message || String(error);
  for (const pattern of PERMANENT_MESSAGE_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }

  return false;
}

export function getErrorCategory(error) {
  if (isPermanentError(error)) return 'permanent';
  if (isTransientError(error)) return 'transient';
  return 'unknown';
}

export function calculateBackoff(attempt, baseDelay = 30000) {
  return Math.min(baseDelay * Math.pow(2, attempt), 600000);
}
