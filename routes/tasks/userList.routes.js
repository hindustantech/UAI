import express from 'express';
import { getAssignedUsers, getInvitedUsers } from '../../controllers/tasks/userList.controller.js';
import authMiddleware from '../../middlewares/authMiddleware.js';

const router = express.Router();

router.get('/users/assigned', authMiddleware, getAssignedUsers);
router.get('/users/invited', authMiddleware, getInvitedUsers);

export default router;
