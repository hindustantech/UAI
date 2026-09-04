import Task from '../../models/tasks/taskModel.js';
import TaskAssignment from '../../models/tasks/taskAssignmentModel.js';
import TaskWorkSession from '../../models/tasks/taskWorkSessionModel.js';
import TaskStatusHistory from '../../models/tasks/taskStatusHistoryModel.js';
import { createTaskAuditLog } from '../../utils/taskAuditHelper.js';
import { resolveCompanyId } from '../../utils/companyResolver.js';
import { TaskNotificationService } from './taskNotification.service.js';

export const startTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (!['ACCEPTED', 'ACTIVE', 'IN_PROGRESS', 'PAUSED', 'BLOCKED', 'REOPENED'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task is not in a valid state for starting' }
      });
    }

    const assignment = await TaskAssignment.findOne({
      companyId,
      taskId: id,
      userId: req.user._id,
      status: { $in: ['ASSIGNED', 'ACCEPTED'] }
    });

    if (!assignment) {
      return res.status(403).json({
        success: false,
        error: { code: 'USER_NOT_ASSIGNED', message: 'You are not assigned to this task in this company' }
      });
    }

    const activeSession = await TaskWorkSession.findOne({
      companyId,
      userId: req.user._id,
      status: 'ACTIVE'
    });

    if (activeSession) {
      const activeTask = await Task.findById(activeSession.taskId).select('taskNumber title');
      return res.status(409).json({
        success: false,
        error: {
          code: 'ACTIVE_WORK_SESSION_EXISTS',
          message: `You already have an active task: ${activeTask.taskNumber} — ${activeTask.title}. Stop it before starting another task.`
        }
      });
    }

    const workSession = await TaskWorkSession.create({
      companyId,
      taskId: id,
      userId: req.user._id,
      assignmentId: assignment._id,
      startedAt: new Date(),
      startSource: req.body.startSource || 'WEB'
    });

    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'ACTIVE',
        activatedAt: task.activatedAt || new Date(),
        activatedBy: task.activatedBy || req.user._id
      },
      { new: true }
    );

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'ACTIVE',
      changedBy: req.user._id,
      reason: 'Task started'
    });

    await createTaskAuditLog({
      action: 'TASK_STARTED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: task.status },
      after: { status: 'ACTIVE' },
      metadata: { workSessionId: workSession._id }
    });

    await TaskNotificationService.sendTaskNotification({
      companyId,
      type: 'task_started',
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      targetUserIds: [task.ownerId],
      extraData: { actorName: req.user.name || req.user.email, message: `Task ${task.taskNumber} has been started` }
    });

    res.json({
      success: true,
      data: {
        workSession,
        task: updatedTask
      }
    });
  } catch (error) {
    console.error('Start task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_START_ERROR', message: 'Failed to start task' }
    });
  }
};

export const stopTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    const activeSession = await TaskWorkSession.findOne({
      companyId,
      taskId: id,
      userId: req.user._id,
      status: 'ACTIVE'
    });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_ACTIVE_WORK_SESSION', message: 'No active work session found' }
      });
    }

    activeSession.stoppedAt = new Date();
    activeSession.status = 'STOPPED';
    activeSession.stopSource = req.body.stopSource || 'USER';
    activeSession.stopReason = req.body.stopReason || '';
    activeSession.durationSeconds = Math.floor((new Date(activeSession.stoppedAt) - new Date(activeSession.startedAt)) / 1000);
    await activeSession.save();

    if (task.status === 'ACTIVE') {
      await Task.findByIdAndUpdate(
        id,
        { status: 'PAUSED' },
        { new: true }
      );

      await TaskStatusHistory.create({
        companyId,
        taskId: id,
        fromStatus: 'ACTIVE',
        toStatus: 'PAUSED',
        changedBy: req.user._id,
        reason: 'Task stopped'
      });
    }

    await createTaskAuditLog({
      action: 'TASK_STOPPED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: task.status },
      after: { status: 'PAUSED' },
      metadata: { workSessionId: activeSession._id, durationSeconds: activeSession.durationSeconds }
    });

    await TaskNotificationService.sendTaskNotification({
      companyId,
      type: 'task_stopped',
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      targetUserIds: [task.ownerId],
      extraData: { actorName: req.user.name || req.user.email, message: `Task ${task.taskNumber} has been stopped` }
    });

    res.json({
      success: true,
      data: activeSession
    });
  } catch (error) {
    console.error('Stop task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_STOP_ERROR', message: 'Failed to stop task' }
    });
  }
};

export const resumeTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (!['PAUSED', 'BLOCKED'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task is not in a valid state for resuming' }
      });
    }

    const assignment = await TaskAssignment.findOne({
      companyId,
      taskId: id,
      userId: req.user._id,
      status: { $in: ['ASSIGNED', 'ACCEPTED'] }
    });

    if (!assignment) {
      return res.status(403).json({
        success: false,
        error: { code: 'USER_NOT_ASSIGNED', message: 'You are not assigned to this task' }
      });
    }

    const activeSession = await TaskWorkSession.findOne({
      companyId,
      userId: req.user._id,
      status: 'ACTIVE'
    });

    if (activeSession) {
      const activeTask = await Task.findById(activeSession.taskId).select('taskNumber title');
      return res.status(409).json({
        success: false,
        error: {
          code: 'ACTIVE_WORK_SESSION_EXISTS',
          message: `You already have an active task: ${activeTask.taskNumber} — ${activeTask.title}. Stop it before starting another task.`
        }
      });
    }

    const workSession = await TaskWorkSession.create({
      companyId,
      taskId: id,
      userId: req.user._id,
      assignmentId: assignment._id,
      startedAt: new Date(),
      startSource: req.body.startSource || 'WEB'
    });

    const updatedTask = await Task.findByIdAndUpdate(
      id,
      { status: 'ACTIVE' },
      { new: true }
    );

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'ACTIVE',
      changedBy: req.user._id,
      reason: 'Task resumed'
    });

    await createTaskAuditLog({
      action: 'TASK_RESUMED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: task.status },
      after: { status: 'ACTIVE' },
      metadata: { workSessionId: workSession._id }
    });

    await TaskNotificationService.sendTaskNotification({
      companyId,
      type: 'task_resumed',
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      targetUserIds: [task.ownerId],
      extraData: { actorName: req.user.name || req.user.email, message: `Task ${task.taskNumber} has been resumed` }
    });

    res.json({
      success: true,
      data: {
        workSession,
        task: updatedTask
      }
    });
  } catch (error) {
    console.error('Resume task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_RESUME_ERROR', message: 'Failed to resume task' }
    });
  }
};

export const submitTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { completionComment } = req.body;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (!['IN_PROGRESS', 'PAUSED', 'BLOCKED', 'ACTIVE'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task is not in a valid state for submission' }
      });
    }

    const assignment = await TaskAssignment.findOne({
      companyId,
      taskId: id,
      userId: req.user._id,
      status: { $in: ['ASSIGNED', 'ACCEPTED'] }
    });

    if (!assignment) {
      return res.status(403).json({
        success: false,
        error: { code: 'USER_NOT_ASSIGNED', message: 'You are not assigned to this task' }
      });
    }

    const activeSession = await TaskWorkSession.findOne({
      companyId,
      taskId: id,
      userId: req.user._id,
      status: 'ACTIVE'
    });

    if (activeSession) {
      activeSession.stoppedAt = new Date();
      activeSession.status = 'STOPPED';
      activeSession.stopSource = 'USER';
      activeSession.stopReason = 'Submitted';
      activeSession.durationSeconds = Math.floor((new Date(activeSession.stoppedAt) - new Date(activeSession.startedAt)) / 1000);
      await activeSession.save();
    }

    const allSessions = await TaskWorkSession.find({
      companyId,
      taskId: id,
      status: { $in: ['STOPPED', 'AUTO_STOPPED'] }
    });

    const totalDuration = allSessions.reduce((sum, session) => sum + session.durationSeconds, 0);

    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedBy: req.user._id,
        completedAt: new Date(),
        completedBy: req.user._id,
        actualDurationSeconds: totalDuration,
      },
      { new: true }
    );

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'SUBMITTED',
      changedBy: req.user._id,
      reason: completionComment || 'Task submitted'
    });

    await createTaskAuditLog({
      action: 'TASK_SUBMITTED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: task.status },
      after: { status: 'SUBMITTED' },
      metadata: { completionComment, actualDurationSeconds: totalDuration }
    });

    await TaskNotificationService.notifyTaskSubmitted({
      companyId,
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      submittedByName: req.user.name || req.user.email,
      ownerId: task.ownerId,
    });

    res.json({
      success: true,
      data: updatedTask
    });
  } catch (error) {
    console.error('Submit task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_SUBMIT_ERROR', message: 'Failed to submit task' }
    });
  }
};

export const getWorkSessions = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    const workSessions = await TaskWorkSession.find({ companyId, taskId: id })
      .populate('userId', 'name email')
      .sort({ startedAt: -1 });

    res.json({
      success: true,
      count: workSessions.length,
      data: workSessions
    });
  } catch (error) {
    console.error('Get work sessions error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_WORK_SESSION_ERROR', message: 'Failed to fetch work sessions' }
    });
  }
};

export const getUserWorkTime = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const filter = {
      companyId,
      userId: id,
      status: { $in: ['STOPPED', 'AUTO_STOPPED'] }
    };

    if (Object.keys(dateFilter).length > 0) {
      filter.startedAt = dateFilter;
    }

    const workSessions = await TaskWorkSession.find(filter).sort({ startedAt: -1 });

    const totalDuration = workSessions.reduce((sum, session) => sum + session.durationSeconds, 0);

    const tasksByUser = {};
    for (const session of workSessions) {
      const taskId = session.taskId.toString();
      if (!tasksByUser[taskId]) {
        tasksByUser[taskId] = {
          taskId,
          totalDuration: 0,
          sessions: []
        };
      }
      tasksByUser[taskId].totalDuration += session.durationSeconds;
      tasksByUser[taskId].sessions.push(session);
    }

    res.json({
      success: true,
      data: {
        userId: id,
        companyId,
        totalDurationSeconds: totalDuration,
        totalDurationFormatted: formatDuration(totalDuration),
        tasks: Object.values(tasksByUser),
        sessionCount: workSessions.length
      }
    });
  } catch (error) {
    console.error('Get user work time error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_WORK_TIME_ERROR', message: 'Failed to fetch user work time' }
    });
  }
};

export const correctWorkSession = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { originalStartedAt, originalStoppedAt, correctedStartedAt, correctedStoppedAt, correctionReason } = req.body;

    const workSession = await TaskWorkSession.findOne({ _id: id, companyId });
    if (!workSession) {
      return res.status(404).json({
        success: false,
        error: { code: 'WORK_SESSION_NOT_FOUND', message: 'Work session not found' }
      });
    }

    const user = req.user;
    if (!['super_admin', 'partner', 'admin'].includes(user.type)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to edit work session time' }
      });
    }

    const originalData = {
      startedAt: workSession.startedAt,
      stoppedAt: workSession.stoppedAt,
      durationSeconds: workSession.durationSeconds
    };

    workSession.startedAt = new Date(correctedStartedAt);
    workSession.stoppedAt = new Date(correctedStoppedAt);
    workSession.durationSeconds = Math.floor((new Date(correctedStoppedAt) - new Date(correctedStartedAt)) / 1000);

    workSession.correction = {
      correctedBy: req.user._id,
      correctedAt: new Date(),
      originalData,
      reason: correctionReason
    };

    await workSession.save();

    await createTaskAuditLog({
      action: 'WORK_SESSION_CORRECTED',
      entityType: 'WORK_SESSION',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: originalData,
      after: {
        startedAt: workSession.startedAt,
        stoppedAt: workSession.stoppedAt,
        durationSeconds: workSession.durationSeconds
      },
      prefix: 'work-session',
      metadata: { correctionReason }
    });

    res.json({
      success: true,
      data: workSession
    });
  } catch (error) {
    console.error('Correct work session error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_CORRECTION_ERROR', message: 'Failed to correct work session' }
    });
  }
};

const formatDuration = (seconds) => {
  if (seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};