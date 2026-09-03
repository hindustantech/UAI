import Task from '../../models/tasks/taskModel.js';
import TaskAssignment from '../../models/tasks/taskAssignmentModel.js';
import TaskWorkSession from '../../models/tasks/taskWorkSessionModel.js';
import TaskStatusHistory from '../../models/tasks/taskStatusHistoryModel.js';
import User from '../../models/userModel.js';
import AuditLog from '../../models/AuditLog.js';
import moment from 'moment';
import { resolveCompanyId } from '../../utils/companyResolver.js';
import { TaskNotificationService } from './taskNotification.service.js';

export const startTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Check task is in valid state for starting
    if (!['ACCEPTED', 'ACTIVE', 'IN_PROGRESS', 'PAUSED', 'BLOCKED', 'REOPENED'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task is not in a valid state for starting' }
      });
    }

    // Check if user is assigned to this task in this company
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

    // Check if user already has an active work session (one active task rule)
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

    // Create work session
    const workSession = await TaskWorkSession.create({
      companyId,
      taskId: id,
      userId: req.user._id,
      assignmentId: assignment._id,
      startedAt: new Date(),
      startSource: req.body.startSource || 'WEB'
    });

    // Update task status to ACTIVE
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      { 
        status: 'ACTIVE',
        activatedAt: task.activatedAt || new Date(),
        activatedBy: task.activatedBy || req.user._id
      },
      { new: true }
    );

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'ACTIVE',
      changedBy: req.user._id,
      reason: 'Task started'
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-STARTED-${id}-${req.user._id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_STARTED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      before: { status: task.status },
      after: { status: 'ACTIVE' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { workSessionId: workSession._id }
    });

    // Send notification
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

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Find active work session
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

    // Stop the session
    activeSession.stoppedAt = new Date();
    activeSession.status = 'STOPPED';
    activeSession.stopSource = req.body.stopSource || 'USER';
    activeSession.stopReason = req.body.stopReason || '';
    activeSession.durationSeconds = Math.floor((new Date(activeSession.stoppedAt) - new Date(activeSession.startedAt)) / 1000);
    await activeSession.save();

    // Update task status to PAUSED (if task was ACTIVE)
    if (task.status === 'ACTIVE') {
      await Task.findByIdAndUpdate(
        id,
        { status: 'PAUSED' },
        { new: true }
      );

      // Create status history
      await TaskStatusHistory.create({
        companyId,
        taskId: id,
        fromStatus: 'ACTIVE',
        toStatus: 'PAUSED',
        changedBy: req.user._id,
        reason: 'Task stopped'
      });
    }

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-STOPPED-${id}-${req.user._id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_STOPPED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      before: { status: task.status },
      after: { status: 'PAUSED' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { workSessionId: activeSession._id, durationSeconds: activeSession.durationSeconds }
    });

    // Send notification
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

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Check task is in valid state for resuming
    if (!['PAUSED', 'BLOCKED'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task is not in a valid state for resuming' }
      });
    }

    // Check if user is assigned to this task
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

    // Check if user already has an active work session (one active task rule)
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

    // Create new work session (don't modify previous)
    const workSession = await TaskWorkSession.create({
      companyId,
      taskId: id,
      userId: req.user._id,
      assignmentId: assignment._id,
      startedAt: new Date(),
      startSource: req.body.startSource || 'WEB'
    });

    // Update task status to ACTIVE
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      { status: 'ACTIVE' },
      { new: true }
    );

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'ACTIVE',
      changedBy: req.user._id,
      reason: 'Task resumed'
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-RESUMED-${id}-${req.user._id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_RESUMED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      before: { status: task.status },
      after: { status: 'ACTIVE' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { workSessionId: workSession._id }
    });

    // Send notification
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

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Check task is in valid state for submission
    if (!['IN_PROGRESS', 'PAUSED', 'BLOCKED', 'ACTIVE'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task is not in a valid state for submission' }
      });
    }

    // Check if user is assigned to this task
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

    // Find and stop any active work session
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

    // Calculate actual duration from all valid sessions
    const allSessions = await TaskWorkSession.find({
      companyId,
      taskId: id,
      status: { $in: ['STOPPED', 'AUTO_STOPPED'] }
    });
    
    const totalDuration = allSessions.reduce((sum, session) => sum + session.durationSeconds, 0);

    // Update task
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

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'SUBMITTED',
      changedBy: req.user._id,
      reason: completionComment || 'Task submitted'
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-SUBMITTED-${id}-${req.user._id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_SUBMITTED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      before: { status: task.status },
      after: { status: 'SUBMITTED' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { completionComment, actualDurationSeconds: totalDuration }
    });

    // Send notification to manager/verifier
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

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Get work sessions for this company and task
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

    // Build date filter
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

    // Get all completed work sessions for user in this company
    const workSessions = await TaskWorkSession.find(filter).sort({ startedAt: -1 });

    // Calculate total time
    const totalDuration = workSessions.reduce((sum, session) => sum + session.durationSeconds, 0);

    // Group by task
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

    // Find work session in this company
    const workSession = await TaskWorkSession.findOne({ _id: id, companyId });
    if (!workSession) {
      return res.status(404).json({
        success: false,
        error: { code: 'WORK_SESSION_NOT_FOUND', message: 'Work session not found' }
      });
    }

    // Check if user has permission to edit time (should be admin/manager)
    const user = req.user;
    if (!['super_admin', 'partner', 'admin'].includes(user.type)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to edit work session time' }
      });
    }

    // Store original values
    const originalData = {
      startedAt: workSession.startedAt,
      stoppedAt: workSession.stoppedAt,
      durationSeconds: workSession.durationSeconds
    };

    // Apply correction
    workSession.startedAt = new Date(correctedStartedAt);
    workSession.stoppedAt = new Date(correctedStoppedAt);
    workSession.durationSeconds = Math.floor((new Date(correctedStoppedAt) - new Date(correctedStartedAt)) / 1000);

    // Add correction metadata
    workSession.correction = {
      correctedBy: req.user._id,
      correctedAt: new Date(),
      originalData,
      reason: correctionReason
    };

    await workSession.save();

    // Create audit log
    await AuditLog.create({
      eventId: `WORK-SESSION-CORRECTED-${id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'WORK_SESSION_CORRECTED',
      entityType: 'WORK_SESSION',
      entityId: id,
      companyId,
      oldData: originalData,
      newData: {
        startedAt: workSession.startedAt,
        stoppedAt: workSession.stoppedAt,
        durationSeconds: workSession.durationSeconds
      },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `work-session-${id}`,
      seq: 0,
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

const getNextAuditSeq = async (entityId) => {
  try {
    const lastSeq = await AuditLog.findOne({ chainScope: `task-${entityId}` })
      .sort({ seq: -1 })
      .select('seq');
    return (lastSeq && lastSeq.seq) || 0;
  } catch (error) {
    return 0;
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