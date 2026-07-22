import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Subscription } from '../../../models/Attandance/subscration/Subscription.js';
import User from '../../../models/userModel.js';
import { NotificationService } from '../services/NotificationService.js';
import { acquireLock, releaseLock } from '../utils/redisLock.js';
import { connectRedis, getRedisClient } from '../../../config/redis.js';
import { notificationLogger } from '../index.js';
import Notification from '../models/Notification.js';

dotenv.config();

const LOOKBACK_DAYS = parseInt(process.env.CATCHUP_LOOKBACK_DAYS, 10) || 30;
const BATCH_SIZE = 50;

async function hasBeenSent(subscriptionId) {
  if (!subscriptionId) return false;
  const existing = await Notification.findOne({
    type: 'subscription_expired',
    'metadata.subscriptionId': String(subscriptionId),
    status: { $in: ['success', 'started', 'queued'] },
  }).lean();
  return !!existing;
}

async function processBatch(subs) {
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const sub of subs) {
    const companyId = sub.company?._id || sub.company;
    if (!companyId) {
      skipped++;
      continue;
    }

    const alreadySent = await hasBeenSent(sub._id);
    if (alreadySent) {
      skipped++;
      continue;
    }

    try {
      await NotificationService.sendSubscriptionExpired({
        companyId,
        companyName: sub.company?.name || 'Customer',
        planName: sub.planSnapshot?.name || 'Premium',
        endDate: sub.endDate?.toISOString(),
        email: sub.company?.email,
        phone: sub.company?.phone,
        subscriptionId: sub._id,
      });

      sent++;
    } catch (err) {
      failed++;
      notificationLogger.error('Catchup: send failed', {
        subId: sub._id, companyId, error: err.message,
      });
    }
  }

  return { sent, skipped, failed };
}

async function runCatchup() {
  const lockKey = 'notification-catchup-expired';
  const lockValue = await acquireLock(lockKey, 600000);

  if (!lockValue) {
    console.log('[CATCHUP] Skipped — another instance holds the lock');
    return;
  }

  try {
    const cutoffDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    console.log(`[CATCHUP] Starting — looking back ${LOOKBACK_DAYS} days (since ${cutoffDate.toISOString()})`);

    let totalSent = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let skip = 0;

    while (true) {
      const subs = await Subscription.find({
        status: 'EXPIRED',
        isActive: false,
        endDate: { $gte: cutoffDate },
      })
        .populate('company', 'email phone name')
        .sort({ endDate: -1 })
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean();

      if (subs.length === 0) break;

      const result = await processBatch(subs);
      totalSent += result.sent;
      totalSkipped += result.skipped;
      totalFailed += result.failed;
      skip += subs.length;

      console.log(`[CATCHUP] Batch processed: ${skip} total, ${totalSent} sent, ${totalSkipped} skipped, ${totalFailed} failed`);
    }

    console.log(`[CATCHUP] Done — ${totalSent} sent, ${totalSkipped} skipped, ${totalFailed} failed`);
  } catch (err) {
    console.error('[CATCHUP] Error:', err.message);
  } finally {
    await releaseLock(lockKey, lockValue);
    await mongoose.disconnect();
    const redis = getRedisClient();
    if (redis) redis.disconnect();
  }
}

await mongoose.connect(process.env.MONGO_URI);
console.log('[CATCHUP] MongoDB connected');
await connectRedis();
console.log('[CATCHUP] Redis connected');

await runCatchup();
