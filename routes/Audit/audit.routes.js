// routes/Audit/audit.routes.js
import express from 'express';
import {
    getAllAuditLogs,
    getAuditLogStats,
    getAuditLogByEventId,
} from '../../controllers/Audit/auditLog.controller.js';
import authMiddleware from '../../middlewares/authMiddleware.js';

const router = express.Router();

router.get('/', authMiddleware, getAllAuditLogs);
router.get('/stats', authMiddleware, getAuditLogStats);
router.get('/:eventId', authMiddleware, getAuditLogByEventId);

export default router;
