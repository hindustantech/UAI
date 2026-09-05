import express from 'express';
import authMiddleware from '../../middlewares/authMiddleware.js';
// import { checkPermission } from '../../middlewares/checkPermission.js';
import {
  verifyTask,
  rejectTask,
  reopenTask,
  closeTask,
  activateTask,
  deactivateTask,
  cancelTask,
} from '../../controllers/tasks/workflow.controller.js';

const router = express.Router();

// @route   POST /api/v1/tasks/:id/verify
// @desc    Verify submitted task
// @access  Private (task.verify permission)
router.post(
  '/:id/verify',
  authMiddleware,
  // checkPermission('task.verify'),
  verifyTask
);

// @route   POST /api/v1/tasks/:id/reject
// @desc    Reject task submission
// @access  Private (task.reject permission)
router.post(
  '/:id/reject',
  authMiddleware,
  // checkPermission('task.reject'),
  rejectTask
);

// @route   POST /api/v1/tasks/:id/reopen
// @desc    Reopen closed task
// @access  Private (task.reopen permission)
router.post(
  '/:id/reopen',
  authMiddleware,
  // checkPermission('task.reopen'),
  reopenTask
);

// @route   POST /api/v1/tasks/:id/close
// @desc    Close verified task
// @access  Private (task.close permission)
router.post(
  '/:id/close',
  authMiddleware,
  // checkPermission('task.close'),
  closeTask
);

// @route   POST /api/v1/tasks/:id/activate
// @desc    Activate deactivated task
// @access  Private (task.activate permission)
router.post(
  '/:id/activate',
  authMiddleware,
  // checkPermission('task.activate'),
  activateTask
);

// @route   POST /api/v1/tasks/:id/deactivate
// @desc    Deactivate task
// @access  Private (task.deactivate permission)
router.post(
  '/:id/deactivate',
  authMiddleware,
  // checkPermission('task.deactivate'),
  deactivateTask
);

// @route   POST /api/v1/tasks/:id/cancel
// @desc    Cancel task
// @access  Private (task.cancel permission)
router.post(
  '/:id/cancel',
  authMiddleware,
  // checkPermission('task.cancel'),
  cancelTask
);

export default router;