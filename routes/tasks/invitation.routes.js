import express from 'express';
import authMiddleware from '../../middlewares/authMiddleware.js';
import {
  inviteUser,
  getMyInvitations,
  acceptInvitationById,
  rejectInvitationById,
} from '../../controllers/tasks/invitation.controller.js';

const router = express.Router();

// @route   GET /api/v1/tasks/my-invitations
// @desc    Get pending invitations for logged-in user
// @access  Private
router.get(
  '/my-invitations',
  authMiddleware,
  getMyInvitations
);

// @route   POST /api/v1/tasks/invitations/:invitationId/accept
// @desc    Accept task invitation by invitation ID
// @access  Private
router.post(
  '/invitations/:invitationId/accept',
  authMiddleware,
  acceptInvitationById
);

// @route   POST /api/v1/tasks/invitations/:invitationId/reject
// @desc    Reject task invitation by invitation ID
// @access  Private
router.post(
  '/invitations/:invitationId/reject',
  authMiddleware,
  rejectInvitationById
);

// @route   POST /api/v1/tasks/:id/invite
// @desc    Invite user to task
// @access  Private (task.invite permission)
router.post(
  '/:id/invite',
  authMiddleware,
  inviteUser
);

export default router;
