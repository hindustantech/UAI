import express from 'express';
import authMiddleware from '../../middlewares/authMiddleware.js';
import { checkPermission } from '../../middlewares/checkPermission.js';
import {
  getTaskActivity,
  getTaskHistory,
} from '../../controllers/tasks/history.controller.js';

const router = express.Router();

// @route   GET /api/v1/tasks/:id/activity
// @desc    Get task activity timeline
// @access  Private (task.history.view permission)
router.get(
  '/:id/activity',
  authMiddleware,
  checkPermission('task.history.view'),
  getTaskActivity
);

// @route   GET /api/v1/tasks/:id/history
// @desc    Get task status history
// @access  Private (task.history.view permission)
router.get(
  '/:id/history',
  authMiddleware,
  checkPermission('task.history.view'),
  getTaskHistory
);

export default router;