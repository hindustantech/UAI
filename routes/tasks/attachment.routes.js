import express from 'express';
import authMiddleware from '../../middlewares/authMiddleware.js';
// import { checkPermission } from '../../middlewares/checkPermission.js';
import {
  uploadAttachment,
  getAttachments,
  deleteAttachment,
} from '../../controllers/tasks/attachment.controller.js';

const router = express.Router();

// @route   POST /api/v1/tasks/:id/attachments
// @desc    Upload task attachment
// @access  Private (task.attachment permission)
router.post(
  '/:id/attachments',
  authMiddleware,
  // checkPermission('task.attachment'),
  uploadAttachment
);

// @route   GET /api/v1/tasks/:id/attachments
// @desc    Get task attachments
// @access  Private (task.attachment permission)
router.get(
  '/:id/attachments',
  authMiddleware,
  // checkPermission('task.attachment'),
  getAttachments
);

// @route   DELETE /api/v1/tasks/:id/attachments/:attachmentId
// @desc    Delete task attachment
// @access  Private (task.attachment permission)
router.delete(
  '/:id/attachments/:attachmentId',
  authMiddleware,
  // checkPermission('task.attachment'),
  deleteAttachment
);

export default router;