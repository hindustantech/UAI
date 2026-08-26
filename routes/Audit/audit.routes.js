// routes/Audit/audit.routes.js
import express from 'express';
import {
    getAllAuditLogs,
    getAuditLogByEventId,
    getResourceHistory,
    getUserActivity,
    getAuditLogStats,
    verifyChain,
    getSuspiciousActivity,
    exportAuditLogs,
    deactivateAuditEvent,
} from '../../controllers/Audit/auditLog.controller.js';
import authMiddleware from '../../middlewares/authMiddleware.js';
import { requireAuditPermission } from '../../middlewares/requireAuditPermission.js';

const router = express.Router();

/* ────────────────────────────────────────────────────────────────
   Explicit routes FIRST — must be registered before /:eventId
   so that /api/audit/logs hits getAllAuditLogs instead of falling
   into the /:eventId catch-all.
   ──────────────────────────────────────────────────────────────── */

router.get('/', authMiddleware, requireAuditPermission('audit.read'), getAllAuditLogs);
router.get('/logs', authMiddleware, requireAuditPermission('audit.read'), getAllAuditLogs);

/* ── Stats ── */
router.get('/stats', authMiddleware, requireAuditPermission('audit.read'), getAuditLogStats);

/* ── Summary ── */
router.get('/summary', authMiddleware, requireAuditPermission('audit.read'), getAuditLogStats);

/* ── Chain verification ── */
router.get('/verify-chain', authMiddleware, requireAuditPermission('audit.verify'), verifyChain);

/* ── Suspicious activity ── */
router.get('/suspicious', authMiddleware, requireAuditPermission('audit.read'), getSuspiciousActivity);

/* ── Export ── */
router.get('/export', authMiddleware, requireAuditPermission('audit.export'), exportAuditLogs);

/* ── Resource history ── */
router.get('/resource/:resource/:resourceId', authMiddleware, requireAuditPermission('audit.read'), getResourceHistory);

/* ── User activity ── */
router.get('/user/:userId', authMiddleware, requireAuditPermission('audit.read'), getUserActivity);

/* ── Detail ── */
router.get('/:eventId', authMiddleware, requireAuditPermission('audit.read_detail'), getAuditLogByEventId);

/* ── Deactivate ── */
router.post('/:eventId/deactivate', authMiddleware, requireAuditPermission('audit.deactivate'), deactivateAuditEvent);

export default router;