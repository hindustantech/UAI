import Task from '../../models/tasks/taskModel.js';
import TaskAssignment from '../../models/tasks/taskAssignmentModel.js';
import TaskInvitation from '../../models/tasks/taskInvitationModel.js';
import TaskWorkSession from '../../models/tasks/taskWorkSessionModel.js';
import TaskStatusHistory from '../../models/tasks/taskStatusHistoryModel.js';
import TaskComment from '../../models/tasks/taskCommentModel.js';
import TaskAttachment from '../../models/tasks/taskAttachmentModel.js';
import User from '../../models/userModel.js';
import Employee from '../../models/Attandance/Employee.js';
import AuditLog from '../../models/AuditLog.js';
import moment from 'moment';
import { resolveCompanyId } from '../../utils/companyResolver.js';
import { TaskNotificationService } from './taskNotification.service.js';

export const getTasks = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { status, priority, department, assignee, owner, dueDateStart, dueDateEnd, search, page = 1, limit = 50 } = req.query;

    let filter = { companyId };

    // Filter by status
    if (status) {
      filter.status = status;
    }

    // Filter by priority
    if (priority) {
      filter.priority = priority;
    }

    // Filter by department
    if (department) {
      filter.departmentId = department;
    }

    // Filter by owner
    if (owner) {
      filter.ownerId = owner;
    }

    // Filter by assignee
    if (assignee) {
      filter.assignedUsers = assignee;
    }

    // Filter by date range
    if (dueDateStart || dueDateEnd) {
      filter.dueDate = {};
      if (dueDateStart) filter.dueDate.$gte = new Date(dueDateStart);
      if (dueDateEnd) filter.dueDate.$lte = new Date(dueDateEnd);
    }

    // Search by title or taskNumber
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { taskNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Exclude deleted tasks unless user is super_admin
    const user = req.user;
    if (user.type !== 'super_admin' && user.type !== 'partner') {
      filter.deletedAt = { $exists: false };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate('createdBy', 'name email')
        .populate('ownerId', 'name email')
        .populate('departmentId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Task.countDocuments(filter)
    ]);

    res.json({
      success: true,
      count: tasks.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: tasks
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_FETCH_ERROR', message: 'Failed to fetch tasks' }
    });
  }
};

export const getTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const task = await Task.findOne({ _id: req.params.id, companyId })
      .populate('createdBy', 'name email')
      .populate('ownerId', 'name email')
      .populate('departmentId', 'name')
      .populate('assignedUsers', 'name email');

    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Check if user has permission to view this task
    const user = req.user;
    if (user.type !== 'super_admin' && user.type !== 'partner') {
      // Check if user is assigned, owner, or has view permission
      const isOwner = task.ownerId._id.equals(user._id);
      const isAssigned = task.assignedUsers.some(
        u => u._id.equals(user._id)
      );
      const isCreatedBy = task.createdBy._id.equals(user._id);

      if (!isOwner && !isAssigned && !isCreatedBy) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not have permission to view this task' }
        });
      }
    }

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_FETCH_ERROR', message: 'Failed to fetch task' }
    });
  }
};

export const createTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { title, description,  priority, startDate, dueDate, estimatedDurationSeconds, assignedUsers } = req.body;

    // Validate required fields
    if (!title) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Title is required' }
      });
    }

    // Validate assigned users belong to same company
    if (assignedUsers && assignedUsers.length > 0) {
      const employees = await Employee.find({
        companyId,
        userId: { $in: assignedUsers },
        employmentStatus: 'active'
      });

      if (employees.length !== assignedUsers.length) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Some assigned users are not active employees in this company' }
        });
      }
    }

    // Create task
    const task = await Task.create({
      companyId,
      title,
      description,
      priority: priority || 'MEDIUM',
      startDate: startDate || new Date(),
      dueDate,
      estimatedDurationSeconds: estimatedDurationSeconds || 0,
      createdBy: req.user._id,
      ownerId: req.user._id,
      assignedUsers: assignedUsers || [],
      status: assignedUsers && assignedUsers.length > 0 ? 'ASSIGNED' : 'DRAFT'
    });

    // Create assignments
    if (assignedUsers && assignedUsers.length > 0) {
      const assignments = assignedUsers.map(userId => ({
        companyId,
        taskId: task._id,
        userId,
        assignedBy: req.user._id,
        status: 'ASSIGNED'
      }));
      await TaskAssignment.insertMany(assignments);

      // Create status history
      await TaskStatusHistory.create({
        companyId,
        taskId: task._id,
        fromStatus: 'DRAFT',
        toStatus: 'ASSIGNED',
        changedBy: req.user._id,
        reason: 'Task created with assignments'
      });

      // Send notifications
      await TaskNotificationService.notifyTaskAssigned({
        companyId,
        taskId: task._id,
        taskNumber: task.taskNumber,
        taskTitle: task.title,
        assigneeId: assignedUsers[0], // primary assignee
        assignedByName: req.user.name || req.user.email
      });
    }

    // Create audit log
    await createAuditLog({
      action: 'TASK_CREATED',
      entityType: 'TASK',
      entityId: task._id,
      actorId: req.user._id,
      companyId,
      after: { status: task.status, title: task.title },
      metadata: { taskNumber: task.taskNumber }
    });

    res.status(201).json({
      success: true,
      data: task
    });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_CREATE_ERROR', message: 'Failed to create task' }
    });
  }
};

export const updateTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { version } = req.body;

    // Find current task
    const currentTask = await Task.findOne({ _id: id, companyId });
    if (!currentTask) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Check for version conflict (optimistic locking)
    if (version !== undefined && currentTask.version !== version) {
      return res.status(409).json({
        success: false,
        error: { code: 'TASK_VERSION_CONFLICT', message: 'Task was modified by another user' }
      });
    }

    // Prevent status changes on closed tasks unless reopening
    if (currentTask.status === 'CLOSED' && req.body.status !== 'REOPENED') {
      return res.status(400).json({
        success: false,
        error: { code: 'TASK_ALREADY_CLOSED', message: 'Cannot update a closed task' }
      });
    }

    // Update task
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      { ...req.body, version: currentTask.version + 1 },
      { new: true, runValidators: true }
    );

    // Create audit log
    await createAuditLog({
      action: 'TASK_UPDATED',
      entityType: 'TASK',
      entityId: updatedTask._id,
      actorId: req.user._id,
      companyId,
      before: { status: currentTask.status },
      after: { status: updatedTask.status },
      metadata: { field: 'status', changedBy: req.user._id }
    });

    // Create status history if status changed
    if (req.body.status && req.body.status !== currentTask.status) {
      await TaskStatusHistory.create({
        companyId,
        taskId: updatedTask._id,
        fromStatus: currentTask.status,
        toStatus: req.body.status,
        changedBy: req.user._id,
        reason: req.body.statusChangeReason || 'Status changed'
      });
    }

    res.json({
      success: true,
      data: updatedTask
    });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_UPDATE_ERROR', message: 'Failed to update task' }
    });
  }
};

export const softDeleteTask = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;

    const task = await Task.findOneAndUpdate(
      { _id: id, companyId },
      { 
        deletedAt: new Date(),
        deletedBy: req.user._id,
        status: 'DEACTIVATED'
      },
      { new: true }
    );

    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Create audit log
    await createAuditLog({
      action: 'TASK_DELETED',
      entityType: 'TASK',
      entityId: task._id,
      actorId: req.user._id,
      companyId,
      before: { status: task.status, title: task.title },
      after: { status: 'DEACTIVATED', title: task.title },
      metadata: { softDelete: true }
    });

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    console.error('Soft delete task error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_DELETE_ERROR', message: 'Failed to delete task' }
    });
  }
};

const createAuditLog = async (auditData) => {
  try {
    const {
      action,
      entityType,
      entityId,
      actorId,
      companyId,
      before,
      after,
      metadata
    } = auditData;

    const auditLog = new AuditLog({
      eventId: `TASK-${entityId}-${Date.now()}`,
      actorType: 'USER',
      userId: actorId,
      organizationId: companyId,
      action,
      resource: entityType,
      resourceId: String(entityId),
      oldData: before,
      newData: after,
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${entityId}`,
      seq: await getNextAuditSeq(entityId),
      metadata
    });

    await auditLog.save();
  } catch (error) {
    console.error('Create audit log error:', error);
    // Don't throw - audit log failure shouldn't block task operations
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