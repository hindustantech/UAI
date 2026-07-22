import { Queue } from 'bullmq';
import { getRedisClient } from '../../../config/redis.js';
import { TIER_SCORES, TIER_LABELS, CHANNELS, makeTierQueueName, parseTierQueueName } from '../priority/constants.js';
import config from '../config/index.js';
import { QUEUE_NAMES } from '../constants/index.js';

function getConnection() {
  const client = getRedisClient();
  return { connection: client };
}

const defaultJobOptions = {
  removeOnComplete: { count: config.notification.jobRemoveComplete },
  removeOnFail: { count: config.notification.jobRemoveFail },
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 30000,
  },
};

const tierQueues = {};

for (const channel of CHANNELS) {
  for (const [scoreStr, label] of Object.entries(TIER_LABELS)) {
    const tierScore = Number(scoreStr);
    const queueName = makeTierQueueName(channel, tierScore);

    tierQueues[queueName] = new Queue(queueName, {
      ...getConnection(),
      defaultJobOptions: {
        ...defaultJobOptions,
        priority: tierScore,
        attempts: channel === 'email' ? config.email.maxRetry : config.whatsapp.maxRetry,
      },
    });
  }
}

export const queues = tierQueues;

export function getTierQueue(channel, tierScore) {
  const name = makeTierQueueName(channel, tierScore);
  return tierQueues[name] || null;
}

export function getAllTierQueues() {
  return Object.entries(tierQueues).map(([name, queue]) => {
    const parsed = parseTierQueueName(name);
    return {
      name,
      queue,
      tierScore: parsed?.tierScore ?? 2,
    };
  });
}

export const emailQueue = getTierQueue('email', TIER_SCORES.NORMAL);
export const whatsappQueue = getTierQueue('whatsapp', TIER_SCORES.NORMAL);

export const notificationQueue = new Queue(QUEUE_NAMES.NOTIFICATION, {
  ...getConnection(),
  defaultJobOptions,
});

export const reportQueue = new Queue(QUEUE_NAMES.REPORT, {
  ...getConnection(),
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 3,
  },
});

export const schedulerQueue = new Queue(QUEUE_NAMES.SCHEDULER, {
  ...getConnection(),
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 3,
  },
});

export const retryQueue = new Queue(QUEUE_NAMES.RETRY, {
  ...getConnection(),
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 1,
  },
});

export const deadLetterQueue = new Queue(QUEUE_NAMES.DEAD_LETTER, {
  ...getConnection(),
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 1,
  },
});

export async function getAllQueueStats() {
  const allQueues = getAllTierQueues();
  const systemQueues = [
    { name: QUEUE_NAMES.NOTIFICATION, queue: notificationQueue },
    { name: QUEUE_NAMES.REPORT, queue: reportQueue },
    { name: QUEUE_NAMES.SCHEDULER, queue: schedulerQueue },
    { name: QUEUE_NAMES.RETRY, queue: retryQueue },
    { name: QUEUE_NAMES.DEAD_LETTER, queue: deadLetterQueue },
  ];

  const stats = {};

  for (const { name, queue } of [...allQueues, ...systemQueues]) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    stats[name] = { waiting, active, completed, failed, delayed };
  }

  return stats;
}

export async function closeAllQueues() {
  const allQueues = [
    ...Object.values(tierQueues),
    notificationQueue,
    reportQueue,
    schedulerQueue,
    retryQueue,
    deadLetterQueue,
  ];
  await Promise.all(allQueues.map(q => q.close()));
}

export default {
  tierQueues,
  getTierQueue,
  getAllTierQueues,
  emailQueue,
  whatsappQueue,
  notificationQueue,
  reportQueue,
  schedulerQueue,
  retryQueue,
  deadLetterQueue,
  getAllQueueStats,
  closeAllQueues,
};
