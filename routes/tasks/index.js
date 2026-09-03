import express from 'express';
import taskRoutes from './task.routes.js';
import assignmentRoutes from './assignment.routes.js';
import invitationRoutes from './invitation.routes.js';
import workSessionRoutes from './workSession.routes.js';
import workflowRoutes from './workflow.routes.js';
import historyRoutes from './history.routes.js';
import commentRoutes from './comment.routes.js';
import attachmentRoutes from './attachment.routes.js';

const router = express.Router();

// Mount all task-related routes
router.use('/', taskRoutes);
router.use('/', assignmentRoutes);
router.use('/', invitationRoutes);
router.use('/', workSessionRoutes);
router.use('/', workflowRoutes);
router.use('/', historyRoutes);
router.use('/', commentRoutes);
router.use('/', attachmentRoutes);

export default router;