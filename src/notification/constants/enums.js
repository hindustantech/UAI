export const QUEUE_NAMES = {
  EMAIL: 'emailQueue',
  WHATSAPP: 'whatsappQueue',
  NOTIFICATION: 'notificationQueue',
  REPORT: 'reportQueue',
  SCHEDULER: 'schedulerQueue',
  RETRY: 'retryQueue',
  DEAD_LETTER: 'deadLetterQueue',
};

export const NOTIFICATION_TYPES = {
  SUBSCRIPTION_ACTIVATED: 'subscription_activated',
  SUBSCRIPTION_RENEWED: 'subscription_renewed',
  SUBSCRIPTION_EXPIRED: 'subscription_expired',
  SUBSCRIPTION_EXPIRING_SOON: 'subscription_expiring_soon',
  TRIAL_STARTED: 'trial_started',
  TRIAL_ENDING: 'trial_ending',

  EMPLOYEE_ADDED: 'employee_added',
  EMPLOYEE_REMOVED: 'employee_removed',
  EMPLOYEE_CHECK_IN: 'employee_check_in',
  EMPLOYEE_CHECK_OUT: 'employee_check_out',
  LATE_ATTENDANCE: 'late_attendance',
  ABSENT: 'absent',

  DAILY_REPORT: 'daily_report',
  WEEKLY_REPORT: 'weekly_report',
  MONTHLY_REPORT: 'monthly_report',

  LEAVE_APPROVED: 'leave_approved',
  LEAVE_REJECTED: 'leave_rejected',

  MEETING_REMINDER: 'meeting_reminder',
  FOLLOWUP_REMINDER: 'followup_reminder',
  VISIT_REMINDER: 'visit_reminder',

  WELCOME: 'welcome',
  PASSWORD_RESET: 'password_reset',
  OTP: 'otp',
  LOGIN_ALERT: 'login_alert',
};

export const CHANNELS = {
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
  SMS: 'sms',
  PUSH: 'push',
  IN_APP: 'in_app',
};

export const JOB_STATUS = {
  QUEUED: 'queued',
  STARTED: 'started',
  RETRY: 'retry',
  SUCCESS: 'success',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter',
  DUPLICATE_SKIPPED: 'duplicate_skipped',
  RATE_LIMITED: 'rate_limited',
};

export const PRIORITY = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
  BULK: 4,
};
