import { Worker } from 'bullmq';
import { getRedisClient } from '../../../config/redis.js';
import { whatsappProvider } from '../providers/whatsappProvider.js';
import { notificationLogger } from '../logs/index.js';
import { isPermanentError } from '../utils/retry.js';
import { claimIdempotency } from '../utils/idempotency.js';
import { TIER_CONFIG } from '../priority/constants.js';
import { checkRateLimit } from '../priority/rateLimiter.js';
import { isTierPaused, incrementDropped } from '../priority/loadShedder.js';
import Notification from '../models/Notification.js';
import DeadLetter from '../models/DeadLetter.js';

async function processWhatsAppTierJob(job, tierScore) {
  const { idempotencyKey, to, message, templateName, params, notificationId } = job.data;
  const tierLabel = TIER_CONFIG[tierScore]?.label || 'normal';
  const tierCfg = TIER_CONFIG[tierScore] || TIER_CONFIG[2];

  const paused = await isTierPaused(tierLabel);
  if (paused) {
    notificationLogger.warn('WhatsApp tier paused, moving job back', { tier: tierLabel, jobId: job.id });
    await incrementDropped();
    throw new Error('RateLimit');
  }

  const rateCheck = await checkRateLimit('whatsapp', tierScore);
  if (!rateCheck.allowed) {
    notificationLogger.warn('WhatsApp rate limit hit for tier', { tier: tierLabel, jobId: job.id });
    throw new Error('RateLimit');
  }

  notificationLogger.info('WhatsApp job started', { jobId: job.id, to, tier: tierLabel });

  if (idempotencyKey) {
    const claimed = await claimIdempotency(idempotencyKey);
    if (!claimed) {
      notificationLogger.info('Duplicate WhatsApp skipped', { idempotencyKey, jobId: job.id });
      if (notificationId) {
        await Notification.findByIdAndUpdate(notificationId, { status: 'duplicate_skipped' });
      }
      return { skipped: true, reason: 'duplicate' };
    }
  }

  if (notificationId) {
    await Notification.findByIdAndUpdate(notificationId, { status: 'started' });
  }

  try {
    const result = await whatsappProvider.send({ to, message, templateName, params });

    if (notificationId) {
      await Notification.findByIdAndUpdate(notificationId, {
        status: 'success',
        sentAt: new Date(),
        $set: { error: null },
      });
    }

    notificationLogger.info('WhatsApp sent successfully', { jobId: job.id, to, tier: tierLabel });
    return { success: true, messageId: result.messageId };
  } catch (error) {
    if (isPermanentError(error)) {
      notificationLogger.error('Permanent WhatsApp failure, moving to dead letter', {
        jobId: job.id, to, error: error.message, tier: tierLabel,
      });

      await DeadLetter.create({
        originalQueue: `whatsapp_${tierLabel}`,
        jobName: job.name,
        jobId: job.id,
        payload: job.data,
        error: { message: error.message, stack: error.stack, code: error.code },
        retryCount: job.attemptsMade,
        status: 'pending',
      });

      if (notificationId) {
        await Notification.findByIdAndUpdate(notificationId, {
          status: 'dead_letter',
          error: { message: error.message, stack: error.stack },
        });
      }

      return { deadLetter: true };
    }

    notificationLogger.warn('Transient WhatsApp failure, will retry', {
      jobId: job.id, to, attempt: job.attemptsMade, error: error.message, tier: tierLabel,
    });

    if (notificationId) {
      await Notification.findByIdAndUpdate(notificationId, {
        status: 'retry',
        $inc: { retryCount: 1 },
        error: { message: error.message },
      });
    }

    throw error;
  }
}

export function createWhatsAppTierWorker(tierScore) {
  const tierCfg = TIER_CONFIG[tierScore];
  if (!tierCfg) {
    throw new Error(`No config for tier score: ${tierScore}`);
  }

  const queueName = `whatsapp_${tierCfg.label}`;

  const worker = new Worker(
    queueName,
    (job) => processWhatsAppTierJob(job, tierScore),
    {
      connection: getRedisClient(),
      concurrency: tierCfg.concurrency,
      limiter: {
        max: tierCfg.rateLimitMax,
        duration: tierCfg.rateLimitDuration,
      },
    },
  );

  worker.on('completed', (job) => {
    notificationLogger.debug('WhatsApp tier job completed', { jobId: job.id, tier: tierCfg.label });
  });

  worker.on('failed', (job, error) => {
    if (error.message?.includes('RateLimit')) return;
    notificationLogger.error('WhatsApp tier job failed after all retries', {
      jobId: job?.id, tier: tierCfg.label, error: error.message,
    });
  });

  worker.on('error', (error) => {
    if (error.message?.includes('RateLimit')) return;
    notificationLogger.error('WhatsApp tier worker error', { tier: tierCfg.label, error: error.message });
  });

  notificationLogger.info('WhatsApp tier worker created', {
    tier: tierCfg.label,
    queue: queueName,
    concurrency: tierCfg.concurrency,
    rateLimit: `${tierCfg.rateLimitMax}/${tierCfg.rateLimitDuration}ms`,
  });

  return worker;
}
