/**
 * Centralized audit-log query builder.
 *
 * Every investigation endpoint uses this function so that:
 *   - Organization isolation is enforced in one place (no per-controller bugs)
 *   - Input validation is uniform
 *   - Invalid params return 400, never leak Mongo errors
 *   - Sort whitelist prevents field injection
 *   - Pagination is capped
 */

import mongoose from 'mongoose';

const MAX_PAGE_LIMIT   = 200;
const DEFAULT_PAGE     = 1;
const DEFAULT_LIMIT    = 50;
const DEFAULT_SORT_BY  = 'timestamp';
const DEFAULT_SORT_DIR = -1;

const VALID_SORT_FIELDS = new Set([
    'timestamp', 'action', 'resource', 'resourceId',
    'userId', 'success', 'category', 'createdAt',
    'eventType', 'operation',
]);

const VALID_OPERATIONS = new Set([
    'CREATE', 'UPDATE', 'DELETE', 'ACTIVATE', 'DEACTIVATE',
    'PAYMENT', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT',
    'PROCESS', 'EXPORT', 'READ', 'OTHER',
]);

const VALID_EVENT_TYPES = new Set([
    'READ', 'WRITE', 'SECURITY', 'FINANCIAL', 'SYSTEM',
]);

const VALID_RESULTS = new Set([
    'SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS', 'NOT_FOUND',
    'NO_CHANGE', 'ROLLBACK', 'REJECTED', 'DENIED',
]);

/* ────────────────────────────────────────────────────────────────
   ERROR CLASSES
   ──────────────────────────────────────────────────────────────── */

export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 400;
    }
}

/* ────────────────────────────────────────────────────────────────
   BUILD THE FILTER + SORT + PAGINATION OBJECTS
   ──────────────────────────────────────────────────────────────── */

/**
 * @param {object} params           — query params from req.query
 * @param {object} authContext      — { scope, companyId, userId, type }
 * @returns {{ filter, sort, page, limit, skip }}
 */
export const buildAuditLogQuery = (params, authContext = {}) => {
    const {
        organizationId,
        userId,
        resourceId,
        resource,
        action,
        operation,
        eventType,
        category,
        result,
        success,
        method,
        requestId,
        ip,
        search,
        eventId,
        includeHidden,
        page = DEFAULT_PAGE,
        limit = DEFAULT_LIMIT,
        sortBy = DEFAULT_SORT_BY,
        sortOrder,
    } = params;

    const filter = {};

    /* ──────────────────────────────────────────────────────────────
       ORGANIZATION ISOLATION — CRITICAL
       COMPANY-scope users are ALWAYS forced to their own companyId.
       GLOBAL scope (super_admin / partner) may query any org.
       ────────────────────────────────────────────────────────────── */

    const isGlobal = authContext.scope === 'GLOBAL' ||
                     authContext.type === 'super_admin' ||
                     authContext.type === 'partner';

    if (!isGlobal) {
        const orgId = authContext.companyId;
        if (!orgId || !mongoose.Types.ObjectId.isValid(String(orgId))) {
            throw new ValidationError('Organization scope not available for this user');
        }
        filter.organizationId = new mongoose.Types.ObjectId(String(orgId));
    } else if (organizationId) {
        if (!mongoose.Types.ObjectId.isValid(String(organizationId))) {
            throw new ValidationError('Invalid organizationId');
        }
        filter.organizationId = new mongoose.Types.ObjectId(String(organizationId));
    }

    /* ──────────────────────────────────────────────────────────────
       OPTIONAL ID-FIELD FILTERS (all AND-combined)
       ────────────────────────────────────────────────────────────── */

    if (userId) {
        if (!mongoose.Types.ObjectId.isValid(String(userId))) {
            throw new ValidationError('Invalid userId');
        }
        filter.userId = new mongoose.Types.ObjectId(String(userId));
    }

    if (resourceId) {
        filter.resourceId = String(resourceId).trim();
    }

    if (resource) {
        filter.resource = String(resource).trim();
    }

    if (action) {
        filter.action = String(action).trim();
    }

    if (operation) {
        const op = String(operation).toUpperCase().trim();
        if (!VALID_OPERATIONS.has(op)) throw new ValidationError(`Invalid operation: ${op}`);
        filter.operation = op;
    }

    if (eventType) {
        const et = String(eventType).toUpperCase().trim();
        if (!VALID_EVENT_TYPES.has(et)) throw new ValidationError(`Invalid eventType: ${et}`);
        filter.eventType = et;
    }

    if (category) {
        filter.category = String(category).trim();
    }

    if (result) {
        const r = String(result).toUpperCase().trim();
        if (!VALID_RESULTS.has(r)) throw new ValidationError(`Invalid result: ${r}`);
        filter.result = r;
    }

    if (success === 'true' || success === 'false') {
        filter.success = success === 'true';
    }

    if (method) {
        filter['http.method'] = String(method).toUpperCase().trim();
    }

    if (requestId) {
        filter.requestId = String(requestId).trim();
    }

    if (ip) {
        filter['http.ip'] = { $regex: escapeRegex(String(ip).trim()), $options: 'i' };
    }

    if (eventId) {
        filter.eventId = String(eventId).trim();
    }

    /* ──────────────────────────────────────────────────────────────
       DATE RANGE — UTC, strict validation, from <= to
       ────────────────────────────────────────────────────────────── */

    const fromRaw = params.from || params.startDate;
    const toRaw   = params.to   || params.endDate;

    if (fromRaw || toRaw) {
        filter.timestamp = {};

        if (fromRaw) {
            const d = new Date(fromRaw);
            if (isNaN(d.getTime())) throw new ValidationError('Invalid "from" date');
            filter.timestamp.$gte = d;
        }
        if (toRaw) {
            const d = new Date(toRaw);
            if (isNaN(d.getTime())) throw new ValidationError('Invalid "to" date');
            filter.timestamp.$lte = d;
        }
        if (filter.timestamp.$gte && filter.timestamp.$lte &&
            filter.timestamp.$gte > filter.timestamp.$lte) {
            throw new ValidationError('"from" date must not be after "to" date');
        }
    }

    /* ──────────────────────────────────────────────────────────────
       VISIBILITY FILTER — only admins with AUDIT.DEACTIVATE see
       hidden records (or when includeHidden=true).
       Non-admin users never see hidden records.
       ────────────────────────────────────────────────────────────── */

    const canSeeHidden = includeHidden === 'true' && isGlobal;
    if (!canSeeHidden) {
        filter.visibilityStatus = { $ne: 'HIDDEN' };
    }

    /* ──────────────────────────────────────────────────────────────
       SEARCH (indexed fields only where possible)
       ────────────────────────────────────────────────────────────── */

    if (search && String(search).trim()) {
        const term = escapeRegex(search.trim());
        const looksLikeObjectId = mongoose.Types.ObjectId.isValid(String(search).trim());

        filter.$or = [
            { action:    { $regex: term, $options: 'i' } },
            { resource:  { $regex: term, $options: 'i' } },
            { resourceId:{ $regex: term, $options: 'i' } },
            { userRole:  { $regex: term, $options: 'i' } },
            { 'http.route': { $regex: term, $options: 'i' } },
            { 'http.ip':    { $regex: term, $options: 'i' } },
            { errorCode: { $regex: term, $options: 'i' } },
        ];

        if (looksLikeObjectId) {
            filter.$or.push(
                { userId:  new mongoose.Types.ObjectId(String(search).trim()) },
                { eventId: String(search).trim() },
            );
        } else {
            filter.$or.push({ eventId: { $regex: term, $options: 'i' } });
        }

        if (String(search).trim().startsWith('req_') || String(search).trim().startsWith('urn:')) {
            filter.$or.push({ requestId: String(search).trim() });
        }
    }

    /* ──────────────────────────────────────────────────────────────
       PAGINATION + SORTING
       ────────────────────────────────────────────────────────────── */

    const pg = Math.max(1, parseInt(String(page), 10) || DEFAULT_PAGE);
    const lim = Math.min(MAX_PAGE_LIMIT, Math.max(1, parseInt(String(limit), 10) || DEFAULT_LIMIT));
    const skip = (pg - 1) * lim;

    const sortField = VALID_SORT_FIELDS.has(String(sortBy).trim())
        ? String(sortBy).trim()
        : DEFAULT_SORT_BY;

    const sortDir = sortOrder === 'asc' || sortOrder === '1' ? 1 : DEFAULT_SORT_DIR;
    const sort = { [sortField]: sortDir };

    return { filter, sort, page: pg, limit: lim, skip };
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default buildAuditLogQuery;
