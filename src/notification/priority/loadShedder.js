import { getRedisClient } from '../../../config/redis.js';
import { TIER_SCORES } from './constants.js';
import { notificationLogger } from '../index.js';

const CIRCUIT_KEY = 'notification:circuit:state';
const DEPTH_KEY = 'notification:circuit:critical_high_depth';
const DROPPED_COUNTER = 'notification:circuit:dropped';
const PAUSED_PREFIX = 'notification:paused:';

const CLOSED = 'CLOSED';
const OPEN = 'OPEN';
const HALF_OPEN = 'HALF_OPEN';

const CB_CRITICAL_HIGH_OPEN = parseInt(process.env.CB_CRITICAL_HIGH_DEPTH_OPEN) || 100;
const CB_CRITICAL_HIGH_OPEN_ALL = parseInt(process.env.CB_CRITICAL_HIGH_DEPTH_OPEN_ALL) || 500;
const CB_RECOVERY_DEPTH = parseInt(process.env.CB_RECOVERY_DEPTH) || 50;

let cbSha = null;

const CB_LUA_SCRIPT = `
local depth_key = KEYS[1]
local circuit_key = KEYS[2]
local paused_prefix = KEYS[3]

local cb_open = tonumber(ARGV[1])
local cb_open_all = tonumber(ARGV[2])
local cb_recovery = tonumber(ARGV[3])

local depth = tonumber(redis.call('GET', depth_key)) or 0
local state = redis.call('GET', circuit_key) or 'CLOSED'

if depth > cb_open_all then
    if state ~= 'OPEN' then
        redis.call('SET', circuit_key, 'OPEN', 'EX', 30)
        redis.call('SET', paused_prefix .. 'bulk', '1', 'EX', 60)
        redis.call('SET', paused_prefix .. 'low', '1', 'EX', 60)
        return { 'OPEN', depth, 'paused_bulk_low' }
    end
    return { 'OPEN', depth, 'steady_open' }
end

if depth > cb_open then
    if state == 'CLOSED' then
        redis.call('SET', circuit_key, 'OPEN', 'EX', 30)
        redis.call('SET', paused_prefix .. 'bulk', '1', 'EX', 60)
        return { 'OPEN', depth, 'paused_bulk' }
    end
    return { state, depth, 'steady' }
end

if state == 'OPEN' and depth < cb_recovery then
    redis.call('SET', circuit_key, 'HALF_OPEN', 'EX', 10)
    redis.call('DEL', paused_prefix .. 'bulk')
    redis.call('DEL', paused_prefix .. 'low')
    return { 'HALF_OPEN', depth, 'probing' }
end

if state == 'HALF_OPEN' and depth < cb_recovery / 2 then
    redis.call('SET', circuit_key, 'CLOSED', 'EX', 300)
    return { 'CLOSED', depth, 'recovered' }
end

return { state, depth, 'steady' }
`;

async function loadScript() {
  if (cbSha) return cbSha;
  const redis = getRedisClient();
  cbSha = await redis.script('LOAD', CB_LUA_SCRIPT);
  return cbSha;
}

export async function updateQueueDepth(queues) {
  const redis = getRedisClient();
  let totalDepth = 0;

  for (const { queue, tierScore } of queues) {
    if (tierScore <= TIER_SCORES.HIGH) {
      const waiting = await queue.getWaitingCount();
      totalDepth += waiting;
    }
  }

  await redis.set(DEPTH_KEY, String(totalDepth), 'EX', 10);
  return totalDepth;
}

export async function isTierPaused(tierLabel) {
  const redis = getRedisClient();
  const paused = await redis.get(`${PAUSED_PREFIX}${tierLabel}`);
  return paused === '1';
}

export async function incrementDropped() {
  const redis = getRedisClient();
  const count = await redis.incr(DROPPED_COUNTER);
  await redis.expire(DROPPED_COUNTER, 604800);
  return count;
}

export async function getDroppedCount() {
  const redis = getRedisClient();
  const val = await redis.get(DROPPED_COUNTER);
  return val ? Number(val) : 0;
}

export async function evaluateCircuitBreaker() {
  try {
    const sha = await loadScript();
    const redis = getRedisClient();
    const result = await redis.evalsha(
      sha, 3,
      DEPTH_KEY, CIRCUIT_KEY, PAUSED_PREFIX,
      String(CB_CRITICAL_HIGH_OPEN), String(CB_CRITICAL_HIGH_OPEN_ALL), String(CB_RECOVERY_DEPTH),
    );

    const [state, depth, action] = result;

    if (action === 'paused_bulk_low') {
      notificationLogger.warn('Circuit OPEN: pausing bulk + low (depth > 500)', { depth: Number(depth) });
    } else if (action === 'paused_bulk') {
      notificationLogger.warn('Circuit OPEN: pausing bulk (depth > 100)', { depth: Number(depth) });
    } else if (action === 'probing') {
      notificationLogger.info('Circuit HALF_OPEN: probing recovery', { depth: Number(depth) });
    } else if (action === 'recovered') {
      notificationLogger.info('Circuit CLOSED: fully recovered', { depth: Number(depth) });
    }

    return { state, depth: Number(depth) };
  } catch (error) {
    if (error.message?.includes('NOSCRIPT')) {
      cbSha = null;
      return evaluateCircuitBreaker();
    }
    notificationLogger.error('Circuit breaker evaluation failed', { error: error.message });
    return { state: CLOSED, depth: 0 };
  }
}

export async function getCircuitBreakerStatus() {
  const redis = getRedisClient();
  const [state, depth, dropped] = await Promise.all([
    redis.get(CIRCUIT_KEY).then(v => v || CLOSED),
    redis.get(DEPTH_KEY).then(v => Number(v) || 0),
    getDroppedCount(),
  ]);
  return { state, depth, dropped };
}
