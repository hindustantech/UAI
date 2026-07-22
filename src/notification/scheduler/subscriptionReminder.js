import cron from 'node-cron';
import { Subscription } from '../../../models/Attandance/subscration/Subscription.js';
import User from '../../../models/userModel.js';
import { schedulerQueue } from '../queues/index.js';
import { notificationLogger } from '../index.js';
import { acquireLock, releaseLock } from '../utils/redisLock.js';
import { getRedisClient } from '../../../config/redis.js';

export async function scheduleSubscriptionReminders(subscription) {
  if (!subscription || !subscription.endDate) {
    notificationLogger.warn('Cannot schedule reminders: invalid subscription');
    return;
  }

  const endDate = new Date(subscription.endDate);
  const now = new Date();
  const daysUntilExpiry = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
  const companyId = subscription.company || subscription.companyId;
  const planName = subscription.planSnapshot?.name || 'Premium';

  const reminderPoints = [
    { daysBefore: 7, label: '7days' },
    { daysBefore: 3, label: '3days' },
    { daysBefore: 1, label: '1day' },
  ];

  const redis = getRedisClient();

  for (const reminder of reminderPoints) {
    if (daysUntilExpiry >= reminder.daysBefore) {
      const delayMs = (endDate.getTime() - now.getTime()) - (reminder.daysBefore * 24 * 60 * 60 * 1000);

      if (delayMs < 0) continue;

      const dedupKey = `notification:reminder:sched:${companyId}:${reminder.label}`;

      try {
        const alreadyScheduled = await redis.get(dedupKey);
        if (alreadyScheduled) {
          notificationLogger.debug('Reminder already scheduled, skipping', {
            companyId, reminder: reminder.label,
          });
          continue;
        }

        await schedulerQueue.add(
          'subscription_expiring_soon',
          {
            type: 'subscription_expiring_soon',
            companyId,
            planId: subscription.plan,
            subscriptionId: String(subscription._id),
            planName,
            endDate: subscription.endDate,
            reminderLabel: reminder.label,
          },
          { delay: delayMs, attempts: 1 },
        );

        await redis.set(dedupKey, '1', 'PX', delayMs + 86400000, 'NX');

        notificationLogger.info('Subscription reminder scheduled', {
          companyId,
          reminder: reminder.label,
          delayMs,
        });
      } catch (error) {
        notificationLogger.error('Failed to schedule reminder', {
          companyId,
          error: error.message,
        });
      }
    }
  }
}

export function scheduleDailySubscriptionCheck() {

  cron.schedule('* * * * *', async () => {
    const lockKey = 'subscription-daily-reminder-check';
    const lockValue = await acquireLock(lockKey, 300000);

    if (!lockValue) {
      notificationLogger.debug('Daily subscription check skipped (another instance holds lock)');
      return;
    }

    notificationLogger.info('Running daily subscription reminder check');

    try {
      const expiringSubscriptions = await Subscription.find({
        status: 'ACTIVE',
        isActive: true,
        endDate: {
          $gte: new Date(),
          $lte: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        },
      }).populate('company', 'email phone name');

      for (const sub of expiringSubscriptions) {
        await scheduleSubscriptionReminders(sub);
      }

      notificationLogger.info('Daily subscription check completed', {
        expiringCount: expiringSubscriptions.length,
      });
    } catch (error) {
      notificationLogger.error('Daily subscription check failed', { error: error.message });
    } finally {
      await releaseLock(lockKey, lockValue);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });

  notificationLogger.info('Daily subscription reminder cron scheduled (0 0 * * *)');
}
