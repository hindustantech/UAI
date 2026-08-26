// controllers/Audit/auditLog.controller.js
import mongoose from 'mongoose';
import AuditLog from '../../models/AuditLog.js';

const VALID_CATEGORIES = ['AUTHENTICATION', 'AUTHORIZATION', 'DATA', 'BUSINESS', 'SYSTEM', 'ADMIN'];
const VALID_ACTOR_TYPES = ['USER', 'SERVICE_ACCOUNT', 'SYSTEM', 'CRON', 'QUEUE', 'WORKER'];
const VALID_RESULTS = ['SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS', 'NOT_FOUND', 'NO_CHANGE', 'ROLLBACK', 'REJECTED', 'DENIED'];
const VALID_ORIGINS = ['HTTP', 'CRON', 'QUEUE', 'WORKER', 'SYSTEM'];

const MAX_PAGE_LIMIT = 100;

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Resolve organization scoping:
 * - GLOBAL scope users (super_admin / partner / platform admins) see all logs
 * - COMPANY scope users only see logs of their own organization
 */
const resolveOrganizationFilter = (reqUser) => {
    const role = reqUser?.type || reqUser?.role;
    const scope = reqUser?.scope;

    if (scope === 'GLOBAL' || role === 'super_admin' || role === 'partner') {
        return null; // no org restriction
    }

    const orgId = reqUser?.companyId || reqUser?._id || reqUser?.id;
    if (orgId && mongoose.Types.ObjectId.isValid(String(orgId))) {
        return { organizationId: new mongoose.Types.ObjectId(String(orgId)) };
    }

    const uid = reqUser?._id || reqUser?.id;
    if (uid && mongoose.Types.ObjectId.isValid(String(uid))) {
        return {
            $or: [
                { organizationId: new mongoose.Types.ObjectId(String(uid)) },
                { userId: new mongoose.Types.ObjectId(String(uid)) },
            ],
        };
    }

    return null;
};

/**
 * GET /api/audit/logs
 * Paginated + filterable + searchable audit log listing (Admin Panel).
 *
 * Query params:
 *   page, limit          -> pagination (limit capped at MAX_PAGE_LIMIT)
 *   search               -> regex across action, resource, resourceId, eventId, requestId, userRole
 *   category             -> enum filter
 *   action               -> exact action tag filter
 *   actorType            -> enum filter
 *   result               -> enum filter (SUCCESS/FAILURE/...)
 *   origin               -> enum filter
 *   success              -> "true"/"false"
 *   startDate, endDate   -> timestamp range (inclusive)
 *   sortBy, sortOrder    -> sort control (timestamp default)
 */
export const getAllAuditLogs = async (req, res) => {
    try {
        let {
            page = 1,
            limit = 20,
            search,
            category,
            action,
            actorType,
            result,
            origin,
            success,
            startDate,
            endDate,
            sortBy = 'timestamp',
            sortOrder = 'desc',
        } = req.query;

        page = Math.max(1, parseInt(page, 10) || 1);
        limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, parseInt(limit, 10) || 20));
        const skip = (page - 1) * limit;

        /* ---------------- Build Filter ---------------- */
        const filter = {};

        const orgFilter = resolveOrganizationFilter(req.user);
        if (orgFilter) Object.assign(filter, orgFilter);

        if (category && VALID_CATEGORIES.includes(category)) {
            filter.category = category;
        }
        if (action) {
            filter.action = action;
        }
        if (actorType && VALID_ACTOR_TYPES.includes(actorType)) {
            filter.actorType = actorType;
        }
        if (result && VALID_RESULTS.includes(result)) {
            filter.result = result;
        }
        if (origin && VALID_ORIGINS.includes(origin)) {
            filter.origin = origin;
        }
        if (success === 'true' || success === 'false') {
            filter.success = success === 'true';
        }

        // Date range on timestamp
        if (startDate || endDate) {
            filter.timestamp = {};
            if (startDate) {
                const s = new Date(startDate);
                if (!isNaN(s.getTime())) filter.timestamp.$gte = s;
            }
            if (endDate) {
                const e = new Date(endDate);
                if (!isNaN(e.getTime())) {
                    e.setHours(23, 59, 59, 999);
                    filter.timestamp.$lte = e;
                }
            }
        }

        // Search across key fields
        if (search && String(search).trim()) {
            const term = escapeRegex(search.trim());
            filter.$or = [
                { action: { $regex: term, $options: 'i' } },
                { resource: { $regex: term, $options: 'i' } },
                { resourceId: { $regex: term, $options: 'i' } },
                { userRole: { $regex: term, $options: 'i' } },
                { eventId: { $regex: term, $options: 'i' } },
                { requestId: { $regex: term, $options: 'i' } },
                { errorCode: { $regex: term, $options: 'i' } },
            ];
        }

        /* ---------------- Sorting ---------------- */
        const allowedSortFields = ['timestamp', 'action', 'category', 'durationMs', 'createdAt'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'timestamp';
        const sortDir = sortOrder === 'asc' ? 1 : -1;
        const sort = { [sortField]: sortDir };

        /* ---------------- Execution ---------------- */
        const [logs, total] = await Promise.all([
            AuditLog.find(filter)
                .populate('userId', 'name email phone type')
                .populate('employeeId', 'name email')
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
            data: logs,
            pagination: {
                totalRecords: total,
                totalPages,
                currentPage: page,
                perPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        });
    } catch (error) {
        console.error('GET AUDIT LOGS ERROR:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch audit logs',
            error: error.message,
        });
    }
};

/**
 * GET /api/audit/stats
 * Aggregated overview for the admin dashboard header.
 */
export const getAuditLogStats = async (req, res) => {
    try {
        const baseFilter = {};
        const orgFilter = resolveOrganizationFilter(req.user);
        if (orgFilter) Object.assign(baseFilter, orgFilter);

        const [byCategory, byResult, failedCount, total] = await Promise.all([
            AuditLog.aggregate([
                { $match: baseFilter },
                { $group: { _id: '$category', count: { $sum: 1 } } },
            ]),
            AuditLog.aggregate([
                { $match: baseFilter },
                { $group: { _id: '$result', count: { $sum: 1 } } },
            ]),
            AuditLog.countDocuments({ ...baseFilter, success: false }),
            AuditLog.countDocuments(baseFilter),
        ]);

        return res.status(200).json({
            success: true,
            message: 'Audit stats fetched successfully',
            data: {
                total,
                failedCount,
                byCategory: byCategory.reduce((acc, c) => ({ ...acc, [c._id || 'UNKNOWN']: c.count }), {}),
                byResult: byResult.reduce((acc, r) => ({ ...acc, [r._id || 'UNKNOWN']: r.count }), {}),
            },
        });
    } catch (error) {
        console.error('GET AUDIT STATS ERROR:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch audit stats',
            error: error.message,
        });
    }
};

/**
 * GET /api/audit/:eventId
 * Single audit event full detail (diff data, http context, chain info).
 */
export const getAuditLogByEventId = async (req, res) => {
    try {
        const { eventId } = req.params;

        const filter = { eventId };
        const orgFilter = resolveOrganizationFilter(req.user);
        if (orgFilter) Object.assign(filter, orgFilter);

        const log = await AuditLog.findOne(filter)
            .populate('userId', 'name email phone type')
            .populate('employeeId', 'name email')
            .lean();

        if (!log) {
            return res.status(404).json({
                success: false,
                message: 'Audit log not found',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Audit log fetched successfully',
            data: log,
        });
    } catch (error) {
        console.error('GET AUDIT LOG DETAIL ERROR:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch audit log',
            error: error.message,
        });
    }
};
