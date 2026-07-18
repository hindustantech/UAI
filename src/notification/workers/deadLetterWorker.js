import { Worker } from 'bullmq';
import { getRedisClient } from '../../../config/redis.js';
import { QUEUE_NAMES } from '../constants/index.js';
import { notificationLogger } from '../logs/index.js';
import DeadLetter from '../models/DeadLetter.js';

async function processDeadLetter(job) {
  const { originalQueue, jobName, payload, error, retryCount } = job.data;

  notificationLogger.error('Processing dead letter entry', {
    originalQueue, jobName, error: error?.message,
  });

  const deadLetterRecord = await DeadLetter.findOneAndUpdate(
    { jobId: job.id },
    {
      $set: {
        originalQueue,
        jobName,
        payload,
        error,
        retryCount: retryCount || 0,
        timestamp: new Date(),
      },
      $setOnInsert: { status: 'pending' },
    },
    { upsert: true, new: true },
  );

  return { deadLetterId: deadLetterRecord._id };
}

export function createDeadLetterWorker() {
  const worker = new Worker(QUEUE_NAMES.DEAD_LETTER, processDeadLetter, {
    connection: getRedisClient(),
    concurrency: 1,
  });

  worker.on('completed', (job) => {
    notificationLogger.info('Dead letter processed', { jobId: job.id });
  });

  worker.on('failed', (job, error) => {
    notificationLogger.error('Dead letter worker failed', {
      jobId: job?.id, error: error.message,
    });
  });

  return worker;
}

export { processDeadLetter };
