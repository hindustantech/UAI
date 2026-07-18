import { getRedisClient } from '../../../config/redis.js';
import config from '../config/index.js';
import { notificationLogger } from '../logs/index.js';

const IDEMPOTENCY_STATUS = 'completed';

const IDEMPOTENCY_PREFIX = 'notification:idempotency:';

export function makeIdempotencyKey(type, ...parts) {
  const cleaned = parts.filter(Boolean).map(p => String(p).replace(/[: ]/g, '_'));
  return `${IDEMPOTENCY_PREFIX}${type}:${cleaned.join(':')}`;
}

export function makeIdempotencyKeyForSubscription(companyId, planId, label) {
  return makeIdempotencyKey('subscription', companyId, planId, label);
}

export function makeIdempotencyKeyForAttendance(employeeId, date) {
  return makeIdempotencyKey('attendance', employeeId, date);
}

export function makeIdempotencyKeyForReport(companyId, date) {
  return makeIdempotencyKey('report', companyId, date);
}

export function makeIdempotencyKeyForOtp(userId, requestId) {
  return makeIdempotencyKey('otp', userId, requestId);
}

export async function claimIdempotency(idempotencyKey) {
  const redis = getRedisClient();
  try {
    const result = await redis.set(idempotencyKey, IDEMPOTENCY_STATUS, 'PX', config.idempotency.ttl, 'NX');
    if (result === 'OK') {
      notificationLogger.debug('Idempotency claimed', { idempotencyKey, ttl: config.idempotency.ttl });
      return true;
    }
    notificationLogger.debug('Idempotency already claimed', { idempotencyKey });
    return false;
  } catch (error) {
    notificationLogger.error('Idempotency claim error', { idempotencyKey, error: error.message });
    return false;
  }
}

export async function checkIdempotency(idempotencyKey) {
  const redis = getRedisClient();
  try {
    const status = await redis.get(idempotencyKey);
    if (status === IDEMPOTENCY_STATUS) {
      notificationLogger.debug('Idempotency check: already processed', { idempotencyKey });
      return true;
    }
    return false;
  } catch (error) {
    notificationLogger.error('Idempotency check error', { idempotencyKey, error: error.message });
    return false;
  }
}

export async function markIdempotent(idempotencyKey) {
  const redis = getRedisClient();
  try {
    await redis.set(idempotencyKey, IDEMPOTENCY_STATUS, 'PX', config.idempotency.ttl);
    notificationLogger.debug('Idempotency marked', { idempotencyKey, ttl: config.idempotency.ttl });
    return true;
  } catch (error) {
    notificationLogger.error('Idempotency mark error', { idempotencyKey, error: error.message });
    return false;
  }
}

export async function removeIdempotencyKey(idempotencyKey) {
  const redis = getRedisClient();
  try {
    await redis.del(idempotencyKey);
    return true;
  } catch {
    return false;
  }
}
