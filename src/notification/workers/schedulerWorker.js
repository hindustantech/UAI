import { Worker } from 'bullmq';
import { getRedisClient } from '../../../config/redis.js';
import { QUEUE_NAMES } from '../constants/index.js';
import { NotificationService } from '../services/NotificationService.js';
import { notificationLogger } from '../index.js';
import { Subscription } from '../../../models/Attandance/subscration/Subscription.js';
import User from '../../../models/userModel.js';

async function processSchedulerJob(job) {
  const { type, companyId, endDate, reminderLabel, subscriptionId, planName: payloadPlanName } = job.data;

  notificationLogger.info('Processing scheduler job', {
    jobId: job.id, type, companyId, reminderLabel,
  });

  if (type === 'subscription_expiring_soon') {
    let company;
    try {
      company = await User.findById(companyId).select('name email phone').lean();
    } catch (err) {
      notificationLogger.error('Failed to fetch company', { companyId, jobId: job.id, error: err.message });
      throw err;
    }

    if (!company) {
      notificationLogger.warn('Company not found for reminder', { companyId, jobId: job.id });
      return { skipped: true, reason: 'company_not_found' };
    }

    let planName = payloadPlanName || 'Premium';
    if (subscriptionId) {
      try {
        const subscription = await Subscription.findById(subscriptionId).select('planSnapshot').lean();
        if (subscription?.planSnapshot?.name) {
          planName = subscription.planSnapshot.name;
        }
      } catch (err) {
        notificationLogger.warn('Could not fetch subscription by id, using payload planName', {
          subscriptionId, jobId: job.id, error: err.message,
        });
      }
    }

    const daysLeft = Math.floor((new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24));

    const result = await NotificationService.sendSubscriptionExpiringSoon({
      companyId,
      companyName: company.name || 'Customer',
      planName,
      endDate: new Date(endDate).toISOString(),
      daysLeft,
      email: company.email,
      phone: company.phone,
    });

    notificationLogger.info('Subscription expiring soon notification sent', {
      companyId, daysLeft, reminderLabel, jobId: job.id,
      notificationStatus: result?.results?.[0]?.status,
    });

    return { sent: true, daysLeft, reminderLabel };
  }

  notificationLogger.warn('Unknown scheduler job type', { type, jobId: job.id });
  return { skipped: true, reason: 'unknown_type' };
}

export function createSchedulerWorker() {
  const worker = new Worker(QUEUE_NAMES.SCHEDULER, processSchedulerJob, {
    connection: getRedisClient(),
    concurrency: 1,
  });

  worker.on('completed', (job) => {
    notificationLogger.info('Scheduler job completed', { jobId: job.id });
  });

  worker.on('failed', (job, error) => {
    notificationLogger.error('Scheduler worker failed', {
      jobId: job?.id, error: error.message,
    });
  });

  notificationLogger.info('Scheduler worker created', { queue: QUEUE_NAMES.SCHEDULER });

  return worker;
}

export { processSchedulerJob };
