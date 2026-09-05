import express from 'express';
import authMiddleware from '../../middlewares/authMiddleware.js';
// import {  } from '../../middlewares/.js';
import {
  assignTask,
  reassignTask,
  removeAssignee,
} from '../../controllers/tasks/assignment.controller.js';

const router = express.Router();

// @route   POST /api/v1/tasks/:id/assign
// @desc    Assign task to user
// @access  Private (task.assign permission)
router.post(
  '/:id/assign',
  authMiddleware,
  // ('task.assign'),
  assignTask
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