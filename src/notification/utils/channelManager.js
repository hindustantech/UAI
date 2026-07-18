import { getRedisClient } from '../../../config/redis.js';
import { notificationLogger } from '../index.js';

const CHANNEL_PREFIX = 'notification:channel:';
const memoryCache = {};

export function initializeChannelCache() {
  for (const ch of ['email', 'whatsapp', 'push']) {
    const envKey = `DISABLE_${ch.toUpperCase()}`;
    memoryCache[ch] = process.env[envKey] !== 'true';
  }
  notificationLogger.info('Channel cache initialized', memoryCache);
}

export async function syncChannelFromRedis(channel) {
  try {
    const redis = getRedisClient();
    if (redis) {
      const val = await redis.get(`${CHANNEL_PREFIX}${channel}`);
      if (val !== null) {
        memoryCache[channel] = val === '1';
      }
    }
  } catch (err) {
    notificationLogger.debug('Redis not available for channel sync', { channel, error: err.message });
  }
}

export function isChannelEnabled(channel) {
  if (memoryCache[channel] === undefined) {
    const envKey = `DISABLE_${channel.toUpperCase()}`;
    memoryCache[channel] = process.env[envKey] !== 'true';
  }
  return memoryCache[channel];
}

export async function setChannelEnabled(channel, enabled) {
  memoryCache[channel] = !!enabled;
  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.set(`${CHANNEL_PREFIX}${channel}`, enabled ? '1' : '0');
      notificationLogger.info('Channel state saved to Redis', { channel, enabled });
    }
  } catch (err) {
    notificationLogger.warn('Failed to save channel state to Redis, memory only', { channel, enabled, error: err.message });
  }
}

export async function getChannelStatus() {
  const channels = ['email', 'whatsapp', 'push'];
  const status = {};
  for (const ch of channels) {
    status[ch] = isChannelEnabled(ch);
  }
  return status;
}
