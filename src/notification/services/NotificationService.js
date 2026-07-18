import { getTierQueue, notificationQueue } from '../queues/index.js';
import { NOTIFICATION_TYPES, CHANNELS, PRIORITY, NOTIFICATION_DEFAULT_PRIORITY, NOTIFICATION_JOB_REMOVE_COMPLETE, NOTIFICATION_JOB_REMOVE_FAIL } from '../constants/index.js';
import { renderEmailTemplate, renderWhatsAppTemplate, getWhatsAppTemplateName } from '../templates/index.js';
import { getTierScoreForType, TIER_SCORES } from '../priority/constants.js';
import { notificationLogger } from '../index.js';
import { makeIdempotencyKey } from '../utils/idempotency.js';
import Notification from '../models/Notification.js';
import mongoose from 'mongoose';

const CHANNEL_MAP = {
  [NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED]: [CHANNELS.EMAIL, CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED]: [CHANNELS.EMAIL, CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED]: [CHANNELS.EMAIL, CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRING_SOON]: [CHANNELS.EMAIL, CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.TRIAL_STARTED]: [CHANNELS.EMAIL, CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.TRIAL_ENDING]: [CHANNELS.EMAIL, CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.EMPLOYEE_ADDED]: [CHANNELS.EMAIL],
  [NOTIFICATION_TYPES.EMPLOYEE_REMOVED]: [CHANNELS.EMAIL],
  [NOTIFICATION_TYPES.EMPLOYEE_CHECK_IN]: [CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.EMPLOYEE_CHECK_OUT]: [CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.LATE_ATTENDANCE]: [CHANNELS.EMAIL, CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.ABSENT]: [CHANNELS.EMAIL, CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.DAILY_REPORT]: [CHANNELS.EMAIL],
  [NOTIFICATION_TYPES.WEEKLY_REPORT]: [CHANNELS.EMAIL],
  [NOTIFICATION_TYPES.MONTHLY_REPORT]: [CHANNELS.EMAIL],
  [NOTIFICATION_TYPES.LEAVE_APPROVED]: [CHANNELS.EMAIL, CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.LEAVE_REJECTED]: [CHANNELS.EMAIL, CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.MEETING_REMINDER]: [CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.FOLLOWUP_REMINDER]: [CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.VISIT_REMINDER]: [CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.WELCOME]: [CHANNELS.EMAIL, CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.PASSWORD_RESET]: [CHANNELS.EMAIL],
  [NOTIFICATION_TYPES.OTP]: [CHANNELS.WHATSAPP],
  [NOTIFICATION_TYPES.LOGIN_ALERT]: [CHANNELS.EMAIL],
};

function generateObjectId() {
  return new mongoose.Types.ObjectId().toString();
}

function createIdempotencyKey(type, userId, data) {
  const parts = [type, userId || ''];
  if (data?.date) parts.push(data.date);
  if (data?.requestId) parts.push(data.requestId);
  if (data?.idempotencySuffix) parts.push(data.idempotencySuffix);
  return makeIdempotencyKey(type, ...parts);
}

function resolvePriority(priority) {
  if (priority === undefined || priority === null) return NOTIFICATION_DEFAULT_PRIORITY;
  const p = Number(priority);
  if (p >= PRIORITY.HIGH && p <= PRIORITY.LOW) return p;
  return NOTIFICATION_DEFAULT_PRIORITY;
}

export class NotificationService {
  static async send({ type, companyId, userId, email, phone, data = {}, priority, delay = 0, deviceToken }) {
    if (!type) {
      notificationLogger.error('Notification type is required');
      return { error: 'Notification type is required' };
    }

    const channels = CHANNEL_MAP[type] || [CHANNELS.EMAIL];
    const resolvedPriority = resolvePriority(priority);
    const tierScore = getTierScoreForType(type);
    const idempotencyKey = createIdempotencyKey(type, userId, data);

    notificationLogger.info('Notification send requested', {
      type, companyId, userId, channels, tierScore, delay, priority: resolvedPriority,
    });

    const results = [];

    for (const channel of channels) {
      let notificationRecord;
      try {
        notificationRecord = await Notification.create({
          type,
          channel,
          companyId: companyId || undefined,
          userId: userId || undefined,
          recipient: { email, phone, deviceToken },
          idempotencyKey: `${idempotencyKey}:${channel}`,
          status: 'queued',
          priority: tierScore,
          metadata: { ...data, tierScore },
        });

        const jobPayload = {
          type,
          channel,
          companyId,
          userId,
          email,
          phone,
          deviceToken,
          data,
          tierScore,
          idempotencyKey: `${idempotencyKey}:${channel}`,
          notificationId: notificationRecord._id,
        };

        let job;

        if (channel === CHANNELS.EMAIL && email) {
          const template = renderEmailTemplate(type, data);
          const tierQueue = getTierQueue('email', tierScore);

          if (tierQueue) {
            job = await tierQueue.add(type, {
              ...jobPayload,
              to: email,
              subject: template.subject,
              html: template.html,
            }, {
              priority: tierScore,
              delay,
              removeOnComplete: NOTIFICATION_JOB_REMOVE_COMPLETE,
              removeOnFail: NOTIFICATION_JOB_REMOVE_FAIL,
            });

            results.push({ channel, tierScore, jobId: job.id, status: 'queued' });
            notificationLogger.info('Email notification queued to tier', {
              type, to: email, tierScore, jobId: job.id,
            });
          } else {
            notificationLogger.error('No tier queue found for email', { tierScore });
            results.push({ channel, error: 'No tier queue found', status: 'failed' });
          }
        } else if (channel === CHANNELS.WHATSAPP && phone) {
          const template = renderWhatsAppTemplate(type, data);
          const templateName = getWhatsAppTemplateName(type);
          const tierQueue = getTierQueue('whatsapp', tierScore);

          if (tierQueue) {
            job = await tierQueue.add(type, {
              ...jobPayload,
              to: phone,
              message: template.message,
              templateName,
              params: template.params,
            }, {
              priority: tierScore,
              delay,
              removeOnComplete: NOTIFICATION_JOB_REMOVE_COMPLETE,
              removeOnFail: NOTIFICATION_JOB_REMOVE_FAIL,
            });

            results.push({ channel, tierScore, jobId: job.id, status: 'queued' });
            notificationLogger.info('WhatsApp notification queued to tier', {
              type, to: phone, tierScore, jobId: job.id,
            });
          } else {
            notificationLogger.error('No tier queue found for whatsapp', { tierScore });
            results.push({ channel, error: 'No tier queue found', status: 'failed' });
          }
        }
      } catch (error) {
        notificationLogger.error('Failed to queue notification', {
          channel, type, tierScore, error: error.message,
        });
        if (notificationRecord) {
          await Notification.findByIdAndUpdate(notificationRecord._id, { status: 'failed', error: { message: error.message } }).catch(() => {});
        }
        results.push({ channel, error: error.message, status: 'failed' });
      }
    }

    return { results, idempotencyKey, tierScore };
  }

  static async sendOtp({ userId, phone, code, email, data = {} }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.OTP,
      userId,
      phone,
      email,
      data: { ...data, code: String(code), expiryMinutes: data.expiryMinutes || '10', requestId: data.requestId || generateObjectId() },
    });
  }

  static async sendWelcome({ userId, name, email, phone, companyName }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.WELCOME,
      userId,
      email,
      phone,
      data: { name, companyName },
    });
  }

  static async sendSubscriptionActivated({ companyId, companyName, planName, startDate, endDate, email, phone }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED,
      companyId,
      userId: companyId,
      email,
      phone,
      data: { companyName, planName, startDate, endDate },
    });
  }

  static async sendSubscriptionExpired({ companyId, companyName, planName, endDate, email, phone }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED,
      companyId,
      userId: companyId,
      email,
      phone,
      data: { companyName, planName, endDate },
    });
  }

  static async sendSubscriptionExpiringSoon({ companyId, companyName, planName, endDate, daysLeft, email, phone }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRING_SOON,
      companyId,
      userId: companyId,
      email,
      phone,
      data: { companyName, planName, endDate, daysLeft: String(daysLeft) },
    });
  }

  static async sendEmployeeCheckIn({ companyId, employeeId, employeeName, time, type, phone }) {
    return NotificationService.send({
      type: type === 'check_out' ? NOTIFICATION_TYPES.EMPLOYEE_CHECK_OUT : NOTIFICATION_TYPES.EMPLOYEE_CHECK_IN,
      companyId,
      userId: employeeId,
      phone,
      data: { employeeName, time, type, date: new Date().toISOString().split('T')[0] },
    });
  }

  static async sendAbsentAlert({ companyId, employeeName, date, email, phone }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.ABSENT,
      companyId,
      email,
      phone,
      data: { employeeName, date },
    });
  }

  static async sendLeaveApproved({ employeeId, employeeName, leaveType, startDate, endDate, reason, approver, email, phone }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.LEAVE_APPROVED,
      userId: employeeId,
      email,
      phone,
      data: { employeeName, leaveType, startDate, endDate, reason, approver },
    });
  }

  static async sendLeaveRejected({ employeeId, employeeName, leaveType, startDate, endDate, reason, approver, email, phone }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.LEAVE_REJECTED,
      userId: employeeId,
      email,
      phone,
      data: { employeeName, leaveType, startDate, endDate, reason, approver },
    });
  }

  static async sendPasswordReset({ userId, email, name, resetLink }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.PASSWORD_RESET,
      userId,
      email,
      data: { name, resetLink, requestId: generateObjectId() },
    });
  }

  static async sendLoginAlert({ userId, email, name, ip, location, device, timestamp }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.LOGIN_ALERT,
      userId,
      email,
      data: { name, ip, location, device, timestamp, requestId: generateObjectId() },
    });
  }

  static async sendDailyReport({ companyId, companyName, date, email, summary }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.DAILY_REPORT,
      companyId,
      email,
      data: { companyName, date, summary, idempotencySuffix: `report-${date}` },
      delay: 0,
    });
  }

  static async sendWeeklyReport({ companyId, companyName, weekStart, weekEnd, email, summary }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.WEEKLY_REPORT,
      companyId,
      email,
      data: { companyName, weekStart, weekEnd, summary, idempotencySuffix: `report-${weekStart}-${weekEnd}` },
    });
  }

  static async sendMonthlyReport({ companyId, companyName, month, year, email, summary }) {
    return NotificationService.send({
      type: NOTIFICATION_TYPES.MONTHLY_REPORT,
      companyId,
      email,
      data: { companyName, month, year, summary, idempotencySuffix: `report-${month}-${year}` },
    });
  }
}

export default NotificationService;
