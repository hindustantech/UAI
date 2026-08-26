/**
 * requireAuditPermission
 *
 * Thin wrapper around the existing checkPermission pattern.
 * Maps audit-specific permission keys to the existing
 * checkPermission infrastructure (AssingPermission collection).
 *
 * Usage:
 *   router.get('/logs', authMiddleware, requireAuditPermission('audit.read'), getAllAuditLogs);
 *   router.post('/:eventId/deactivate', authMiddleware, requireAuditPermission('audit.deactivate'), ...);
 */

import User from '../models/userModel.js';
import Employee from '../models/Attandance/Employee.js';
import AssingPermission from '../models/AssingPermission.js';

/**
 * Role-based default access matrix (backward-compatible with existing hierarchy):
 *
 *   GLOBAL scope (super_admin / partner) → ALL audit permissions
 *   Employee role admin  → READ, READ_DETAIL, EXPORT, VERIFY
 *   Employee role manager→ READ, READ_DETAIL
 *   Auditor (custom role)→ READ, READ_DETAIL, VERIFY, EXPORT
 *   Plain user (no admin)→ nothing (403)
 *
 * When AssingPermission has a matching permission key, it overrides the
 * default role matrix (checkPermission always allows matching keys).
 *
 * @param {string} permissionKey  e.g. 'audit.read', 'audit.deactivate'
 */
export const requireAuditPermission = (permissionKey) => {
    return async (req, res, next) => {
        try {
            const userId = req.user?.id || req.user?._id;
            const companyId = req.user?.companyId;
            const userScope = req.user?.scope;
            const userType  = req.user?.type;

            if (!userId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }

            /* ── GLOBAL scope bypass: partner / super_admin see everything ── */
            if (userScope === 'GLOBAL' || userType === 'super_admin' || userType === 'partner') {
                return next();
            }

            /* ── User document (for type) + Employee doc (for role) ── */
            const user = await User.findById(userId).select('type permissions').lean();
            if (!user) {
                return res.status(401).json({ success: false, message: 'User not found' });
            }

            /* ── Tenant check ── */
            const employee = companyId
                ? await Employee.findOne({ userId: user._id, companyId }).select('role').lean()
                : null;

            if (companyId && !employee) {
                return res.status(403).json({ success: false, message: 'Access denied: not part of company' });
            }

            const role = employee?.role;

            /* ── Role hierarchy shortcut ── */
            if (role === 'admin' || userType === 'admin') {
                return next();
            }

            /* ── AssingPermission explicit key match ── */
            if (employee && companyId) {
                const assignment = await AssingPermission.findOne({ companyId, userId: user._id }).lean();
                if (assignment && assignment.permissions?.includes(permissionKey)) {
                    return next();
                }
            }

            /* ── Auditor role support (custom: grants audit.read / detail / verify / export) ── */
            if (role === 'auditor') {
                const auditorPerms = ['audit.read', 'audit.read_detail', 'audit.verify', 'audit.export', 'audit.summary'];
                if (auditorPerms.includes(permissionKey)) return next();
            }

            /* ── Manager: read-only access ── */
            if (role === 'manager' || role === 'org_admin') {
                const managerPerms = ['audit.read', 'audit.read_detail', 'audit.summary'];
                if (managerPerms.includes(permissionKey)) return next();
            }

            return res.status(403).json({
                success: false,
                message: 'Forbidden: insufficient audit permissions',
            });
        } catch (err) {
            return res.status(500).json({ success: false, message: 'Internal error' });
        }
    };
};

export default requireAuditPermission;
