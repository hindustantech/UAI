import express from 'express';
import authMiddleware from '../../middlewares/authMiddleware.js';
// import {  } from '../../middlewares/.js';
import {
  assignTask,
  assignTaskBulk,
  reassignTask,
  removeAssignee,
  getTaskAssignments,
  getMyAssignments
} from '../../controllers/tasks/assignment.controller.js';

const router = express.Router();

// @route   GET /api/v1/tasks/my-assignments
// @desc    Get all assignments for the logged-in user
// @access  Private
router.get(
  '/my-assignments',
  authMiddleware,
  getMyAssignments
);

// @route   GET /api/v1/tasks/:id/assignments
// @desc    Get all assignments for a task
// @access  Private
router.get(
  '/:id/assignments',
  authMiddleware,
  getTaskAssignments
);

// @route   POST /api/v1/tasks/:id/assign
// @desc    Assign task to user
// @access  Private (task.assign permission)
router.post(
  '/:id/assign',
  authMiddleware,
  // ('task.assign'),
  assignTask
);

// @route   POST /api/v1/tasks/:id/assign-bulk
// @desc    Assign task to multiple users
// @access  Private (task.assign permission)
router.post(
  '/:id/assign-bulk',
  authMiddleware,
  // ('task.assign'),
  assignTaskBulk
);

// @route   POST /api/v1/tasks/:id/reassign
// @desc    Reassign task to another user
// @access  Private (task.reassign permission)
router.post(
  '/:id/reassign',
  authMiddleware,
  // ('task.reassign'),
  reassignTask
);

// @route   DELETE /api/v1/tasks/:id/assignees/:userId
// @desc    Remove assignee from task
// @access  Private (task.reassign permission)
router.delete(
  '/:id/assignees/:userId',
  authMiddleware,
  // ('task.reassign'),
  removeAssignee
);
export default router;