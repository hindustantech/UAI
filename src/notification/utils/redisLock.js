import { getRedisClient } from '../../../config/redis.js';
import config from '../config/index.js';
import { notificationLogger } from '../index.js';

const LOCK_PREFIX = 'notification:lock:';

function generateLockValue() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function acquireLock(key, ttl = config.lock.ttl) {
  const lockKey = `${LOCK_PREFIX}${key}`;
  const lockValue = generateLockValue();
  const redis = getRedisClient();

  try {
    const acquired = await redis.set(lockKey, lockValue, 'PX', ttl, 'NX');
    if (acquired === 'OK') {
      notificationLogger.debug('Lock acquired', { key, lockValue, ttl });
      return lockValue;
    }
    notificationLogger.debug('Lock not acquired (already held)', { key });
    return null;
  } catch (error) {
    notificationLogger.error('Lock acquisition error', { key, error: error.message });
    return null;
  }
}

export async function releaseLock(key, lockValue) {
  const lockKey = `${LOCK_PREFIX}${key}`;
  const redis = getRedisClient();

  try {
    const currentValue = await redis.get(lockKey);
    if (currentValue === lockValue) {
      await redis.del(lockKey);
      notificationLogger.debug('Lock released', { key });
      return true;
    }
    notificationLogger.debug('Lock not released (value mismatch or expired)', { key });
    return false;
  } catch (error) {
    notificationLogger.error('Lock release error', { key, error: error.message });
    return false;
  }
}

export async function withLock(key, fn, ttl = config.lock.ttl) {
  const lockValue = await acquireLock(key, ttl);
  if (!lockValue) {
    return null;
  }

  try {
    const result = await fn();
    return result;
  } finally {
    await releaseLock(key, lockValue);
  }
}

export async function acquireLockWithRetry(key, ttl = config.lock.ttl, maxRetries = config.lock.retryCount, retryDelay = config.lock.retryDelay) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const lockValue = await acquireLock(key, ttl);
    if (lockValue) {
      return lockValue;
    }
    if (attempt < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  return null;
}
