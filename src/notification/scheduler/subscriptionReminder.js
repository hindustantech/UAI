import cron from 'node-cron';
import { Subscription } from '../../../models/Attandance/subscration/Subscription.js';
import User from '../../../models/userModel.js';
import { schedulerQueue } from '../queues/index.js';
import { notificationLogger } from '../index.js';
import { acquireLock } from '../utils/redisLock.js';

export async function scheduleSubscriptionReminders(subscription) {
  if (!subscription || !subscription.endDate) {
    notificationLogger.warn('Cannot schedule reminders: invalid subscription');
    return;
  }

  const endDate = new Date(subscription.endDate);
  const now = new Date();
  const daysUntilExpiry = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

  const reminderPoints = [
    { daysBefore: 7, label: '7days' },
    { daysBefore: 3, label: '3days' },
    { daysBefore: 1, label: '1day' },
  ];

  for (const reminder of reminderPoints) {
    if (daysUntilExpiry >= reminder.daysBefore) {
      const delayMs = (endDate.getTime() - now.getTime()) - (reminder.daysBefore * 24 * 60 * 60 * 1000);

      if (delayMs < 0) continue;

      const lockKey = `subscription-reminder-${subscription.company || subscription.companyId}-${reminder.label}`;

      try {
        await schedulerQueue.add(
          'subscription_expiring_soon',
          {
            type: 'subscription_expiring_soon',
            companyId: subscription.company || subscription.companyId,
            planId: subscription.plan,
            endDate: subscription.endDate,
            reminderLabel: reminder.label,
          },
          { delay: delayMs, attempts: 1 },
        );

        notificationLogger.info('Subscription reminder scheduled', {
          companyId: subscription.company || subscription.companyId,
          reminder: reminder.label,
          delayMs,
        });
      } catch (error) {
        notificationLogger.error('Failed to schedule reminder', {
          companyId: subscription.company || subscription.companyId,
          error: error.message,
        });
      }
    }
  }
}

export function scheduleDailySubscriptionCheck() {
  cron.schedule('0 0 * * *', async () => {
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
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });

  notificationLogger.info('Daily subscription reminder cron scheduled (0 0 * * *)');
}
