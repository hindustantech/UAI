import Task from '../../models/tasks/taskModel.js';
import TaskAssignment from '../../models/tasks/taskAssignmentModel.js';
import TaskStatusHistory from '../../models/tasks/taskStatusHistoryModel.js';
import User from '../../models/userModel.js';
import Employee from '../../models/Attandance/Employee.js';
import AuditLog from '../../models/AuditLog.js';
import { resolveCompanyId } from '../../utils/companyResolver.js';
import { TaskNotificationService } from './taskNotification.service.js';

export const assignTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { userId, status = 'ASSIGNED' } = req.body;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Check task is in valid state for assignment
    if (!['DRAFT', 'ASSIGNED'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'TASK_NOT_ASSIGNABLE', message: 'Task is not in a valid state for assignment' }
      });
    }

    // Check if user exists and is active
    const user = await User.findById(userId).select('type companyId');
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' }
      });
    }

    // Check if employee exists and is active in same company
    const employee = await Employee.findOne({ companyId, userId: user._id, employmentStatus: 'active' });
    if (!employee) {
      return res.status(400).json({
        success: false,
        error: { code: 'USER_INACTIVE', message: 'User is inactive or not an employee of this company' }
      });
    }

    // Check if assignment already exists for this user+task in this company
    const existingAssignment = await TaskAssignment.findOne({
      companyId,
      taskId: id,
      userId: user._id,
      status: { $in: ['INVITED', 'ASSIGNED', 'ACCEPTED'] }
    });

    if (existingAssignment) {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_ASSIGNMENT', message: 'User already has an assignment for this task in this company' }
      });
    }

    // Create assignment
    const assignment = await TaskAssignment.create({
      companyId,
      taskId: id,
      userId,
      assignedBy: req.user._id,
      assignedAt: new Date(),
      status
    });

    // Update task status to ASSIGNED if it's DRAFT
    if (task.status === 'DRAFT') {
      await Task.findByIdAndUpdate(
        id,
        { status: 'ASSIGNED' },
        { new: true }
      );
    }

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: 'ASSIGNED',
      changedBy: req.user._id,
      reason: `Assigned to ${user.name || user.email} in ${req.user.companyId ? 'this company' : 'global'}`
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-ASSIGNED-${id}-${userId}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_ASSIGNED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      before: { status: task.status },
      after: { status: 'ASSIGNED' },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { assignedTo: userId }
    });

    // Send notification
    await TaskNotificationService.notifyTaskAssigned({
      companyId,
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      assigneeId: userId,
      assignedByName: req.user.name || req.user.email
    });

    res.json({
      success: true,
      data: assignment
    });
  } catch (error) {
    console.error('Assign task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_ASSIGN_ERROR', message: 'Failed to assign task' }
    });
  }
};

export const reassignTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { oldUserId, newUserId } = req.body;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Find existing assignment
    const existingAssignment = await TaskAssignment.findOne({
      companyId,
      taskId: id,
      userId: oldUserId,
      status: { $in: ['ASSIGNED', 'ACCEPTED'] }
    });

    if (!existingAssignment) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_ASSIGNABLE', message: 'User not found in task assignments for this company' }
      });
    }

    // Check if new user exists and is active
    const newUser = await User.findById(newUserId);
    if (!newUser) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'New user not found' }
      });
    }

    const newEmployee = await Employee.findOne({ companyId, userId: newUser._id, employmentStatus: 'active' });
    if (!newEmployee) {
      return res.status(400).json({
        success: false,
        error: { code: 'USER_INACTIVE', message: 'New user is inactive' }
      });
    }

    // Update old assignment status
    existingAssignment.status = 'REMOVED';
    await existingAssignment.save();

    // Create new assignment
    const newAssignment = await TaskAssignment.create({
      companyId,
      taskId: id,
      userId: newUserId,
      assignedBy: req.user._id,
      status: 'ASSIGNED'
    });

    // Update task assignedUsers
    task.assignedUsers = task.assignedUsers.filter(u => !u.equals(oldUserId));
    task.assignedUsers.push(newUserId);
    await task.save();

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: task.status,
      changedBy: req.user._id,
      reason: `Reassigned from ${oldUserId} to ${newUserId} in this company`
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-REASSIGNED-${id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_REASSIGNED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      before: { assignedUsers: task.assignedUsers },
      after: { assignedUsers: [...task.assignedUsers, newUserId] },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { oldUserId, newUserId }
    });

    // Send notification
    await TaskNotificationService.sendTaskNotification({
      companyId,
      type: 'task_reassigned', // Not in notification types - would need to add
      taskId: id,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      targetUserIds: [newUserId],
      extraData: { actorName: req.user.name, message: `Task ${task.taskNumber} has been reassigned from ${oldUserId} to ${newUserId}` }
    });

    res.json({
      success: true,
      data: newAssignment
    });
  } catch (error) {
    console.error('Reassign task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_REASSIGN_ERROR', message: 'Failed to reassign task' }
    });
  }
};

export const removeAssignee = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id, userId } = req.params;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Find existing assignment
    const existingAssignment = await TaskAssignment.findOne({
      companyId,
      taskId: id,
      userId,
      status: { $in: ['ASSIGNED', 'ACCEPTED'] }
    });

    if (!existingAssignment) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_ASSIGNABLE', message: 'User not found in task assignments for this company' }
      });
    }

    // Update assignment status
    existingAssignment.status = 'REMOVED';
    await existingAssignment.save();

    // Update task assignedUsers
    task.assignedUsers = task.assignedUsers.filter(u => !u.equals(userId));
    await task.save();

    // Create status history
    await TaskStatusHistory.create({
      companyId,
      taskId: id,
      fromStatus: task.status,
      toStatus: task.status,
      changedBy: req.user._id,
      reason: 'Removed from task'
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-REMOVED-${id}-${userId}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_REMOVED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      before: { assignedUsers: task.assignedUsers },
      after: { assignedUsers: task.assignedUsers.filter(u => !u.equals(userId)) },
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { removedUserId: userId }
    });

    res.json({
      success: true,
      data: existingAssignment
    });
  } catch (error) {
    console.error('Remove assignee error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_REMOVE_ERROR', message: 'Failed to remove assignee' }
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