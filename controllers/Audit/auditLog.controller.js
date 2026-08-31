// controllers/Audit/auditLog.controller.js
import mongoose from 'mongoose';
import AuditLog from '../../models/AuditLog.js';
import { buildAuditLogQuery, ValidationError } from '../../services/audit/queryBuilder.js';
import { normalizeAuditEvent, normalizeAuditEvents } from '../../services/audit/presenter.js';
import {
    verifyAuditEvent,
    verifyChainDetailed,
} from '../../services/audit/hashChain.js';
import auditConfig from '../../services/audit/config.js';
import { logApiAction } from '../../utils/apiLogger.js';
import ExcelJS from 'exceljs';
import Employee from '../../models/Attandance/Employee.js';

/* ────────────────────────────────────────────────────────────────
   HELPERS
   ──────────────────────────────────────────────────────────────── */

/** Build the auth context consumed by the centralized query builder */
const authContextFrom = (req) => ({
    scope: req.user?.scope,
    type: req.user?.type,
    companyId: req.user?.companyId || null,
    userId: req.user?.id || req.user?._id || null,
});

const sendError = (res, err, fallbackMessage = 'Failed to fetch audit logs') => {
    if (err instanceof ValidationError) {
        return res.status(400).json({ success: false, message: err.message });
    }
    console.error('AUDIT API ERROR:', err);
    // Never leak MongoDB internals to clients
    return res.status(500).json({ success: false, message: fallbackMessage });
};

const GLOBAL_SCOPE = '__GLOBAL__';

/**
 * Resolve chainScope for verification/deactivation endpoints.
 * COMPANY-scope users are pinned to their own org; GLOBAL users may
 * target any organizationId explicitly (defaults to __GLOBAL__ only when
 * no org events exist — normally they pass an explicit organizationId).
 */
const resolveChainScope = (req) => {
    const isGlobal = req.user?.scope === 'GLOBAL' ||
        req.user?.type === 'super_admin' ||
        req.user?.type === 'partner';

    const requested = req.query.organizationId || req.body?.organizationId;

    if (!isGlobal) {
        const orgId = req.user?.companyId;
        if (!orgId || !mongoose.Types.ObjectId.isValid(String(orgId))) {
            throw new ValidationError('Organization scope not available for this user');
        }
        return String(orgId);
    }

    if (requested) {
        if (!mongoose.Types.ObjectId.isValid(String(requested))) {
            throw new ValidationError('Invalid organizationId');
        }
        return String(requested);
    }
    return GLOBAL_SCOPE;
};

/* ────────────────────────────────────────────────────────────────
   1. LIST — GET /api/audit/logs
   Full investigation filter set, AND-combined, paginated.
   ──────────────────────────────────────────────────────────────── */

export const getAllAuditLogs = async (req, res) => {
    try {
        const { filter, sort, page, limit, skip } = buildAuditLogQuery(req.query, authContextFrom(req));

        const [logs, total] = await Promise.all([
            AuditLog.find(filter)
                .populate('userId', 'name email phone type')
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean(),
            AuditLog.countDocuments(filter),
        ]);

        const totalPages = Math.ceil(total / limit);

        return res.status(200).json({
            success: true,
            message: 'Audit logs fetched successfully',
            data: normalizeAuditEvents(logs),
            pagination: {
                totalRecords: total,
                totalPages,
                currentPage: page,
                perPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        });
    } catch (err) {
        return sendError(res, err);
    }
};

/* ────────────────────────────────────────────────────────────────
   2. DETAIL — GET /api/audit/:eventId
   Complete audit event incl. changes, http context, chain info.
   ──────────────────────────────────────────────────────────────── */

export const getAuditLogByEventId = async (req, res) => {
    try {
        const { eventId } = req.params;
        const { filter } = buildAuditLogQuery(
            { eventId, includeHidden: req.query.includeHidden },
            authContextFrom(req)
        );

        const log = await AuditLog.findOne(filter)
            .populate('userId', 'name email phone type')
            .lean();

        if (!log) {
            return res.status(404).json({ success: false, message: 'Audit log not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Audit log fetched successfully',
            data: normalizeAuditEvent(log),
        });
    } catch (err) {
        return sendError(res, err, 'Failed to fetch audit log');
    }
};

/* ────────────────────────────────────────────────────────────────
   3. RESOURCE HISTORY — GET /api/audit/resource/:resource/:resourceId
   Complete timeline of one business record (e.g. an employee).
   ──────────────────────────────────────────────────────────────── */

export const getResourceHistory = async (req, res) => {
    try {
        const { resource, resourceId } = req.params;

        const { filter, sort, page, limit, skip } = buildAuditLogQuery(
            { ...req.query, resource, resourceId },
            authContextFrom(req)
        );
        // History is always newest-first unless explicitly overridden
        if (!req.query.sortBy) sort.timestamp = -1;

        const [logs, total] = await Promise.all([
            AuditLog.find(filter).sort(sort).skip(skip).limit(limit).lean(),
            AuditLog.countDocuments(filter),
        ]);

        const totalPages = Math.ceil(total / limit);

        return res.status(200).json({
            success: true,
            message: 'Resource history fetched successfully',
            data: normalizeAuditEvents(logs),
            pagination: {
                totalRecords: total,
                totalPages,
                currentPage: page,
                perPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        });
    } catch (err) {
        return sendError(res, err, 'Failed to fetch resource history');
    }
};

/* ────────────────────────────────────────────────────────────────
   4. USER ACTIVITY — GET /api/audit/user/:userId
   "What did this user do?"
   ──────────────────────────────────────────────────────────────── */

export const getUserActivity = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(String(userId))) {
            throw new ValidationError('Invalid userId');
        }

        const { filter, sort, page, limit, skip } = buildAuditLogQuery(
            { ...req.query, userId },
            authContextFrom(req)
        );
        if (!req.query.sortBy) sort.timestamp = -1;

        const [logs, total] = await Promise.all([
            AuditLog.find(filter).sort(sort).skip(skip).limit(limit).lean(),
            AuditLog.countDocuments(filter),
        ]);

        const totalPages = Math.ceil(total / limit);

        return res.status(200).json({
            success: true,
            message: 'User activity fetched successfully',
            data: normalizeAuditEvents(logs),
            pagination: {
                totalRecords: total,
                totalPages,
                currentPage: page,
                perPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        });
    } catch (err) {
        return sendError(res, err, 'Failed to fetch user activity');
    }
};

/* ────────────────────────────────────────────────────────────────
   5. SUMMARY — GET /api/audit/summary
   Aggregation-pipeline statistics for an organization.
   ──────────────────────────────────────────────────────────────── */

export const getAuditLogStats = async (req, res) => {
    try {
        // Reuse builder purely for validation + org scoping (ignore pagination)
        const { filter } = buildAuditLogQuery(
            { ...req.query, page: 1, limit: 1 },
            authContextFrom(req)
        );

        const operationCountsPipeline = [
            { $match: filter },
            {
                $group: {
                    _id: { $ifNull: ['$operation', 'OTHER'] },
                    count: { $sum: 1 },
                },
            },
        ];

        const [
            total,
            successCount,
            failCount,
            byOperation,
            byEventType,
            topActors,
            topResources,
            topActions,
            recentFailures,
        ] = await Promise.all([
            AuditLog.countDocuments(filter),
            AuditLog.countDocuments({ ...filter, success: true }),
            AuditLog.countDocuments({ ...filter, success: false }),
            AuditLog.aggregate(operationCountsPipeline),
            AuditLog.aggregate([
                { $match: filter },
                { $group: { _id: { $ifNull: ['$eventType', 'WRITE'] }, count: { $sum: 1 } } },
            ]),
            AuditLog.aggregate([
                { $match: filter },
                { $group: { _id: '$userId', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user',
                        pipeline: [{ $project: { name: 1, email: 1, type: 1 } }],
                    },
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
            ]),
            AuditLog.aggregate([
                { $match: filter },
                { $group: { _id: '$resource', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
            AuditLog.aggregate([
                { $match: filter },
                { $group: { _id: '$action', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
            AuditLog.find({ ...filter, success: false })
                .sort({ timestamp: -1 })
                .limit(20)
                .select('eventId timestamp action resource resourceId userId safeErrorMessage errorCode')
                .lean(),
        ]);

        const opMap = Object.fromEntries(byOperation.map(o => [o._id, o.count]));
        const etMap = Object.fromEntries(byEventType.map(e => [e._id, e.count]));

        return res.status(200).json({
            success: true,
            message: 'Audit stats fetched successfully',
            data: {
                totalEvents: total,
                successfulEvents: successCount,
                failedEvents: failCount,

                creates:      opMap.CREATE      ?? 0,
                updates:      opMap.UPDATE      ?? 0,
                deletes:      opMap.DELETE      ?? 0,
                activations:  opMap.ACTIVATE    ?? 0,
                deactivations:opMap.DEACTIVATE  ?? 0,
                payments:     opMap.PAYMENT     ?? 0,
                reads:        (etMap.READ       ?? 0),

                byOperation: opMap,
                byEventType: etMap,

                topActors: topActors.map(a => ({
                    userId: a._id,
                    name: a.user?.name ?? null,
                    email: a.user?.email ?? null,
                    type: a.user?.type ?? null,
                    count: a.count,
                })),
                topResources: topResources.map(r => ({ resource: r._id, count: r.count })),
                topActions: topActions.map(a => ({ action: a._id, count: a.count })),

                recentFailures: recentFailures.map(f => ({
                    eventId: f.eventId,
                    timestamp: f.timestamp,
                    action: f.action,
                    resource: f.resource,
                    resourceId: f.resourceId,
                    errorCode: f.errorCode,
                    safeErrorMessage: f.safeErrorMessage,
                })),
            },
        });
    } catch (err) {
        return sendError(res, err, 'Failed to fetch audit stats');
    }
};

/* ────────────────────────────────────────────────────────────────
   6. VERIFY CHAIN — GET /api/audit/verify-chain
   Read-only integrity verification. Never mutates records.
   Modes: ?eventId=... (single) | range via from/to (+organizationId).
   ──────────────────────────────────────────────────────────────── */

export const verifyChain = async (req, res) => {
    try {
        /* Single-event mode */
        if (req.query.eventId) {
            const result = await verifyAuditEvent(String(req.query.eventId));
            // Enforce org visibility: non-global users may only inspect own-scope events
            if (result && result.eventId && req.user?.scope !== 'GLOBAL' &&
                req.user?.type !== 'super_admin' && req.user?.type !== 'partner') {
                const evt = await AuditLog.findOne({ eventId: String(req.query.eventId) })
                    .select('organizationId').lean();
                if (!evt || String(evt.organizationId) !== String(req.user.companyId)) {
                    return res.status(404).json({ success: false, message: 'Audit event not found' });
                }
            }
            return res.status(200).json({ success: true, data: result });
        }

        /* Range mode */
        const chainScope = resolveChainScope(req);

        // Map optional date range → seq boundaries
        let fromSeq = 1;
        let toSeq = null;

        if (req.query.from || req.query.to) {
            const rangeFilter = { chainScope };
            const ts = {};
            if (req.query.from) {
                const d = new Date(req.query.from);
                if (isNaN(d.getTime())) throw new ValidationError('Invalid "from" date');
                ts.$gte = d;
            }
            if (req.query.to) {
                const d = new Date(req.query.to);
                if (isNaN(d.getTime())) throw new ValidationError('Invalid "to" date');
                ts.$lte = d;
            }
            if (ts.$gte && ts.$lte && ts.$gte > ts.$lte) {
                throw new ValidationError('"from" must not be after "to"');
            }
            if (Object.keys(ts).length) rangeFilter.timestamp = ts;

            const [minDoc, maxDoc] = await Promise.all([
                AuditLog.findOne(rangeFilter).sort({ seq: 1 }).select('seq').lean(),
                AuditLog.findOne(rangeFilter).sort({ seq: -1 }).select('seq').lean(),
            ]);
            if (!minDoc || !maxDoc) {
                return res.status(200).json({
                    success: true,
                    data: { valid: true, checked: 0, errors: [], note: 'NO_EVENTS_IN_RANGE' },
                });
            }
            fromSeq = minDoc.seq;
            toSeq = maxDoc.seq;
        }

        const result = await verifyChainDetailed({ chainScope, fromSeq, toSeq });

        return res.status(200).json({
            success: true,
            data: {
                chainScope,
                valid: result.valid,
                checked: result.checked,
                errors: result.errors,
                notes: result.notes,
            },
        });
    } catch (err) {
        return sendError(res, err, 'Chain verification failed');
    }
};

/* ────────────────────────────────────────────────────────────────
   7. SUSPICIOUS ACTIVITY — GET /api/audit/suspicious
   Conservative, evidence-based heuristics. Labels describe the
   PATTERN (UNUSUAL_ACTIVITY / HIGH_VOLUME / MULTIPLE_FAILURES /
   SENSITIVE_CHANGE), never assert malicious intent.
   ──────────────────────────────────────────────────────────────── */

const SUSPICIOUS_WINDOW_DAYS_DEFAULT = 7;

export const getSuspiciousActivity = async (req, res) => {
    try {
        const { filter } = buildAuditLogQuery(
            { ...req.query, page: 1, limit: 1 },
            authContextFrom(req)
        );

        // Window defaults to last N days when no explicit range given
        const days = parseInt(String(req.query.windowDays || SUSPICIOUS_WINDOW_DAYS_DEFAULT), 10) || SUSPICIOUS_WINDOW_DAYS_DEFAULT;
        if (!req.query.from && !req.query.to) {
            const now = new Date();
            const from = new Date(now.getTime() - days * 86400000);
            filter.timestamp = { ...(filter.timestamp || {}), $gte: from };
        }

        const thresholds = {
            deletes:   parseInt(String(req.query.deleteThreshold   || 10), 10),
            updates:   parseInt(String(req.query.updateThreshold   || 100), 10),
            failures:  parseInt(String(req.query.failureThreshold  || 10), 10),
            salary:    parseInt(String(req.query.salaryThreshold   || 20), 10),
            deact:     parseInt(String(req.query.deactivateThreshold || 10), 10),
        };

        const findings = [];

        const runRule = async (rule) => {
            const rows = await AuditLog.aggregate(rule.pipeline);
            for (const row of rows) {
                findings.push({
                    type: rule.type,
                    label: rule.label,
                    severity: row.count >= rule.criticalAt ? 'CRITICAL' : 'WARNING',
                    count: row.count,
                    windowDays: days,
                    userId: row._id.userId ?? null,
                    action: row._id.action ?? null,
                });
            }
        };

        const base = [{ $match: filter }];

        await Promise.all([
            // Many DELETEs by one user
            runRule({
                type: 'HIGH_VOLUME',
                label: 'Many delete operations by a single user',
                criticalAt: thresholds.deletes * 2,
                pipeline: [
                    ...base,
                    { $match: { operation: 'DELETE', success: true } },
                    { $group: { _id: { userId: '$userId' }, count: { $sum: 1 } } },
                    { $match: { count: { $gte: thresholds.deletes } } },
                    { $sort: { count: -1 } },
                    { $limit: 20 },
                ],
            }),
            // Update storm by one user
            runRule({
                type: 'HIGH_VOLUME',
                label: 'Unusually high number of update operations',
                criticalAt: thresholds.updates * 2,
                pipeline: [
                    ...base,
                    { $match: { operation: 'UPDATE', success: true } },
                    { $group: { _id: { userId: '$userId' }, count: { $sum: 1 } } },
                    { $match: { count: { $gte: thresholds.updates } } },
                    { $sort: { count: -1 } },
                    { $limit: 20 },
                ],
            }),
            // Repeated failures (any action)
            runRule({
                type: 'MULTIPLE_FAILURES',
                label: 'Repeated failed operations by a single user',
                criticalAt: thresholds.failures * 3,
                pipeline: [
                    ...base,
                    { $match: { success: false } },
                    { $group: { _id: { userId: '$userId' }, count: { $sum: 1 } } },
                    { $match: { count: { $gte: thresholds.failures } } },
                    { $sort: { count: -1 } },
                    { $limit: 20 },
                ],
            }),
            // Salary change spike
            runRule({
                type: 'SENSITIVE_CHANGE',
                label: 'High volume of salary/payroll modifications',
                criticalAt: thresholds.salary * 2,
                pipeline: [
                    ...base,
                    {
                        $match: {
                            $or: [
                                { action: { $regex: '^PAYROLL\\.(SALARY_UPDATE|UPDATE|PROCESS)', $options: 'i' } },
                                { changedFields: { $in: ['salaryStructure.basic', 'salary'] } },
                            ],
                            success: true,
                        },
                    },
                    { $group: { _id: { userId: '$userId' }, count: { $sum: 1 } } },
                    { $match: { count: { $gte: thresholds.salary } } },
                    { $sort: { count: -1 } },
                    { $limit: 20 },
                ],
            }),
            // Bulk deactivation
            runRule({
                type: 'UNUSUAL_ACTIVITY',
                label: 'Bulk deactivation of accounts/resources',
                criticalAt: thresholds.deact * 2,
                pipeline: [
                    ...base,
                    { $match: { operation: 'DEACTIVATE', success: true } },
                    { $group: { _id: { userId: '$userId' }, count: { $sum: 1 } } },
                    { $match: { count: { $gte: thresholds.deact } } },
                    { $sort: { count: -1 } },
                    { $limit: 20 },
                ],
            }),
            // Permission changes followed by financial activity
            runRule({
                type: 'SENSITIVE_CHANGE',
                label: 'Permission/role changes combined with financial operations',
                criticalAt: 10,
                pipeline: [
                    ...base,
                    {
                        $match: {
                            $or: [
                                { action: { $regex: '(PERMISSION_CHANGE|ROLE_CHANGE)', $options: 'i' } },
                                { eventType: 'FINANCIAL' },
                            ],
                        },
                    },
                    { $group: { _id: { userId: '$userId' }, count: { $sum: 1 } } },
                    { $match: { count: { $gte: 3 } } },
                    { $sort: { count: -1 } },
                    { $limit: 20 },
                ],
            }),
        ]);

        return res.status(200).json({
            success: true,
            message: 'Suspicious activity scan completed',
            data: {
                windowDays: days,
                findingsCount: findings.length,
                findings,
                disclaimer:
                    'These are statistical patterns, not verdicts. Investigate each finding before drawing conclusions.',
            },
        });
    } catch (err) {
        return sendError(res, err, 'Suspicious activity scan failed');
    }
};

/* ────────────────────────────────────────────────────────────────
   8. EXPORT — GET /api/audit/export
   CSV export capped by AUDIT_EXPORT_MAX_ROWS. Export itself is audited.
   ──────────────────────────────────────────────────────────────── */

export const exportAuditLogs = async (req, res) => {
    try {
        const { filter, sort } = buildAuditLogQuery(
            { ...req.query, limit: auditConfig.exportMaxRows, page: 1 },
            authContextFrom(req)
        );

        const docs = await AuditLog.find(filter)
            .sort(sort)
            .limit(auditConfig.exportMaxRows)
            .select('-oldData -newData -changes -sanitizedRequestBody')
            .populate('userId', 'name email phone')
            .populate({
                path: 'employeeId',
                select: 'empCode user_name jobInfo employeeType role',
                populate: { path: 'userId', select: 'name phone' }
            });

        // ── PHASE B: Batch-fetch employee details for unresolved resourceIds ──
        const unresolvedEmpIds = new Set();
        const attendanceRequestIds = new Set();
        docs.forEach(d => {
            if (!d.employeeId?.empCode && d.resourceId) {
                if (d.resource === 'AttendanceRequest') {
                    attendanceRequestIds.add(String(d.resourceId));
                } else if (d.resource !== 'AUTH') {
                    unresolvedEmpIds.add(String(d.resourceId));
                }
            }
        });

        const employeeMap = {};
        const requestToEmployeeMap = {};

        // 1. Fetch AttendanceRequest docs → get employeeIds → add to unresolvedEmpIds
        const { default: AttendanceRequest } = await import('../../models/Attandance/Request.js');
        if (attendanceRequestIds.size > 0) {
            const arIds = [...attendanceRequestIds]
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id));
            if (arIds.length > 0) {
                const requests = await AttendanceRequest.find({ _id: { $in: arIds } })
                    .select('employeeId')
                    .lean();
                requests.forEach(req => {
                    if (req.employeeId) {
                        unresolvedEmpIds.add(String(req.employeeId));
                        requestToEmployeeMap[String(req._id)] = String(req.employeeId);
                    }
                });
            }
        }

        // 2. Batch-fetch Employee details for ALL collected IDs
        if (unresolvedEmpIds.size > 0) {
            const empIds = [...unresolvedEmpIds]
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id));
            if (empIds.length > 0) {
                const employees = await Employee.find({ _id: { $in: empIds } })
                    .select('empCode user_name jobInfo employeeType role userId')
                    .populate('userId', 'name phone')
                    .lean();
                employees.forEach(emp => {
                    employeeMap[emp._id.toString()] = emp;
                });
            }
        }

        const rows = docs.map(d => {
            const resourceId = d.resourceId || '';
            const actorUser = d.userId || {};

            // ── TIER 1: Populated employeeId (Employee.* events) ──
            if (d.employeeId && d.employeeId.empCode) {
                const emp = d.employeeId;
                const empUser = emp.userId || {};
                return {
                    eventId: d.eventId ?? '',
                    timestamp: d.timestamp
                        ? new Date(d.timestamp).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: true,
                          })
                        : '',
                    organizationId: d.organizationId?.toString() ?? '',
                    empId: emp.empCode ?? '',
                    empName: emp.user_name ?? empUser.name ?? '',
                    empPhone: empUser.phone ?? '',
                    empDepartment: emp.jobInfo?.department ?? '',
                    empDesignation: emp.jobInfo?.designation ?? '',
                    empType: emp.employeeType ?? '',
                    empRole: emp.role ?? '',
                    userName: actorUser.name ?? '',
                    userEmail: actorUser.email ?? '',
                    userPhone: actorUser.phone ?? '',
                    userRole: d.userRole ?? '',
                    action: d.action ?? '',
                    operation: d.operation ?? '',
                    eventType: d.eventType ?? '',
                    category: d.category ?? '',
                    resource: d.resource ?? '',
                    resourceId: resourceId,
                    success: d.success ? 'Yes' : 'No',
                    result: d.result ?? '',
                    method: d.http?.method ?? '',
                    route: d.http?.route ?? '',
                    ip: d.http?.ip ?? '',
                    changedFields: (d.changedFields ?? []).join(';'),
                    errorCode: d.errorCode ?? '',
                    safeErrorMessage: d.safeErrorMessage ?? '',
                    seq: d.seq ?? '',
                    currentHash: d.currentHash ?? '',
                };
            }

// ── TIER 2: Action-aware resolution ──
            let empId = '';
            let empName = '';
            let empPhone = '';
            let empDepartment = '';
            let empDesignation = '';
            let empType = '';
            let empRole = '';

            // Try batch-fetched Employee map (direct Employee _id → Employee fields)
            const empFromMap = resourceId ? employeeMap[String(resourceId).replace(/['"]/g, '').trim()] : null;

            // Try AttendanceRequest → Employee mapping (request._id → empId → Employee fields)
            const empFromRequestMap = resourceId && requestToEmployeeMap[String(resourceId).replace(/['"]/g, '').trim()]
                ? employeeMap[String(requestToEmployeeMap[String(resourceId).replace(/['"]/g, '').trim()])] : null;

            if (empFromMap) {
                const empUser = empFromMap.userId || {};
                empId = empFromMap.empCode ?? String(resourceId).replace(/['"]/g, '').trim();
                empName = empFromMap.user_name ?? empUser.name ?? '';
                empPhone = empUser.phone ?? '';
                empDepartment = empFromMap.jobInfo?.department ?? '';
                empDesignation = empFromMap.jobInfo?.designation ?? '';
                empType = empFromMap.employeeType ?? '';
                empRole = empFromMap.role ?? '';
            } else if (empFromRequestMap) {
                const empUser = empFromRequestMap.userId || {};
                empId = empFromRequestMap.empCode ?? '';
                empName = empFromRequestMap.user_name ?? empUser.name ?? '';
                empPhone = empUser.phone ?? '';
                empDepartment = empFromRequestMap.jobInfo?.department ?? '';
                empDesignation = empFromRequestMap.jobInfo?.designation ?? '';
                empType = empFromRequestMap.employeeType ?? '';
                empRole = empFromRequestMap.role ?? '';
            } else if (d.resource === 'AttendanceRequest' && resourceId) {
                empId = String(resourceId).replace(/['"]/g, '').trim();
            } else if (resourceId) {
                empId = String(resourceId).replace(/['"]/g, '').trim();
            }

            return {
                eventId: d.eventId ?? '',
                timestamp: d.timestamp
                    ? new Date(d.timestamp).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true,
                      })
                    : '',
                organizationId: d.organizationId?.toString() ?? '',
                empId,
                empName,
                empPhone,
                empDepartment,
                empDesignation,
                empType,
                empRole,
                userName: actorUser.name ?? '',
                userEmail: actorUser.email ?? '',
                userPhone: actorUser.phone ?? '',
                userRole: d.userRole ?? '',
                action: d.action ?? '',
                operation: d.operation ?? '',
                eventType: d.eventType ?? '',
                category: d.category ?? '',
                resource: d.resource ?? '',
                resourceId,
                success: d.success ? 'Yes' : 'No',
                result: d.result ?? '',
                method: d.http?.method ?? '',
                route: d.http?.route ?? '',
                ip: d.http?.ip ?? '',
                changedFields: (d.changedFields ?? []).join(';'),
                errorCode: d.errorCode ?? '',
                safeErrorMessage: d.safeErrorMessage ?? '',
                seq: d.seq ?? '',
                currentHash: d.currentHash ?? '',
            };
        });

        if (rows.length === 0) {
            return res.status(200).json({ success: true, message: 'No audit logs match the filters', data: [] });
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Audit Logs', {
            views: [{ state: 'frozen', ySplit: 1 }],
        });

        const headers = [
            'Event ID',
            'Timestamp (IST)',
            'Organization ID',
            'Emp ID',
            'Emp Name',
            'Emp Phone',
            'Emp Department',
            'Emp Designation',
            'Emp Type',
            'Emp Role',
            'Actor Name',
            'Actor Email',
            'Actor Phone',
            'User Role',
            'Action',
            'Operation',
            'Event Type',
            'Category',
            'Resource',
            'Resource ID',
            'Success',
            'Result',
            'HTTP Method',
            'Route',
            'IP Address',
            'Changed Fields',
            'Error Code',
            'Error Message',
            'Seq',
            'Hash',
        ];

        worksheet.columns = headers.map(h => ({
            header: h,
            width: h.length + 4,
        }));

        worksheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4472C4' },
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF2F5496' } },
                left: { style: 'thin', color: { argb: 'FF2F5496' } },
                bottom: { style: 'medium', color: { argb: 'FF2F5496' } },
                right: { style: 'thin', color: { argb: 'FF2F5496' } },
            };
        });

        const lightBlue = 'FFD6E4F0';

        rows.forEach((row) => {
            const r = worksheet.addRow([
                row.eventId,
                row.timestamp,
                row.organizationId,
                row.empId,
                row.empName,
                row.empPhone,
                row.empDepartment,
                row.empDesignation,
                row.empType,
                row.empRole,
                row.userName,
                row.userEmail,
                row.userPhone,
                row.userRole,
                row.action,
                row.operation,
                row.eventType,
                row.category,
                row.resource,
                row.resourceId,
                row.success,
                row.result,
                row.method,
                row.route,
                row.ip,
                row.changedFields,
                row.errorCode,
                row.errorMessage,
                row.seq,
                row.currentHash,
            ]);

            const rowNum = r.number;
            const isEven = rowNum % 2 === 0;

            r.eachCell({ includeEmpty: true }, (cell) => {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFB4C6E7' } },
                    left: { style: 'thin', color: { argb: 'FFB4C6E7' } },
                    bottom: { style: 'thin', color: { argb: 'FFB4C6E7' } },
                    right: { style: 'thin', color: { argb: 'FFB4C6E7' } },
                };
                cell.alignment = { vertical: 'middle', wrapText: false };
                cell.font = { size: 10 };
                if (isEven) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: lightBlue },
                    };
                }
            });

            const successCell = r.getCell(21);
            if (row.success === 'Yes') {
                successCell.font = { bold: true, color: { argb: 'FF006100' }, size: 10 };
                successCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFC6EFCE' },
                };
            } else {
                successCell.font = { bold: true, color: { argb: 'FF9C0006' }, size: 10 };
                successCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFC7CE' },
                };
            }
        });

        const autoColWidths = headers.map((h, i) => {
            let maxLen = h.length;
            rows.forEach(row => {
                const val = Object.values(row)[i];
                if (val != null) maxLen = Math.max(maxLen, String(val).length);
            });
            return Math.min(Math.max(maxLen + 2, 12), 50);
        });
        worksheet.columns.forEach((col, i) => { col.width = autoColWidths[i]; });

        worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: headers.length },
        };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.xlsx"`);

        await workbook.xlsx.write(res);

        logApiAction({
            action: 'EXPORT',
            model: 'Audit',
            req,
            extra: {
                exportedRows: rows.length,
                filters: JSON.stringify(req.query).slice(0, 500),
            },
        });

        return res.status(200).send();

    } catch (err) {
        return sendError(res, err, 'Export failed');
    }
};

/* ────────────────────────────────────────────────────────────────
   9. DEACTIVATE EVENT — POST /api/audit/:eventId/deactivate
   Env-gated (default OFF). NEVER deletes the record — only flips
   visibilityStatus and writes a companion AUDIT.EVENT_DEACTIVATED
   audit trail entry describing who hid what and why.
   ──────────────────────────────────────────────────────────────── */

export const deactivateAuditEvent = async (req, res) => {
    try {
        if (String(process.env.AUDIT_LOG_DEACTIVATION_ENABLED).toLowerCase() !== 'true') {
            return res.status(403).json({
                success: false,
                message: 'Audit event deactivation is disabled by policy (AUDIT_LOG_DEACTIVATION_ENABLED!=true)',
            });
        }

        const { eventId } = req.params;
        const { reason } = req.body || {};

        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ success: false, message: 'A deactivation reason is required' });
        }

        const { filter } = buildAuditLogQuery(
            { eventId, includeHidden: 'true' },
            authContextFrom(req)
        );

        const evt = await AuditLog.findOne(filter);
        if (!evt) {
            return res.status(404).json({ success: false, message: 'Audit event not found' });
        }

        if (evt.visibilityStatus === 'HIDDEN') {
            return res.status(200).json({
                success: true,
                message: 'Audit event already deactivated',
                data: { eventId: evt.eventId, visibilityStatus: evt.visibilityStatus },
            });
        }

        evt.visibilityStatus = 'HIDDEN';
        evt.deactivatedAt = new Date();
        evt.deactivatedBy = req.user?.id || req.user?._id || null;
        evt.deactivationReason = String(reason).trim().slice(0, 500);
        await evt.save(); // append-only content untouched — lifecycle fields only

        // Companion audit trail entry describing THIS administrative action
        logApiAction({
            action: 'EVENT_DEACTIVATED',
            model: 'Audit',
            req,
            resourceId: evt.eventId,
            reason: evt.deactivationReason,
            extra: {
                targetEventId: evt.eventId,
                targetAction: evt.action,
                deactivatedBy: String(evt.deactivatedBy ?? ''),
            },
        });

        return res.status(200).json({
            success: true,
            message: 'Audit event deactivated (record preserved)',
            data: {
                eventId: evt.eventId,
                visibilityStatus: evt.visibilityStatus,
                deactivatedAt: evt.deactivatedAt,
                deactivationReason: evt.deactivationReason,
            },
        });
    } catch (err) {
        return sendError(res, err, 'Deactivation failed');
    }
};