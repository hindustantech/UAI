import express from 'express';
import authMiddleware from '../middlewares/authMiddleware.js';
// import { getInvitations } from '../controllers/tasks/invitation.controller.js';

const router = express.Router();

// @route   GET /api/v1/invitations
// @desc    Get all invitations with pagination, search, and filter
// @access  Private
// router.get(
//   '/',
//   authMiddleware,
//   getInvitations
// );

export default router;