// controllers/Audit/auditDashboard.controller.js
import mongoose from 'mongoose';
import AuditLog from '../../models/AuditLog.js';
import { buildAuditLogQuery, ValidationError } from '../../services/audit/queryBuilder.js';
import { normalizeAuditEvents } from '../../services/audit/presenter.js';

const GLOBAL_SCOPE = '__GLOBAL__';

const authContextFrom = (req) => ({
    scope: req.user?.scope,
    type: req.user?.type,
    companyId: req.user?.companyId || null,
    userId: req.user?.id || req.user?._id || null,
});

const sendError = (res, err, fallback = 'Dashboard data failed') => {
    if (err instanceof ValidationError) {
        return res.status(400).json({ success: false, message: err.message });
    }
    console.error('AUDIT DASHBOARD ERROR:', err);
    return res.status(500).json({ success: false, message: fallback });
};

/**
 * GET /api/audit/dashboard
 * Single round-trip returning everything the dashboard page needs:
 *   - summary counts
 *   - time-series (daily or hourly buckets)
 *   - recent activity
 *   - top actors/resources/actions
 *
 * Query params: from, to, organizationId (global only), windowDays (default 7)
 */
export const getAuditDashboard = async (req, res) => {
    try {
        // Validate + build org-scoped base filter (ignore pagination/sort)
        const { filter } = buildAuditLogQuery(
            { ...req.query, page: 1, limit: 1 },
            authContextFrom(req)
        );

        // Default to last 7 days when no range specified
        const days = parseInt(String(req.query.windowDays || 7), 10) || 7;
        if (!filter.timestamp) {
            const now = new Date();
            filter.timestamp = { $gte: new Date(now.getTime() - days * 86400000) };
        }

        const base = [{ $match: filter }];

        const [
            total,
            successCount,
            failCount,
            byOperation,
            byCategory,
            timeSeries,
            topActors,
            topResources,
            topActions,
            recentActivity,
        ] = await Promise.all([
            AuditLog.countDocuments(filter),
            AuditLog.countDocuments({ ...filter, success: true }),
            AuditLog.countDocuments({ ...filter, success: false }),

            AuditLog.aggregate([
                ...base,
                { $group: { _id: { $ifNull: ['$operation', 'OTHER'] }, count: { $sum: 1 } } },
            ]),

            AuditLog.aggregate([
                ...base,
                { $group: { _id: { $ifNull: ['$category', 'UNKNOWN'] }, count: { $sum: 1 } } },
            ]),

            // Time-series: determine bucket granularity from range width
            (async () => {
                const rangeMs = (filter.timestamp?.$gte && filter.timestamp?.$lte)
                    ? filter.timestamp.$lte.getTime() - filter.timestamp.$gte.getTime()
                    : days * 86400000;
                const bucketCount = Math.ceil(rangeMs / 3600000); // number of hours
                const useHourly = bucketCount <= 48;

                if (useHourly) {
                    return AuditLog.aggregate([
                        ...base,
                        {
                            $group: {
                                _id: {
                                    $dateToString: { format: '%Y-%m-%dT%H:00:00Z', date: '$timestamp' },
                                },
                                total: { $sum: 1 },
                                success: { $sum: { $cond: ['$success', 1, 0] } },
                                failed: { $sum: { $cond: ['$success', 0, 1] } },
                            },
                        },
                        { $sort: { _id: 1 } },
                        { $limit: 100 },
                    ]);
                }
                return AuditLog.aggregate([
                    ...base,
                    {
                        $group: {
                            _id: {
                                $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
                            },
                            total: { $sum: 1 },
                            success: { $sum: { $cond: ['$success', 1, 0] } },
                            failed: { $sum: { $cond: ['$success', 0, 1] } },
                        },
                    },
                    { $sort: { _id: 1 } },
                    { $limit: 90 },
                ]);
            })(),

            AuditLog.aggregate([
                ...base,
                { $group: { _id: '$userId', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 8 },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user',
                        pipeline: [{ $project: { name: 1, email: 1 } }],
                    },
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
            ]),

            AuditLog.aggregate([
                ...base,
                { $group: { _id: '$resource', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 8 },
            ]),

            AuditLog.aggregate([
                ...base,
                { $group: { _id: '$action', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 8 },
            ]),

            // Recent activity (latest 15 events)
            AuditLog.find(filter)
                .populate('userId', 'name email type')
                .sort({ timestamp: -1 })
                .limit(15)
                .select('eventId timestamp action operation eventType category resource resourceId userId userRole success result http.ip')
                .lean(),
        ]);

        const opMap = Object.fromEntries(byOperation.map(o => [o._id, o.count]));
        const catMap = Object.fromEntries(byCategory.map(c => [c._id, c.count]));

        return res.status(200).json({
            success: true,
            message: 'Audit dashboard data fetched successfully',
            data: {
                summary: {
                    totalEvents: total,
                    successfulEvents: successCount,
                    failedEvents: failCount,
                    creates:      opMap.CREATE      ?? 0,
                    updates:      opMap.UPDATE      ?? 0,
                    deletes:      opMap.DELETE      ?? 0,
                    activations:  opMap.ACTIVATE    ?? 0,
                    deactivations:opMap.DEACTIVATE  ?? 0,
                    payments:     opMap.PAYMENT     ?? 0,
                    reads:        opMap.READ        ?? 0,
                    other:        opMap.OTHER       ?? 0,
                },
                timeSeries: timeSeries.map(b => ({
                    date: b._id,
                    total: b.total,
                    success: b.success,
                    failed: b.failed,
                })),
                topActors: topActors.map(a => ({
                    userId: a._id,
                    name: a.user?.name ?? null,
                    email: a.user?.email ?? null,
                    count: a.count,
                })),
                topResources: topResources.map(r => ({ resource: r._id, count: r.count })),
                topActions: topActions.map(a => ({ action: a._id, count: a.count })),
                byCategory: catMap,
                recentActivity: normalizeAuditEvents(recentActivity),
                windowDays: days,
            },
        });
    } catch (err) {
        return sendError(res, err);
    }
};
