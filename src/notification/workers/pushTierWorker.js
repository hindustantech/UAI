import { Worker } from 'bullmq';
import { getRedisClient } from '../../../config/redis.js';
import { pushProvider } from '../providers/pushProvider.js';
import { notificationLogger } from '../index.js';
import { isPermanentError } from '../utils/retry.js';
import { claimIdempotency } from '../utils/idempotency.js';
import { TIER_CONFIG } from '../priority/constants.js';
import { checkRateLimit } from '../priority/rateLimiter.js';
import { isTierPaused, incrementDropped } from '../priority/loadShedder.js';
import Notification from '../models/Notification.js';
import DeadLetter from '../models/DeadLetter.js';
import User from '../../../models/userModel.js';

async function processPushTierJob(job, tierScore) {
  const { idempotencyKey, deviceToken, title, body, data, notificationId, userId } = job.data;
  const tierLabel = TIER_CONFIG[tierScore]?.label || 'normal';
  const tierCfg = TIER_CONFIG[tierScore] || TIER_CONFIG[2];

  const paused = await isTierPaused(tierLabel);
  if (paused) {
    notificationLogger.warn('Push tier paused, moving job back', { tier: tierLabel, jobId: job.id });
    await incrementDropped();
    throw new Error('RateLimit');
  }

  const rateCheck = await checkRateLimit('push', tierScore);
  if (!rateCheck.allowed) {
    notificationLogger.warn('Push rate limit hit for tier', { tier: tierLabel, jobId: job.id });
    throw new Error('RateLimit');
  }

  notificationLogger.info('Push job started', { jobId: job.id, tier: tierLabel });

  if (idempotencyKey) {
    const claimed = await claimIdempotency(idempotencyKey);
    if (!claimed) {
      notificationLogger.info('Duplicate push skipped', { idempotencyKey, jobId: job.id });
      if (notificationId) {
        await Notification.findByIdAndUpdate(notificationId, { status: 'duplicate_skipped' });
      }
      return { skipped: true, reason: 'duplicate' };
    }
  }

  if (notificationId) {
    await Notification.findByIdAndUpdate(notificationId, { status: 'started' });
  }

  let tokens = [];
  if (deviceToken) {
    tokens = Array.isArray(deviceToken) ? deviceToken.filter(Boolean) : [deviceToken];
  } else if (userId) {
    const user = await User.findById(userId).select('devicetoken').lean();
    if (user?.devicetoken?.length) {
      tokens = user.devicetoken.filter(Boolean);
    }
  }

  if (tokens.length === 0) {
    notificationLogger.warn('No device tokens for push notification', { userId, jobId: job.id });
    if (notificationId) {
      await Notification.findByIdAndUpdate(notificationId, {
        status: 'skipped',
        error: { message: 'No device tokens available', code: 'NO_DEVICE_TOKENS' },
      });
    }
    return { skipped: true, reason: 'no_tokens' };
  }

  try {
    let result;
    if (tokens.length === 1) {
      result = await pushProvider.send({
        deviceToken: tokens[0],
        title,
        body,
        data,
      });
    } else {
      result = await pushProvider.sendMulticast({
        tokens,
        title,
        body,
        data,
      });
    }

    if (result.invalidTokens?.length > 0) {
      await User.updateMany(
        { devicetoken: { $in: result.invalidTokens } },
        { $pull: { devicetoken: { $in: result.invalidTokens } } }
      );
      notificationLogger.info('Invalid tokens cleaned up from DB', { count: result.invalidTokens.length });
    }

    if (notificationId) {
      await Notification.findByIdAndUpdate(notificationId, {
        status: 'success',
        sentAt: new Date(),
        $set: { error: null },
      });
    }

    notificationLogger.info('Push sent successfully', {
      jobId: job.id,
      successCount: result.successCount || 1,
      tier: tierLabel,
    });

    return { success: true, messageId: result.messageId };
  } catch (error) {
    const isInvalidToken = [
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument',
    ].includes(error.code) || error.code === 'INVALID_TOKEN';

    if (isInvalidToken) {
      const failedTokens = Array.isArray(deviceToken) ? deviceToken : (deviceToken ? [deviceToken] : []);
      if (failedTokens.length > 0) {
        await User.updateMany(
          { devicetoken: { $in: failedTokens } },
          { $pull: { devicetoken: { $in: failedTokens } } }
        );
      }
      notificationLogger.info('Invalid token(s) removed from DB', { tokenCount: failedTokens.length });
    }

    if (isPermanentError(error) || isInvalidToken) {
      notificationLogger.error('Permanent push failure', {
        jobId: job.id, error: error.message, tier: tierLabel,
      });

      await DeadLetter.create({
        originalQueue: `push_${tierLabel}`,
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

    notificationLogger.warn('Transient push failure, will retry', {
      jobId: job.id, attempt: job.attemptsMade, error: error.message, tier: tierLabel,
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

export function createPushTierWorker(tierScore) {
  const tierCfg = TIER_CONFIG[tierScore];
  if (!tierCfg) {
    throw new Error(`No config for tier score: ${tierScore}`);
  }

  const queueName = `push_${tierCfg.label}`;

  const worker = new Worker(
    queueName,
    (job) => processPushTierJob(job, tierScore),
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
    notificationLogger.debug('Push tier job completed', { jobId: job.id, tier: tierCfg.label });
  });

  worker.on('failed', (job, error) => {
    if (error.message?.includes('RateLimit')) return;
    notificationLogger.error('Push tier job failed after all retries', {
      jobId: job?.id, tier: tierCfg.label, error: error.message,
    });
  });

  worker.on('error', (error) => {
    if (error.message?.includes('RateLimit')) return;
    notificationLogger.error('Push tier worker error', { tier: tierCfg.label, error: error.message });
  });

  notificationLogger.info('Push tier worker created', {
    tier: tierCfg.label,
    queue: queueName,
    concurrency: tierCfg.concurrency,
    rateLimit: `${tierCfg.rateLimitMax}/${tierCfg.rateLimitDuration}ms`,
  });

  return worker;
}
