import Task from '../../models/tasks/taskModel.js';
import TaskStatusHistory from '../../models/tasks/taskStatusHistoryModel.js';
import TaskWorkSession from '../../models/tasks/taskWorkSessionModel.js';
import AuditLog from '../../models/AuditLog.js';
import { resolveCompanyId } from '../../utils/companyResolver.js';
import { TaskNotificationService } from './taskNotification.service.js';

export const verifyTask = async (req, res) => {
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

    // Check task is in valid state for verification
    if (task.status !== 'SUBMITTED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be SUBMITTED to verify' }
      });
    }

    // Update task
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy: req.user._id,
      },
      { new: true }
    );

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: 'SUBMITTED',
      toStatus: 'VERIFIED',
      changedBy: req.user._id,
      reason: 'Task verified'
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-VERIFIED-${id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_VERIFIED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      oldData: { status: 'SUBMITTED' },
      newData: { status: 'VERIFIED' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { verifiedBy: req.user._id }
    });

    // Send notification
    await TaskNotificationService.notifyTaskVerified({
      companyId,
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      verifiedByName: req.user.name || req.user.email,
      ownerId: task.ownerId,
      assigneeIds: task.assignedUsers || [],
    });

    res.json({
      success: true,
      data: updatedTask
    });
  } catch (error) {
    console.error('Verify task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_VERIFY_ERROR', message: 'Failed to verify task' }
    });
  }
};

export const rejectTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { reason } = req.body;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Check task is in valid state for rejection
    if (task.status !== 'SUBMITTED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be SUBMITTED to reject' }
      });
    }

    // Check if reason is provided
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Rejection reason is required' }
      });
    }

    // Update task
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'REJECTED',
      },
      { new: true }
    );

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: 'SUBMITTED',
      toStatus: 'REJECTED',
      changedBy: req.user._id,
      reason: reason
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-REJECTED-${id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_REJECTED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      oldData: { status: 'SUBMITTED' },
      newData: { status: 'REJECTED' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { rejectionReason: reason }
    });

    // Send notification
    await TaskNotificationService.notifyTaskRejected({
      companyId,
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      rejectedByName: req.user.name || req.user.email,
      reason,
      assigneeIds: task.assignedUsers || [],
      ownerId: task.ownerId,
    });

    res.json({
      success: true,
      data: updatedTask
    });
  } catch (error) {
    console.error('Reject task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_REJECT_ERROR', message: 'Failed to reject task' }
    });
  }
};

export const reopenTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { reason } = req.body;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Check task is in valid state for reopening
    if (task.status !== 'CLOSED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be CLOSED to reopen' }
      });
    }

    // Check if reason is provided
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Reopen reason is required' }
      });
    }

    // Update task
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'REOPENED',
        closedAt: null,
        closedBy: null,
      },
      { new: true }
    );

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: 'CLOSED',
      toStatus: 'REOPENED',
      changedBy: req.user._id,
      reason: reason
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-REOPENED-${id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_REOPENED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      oldData: { status: 'CLOSED' },
      newData: { status: 'REOPENED' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { reopenReason: reason }
    });

    // Send notification
    await TaskNotificationService.notifyTaskReopened({
      companyId,
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      reopenedByName: req.user.name || req.user.email,
      assigneeIds: task.assignedUsers || [],
    });

    res.json({
      success: true,
      data: updatedTask
    });
  } catch (error) {
    console.error('Reopen task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_REOPEN_ERROR', message: 'Failed to reopen task' }
    });
  }
};

export const closeTask = async (req, res) => {
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

    // Check task is in valid state for closing
    if (task.status !== 'VERIFIED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be VERIFIED to close' }
      });
    }

    // Update task
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy: req.user._id,
      },
      { new: true }
    );

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: 'VERIFIED',
      toStatus: 'CLOSED',
      changedBy: req.user._id,
      reason: 'Task closed'
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-CLOSED-${id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_CLOSED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      oldData: { status: 'VERIFIED' },
      newData: { status: 'CLOSED' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { closedBy: req.user._id }
    });

    // Send notification
    await TaskNotificationService.notifyTaskClosed({
      companyId,
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      closedByName: req.user.name || req.user.email,
      ownerId: task.ownerId,
      assigneeIds: task.assignedUsers || [],
    });

    res.json({
      success: true,
      data: updatedTask
    });
  } catch (error) {
    console.error('Close task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_CLOSE_ERROR', message: 'Failed to close task' }
    });
  }
};

export const activateTask = async (req, res) => {
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

    // Check task is in valid state for activation
    if (task.status !== 'DEACTIVATED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be DEACTIVATED to activate' }
      });
    }

    // Update task
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'ACTIVE',
        activatedAt: new Date(),
        activatedBy: req.user._id,
        deletedAt: null,
        deletedBy: null,
      },
      { new: true }
    );

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: 'DEACTIVATED',
      toStatus: 'ACTIVE',
      changedBy: req.user._id,
      reason: 'Task activated'
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-ACTIVATED-${id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_ACTIVATED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      oldData: { status: 'DEACTIVATED' },
      newData: { status: 'ACTIVE' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { activatedBy: req.user._id }
    });

    res.json({
      success: true,
      data: updatedTask
    });
  } catch (error) {
    console.error('Activate task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_ACTIVATE_ERROR', message: 'Failed to activate task' }
    });
  }
};

export const deactivateTask = async (req, res) => {
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

    // Check task is in valid state for deactivation
    if (!['ACTIVE', 'IN_PROGRESS', 'PAUSED'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be ACTIVE/IN_PROGRESS/PAUSED to deactivate' }
      });
    }

    // Update task
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'DEACTIVATED',
        deactivatedAt: new Date(),
        deactivatedBy: req.user._id,
      },
      { new: true }
    );

    // Stop any active work sessions in this company
    await TaskWorkSession.updateMany(
      { companyId, taskId: id, status: 'ACTIVE' },
      { 
        status: 'AUTO_STOPPED',
        stoppedAt: new Date(),
        stopSource: 'SYSTEM',
        stopReason: 'Task deactivated'
      }
    );

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'DEACTIVATED',
      changedBy: req.user._id,
      reason: 'Task deactivated'
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-DEACTIVATED-${id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_DEACTIVATED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      oldData: { status: task.status },
      newData: { status: 'DEACTIVATED' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { deactivatedBy: req.user._id }
    });

    res.json({
      success: true,
      data: updatedTask
    });
  } catch (error) {
    console.error('Deactivate task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_DEACTIVATE_ERROR', message: 'Failed to deactivate task' }
    });
  }
};

export const cancelTask = async (req, res) => {
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

    // Check task is in valid state for cancellation
    if (['CLOSED', 'CANCELLED'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task cannot be cancelled in current state' }
      });
    }

    // Update task
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'CANCELLED',
      },
      { new: true }
    );

    // Stop any active work sessions in this company
    await TaskWorkSession.updateMany(
      { companyId, taskId: id, status: 'ACTIVE' },
      { 
        status: 'AUTO_STOPPED',
        stoppedAt: new Date(),
        stopSource: 'SYSTEM',
        stopReason: 'Task cancelled'
      }
    );

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'CANCELLED',
      changedBy: req.user._id,
      reason: 'Task cancelled'
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-CANCELLED-${id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_CANCELLED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      oldData: { status: task.status },
      newData: { status: 'CANCELLED' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { cancelledBy: req.user._id }
    });

    res.json({
      success: true,
      data: updatedTask
    });
  } catch (error) {
    console.error('Cancel task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_CANCEL_ERROR', message: 'Failed to cancel task' }
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