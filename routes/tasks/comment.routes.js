import express from 'express';
import authMiddleware from '../../middlewares/authMiddleware.js';
// import { checkPermission } from '../../middlewares/checkPermission.js';
import {
  createComment,
  getComments,
  updateComment,
  deleteComment,
  addMention,
} from '../../controllers/tasks/comment.controller.js';

const router = express.Router();

// @route   POST /api/v1/tasks/:id/comments
// @desc    Create task comment
// @access  Private (task.comment permission)
router.post(
  '/:id/comments',
  authMiddleware,
  // checkPermission('task.comment'),
  createComment
);

// @route   GET /api/v1/tasks/:id/comments
// @desc    Get task comments
// @access  Private (task.comment permission)
router.get(
  '/:id/comments',
  authMiddleware,
  // checkPermission('task.comment'),
  getComments
);

// @route   PATCH /api/v1/tasks/:id/comments/:commentId
// @desc    Update comment
// @access  Private (task.comment permission)
router.patch(
  '/:id/comments/:commentId',
  authMiddleware,
  // checkPermission('task.comment'),
  updateComment
);

// @route   DELETE /api/v1/tasks/:id/comments/:commentId
// @desc    Delete comment (soft delete)
// @access  Private (task.comment permission)
router.delete(
  '/:id/comments/:commentId',
  authMiddleware,
  // checkPermission('task.comment'),
  deleteComment
);

// @route   POST /api/v1/tasks/:id/comments/:commentId/mentions
// @desc    Add mention to comment
// @access  Private (task.comment permission)
router.post(
  '/:id/comments/:commentId/mentions',
  authMiddleware,
  // checkPermission('task.comment'),
  addMention
);

export default router;