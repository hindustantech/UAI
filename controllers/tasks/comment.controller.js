import Task from '../../models/tasks/taskModel.js';
import TaskComment from '../../models/tasks/taskCommentModel.js';
import User from '../../models/userModel.js';
import AuditLog from '../../models/AuditLog.js';
import { resolveCompanyId } from '../../utils/companyResolver.js';

export const createComment = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { message, parentCommentId, mentions } = req.body;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Validate message
    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Comment message is required' }
      });
    }

    // Check if parent comment exists in same company (if provided)
    if (parentCommentId) {
      const parentComment = await TaskComment.findOne({ _id: parentCommentId, companyId, taskId: id });
      if (!parentComment) {
        return res.status(400).json({
          success: false,
          error: { code: 'COMMENT_NOT_FOUND', message: 'Parent comment not found' }
        });
      }
    }

    // Create comment
    const comment = await TaskComment.create({
      companyId,
      taskId: id,
      userId: req.user._id,
      message: message.trim(),
      parentCommentId: parentCommentId || null,
      mentions: mentions || []
    });

    // Create audit log
    await AuditLog.create({
      eventId: `TASK-COMMENT-${id}-${Date.now()}`,
      actorType: 'USER',
      userId: req.user._id,
      action: 'TASK_COMMENTED',
      entityType: 'TASK',
      entityId: id,
      companyId,
      category: 'BUSINESS',
      severity: 'INFO',
      success: true,
      chainScope: `task-${id}`,
      seq: await getNextAuditSeq(id),
      metadata: { commentId: comment._id }
    });

    res.json({
      success: true,
      data: comment
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_COMMENT_ERROR', message: 'Failed to create comment' }
    });
  }
};

export const getComments = async (req, res) => {
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

    // Get comments with pagination (company-scoped)
    const comments = await TaskComment.find({ 
      companyId,
      taskId: id, 
      deletedAt: { $exists: false } 
    })
      .populate('userId', 'name email')
      .populate('parentCommentId', 'message')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Get total count
    const total = await TaskComment.countDocuments({ 
      companyId,
      taskId: id, 
      deletedAt: { $exists: false } 
    });

    res.json({
      success: true,
      count: comments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: comments
    });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_COMMENTS_ERROR', message: 'Failed to fetch comments' }
    });
  }
};

export const updateComment = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id, commentId } = req.params;
    const { message } = req.body;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Find comment in same company
    const comment = await TaskComment.findOne({ _id: commentId, companyId, taskId: id });
    if (!comment) {
      return res.status(404).json({
        success: false,
        error: { code: 'COMMENT_NOT_FOUND', message: 'Comment not found' }
      });
    }

    // Check if user is the comment author
    if (comment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You can only update your own comments' }
      });
    }

    // Update comment
    const updatedComment = await TaskComment.findByIdAndUpdate(
      commentId,
      { message: message.trim() },
      { new: true }
    );

    res.json({
      success: true,
      data: updatedComment
    });
  } catch (error) {
    console.error('Update comment error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_COMMENT_UPDATE_ERROR', message: 'Failed to update comment' }
    });
  }
};

export const deleteComment = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id, commentId } = req.params;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Find comment in same company
    const comment = await TaskComment.findOne({ _id: commentId, companyId, taskId: id });
    if (!comment) {
      return res.status(404).json({
        success: false,
        error: { code: 'COMMENT_NOT_FOUND', message: 'Comment not found' }
      });
    }

    // Soft delete comment
    await TaskComment.findByIdAndUpdate(commentId, { deletedAt: new Date() });

    res.json({
      success: true,
      message: 'Comment deleted successfully'
    });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_COMMENT_DELETE_ERROR', message: 'Failed to delete comment' }
    });
  }
};

export const addMention = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id, commentId } = req.params;
    const { userId } = req.body;

    // Check task exists and belongs to company
    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    // Find comment in same company
    const comment = await TaskComment.findOne({ _id: commentId, companyId, taskId: id });
    if (!comment) {
      return res.status(404).json({
        success: false,
        error: { code: 'COMMENT_NOT_FOUND', message: 'Comment not found' }
      });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' }
      });
    }

    // Add mention if not already present
    if (!comment.mentions.some(m => m.userId.toString() === userId)) {
      comment.mentions.push({ userId });
      await comment.save();
    }

    res.json({
      success: true,
      data: comment
    });
  } catch (error) {
    console.error('Add mention error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TASK_MENTION_ERROR', message: 'Failed to add mention' }
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