import { scheduleSubscriptionReminders, scheduleDailySubscriptionCheck } from './subscriptionReminder.js';
import { initializeReportScheduler } from './reportScheduler.js';
import { notificationLogger } from '../index.js';
import { initializeChannelCache } from '../utils/channelManager.js';

export function initializeSchedulers() {
  notificationLogger.info('Initializing notification schedulers...');

  initializeChannelCache();

  scheduleDailySubscriptionCheck();

  initializeReportScheduler();

  notificationLogger.info('Notification schedulers initialized');
}

export { scheduleSubscriptionReminders } from './subscriptionReminder.js';
export { initializeReportScheduler } from './reportScheduler.js';
