import Task from '../../models/tasks/taskModel.js';
import TaskAssignment from '../../models/tasks/taskAssignmentModel.js';
import TaskStatusHistory from '../../models/tasks/taskStatusHistoryModel.js';
import User from '../../models/userModel.js';
import Employee from '../../models/Attandance/Employee.js';
import { createTaskAuditLog } from '../../utils/taskAuditHelper.js';
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

    // Check if assignment already exists for this user+task in this company (any status)
    const existingAssignment = await TaskAssignment.findOne({
      companyId,
      taskId: id,
      userId: user._id
    });

    // If existing assignment is REMOVED, reactivate it instead of creating new
    if (existingAssignment && existingAssignment.status === 'REMOVED') {
      existingAssignment.status = 'ASSIGNED';
      existingAssignment.assignedAt = new Date();
      existingAssignment.assignedBy = req.user._id;
      await existingAssignment.save();

      // Update task.assignedUsers if user is not already in the list
      if (!task.assignedUsers.some(u => u.equals(user._id))) {
        task.assignedUsers.push(user._id);
        await task.save();
      }

      // Create status history
      await TaskStatusHistory.create({
        companyId,
        taskId: id,
        fromStatus: 'REMOVED',
        toStatus: 'ASSIGNED',
        changedBy: req.user._id,
        reason: `Reassigned to ${user.name || user.email}`
      });

      // Create audit log
      await createTaskAuditLog({
        action: 'TASK_ASSIGNED',
        entityType: 'TASK',
        entityId: id,
        actorId: req.user._id,
        companyId,
        before: { status: 'REMOVED' },
        after: { status: 'ASSIGNED' },
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
        data: existingAssignment
      });
      return;
    }

    // If existing assignment is active (INVITED/ASSIGNED/ACCEPTED), it's a duplicate
    if (existingAssignment && ['INVITED', 'ASSIGNED', 'ACCEPTED'].includes(existingAssignment.status)) {
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
    await createTaskAuditLog({
      action: 'TASK_ASSIGNED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { status: task.status },
      after: { status: 'ASSIGNED' },
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

    // Check if new user already has a REMOVED assignment for this task (reactivate instead of creating new)
    const newUserExistingAssignment = await TaskAssignment.findOne({
      companyId,
      taskId: id,
      userId: newUserId
    });

    if (newUserExistingAssignment && newUserExistingAssignment.status === 'REMOVED') {
      // Reactivate the existing REMOVED assignment
      newUserExistingAssignment.status = 'ASSIGNED';
      newUserExistingAssignment.assignedAt = new Date();
      newUserExistingAssignment.assignedBy = req.user._id;
      await newUserExistingAssignment.save();

      // Update task.assignedUsers: remove old user, add new user (reactivated)
      task.assignedUsers = task.assignedUsers.filter(u => !u.equals(oldUserId));
      if (!task.assignedUsers.some(u => u.equals(newUserId))) {
        task.assignedUsers.push(newUserId);
      }
      await task.save();

      res.json({
        success: true,
        data: newUserExistingAssignment
      });
      return;
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
    await createTaskAuditLog({
      action: 'TASK_REASSIGNED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { assignedUsers: task.assignedUsers },
      after: { assignedUsers: [...task.assignedUsers, newUserId] },
      metadata: { oldUserId, newUserId }
    });

    // Send notification
    await TaskNotificationService.sendTaskNotification({
      companyId,
      type: 'task_reassigned',
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

export const getTaskAssignments = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const {
      page = 1,
      limit = 50,
      status,
      search,
      assignedFrom,
      assignedTo
    } = req.query;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId })
      .populate('createdBy', 'name email')
      .populate('ownerId', 'name email');
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Build filter
    const filter = { companyId, taskId: id };
    if (status) filter.status = status;
    if (assignedFrom || assignedTo) {
      filter.assignedAt = {};
      if (assignedFrom) filter.assignedAt.$gte = new Date(assignedFrom);
      if (assignedTo) filter.assignedAt.$lte = new Date(assignedTo);
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Search filter on populated userId (name/email)
    const userMatch = search
      ? { name: { $regex: search, $options: 'i' } }
      : undefined;

    const [assignments, total] = await Promise.all([
      TaskAssignment.find(filter)
        .populate({ path: 'userId', match: userMatch, select: 'name email employeeId' })
        .populate('assignedBy', 'name email')
        .sort({ assignedAt: -1 })
        .skip(skip)
        .limit(limitNum),
      TaskAssignment.countDocuments(filter)
    ]);

    // Filter out null userId when search is active (populate match returns null for non-matches)
    const filteredAssignments = search
      ? assignments.filter(a => a.userId !== null)
      : assignments;

    res.json({
      success: true,
      count: filteredAssignments.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: {
        task: {
          _id: task._id,
          taskNumber: task.taskNumber,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          createdBy: task.createdBy,
          ownerId: task.ownerId,
          assignedUsers: task.assignedUsers,
          startDate: task.startDate,
          createdAt: task.createdAt
        },
        assignments: filteredAssignments
      }
    });
  } catch (error) {
    console.error('Get task assignments error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_ASSIGN_ERROR', message: 'Failed to get assignments' }
    });
  }
};

export const getMyAssignments = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const {
      page = 1,
      limit = 20,
      status,
      search
    } = req.query;

    const filter = { companyId, userId: req.user._id };
    if (status) filter.status = status;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    let taskFilter = { companyId };
    if (search) {
      taskFilter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { taskNumber: { $regex: search, $options: 'i' } }
      ];
    }
    const matchingTasks = await Task.find(taskFilter).select('_id').lean();
    const taskIds = matchingTasks.map(t => t._id);
    filter.taskId = { $in: taskIds };

    const [assignments, total] = await Promise.all([
      TaskAssignment.find(filter)
        .populate('taskId', 'title taskNumber status priority dueDate startDate')
        .populate('assignedBy', 'name email')
        .sort({ assignedAt: -1 })
        .skip(skip)
        .limit(limitNum),
      TaskAssignment.countDocuments(filter)
    ]);

    res.json({
      success: true,
      count: assignments.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: assignments
    });
  } catch (error) {
    console.error('Get my assignments error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_FETCH_ERROR', message: 'Failed to fetch assignments' }
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
    await createTaskAuditLog({
      action: 'TASK_REMOVED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
      before: { assignedUsers: task.assignedUsers },
      after: { assignedUsers: task.assignedUsers.filter(u => !u.equals(userId)) },
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