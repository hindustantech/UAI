import Task from '../../models/tasks/taskModel.js';
import TaskComment from '../../models/tasks/taskCommentModel.js';
import User from '../../models/userModel.js';
import { createTaskAuditLog } from '../../utils/taskAuditHelper.js';
import { resolveCompanyId } from '../../utils/companyResolver.js';

export const createComment = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { id } = req.params;
    const { message, parentCommentId, mentions } = req.body;

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Comment message is required' }
      });
    }

    if (parentCommentId) {
      const parentComment = await TaskComment.findOne({ _id: parentCommentId, companyId, taskId: id });
      if (!parentComment) {
        return res.status(400).json({
          success: false,
          error: { code: 'COMMENT_NOT_FOUND', message: 'Parent comment not found' }
        });
      }
    }

    const comment = await TaskComment.create({
      companyId,
      taskId: id,
      userId: req.user._id,
      message: message.trim(),
      parentCommentId: parentCommentId || null,
      mentions: mentions || []
    });

    await createTaskAuditLog({
      action: 'TASK_COMMENTED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user._id,
      companyId,
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

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

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

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    const comment = await TaskComment.findOne({ _id: commentId, companyId, taskId: id });
    if (!comment) {
      return res.status(404).json({
        success: false,
        error: { code: 'COMMENT_NOT_FOUND', message: 'Comment not found' }
      });
    }

    if (comment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You can only update your own comments' }
      });
    }

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

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    const comment = await TaskComment.findOne({ _id: commentId, companyId, taskId: id });
    if (!comment) {
      return res.status(404).json({
        success: false,
        error: { code: 'COMMENT_NOT_FOUND', message: 'Comment not found' }
      });
    }

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

    const task = await Task.findOne({ _id: id, companyId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { code: 'TASK_NOT_FOUND', message: 'Task not found' }
      });
    }

    const comment = await TaskComment.findOne({ _id: commentId, companyId, taskId: id });
    if (!comment) {
      return res.status(404).json({
        success: false,
        error: { code: 'COMMENT_NOT_FOUND', message: 'Comment not found' }
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' }
      });
    }

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