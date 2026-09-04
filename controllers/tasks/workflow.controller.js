import Task from '../../models/tasks/taskModel.js';
import TaskStatusHistory from '../../models/tasks/taskStatusHistoryModel.js';
import TaskWorkSession from '../../models/tasks/taskWorkSessionModel.js';
import { createTaskAuditLog } from '../../utils/taskAuditHelper.js';
import { resolveCompanyId } from '../../utils/companyResolver.js';
import { TaskNotificationService } from './taskNotification.service.js';

export const verifyTask = async (req, res) => {
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

    if (task.status !== 'SUBMITTED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be SUBMITTED to verify' }
      });
    }

    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy: req.user._id,
      },
      { new: true }
    );

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: 'SUBMITTED',
      toStatus: 'VERIFIED',
      changedBy: req.user._id,
      reason: 'Task verified'
    });

    await createTaskAuditLog({
      action: 'TASK_VERIFIED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: 'SUBMITTED' },
      after: { status: 'VERIFIED' },
      metadata: { verifiedBy: req.user._id }
    });

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

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (task.status !== 'SUBMITTED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be SUBMITTED to reject' }
      });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Rejection reason is required' }
      });
    }

    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'REJECTED',
      },
      { new: true }
    );

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: 'SUBMITTED',
      toStatus: 'REJECTED',
      changedBy: req.user._id,
      reason: reason
    });

    await createTaskAuditLog({
      action: 'TASK_REJECTED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: 'SUBMITTED' },
      after: { status: 'REJECTED' },
      metadata: { rejectionReason: reason }
    });

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

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (task.status !== 'CLOSED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be CLOSED to reopen' }
      });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Reopen reason is required' }
      });
    }

    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'REOPENED',
        closedAt: null,
        closedBy: null,
      },
      { new: true }
    );

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: 'CLOSED',
      toStatus: 'REOPENED',
      changedBy: req.user._id,
      reason: reason
    });

    await createTaskAuditLog({
      action: 'TASK_REOPENED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: 'CLOSED' },
      after: { status: 'REOPENED' },
      metadata: { reopenReason: reason }
    });

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

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (task.status !== 'VERIFIED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be VERIFIED to close' }
      });
    }

    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy: req.user._id,
      },
      { new: true }
    );

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: 'VERIFIED',
      toStatus: 'CLOSED',
      changedBy: req.user._id,
      reason: 'Task closed'
    });

    await createTaskAuditLog({
      action: 'TASK_CLOSED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: 'VERIFIED' },
      after: { status: 'CLOSED' },
      metadata: { closedBy: req.user._id }
    });

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

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (task.status !== 'DEACTIVATED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be DEACTIVATED to activate' }
      });
    }

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

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: 'DEACTIVATED',
      toStatus: 'ACTIVE',
      changedBy: req.user._id,
      reason: 'Task activated'
    });

    await createTaskAuditLog({
      action: 'TASK_ACTIVATED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: 'DEACTIVATED' },
      after: { status: 'ACTIVE' },
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

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (!['ACTIVE', 'IN_PROGRESS', 'PAUSED'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task must be ACTIVE/IN_PROGRESS/PAUSED to deactivate' }
      });
    }

    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'DEACTIVATED',
        deactivatedAt: new Date(),
        deactivatedBy: req.user._id,
      },
      { new: true }
    );

    await TaskWorkSession.updateMany(
      { companyId, taskId: id, status: 'ACTIVE' },
      {
        status: 'AUTO_STOPPED',
        stoppedAt: new Date(),
        stopSource: 'SYSTEM',
        stopReason: 'Task deactivated'
      }
    );

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'DEACTIVATED',
      changedBy: req.user._id,
      reason: 'Task deactivated'
    });

    await createTaskAuditLog({
      action: 'TASK_DEACTIVATED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: task.status },
      after: { status: 'DEACTIVATED' },
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

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (['CLOSED', 'CANCELLED'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: 'Task cannot be cancelled in current state' }
      });
    }

    const updatedTask = await Task.findByIdAndUpdate(
      id,
      {
        status: 'CANCELLED',
      },
      { new: true }
    );

    await TaskWorkSession.updateMany(
      { companyId, taskId: id, status: 'ACTIVE' },
      {
        status: 'AUTO_STOPPED',
        stoppedAt: new Date(),
        stopSource: 'SYSTEM',
        stopReason: 'Task cancelled'
      }
    );

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'CANCELLED',
      changedBy: req.user._id,
      reason: 'Task cancelled'
    });

    await createTaskAuditLog({
      action: 'TASK_CANCELLED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: task.status },
      after: { status: 'CANCELLED' },
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