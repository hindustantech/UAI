import express from 'express';
import authMiddleware from '../../middlewares/authMiddleware.js';
import { checkPermission } from '../../middlewares/checkPermission.js';
import {
  startTask,
  stopTask,
  resumeTask,
  submitTask,
  getWorkSessions,
  getUserWorkTime,
  correctWorkSession,
} from '../../controllers/tasks/workSession.controller.js';

const router = express.Router();

// @route   POST /api/v1/tasks/:id/start
// @desc    Start task work session
// @access  Private (task.start permission)
router.post(
  '/:id/start',
  authMiddleware,
  checkPermission('task.start'),
  startTask
);

// @route   POST /api/v1/tasks/:id/stop
// @desc    Stop work session
// @access  Private (task.stop permission)
router.post(
  '/:id/stop',
  authMiddleware,
  checkPermission('task.stop'),
  stopTask
);

// @route   POST /api/v1/tasks/:id/resume
// @desc    Resume task (start new session)
// @access  Private (task.resume permission)
router.post(
  '/:id/resume',
  authMiddleware,
  checkPermission('task.resume'),
  resumeTask
);

// @route   POST /api/v1/tasks/:id/submit
// @desc    Submit task
// @access  Private (task.submit permission)
router.post(
  '/:id/submit',
  authMiddleware,
  checkPermission('task.submit'),
  submitTask
);

// @route   GET /api/v1/tasks/:id/work-sessions
// @desc    Get work sessions for task
// @access  Private (task.time.view permission)
router.get(
  '/:id/work-sessions',
  authMiddleware,
  checkPermission('task.time.view'),
  getWorkSessions
);

// @route   GET /api/v1/users/:id/work-time
// @desc    Get user work time
// @access  Private (task.time.view permission)
router.get(
  '/users/:id/work-time',
  authMiddleware,
  checkPermission('task.time.view'),
  getUserWorkTime
);

// @route   PATCH /api/v1/work-sessions/:id
// @desc    Correct work session time
// @access  Private (task.time.edit permission)
router.patch(
  '/work-sessions/:id',
  authMiddleware,
  checkPermission('task.time.edit'),
  correctWorkSession
);

export default router;