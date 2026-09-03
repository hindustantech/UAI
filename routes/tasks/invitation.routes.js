import express from 'express';
import authMiddleware from '../../middlewares/authMiddleware.js';
import { checkPermission } from '../../middlewares/checkPermission.js';
import {
  inviteUser,
  acceptInvitation,
  rejectInvitation,
} from '../../controllers/tasks/invitation.controller.js';

const router = express.Router();

// @route   POST /api/v1/tasks/:id/invite
// @desc    Invite user to task
// @access  Private (task.invite permission)
router.post(
  '/:id/invite',
  authMiddleware,
  checkPermission('task.invite'),
  inviteUser
);

// @route   POST /api/v1/tasks/:id/invitations/:invitationId/accept
// @desc    Accept task invitation
// @access  Private
router.post(
  '/:id/invitations/:invitationId/accept',
  authMiddleware,
  acceptInvitation
);

// @route   POST /api/v1/tasks/:id/invitations/:invitationId/reject
// @desc    Reject task invitation
// @access  Private
router.post(
  '/:id/invitations/:invitationId/reject',
  authMiddleware,
  rejectInvitation
);

export default router;