import Task from '../../models/tasks/taskModel.js';
import TaskInvitation from '../../models/tasks/taskInvitationModel.js';
import TaskAssignment from '../../models/tasks/taskAssignmentModel.js';
import TaskStatusHistory from '../../models/tasks/taskStatusHistoryModel.js';
import User from '../../models/userModel.js';
import Employee from '../../models/Attandance/Employee.js';
import { createTaskAuditLog } from '../../utils/taskAuditHelper.js';
import { resolveCompanyId } from '../../utils/companyResolver.js';
import { TaskNotificationService } from './taskNotification.service.js';

export const inviteUser = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { userId, message } = req.body;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (!['DRAFT', 'INVITED'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'TASK_NOT_INVITABLE', message: 'Task is not in a valid state for invitation' }
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' }
      });
    }

    const employee = await Employee.findOne({ companyId, userId: user._id, employmentStatus: 'active' });
    if (!employee) {
      return res.status(400).json({
        success: false,
        error: { code: 'USER_INACTIVE', message: 'User is inactive or not an employee of this company' }
      });
    }

    const existingInvitation = await TaskInvitation.findOne({
      companyId,
      taskId: id,
      invitedUserId: userId,
      status: 'PENDING'
    });

    if (existingInvitation) {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_INVITATION', message: 'Invitation already pending for this user' }
      });
    }

    const invitation = await TaskInvitation.create({
      companyId,
      taskId: id,
      invitedUserId: userId,
      invitedBy: req.user._id,
      message,
      status: 'PENDING'
    });

    if (task.status === 'DRAFT') {
      await Task.findByIdAndUpdate(
        id,
        { status: 'INVITED' },
        { new: true }
      );
    }

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'INVITED',
      changedBy: req.user._id,
      reason: `Invited ${user.name || user.email}`
    });

    await createTaskAuditLog({
      action: 'TASK_INVITED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: task.status },
      after: { status: 'INVITED' },
      metadata: { invitedUserId: userId }
    });

    await TaskNotificationService.notifyTaskInvited({
      companyId,
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      invitedUserId: userId,
      invitedByName: req.user.name || req.user.email,
      message
    });

    res.json({
      success: true,
      data: invitation
    });
  } catch (error) {
    console.error('Invite user error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_INVITE_ERROR', message: 'Failed to invite user' }
    });
  }
};

export const acceptInvitation = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id, invitationId } = req.params;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    const invitation = await TaskInvitation.findOne({
      _id: invitationId,
      companyId,
      taskId: id,
      invitedUserId: req.user._id,
      status: 'PENDING'
    });

    if (!invitation) {
      return res.status(404).json({
        success: false,
        error: { code: 'INVITATION_NOT_FOUND', message: 'Invitation not found or already processed' }
      });
    }

    invitation.status = 'ACCEPTED';
    invitation.respondedAt = new Date();
    await invitation.save();

    const assignment = await TaskAssignment.create({
      companyId,
      taskId: id,
      userId: req.user._id,
      assignedBy: invitation.invitedBy,
      status: 'ACCEPTED'
    });

    await Task.findByIdAndUpdate(
      id,
      { status: 'ACCEPTED' },
      { new: true }
    );

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'ACCEPTED',
      changedBy: req.user._id,
      reason: 'Invitation accepted'
    });

    await createTaskAuditLog({
      action: 'TASK_INVITATION_ACCEPTED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: task.status },
      after: { status: 'ACCEPTED' },
      metadata: { acceptedBy: req.user._id }
    });

    await TaskNotificationService.notifyInvitationAccepted({
      companyId,
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      acceptedByName: req.user.name || req.user.email,
      ownerId: task.ownerId,
    });

    res.json({
      success: true,
      data: assignment
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_ACCEPT_ERROR', message: 'Failed to accept invitation' }
    });
  }
};

export const rejectInvitation = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id, invitationId } = req.params;
    const { reason } = req.body;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    const invitation = await TaskInvitation.findOne({
      _id: invitationId,
      companyId,
      taskId: id,
      invitedUserId: req.user._id,
      status: 'PENDING'
    });

    if (!invitation) {
      return res.status(404).json({
        success: false,
        error: { code: 'INVITATION_NOT_FOUND', message: 'Invitation not found or already processed' }
      });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Rejection reason is required' }
      });
    }

    invitation.status = 'REJECTED';
    invitation.respondedAt = new Date();
    invitation.rejectionReason = reason;
    await invitation.save();

    const assignment = await TaskAssignment.create({
      companyId,
      taskId: id,
      userId: req.user._id,
      assignedBy: invitation.invitedBy,
      status: 'REJECTED',
      rejectionReason: reason
    });

    await Task.findByIdAndUpdate(
      id,
      { status: 'INVITED' },
      { new: true }
    );

    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'INVITED',
      changedBy: req.user._id,
      reason: 'Invitation rejected'
    });

    await createTaskAuditLog({
      action: 'TASK_INVITATION_REJECTED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: task.status },
      after: { status: 'INVITED' },
      metadata: { rejectedBy: req.user._id, reason }
    });

    await TaskNotificationService.notifyInvitationRejected({
      companyId,
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      rejectedByName: req.user.name || req.user.email,
      reason,
      ownerId: task.ownerId,
    });

    res.json({
      success: true,
      data: assignment
    });
  } catch (error) {
    console.error('Reject invitation error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_REJECT_ERROR', message: 'Failed to reject invitation' }
    });
  }
};