import { Worker } from 'bullmq';
import { getRedisClient } from '../../../config/redis.js';
import { getTierQueue } from '../queues/index.js';
import { TIER_SCORES } from '../priority/constants.js';
import { notificationLogger } from '../logs/index.js';
import DeadLetter from '../models/DeadLetter.js';
import { calculateBackoff } from '../utils/retry.js';
import config from '../config/index.js';

async function processRetry(job) {
  const { deadLetterId } = job.data;

  const deadLetter = await DeadLetter.findById(deadLetterId);
  if (!deadLetter) {
    notificationLogger.warn('Dead letter record not found for retry', { deadLetterId });
    return { notFound: true };
  }

  if (deadLetter.status !== 'pending') {
    notificationLogger.warn('Dead letter already being processed', {
      deadLetterId, status: deadLetter.status,
    });
    return { skipped: true, status: deadLetter.status };
  }

  await DeadLetter.findByIdAndUpdate(deadLetterId, { status: 'retrying' });

  const channel = deadLetter.originalQueue?.startsWith('whatsapp') ? 'whatsapp' : 'email';
  const tierScore = deadLetter.payload?.tierScore ?? TIER_SCORES.NORMAL;
  const targetQueue = getTierQueue(channel, tierScore);
  if (!targetQueue) {
    throw new Error(`No queue found for ${channel} tier ${tierScore}`);
  }
  const backoffDelay = calculateBackoff(deadLetter.retryCount || 0);

  await targetQueue.add(deadLetter.jobName || 'retry', deadLetter.payload, {
    delay: backoffDelay,
    attempts: config.deadLetter.maxRetry,
    backoff: { type: 'exponential', delay: 30000 },
  });

  notificationLogger.info('Job re-enqueued from retry', {
    deadLetterId,
    targetQueue: deadLetter.originalQueue,
    delay: backoffDelay,
  });

  return { reenqueued: true, targetQueue: deadLetter.originalQueue };
}

export function createRetryWorker() {
  const worker = new Worker(QUEUE_NAMES.RETRY, processRetry, {
    connection: getRedisClient(),
    concurrency: 1,
  });

  worker.on('completed', (job) => {
    notificationLogger.info('Retry job completed', { jobId: job.id });
  });

  worker.on('failed', (job, error) => {
    notificationLogger.error('Retry worker failed', { jobId: job?.id, error: error.message });
  });

  return worker;
}

export { processRetry };
