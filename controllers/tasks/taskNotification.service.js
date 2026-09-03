import NotificationService from '../../src/notification/services/NotificationService.js';
import { NOTIFICATION_TYPES } from '../../src/notification/constants/enums.js';
import { getTierScoreForType, TIER_SCORES } from '../../src/notification/priority/constants.js';
import User from '../../models/userModel.js';
import Employee from '../../models/Attandance/Employee.js';
import { notificationLogger } from '../../src/notification/index.js';

// Add task-specific notification types to the existing system
const TASK_NOTIFICATION_TYPES = {
  TASK_CREATED: 'task_created',
  TASK_ASSIGNED: 'task_assigned',
  TASK_INVITED: 'task_invited',
  TASK_INVITATION_ACCEPTED: 'task_invitation_accepted',
  TASK_INVITATION_REJECTED: 'task_invitation_rejected',
  TASK_STARTED: 'task_started',
  TASK_STOPPED: 'task_stopped',
  TASK_RESUMED: 'task_resumed',
  TASK_SUBMITTED: 'task_submitted',
  TASK_VERIFIED: 'task_verified',
  TASK_REJECTED: 'task_rejected',
  TASK_REOPENED: 'task_reopened',
  TASK_CLOSED: 'task_closed',
  TASK_DEACTIVATED: 'task_deactivated',
  TASK_CANCELLED: 'task_cancelled',
  TASK_DUE_SOON: 'task_due_soon',
  TASK_OVERDUE: 'task_overdue',
  WORK_SESSION_AUTO_STOPPED: 'work_session_auto_stopped',
};

// Map task notification types to priority tiers
const TASK_TIER_MAP = {
  [TASK_NOTIFICATION_TYPES.TASK_CREATED]: TIER_SCORES.NORMAL,
  [TASK_NOTIFICATION_TYPES.TASK_ASSIGNED]: TIER_SCORES.HIGH,
  [TASK_NOTIFICATION_TYPES.TASK_INVITED]: TIER_SCORES.HIGH,
  [TASK_NOTIFICATION_TYPES.TASK_INVITATION_ACCEPTED]: TIER_SCORES.NORMAL,
  [TASK_NOTIFICATION_TYPES.TASK_INVITATION_REJECTED]: TIER_SCORES.NORMAL,
  [TASK_NOTIFICATION_TYPES.TASK_STARTED]: TIER_SCORES.NORMAL,
  [TASK_NOTIFICATION_TYPES.TASK_STOPPED]: TIER_SCORES.NORMAL,
  [TASK_NOTIFICATION_TYPES.TASK_RESUMED]: TIER_SCORES.NORMAL,
  [TASK_NOTIFICATION_TYPES.TASK_SUBMITTED]: TIER_SCORES.HIGH,
  [TASK_NOTIFICATION_TYPES.TASK_VERIFIED]: TIER_SCORES.HIGH,
  [TASK_NOTIFICATION_TYPES.TASK_REJECTED]: TIER_SCORES.HIGH,
  [TASK_NOTIFICATION_TYPES.TASK_REOPENED]: TIER_SCORES.NORMAL,
  [TASK_NOTIFICATION_TYPES.TASK_CLOSED]: TIER_SCORES.NORMAL,
  [TASK_NOTIFICATION_TYPES.TASK_DEACTIVATED]: TIER_SCORES.LOW,
  [TASK_NOTIFICATION_TYPES.TASK_CANCELLED]: TIER_SCORES.LOW,
  [TASK_NOTIFICATION_TYPES.TASK_DUE_SOON]: TIER_SCORES.HIGH,
  [TASK_NOTIFICATION_TYPES.TASK_OVERDUE]: TIER_SCORES.CRITICAL,
  [TASK_NOTIFICATION_TYPES.WORK_SESSION_AUTO_STOPPED]: TIER_SCORES.HIGH,
};

// Notification recipients by event type
const NOTIFICATION_RECIPIENTS = {
  [TASK_NOTIFICATION_TYPES.TASK_CREATED]: ['assignedUsers', 'owner'],
  [TASK_NOTIFICATION_TYPES.TASK_ASSIGNED]: ['assignee'],
  [TASK_NOTIFICATION_TYPES.TASK_INVITED]: ['invitedUser'],
  [TASK_NOTIFICATION_TYPES.TASK_INVITATION_ACCEPTED]: ['owner', 'manager'],
  [TASK_NOTIFICATION_TYPES.TASK_INVITATION_REJECTED]: ['owner', 'manager'],
  [TASK_NOTIFICATION_TYPES.TASK_STARTED]: ['owner', 'manager'],
  [TASK_NOTIFICATION_TYPES.TASK_STOPPED]: ['owner'],
  [TASK_NOTIFICATION_TYPES.TASK_RESUMED]: ['owner', 'manager'],
  [TASK_NOTIFICATION_TYPES.TASK_SUBMITTED]: ['manager', 'verifier', 'owner'],
  [TASK_NOTIFICATION_TYPES.TASK_VERIFIED]: ['owner', 'assignees'],
  [TASK_NOTIFICATION_TYPES.TASK_REJECTED]: ['assignees', 'owner'],
  [TASK_NOTIFICATION_TYPES.TASK_REOPENED]: ['assignees'],
  [TASK_NOTIFICATION_TYPES.TASK_CLOSED]: ['assignees', 'owner', 'manager'],
  [TASK_NOTIFICATION_TYPES.TASK_DEACTIVATED]: ['assignees', 'owner'],
  [TASK_NOTIFICATION_TYPES.TASK_CANCELLED]: ['assignees', 'owner'],
  [TASK_NOTIFICATION_TYPES.TASK_DUE_SOON]: ['assignees', 'owner'],
  [TASK_NOTIFICATION_TYPES.TASK_OVERDUE]: ['assignees', 'owner', 'manager'],
  [TASK_NOTIFICATION_TYPES.WORK_SESSION_AUTO_STOPPED]: ['assignee', 'owner'],
};

export class TaskNotificationService {
  static async sendTaskNotification({
    type,
    companyId,
    taskId,
    taskNumber,
    taskTitle,
    actorUserId,
    targetUserIds = [],
    extraData = {},
    priority,
  }) {
    try {
      const tierScore = priority !== undefined ? priority : TASK_TIER_MAP[type] || TIER_SCORES.NORMAL;

      for (const userId of targetUserIds) {
        const user = await User.findById(userId).select('email phone name devicetoken');
        if (!user) continue;

        const deviceTokens = user.devicetoken?.filter(Boolean) || [];

        await NotificationService.send({
          type,
          companyId,
          userId,
          email: user.email,
          phone: user.phone,
          deviceToken: deviceTokens.length === 1 ? deviceTokens[0] : (deviceTokens.length > 0 ? deviceTokens : undefined),
          data: {
            taskId: String(taskId),
            taskNumber,
            taskTitle,
            actorName: extraData.actorName || 'System',
            message: extraData.message || `Task ${taskNumber} has been updated`,
            title: extraData.message || `Task ${taskNumber}`,
            ...extraData,
          },
          priority: tierScore,
        });
      }

      notificationLogger.info('Task notification sent', { type, taskId, targetUserIds: targetUserIds.length });
      return { success: true, type, targetCount: targetUserIds.length };
    } catch (error) {
      notificationLogger.error('Task notification failed', { type, taskId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  static async notifyTaskAssigned({ companyId, taskId, taskNumber, taskTitle, assigneeId, assignedByName }) {
    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.TASK_ASSIGNED,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds: [assigneeId],
      extraData: { actorName: assignedByName, message: `You have been assigned to task ${taskNumber}: ${taskTitle}` },
    });
  }

  static async notifyTaskInvited({ companyId, taskId, taskNumber, taskTitle, invitedUserId, invitedByName, message }) {
    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.TASK_INVITED,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds: [invitedUserId],
      extraData: { actorName: invitedByName, message: message || `You have been invited to task ${taskNumber}: ${taskTitle}` },
    });
  }

  static async notifyInvitationAccepted({ companyId, taskId, taskNumber, taskTitle, acceptedByName, ownerId, managerId }) {
    const targetUserIds = [ownerId];
    if (managerId) targetUserIds.push(managerId);

    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.TASK_INVITATION_ACCEPTED,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds,
      extraData: { actorName: acceptedByName, message: `Invitation accepted for task ${taskNumber}` },
    });
  }

  static async notifyInvitationRejected({ companyId, taskId, taskNumber, taskTitle, rejectedByName, reason, ownerId, managerId }) {
    const targetUserIds = [ownerId];
    if (managerId) targetUserIds.push(managerId);

    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.TASK_INVITATION_REJECTED,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds,
      extraData: { actorName: rejectedByName, reason, message: `Invitation rejected for task ${taskNumber}: ${reason}` },
    });
  }

  static async notifyTaskSubmitted({ companyId, taskId, taskNumber, taskTitle, submittedByName, ownerId, verifierIds = [] }) {
    const targetUserIds = [ownerId, ...verifierIds];

    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.TASK_SUBMITTED,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds: [...new Set(targetUserIds)],
      extraData: { actorName: submittedByName, message: `Task ${taskNumber} has been submitted for review` },
    });
  }

  static async notifyTaskVerified({ companyId, taskId, taskNumber, taskTitle, verifiedByName, ownerId, assigneeIds = [] }) {
    const targetUserIds = [ownerId, ...assigneeIds];

    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.TASK_VERIFIED,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds: [...new Set(targetUserIds)],
      extraData: { actorName: verifiedByName, message: `Task ${taskNumber} has been verified` },
    });
  }

  static async notifyTaskRejected({ companyId, taskId, taskNumber, taskTitle, rejectedByName, reason, assigneeIds = [], ownerId }) {
    const targetUserIds = [...assigneeIds, ownerId];

    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.TASK_REJECTED,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds: [...new Set(targetUserIds)],
      extraData: { actorName: rejectedByName, reason, message: `Task ${taskNumber} has been rejected: ${reason}` },
    });
  }

  static async notifyTaskClosed({ companyId, taskId, taskNumber, taskTitle, closedByName, ownerId, assigneeIds = [], managerId }) {
    const targetUserIds = [ownerId, ...assigneeIds];
    if (managerId) targetUserIds.push(managerId);

    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.TASK_CLOSED,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds: [...new Set(targetUserIds)],
      extraData: { actorName: closedByName, message: `Task ${taskNumber} has been closed` },
    });
  }

  static async notifyWorkSessionAutoStopped({ companyId, taskId, taskNumber, taskTitle, userId, reason }) {
    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.WORK_SESSION_AUTO_STOPPED,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds: [userId],
      extraData: { reason, message: `Work session auto-stopped for task ${taskNumber}: ${reason}` },
    });
  }

  static async notifyTaskDueSoon({ companyId, taskId, taskNumber, taskTitle, dueDate, assigneeIds = [], ownerId }) {
    const targetUserIds = [...assigneeIds, ownerId];

    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.TASK_DUE_SOON,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds: [...new Set(targetUserIds)],
      extraData: { dueDate: new Date(dueDate).toISOString(), message: `Task ${taskNumber} is due soon` },
    });
  }

  static async notifyTaskOverdue({ companyId, taskId, taskNumber, taskTitle, dueDate, assigneeIds = [], ownerId, managerId }) {
    const targetUserIds = [...assigneeIds, ownerId];
    if (managerId) targetUserIds.push(managerId);

    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.TASK_OVERDUE,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds: [...new Set(targetUserIds)],
      extraData: { dueDate: new Date(dueDate).toISOString(), message: `Task ${taskNumber} is now overdue!` },
    });
  }

  static async notifyTaskReopened({ companyId, taskId, taskNumber, taskTitle, reopenedByName, assigneeIds = [] }) {
    return TaskNotificationService.sendTaskNotification({
      type: TASK_NOTIFICATION_TYPES.TASK_REOPENED,
      companyId,
      taskId,
      taskNumber,
      taskTitle,
      targetUserIds: assigneeIds,
      extraData: { actorName: reopenedByName, message: `Task ${taskNumber} has been reopened` },
    });
  }

  static getTaskNotificationTypes() {
    return TASK_NOTIFICATION_TYPES;
  }
}

export default TaskNotificationService;