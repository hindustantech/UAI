import { getCircuitBreakerStatus } from './loadShedder.js';
import { getRateLimitStatus } from './rateLimiter.js';
import { TIER_SCORES, TIER_LABELS, CHANNELS } from './constants.js';
import { getAllQueueStats } from '../queues/index.js';

export async function getPriorityMetrics() {
  const queueStats = await getAllQueueStats();
  const cbStatus = await getCircuitBreakerStatus();

  const perTier = {};
  for (const channel of CHANNELS) {
    perTier[channel] = {};
    for (const [score, label] of Object.entries(TIER_LABELS)) {
      const tierScore = Number(score);
      const queueName = `${channel}:${label}`;
      const rateLimit = await getRateLimitStatus(channel, tierScore);

      perTier[channel][label] = {
        queue: queueStats[queueName] || { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
        rateLimit,
      };
    }
  }

  return {
    circuitBreaker: cbStatus,
    perTier,
  };
}
