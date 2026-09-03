import cron from 'node-cron';
import Task from '../models/tasks/taskModel.js';
import TaskWorkSession from '../models/tasks/taskWorkSessionModel.js';
import { TaskNotificationService } from '../controllers/tasks/taskNotification.service.js';
import { notificationLogger } from '../src/notification/index.js';
import dayjs from 'dayjs';

let isRunning = false;

/**
 * Auto-stop forgotten active work sessions
 * Runs every 5 minutes
 * Stops sessions that exceed max duration (default: 12 hours = 43200 seconds)
 */
export const autoStopForgottenSessions = async () => {
  try {
    const maxDurationSeconds = parseInt(process.env.TASK_MAX_SESSION_DURATION) || 43200; // 12 hours
    const cutoffTime = new Date(Date.now() - maxDurationSeconds * 1000);

    // Find active sessions older than max duration
    const forgottenSessions = await TaskWorkSession.find({
      status: 'ACTIVE',
      startedAt: { $lt: cutoffTime }
    }).populate('taskId', 'taskNumber title companyId');

    if (forgottenSessions.length === 0) {
      return;
    }

    notificationLogger.info(`Found ${forgottenSessions.length} forgotten active sessions`);

    const bulkOps = [];

    for (const session of forgottenSessions) {
      const stoppedAt = new Date();
      const durationSeconds = Math.floor((stoppedAt - session.startedAt) / 1000);

      bulkOps.push({
        updateOne: {
          filter: { _id: session._id },
          update: {
            $set: {
              stoppedAt,
              status: 'AUTO_STOPPED',
              stopSource: 'SYSTEM',
              stopReason: 'Auto-stopped: session exceeded maximum duration',
              durationSeconds
            }
          }
        }
      });

      // Send notification to user
      if (session.taskId) {
        await TaskNotificationService.notifyWorkSessionAutoStopped({
          companyId: session.companyId,
          taskId: session.taskId._id,
          taskNumber: session.taskId.taskNumber,
          taskTitle: session.taskId.title,
          userId: session.userId,
          reason: 'Session exceeded maximum duration (auto-stopped by system)'
        });
      }
    }

    if (bulkOps.length > 0) {
      await TaskWorkSession.bulkWrite(bulkOps);
      notificationLogger.info(`Auto-stopped ${bulkOps.length} forgotten sessions`);
    }
  } catch (error) {
    notificationLogger.error('Auto-stop forgotten sessions failed', { error: error.message });
  }
};

/**
 * Send due soon notifications
 * Runs every hour
 * Notifies about tasks due within 24 hours
 */
export const sendDueSoonNotifications = async () => {
  try {
    const now = dayjs();
    const tomorrow = now.add(24, 'hour').toDate();
    const oneHourLater = now.add(1, 'hour').toDate();

    // Find tasks due soon (within 24 hours) that are still active
    const dueSoonTasks = await Task.find({
      status: { $in: ['ASSIGNED', 'ACCEPTED', 'ACTIVE', 'IN_PROGRESS', 'PAUSED'] },
      dueDate: { $gt: now.toDate(), $lte: tomorrow },
      deletedAt: { $exists: false }
    }).populate('assignedUsers', 'name email')
      .populate('ownerId', 'name email');

    for (const task of dueSoonTasks) {
      const hoursUntilDue = dayjs(task.dueDate).diff(now, 'hour');

      // Only send once (check if notification already sent in last hour)
      // In production, use a separate table to track sent notifications

      await TaskNotificationService.notifyTaskDueSoon({
        companyId: task.companyId,
        taskId: task._id,
        taskNumber: task.taskNumber,
        taskTitle: task.title,
        dueDate: task.dueDate,
        assigneeIds: task.assignedUsers.map(u => u._id),
        ownerId: task.ownerId._id,
      });

      notificationLogger.info(`Due soon notification sent for task ${task.taskNumber}`);
    }
  } catch (error) {
    notificationLogger.error('Send due soon notifications failed', { error: error.message });
  }
};

/**
 * Send overdue notifications
 * Runs every 2 hours
 * Notifies about tasks that are past their due date
 */
export const sendOverdueNotifications = async () => {
  try {
    const now = dayjs();

    // Find overdue tasks that are still active
    const overdueTasks = await Task.find({
      status: { $in: ['ASSIGNED', 'ACCEPTED', 'ACTIVE', 'IN_PROGRESS', 'PAUSED'] },
      dueDate: { $lt: now.toDate() },
      deletedAt: { $exists: false }
    }).populate('assignedUsers', 'name email')
      .populate('ownerId', 'name email');

    for (const task of overdueTasks) {
      const overdueDays = now.diff(dayjs(task.dueDate), 'day');

      // Only send once per day (check if notification already sent today)
      // In production, use a separate table to track sent notifications

      await TaskNotificationService.notifyTaskOverdue({
        companyId: task.companyId,
        taskId: task._id,
        taskNumber: task.taskNumber,
        taskTitle: task.title,
        dueDate: task.dueDate,
        assigneeIds: task.assignedUsers.map(u => u._id),
        ownerId: task.ownerId._id,
      });

      notificationLogger.info(`Overdue notification sent for task ${task.taskNumber}`);
    }
  } catch (error) {
    notificationLogger.error('Send overdue notifications failed', { error: error.message });
  }
};

/**
 * Stop sessions at attendance checkout
 * This is triggered by attendance system
 * Auto-stops active work sessions when employee checks out
 */
export const stopSessionsAtCheckout = async (employeeId, companyId) => {
  try {
    // Find active sessions for this employee
    const activeSessions = await TaskWorkSession.find({
      companyId,
      userId: employeeId,
      status: 'ACTIVE'
    }).populate('taskId', 'taskNumber title');

    if (activeSessions.length === 0) {
      return;
    }

    const bulkOps = [];

    for (const session of activeSessions) {
      const stoppedAt = new Date();
      const durationSeconds = Math.floor((stoppedAt - session.startedAt) / 1000);

      bulkOps.push({
        updateOne: {
          filter: { _id: session._id },
          update: {
            $set: {
              stoppedAt,
              status: 'AUTO_STOPPED',
              stopSource: 'ATTENDANCE_CHECKOUT',
              stopReason: 'Auto-stopped: attendance checkout',
              durationSeconds
            }
          }
        }
      });

      // Notify user
      await TaskNotificationService.notifyWorkSessionAutoStopped({
        companyId,
        taskId: session.taskId._id,
        taskNumber: session.taskId.taskNumber,
        taskTitle: session.taskId.title,
        userId: employeeId,
        reason: 'Work session auto-stopped due to attendance checkout'
      });
    }

    if (bulkOps.length > 0) {
      await TaskWorkSession.bulkWrite(bulkOps);
      notificationLogger.info(`Stopped ${bulkOps.length} sessions at checkout for employee ${employeeId}`);
    }
  } catch (error) {
    notificationLogger.error('Stop sessions at checkout failed', { error: error.message });
  }
};

/**
 * Start all task-related schedulers
 */
export const startTaskSchedulers = () => {
  // Auto-stop forgotten sessions - every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await autoStopForgottenSessions();
    } catch (err) {
      notificationLogger.error('Task scheduler error (auto-stop)', { error: err.message });
    } finally {
      isRunning = false;
    }
  }, { timezone: 'Asia/Kolkata' });

  // Send due soon notifications - every hour
  cron.schedule('0 * * * *', async () => {
    try {
      await sendDueSoonNotifications();
    } catch (err) {
      notificationLogger.error('Task scheduler error (due soon)', { error: err.message });
    }
  }, { timezone: 'Asia/Kolkata' });

  // Send overdue notifications - every 2 hours
  cron.schedule('0 */2 * * *', async () => {
    try {
      await sendOverdueNotifications();
    } catch (err) {
      notificationLogger.error('Task scheduler error (overdue)', { error: err.message });
    }
  }, { timezone: 'Asia/Kolkata' });

  notificationLogger.info('Task schedulers started');
};

export default {
  autoStopForgottenSessions,
  sendDueSoonNotifications,
  sendOverdueNotifications,
  stopSessionsAtCheckout,
  startTaskSchedulers
};