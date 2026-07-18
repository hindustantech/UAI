import { createEmailTierWorker } from './emailTierWorker.js';
import { createWhatsAppTierWorker } from './whatsappTierWorker.js';
import { createDeadLetterWorker } from './deadLetterWorker.js';
import { createRetryWorker } from './retryWorker.js';
import { TIER_SCORES, TIER_LABELS, CHANNELS } from '../priority/constants.js';
import { evaluateCircuitBreaker, updateQueueDepth } from '../priority/loadShedder.js';
import { getAllTierQueues } from '../queues/index.js';
import { notificationLogger } from '../index.js';
import { getRedisClient } from '../../../config/redis.js';

async function waitForRedis(retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const redis = getRedisClient();
      await redis.ping();
      return true;
    } catch (error) {
      notificationLogger.warn(`Redis not ready (attempt ${i + 1}/${retries})`, { error: error.message });
      if (i < retries - 1) await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Redis connection failed after retries');
}

const allWorkers = [];

export async function startAllWorkers() {
  notificationLogger.info('Starting all tiered notification workers...');
  await waitForRedis();

  for (const channel of CHANNELS) {
    for (const [scoreStr] of Object.entries(TIER_LABELS)) {
      const tierScore = Number(scoreStr);
      try {
        let worker;
        if (channel === 'email') {
          worker = createEmailTierWorker(tierScore);
        } else {
          worker = createWhatsAppTierWorker(tierScore);
        }
        allWorkers.push(worker);
      } catch (error) {
        notificationLogger.error('Failed to create tier worker', {
          channel, tier: TIER_LABELS[tierScore], error: error.message,
        });
      }
    }
  }

  const deadLetterWorker = createDeadLetterWorker();
  allWorkers.push(deadLetterWorker);

  const retryWorker = createRetryWorker();
  allWorkers.push(retryWorker);

  setInterval(async () => {
    try {
      const tieredQueues = getAllTierQueues();
      await updateQueueDepth(tieredQueues);
      await evaluateCircuitBreaker();
    } catch (error) {
      notificationLogger.error('Circuit breaker evaluation failed', { error: error.message });
    }
  }, 10000);

  notificationLogger.info('All tiered notification workers started', {
    totalWorkers: allWorkers.length,
  });

  return { allWorkers };
}

export async function stopAllWorkers() {
  notificationLogger.info('Stopping all notification workers...');
  await Promise.all(allWorkers.map(w => w.close()));
  notificationLogger.info('All notification workers stopped');
}

export function getWorkers() {
  return { allWorkers };
}
