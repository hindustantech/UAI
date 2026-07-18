import { getRedisClient } from '../../../config/redis.js';
import { TIER_CONFIG } from './constants.js';
import { notificationLogger } from '../index.js';

const RATE_LIMITER_PREFIX = 'notification:ratelimit:';

const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local cost = tonumber(ARGV[4]) or 1

local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')

local tokens = tonumber(bucket[1]) or capacity
local lastRefill = tonumber(bucket[2]) or now

local elapsed = math.max(0, now - lastRefill)
tokens = math.min(capacity, tokens + elapsed * refillRate)

if tokens >= cost then
    redis.call('HMSET', key, 'tokens', tokens - cost, 'lastRefill', now)
    redis.call('EXPIRE', key, 3600)
    return {1, tokens - cost, capacity}
else
    redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
    return {0, tokens, capacity}
end
`;

let rateLimiterSha = null;

async function loadScript() {
  if (rateLimiterSha) return rateLimiterSha;
  const redis = getRedisClient();
  rateLimiterSha = await redis.script('LOAD', TOKEN_BUCKET_SCRIPT);
  return rateLimiterSha;
}

export async function checkRateLimit(channel, tierScore, cost = 1) {
  const key = `${RATE_LIMITER_PREFIX}${channel}:${tierScore}`;
  const now = Math.floor(Date.now() / 1000);

  const cfg = TIER_CONFIG[tierScore];
  const refillRate = cfg ? cfg.rateLimitMax / (cfg.rateLimitDuration / 1000) : 1;
  const capacity = cfg ? cfg.rateLimitMax : 10;

  try {
    const sha = await loadScript();
    const redis = getRedisClient();
    const result = await redis.evalsha(sha, 1, key, String(now), String(refillRate), String(capacity), String(cost));

    const [allowed, tokens, maxTokens] = result.map(Number);

    if (allowed === 0) {
      notificationLogger.warn('Rate limited', { channel, tierScore, tokens, maxTokens });
    }

    return {
      allowed: allowed === 1,
      remaining: tokens,
      capacity: maxTokens,
    };
  } catch (error) {
    if (error.message?.includes('NOSCRIPT')) {
      rateLimiterSha = null;
      return checkRateLimit(channel, tierScore, cost);
    }
    notificationLogger.error('Rate limiter error', { channel, tierScore, error: error.message });
    return { allowed: true, remaining: 0, capacity: 0 };
  }
}

export async function getRateLimitStatus(channel, tierScore) {
  const key = `${RATE_LIMITER_PREFIX}${channel}:${tierScore}`;
  try {
    const redis = getRedisClient();
    const bucket = await redis.hmget(key, 'tokens', 'lastRefill');
    return {
      tokens: bucket[0] ? Number(bucket[0]) : null,
      lastRefill: bucket[1] ? Number(bucket[1]) : null,
    };
  } catch {
    return { tokens: null, lastRefill: null };
  }
}
