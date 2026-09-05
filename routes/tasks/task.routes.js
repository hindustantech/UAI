import express from 'express';
import authMiddleware from '../../middlewares/authMiddleware.js';
import { checkPermission } from '../../middlewares/checkPermission.js';
import {
  createTask,
  getTask,
  updateTask,
  softDeleteTask,
  getTasks,
} from '../../controllers/tasks/task.controller.js';
import { validateTask } from '../../middlewares/taskValidation.js';

const router = express.Router();

// @route   GET /api/v1/tasks
// @desc    Get all tasks with filtering
// @access  Private (with appropriate permissions)
router.get('/', authMiddleware, getTasks);

// @route   POST /api/v1/tasks
// @desc    Create a new task
// @access  Private (task.create permission)
router.post(
  '/',
  authMiddleware,

  validateTask,
  createTask
);

// @route   GET /api/v1/tasks/:id
// @desc    Get single task detail
// @access  Private (with appropriate permissions)
router.get('/:id', authMiddleware, getTask);

// @route   PATCH /api/v1/tasks/:id
// @desc    Update task
// @access  Private (task.update permission)
router.patch(
  '/:id',
  authMiddleware,

  validateTask,
  updateTask
);

// @route   DELETE /api/v1/tasks/:id
// @desc    Soft delete task
// @access  Private (task.delete permission)
router.delete('/:id', authMiddleware, softDeleteTask);

export default router;