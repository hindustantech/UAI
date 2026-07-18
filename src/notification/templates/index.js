import { NOTIFICATION_TYPES } from '../constants/index.js';
import { notificationLogger } from '../index.js';

import { subscriptionActivatedEmail } from './email/subscriptionActivated.js';
import { subscriptionExpiredEmail } from './email/subscriptionExpired.js';
import { subscriptionExpiringEmail } from './email/subscriptionExpiring.js';
import { welcomeEmail } from './email/welcome.js';
import { passwordResetEmail } from './email/passwordReset.js';
import { otpEmail } from './email/otp.js';
import { leaveApprovedEmail } from './email/leaveApproved.js';
import { leaveRejectedEmail } from './email/leaveRejected.js';
import { dailyReportEmail } from './email/dailyReport.js';
import { weeklyReportEmail } from './email/weeklyReport.js';
import { monthlyReportEmail } from './email/monthlyReport.js';
import { loginAlertEmail } from './email/loginAlert.js';
import { employeeCheckInEmail } from './email/employeeCheckIn.js';
import { absentEmail } from './email/absent.js';

import { subscriptionActivatedWhatsApp } from './whatsapp/subscriptionActivated.js';
import { subscriptionExpiredWhatsApp } from './whatsapp/subscriptionExpired.js';
import { subscriptionExpiringWhatsApp } from './whatsapp/subscriptionExpiring.js';
import { welcomeWhatsApp } from './whatsapp/welcome.js';
import { otpWhatsApp } from './whatsapp/otp.js';
import { meetingReminderWhatsApp } from './whatsapp/meetingReminder.js';
import { followupReminderWhatsApp } from './whatsapp/followupReminder.js';
import { visitReminderWhatsApp } from './whatsapp/visitReminder.js';
import { dailyReportWhatsApp } from './whatsapp/dailyReport.js';
import { employeeCheckInWhatsApp } from './whatsapp/employeeCheckIn.js';
import { absentWhatsApp } from './whatsapp/absent.js';

const EMAIL_TEMPLATES = {
  [NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED]: subscriptionActivatedEmail,
  [NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED]: subscriptionActivatedEmail,
  [NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED]: subscriptionExpiredEmail,
  [NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRING_SOON]: subscriptionExpiringEmail,
  [NOTIFICATION_TYPES.TRIAL_STARTED]: welcomeEmail,
  [NOTIFICATION_TYPES.TRIAL_ENDING]: subscriptionExpiringEmail,
  [NOTIFICATION_TYPES.WELCOME]: welcomeEmail,
  [NOTIFICATION_TYPES.PASSWORD_RESET]: passwordResetEmail,
  [NOTIFICATION_TYPES.OTP]: otpEmail,
  [NOTIFICATION_TYPES.LOGIN_ALERT]: loginAlertEmail,
  [NOTIFICATION_TYPES.LEAVE_APPROVED]: leaveApprovedEmail,
  [NOTIFICATION_TYPES.LEAVE_REJECTED]: leaveRejectedEmail,
  [NOTIFICATION_TYPES.DAILY_REPORT]: dailyReportEmail,
  [NOTIFICATION_TYPES.WEEKLY_REPORT]: weeklyReportEmail,
  [NOTIFICATION_TYPES.MONTHLY_REPORT]: monthlyReportEmail,
  [NOTIFICATION_TYPES.EMPLOYEE_CHECK_IN]: employeeCheckInEmail,
  [NOTIFICATION_TYPES.EMPLOYEE_CHECK_OUT]: employeeCheckInEmail,
  [NOTIFICATION_TYPES.EMPLOYEE_ADDED]: welcomeEmail,
  [NOTIFICATION_TYPES.LATE_ATTENDANCE]: absentEmail,
  [NOTIFICATION_TYPES.ABSENT]: absentEmail,
};

const WHATSAPP_TEMPLATES = {
  [NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED]: subscriptionActivatedWhatsApp,
  [NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED]: subscriptionActivatedWhatsApp,
  [NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED]: subscriptionExpiredWhatsApp,
  [NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRING_SOON]: subscriptionExpiringWhatsApp,
  [NOTIFICATION_TYPES.TRIAL_STARTED]: welcomeWhatsApp,
  [NOTIFICATION_TYPES.TRIAL_ENDING]: subscriptionExpiringWhatsApp,
  [NOTIFICATION_TYPES.WELCOME]: welcomeWhatsApp,
  [NOTIFICATION_TYPES.OTP]: otpWhatsApp,
  [NOTIFICATION_TYPES.MEETING_REMINDER]: meetingReminderWhatsApp,
  [NOTIFICATION_TYPES.FOLLOWUP_REMINDER]: followupReminderWhatsApp,
  [NOTIFICATION_TYPES.VISIT_REMINDER]: visitReminderWhatsApp,
  [NOTIFICATION_TYPES.DAILY_REPORT]: dailyReportWhatsApp,
  [NOTIFICATION_TYPES.WEEKLY_REPORT]: dailyReportWhatsApp,
  [NOTIFICATION_TYPES.MONTHLY_REPORT]: dailyReportWhatsApp,
  [NOTIFICATION_TYPES.EMPLOYEE_CHECK_IN]: employeeCheckInWhatsApp,
  [NOTIFICATION_TYPES.EMPLOYEE_CHECK_OUT]: employeeCheckInWhatsApp,
  [NOTIFICATION_TYPES.LATE_ATTENDANCE]: absentWhatsApp,
  [NOTIFICATION_TYPES.ABSENT]: absentWhatsApp,
};

const WHATSAPP_TEMPLATE_NAMES = {
  [NOTIFICATION_TYPES.OTP]: 'otp_auth',
  [NOTIFICATION_TYPES.WELCOME]: 'uai_first',
  [NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED]: 'subscription_activated',
  [NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED]: 'subscription_expired',
  [NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRING_SOON]: 'subscription_expiring',
  [NOTIFICATION_TYPES.MEETING_REMINDER]: 'meeting_reminder',
  [NOTIFICATION_TYPES.FOLLOWUP_REMINDER]: 'followup_reminder',
  [NOTIFICATION_TYPES.VISIT_REMINDER]: 'visit_reminder',
  [NOTIFICATION_TYPES.DAILY_REPORT]: 'daily_report',
  [NOTIFICATION_TYPES.EMPLOYEE_CHECK_IN]: 'employee_check_in',
  [NOTIFICATION_TYPES.ABSENT]: 'absent_alert',
};

export function renderEmailTemplate(type, data) {
  const template = EMAIL_TEMPLATES[type];
  if (!template) {
    notificationLogger.warn('No email template found', { type });
    return { subject: 'Notification', html: `<p>${JSON.stringify(data)}</p>` };
  }
  return template(data);
}

export function renderWhatsAppTemplate(type, data) {
  const template = WHATSAPP_TEMPLATES[type];
  if (!template) {
    notificationLogger.warn('No WhatsApp template found', { type });
    return { message: JSON.stringify(data), params: [] };
  }
  return template(data);
}

export function getWhatsAppTemplateName(type) {
  return WHATSAPP_TEMPLATE_NAMES[type] || 'notification';
}

export function getEmailSubject(type, data) {
  const result = renderEmailTemplate(type, data);
  return result.subject;
}
