import cron from 'node-cron';
import { reportQueue } from '../queues/index.js';
import { notificationLogger } from '../logs/index.js';
import { withLock } from '../utils/redisLock.js';

const DAY_MAP = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

const DAY_CRON = {
  1: '0 20 * * 1',
  2: '0 20 * * 2',
  3: '0 20 * * 3',
  4: '0 20 * * 4',
  5: '0 20 * * 5',
  6: '0 20 * * 6',
  0: '0 20 * * 0',
};

export async function scheduleReport(companyId, reportType, date, email, data) {
  const lockKey = `report-${companyId}-${reportType}-${date}`;

  const result = await withLock(lockKey, async () => {
    try {
      const job = await reportQueue.add(
        reportType,
        { companyId, email, reportType, date, data },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
        },
      );

      notificationLogger.info('Report scheduled', { companyId, reportType, date, jobId: job.id });
      return job.id;
    } catch (error) {
      notificationLogger.error('Failed to schedule report', { companyId, error: error.message });
      return null;
    }
  }, 60000);

  if (result === null && !(result instanceof Error)) {
    notificationLogger.debug('Report already scheduled for this period', { companyId, reportType, date });
  }

  return result;
}

export function initializeReportScheduler() {
  notificationLogger.info('Report scheduler initialized');
}
