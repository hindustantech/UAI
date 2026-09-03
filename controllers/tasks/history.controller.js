import Task from '../../models/tasks/taskModel.js';
import TaskStatusHistory from '../../models/tasks/taskStatusHistoryModel.js';
import TaskWorkSession from '../../models/tasks/taskWorkSessionModel.js';
import TaskAssignment from '../../models/tasks/taskAssignmentModel.js';
import TaskInvitation from '../../models/tasks/taskInvitationModel.js';
import TaskComment from '../../models/tasks/taskCommentModel.js';
import { resolveCompanyId } from '../../utils/companyResolver.js';

export const getTaskActivity = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Build activity timeline from multiple sources
    const activities = [];

    // 1. Status changes (company-scoped)
    const statusChanges = await TaskStatusHistory.find({ companyId, taskId: id })
      .populate('changedBy', 'name email')
      .sort({ createdAt: -1 });

    statusChanges.forEach(change => {
      activities.push({
        type: 'STATUS_CHANGE',
        description: `Status changed from ${change.fromStatus} to ${change.toStatus}`,
        timestamp: change.createdAt,
        user: change.changedBy,
        metadata: { fromStatus: change.fromStatus, toStatus: change.toStatus }
      });
    });

    // 2. Work sessions (company-scoped)
    const workSessions = await TaskWorkSession.find({ companyId, taskId: id })
      .populate('userId', 'name email')
      .sort({ startedAt: -1 });

    workSessions.forEach(session => {
      activities.push({
        type: 'WORK_SESSION',
        description: `${session.userId.name || 'Unknown'} started working`,
        timestamp: session.startedAt,
        user: session.userId,
        metadata: { 
          sessionId: session._id,
          duration: session.durationSeconds,
          status: session.status
        }
      });

      if (session.stoppedAt) {
        activities.push({
          type: 'WORK_SESSION_STOPPED',
          description: `${session.userId.name || 'Unknown'} stopped working`,
          timestamp: session.stoppedAt,
          user: session.userId,
          metadata: { 
            sessionId: session._id,
            duration: session.durationSeconds,
            reason: session.stopReason
          }
        });
      }
    });

    // 3. Assignments (company-scoped)
    const assignments = await TaskAssignment.find({ companyId, taskId: id })
      .populate('userId', 'name email')
      .populate('assignedBy', 'name email')
      .sort({ createdAt: -1 });

    assignments.forEach(assignment => {
      activities.push({
        type: 'ASSIGNMENT',
        description: `${assignment.assignedBy?.name || 'Unknown'} assigned ${assignment.userId?.name || 'Unknown'}`,
        timestamp: assignment.createdAt,
        user: assignment.assignedBy,
        metadata: { 
          assignedTo: assignment.userId?.name || 'Unknown',
          status: assignment.status
        }
      });
    });

    // 4. Invitations (company-scoped)
    const invitations = await TaskInvitation.find({ companyId, taskId: id })
      .populate('invitedBy', 'name email')
      .populate('invitedUserId', 'name email')
      .sort({ createdAt: -1 });

    invitations.forEach(invitation => {
      activities.push({
        type: 'INVITATION',
        description: `${invitation.invitedBy?.name || 'Unknown'} invited ${invitation.invitedUserId?.name || 'Unknown'}`,
        timestamp: invitation.createdAt,
        user: invitation.invitedBy,
        metadata: { 
          invitedTo: invitation.invitedUserId?.name || 'Unknown',
          status: invitation.status
        }
      });
    });

    // 5. Comments (company-scoped)
    const comments = await TaskComment.find({ companyId, taskId: id, deletedAt: { $exists: false } })
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(10);

    comments.forEach(comment => {
      activities.push({
        type: 'COMMENT',
        description: `${comment.userId?.name || 'Unknown'} commented: ${comment.message.substring(0, 50)}...`,
        timestamp: comment.createdAt,
        user: comment.userId,
        metadata: { 
          commentId: comment._id,
          message: comment.message.substring(0, 100)
        }
      });
    });

    // Sort activities by timestamp (most recent first)
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Paginate
    const startIndex = (page - 1) * limit;
    const paginatedActivities = activities.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      count: paginatedActivities.length,
      total: activities.length,
      page: parseInt(page),
      pages: Math.ceil(activities.length / limit),
      data: paginatedActivities
    });
  } catch (error) {
    console.error('Get task activity error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_ACTIVITY_ERROR', message: 'Failed to fetch task activity' }
    });
  }
};

export const getTaskHistory = async (req, res) => {
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

    // Get status history (company-scoped)
    const history = await TaskStatusHistory.find({ companyId, taskId: id })
      .populate('changedBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: history.length,
      data: history
    });
  } catch (error) {
    console.error('Get task history error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_HISTORY_ERROR', message: 'Failed to fetch task history' }
    });
  }
};