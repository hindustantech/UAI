import logger from "./logger.js";
import crypto from "crypto";
import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.js";
import "../models/AuditSequence.js";
import auditConfig from "../services/audit/config.js";
import {
    allocateSequence,
    getPreviousHash,
    computeEventHash,
} from "../services/audit/hashChain.js";

const GLOBAL_SCOPE = "__GLOBAL__";

/* ────────────────────────────────────────────────
   FIELD EXTRACTORS
   ──────────────────────────────────────────────── */

const getActor = (req) => ({
    userId: req?.user?._id?.toString() || req?.user?.id || null,
    userType: req?.user?.type || req?.user?.role || null,
    companyId: req?.user?.companyId?.toString() || (req?.user?.type === "partner" ? req?.user?.id : null) || null,
});

const getLocation = (req) => ({
    method: req?.method,
    route: req?.originalUrl || req?.url,
    ip: req?.ip || req?.connection?.remoteAddress || null,
});

// Model name → AuditLog category mapping
function resolveCategory(model) {
    const m = String(model).toUpperCase();
    if (["PAYMENT", "PAYMENTLOG", "SUBSCRIPTION", "ORDER", "PLAN", "PRICINGRULE"].includes(m)) return "BUSINESS";
    if (["USER", "PERMISSION", "ASSIGNPERMISSION", "PERMISSIONLOG"].includes(m)) return "ADMIN";
    return "DATA";
}

/* ────────────────────────────────────────────────
   SANITIZATION
   ──────────────────────────────────────────────── */

function sanitizeSnapshot(data) {
    if (!data || typeof data !== "object") return data;
    if (data instanceof Date) return data.toISOString();
    if (Array.isArray(data)) return data.slice(0, 50).map(sanitizeSnapshot);

    const obj = typeof data.toJSON === "function" ? data.toJSON() : (typeof data.toObject === "function" ? data.toObject() : data);

    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
        if (auditConfig.sensitiveFields.has(k.toLowerCase()) ||
            SENSITIVE_FIELDS.some((f) => k.toLowerCase().includes(f.toLowerCase()))) {
            clean[k] = "[REDACTED]";
        } else if (v && typeof v === "object" && !(v instanceof Date) && !(typeof v.toHexString === "function")) {
            clean[k] = sanitizeSnapshot(v);
        } else {
            clean[k] = typeof v?.toHexString === "function" ? v.toString() : v;
        }
    }
    return clean;
}

const SENSITIVE_FIELDS = [
    "password", "otp", "pin", "token", "refreshToken", "accessToken",
    "secret", "key", "credential", "devicetoken", "deviceToken",
];

/** Compute top-level keys whose values differ between old & new */
function computeChangedFields(before, after) {
    if (!before || !after) return [];
    const b = typeof before === "object" ? before : {};
    const a = typeof after === "object" ? after : {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const changed = [];
    for (const k of keys) {
        if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changed.push(k);
    }
    return changed.slice(0, 50);
}

/* ────────────────────────────────────────────────
   AUDIT DB WRITE (fire-and-forget, tamper-proof)
   Never awaited by business flow — failures are silent.
   ──────────────────────────────────────────────── */

async function writeToAuditDb(evt) {
    try {
        const chainScope = evt.organizationId || GLOBAL_SCOPE;

        // Reserve sequence atomically (safe across processes)
        const seq = await allocateSequence(chainScope);
        const previousHash = await getPreviousHash(chainScope, seq);

        const eventDoc = {
            eventId: evt.eventId,
            schemaVersion: 1,
            timestamp: evt.timestamp,
            requestId: evt.requestId,
            actorType: evt.actorType,
            userId: evt.userId || undefined,
            employeeId: evt.employeeId || undefined,
            organizationId: evt.organizationId || undefined,
            userRole: evt.userRole,
            action: evt.action,
            category: evt.category,
            resource: evt.resource,
            resourceId: evt.resourceId,
            http: evt.http,
            sanitizedRequestBody: evt.sanitizedRequestBody,
            oldData: evt.oldData ?? null,
            newData: evt.newData ?? null,
            changedFields: evt.changedFields,
            success: evt.success,
            result: evt.result,
            errorCode: evt.errorCode,
            errorCategory: evt.errorCategory,
            safeErrorMessage: evt.safeErrorMessage,
            origin: evt.origin,
            cronJobName: evt.cronJobName,
            metadata: evt.metadata,
            chainScope,
            seq,
            previousHash,
            currentHash: null,
        };

        eventDoc.currentHash = computeEventHash({
            eventId: eventDoc.eventId,
            timestamp: eventDoc.timestamp,
            actorType: eventDoc.actorType,
            actorId: evt.userId,
            action: eventDoc.action,
            resource: eventDoc.resource,
            resourceId: eventDoc.resourceId,
            requestId: eventDoc.requestId,
            success: eventDoc.success,
            oldData: eventDoc.oldData,
            newData: eventDoc.newData,
            previousHash,
        });

        await AuditLog.create(eventDoc);
    } catch {
        // Audit DB failure must NEVER break business flow.
        // File log (already written) is the fallback record.
    }
}

function buildBaseEvent(req, { action, model, resourceId }) {
    const who = getActor(req);
    const where = getLocation(req);

    return {
        eventId: crypto.randomUUID(),
        timestamp: new Date(),
        requestId: req?.headers?.["x-request-id"] || req?.id || null,
        actorType: "USER",
        userId: who.userId && mongoose.isValidObjectId(who.userId) ? who.userId : undefined,
        organizationId: who.companyId && mongoose.isValidObjectId(who.companyId) ? who.companyId : undefined,
        userRole: who.userType,
        action: `${String(model).toUpperCase()}.${String(action).toUpperCase()}`,
        resource: String(model),
        resourceId: resourceId != null ? String(resourceId) : "N/A",
        http: {
            method: where.method,
            route: where.route,
            url: where.route,
            ip: where.ip,
            userAgent: req?.headers?.["user-agent"],
        },
        category: resolveCategory(model),
        origin: "HTTP",
    };
}

/* ────────────────────────────────────────────────
   PUBLIC API
   ──────────────────────────────────────────────── */

/**
 * Structured API action logger — dual write:
 *   1. Winston → logs/app.log (fast, sync-ish)
 *   2. AuditLog → MongoDB (fire-and-forget, searchable, tamper-proof)
 *
 * Captures WHAT / WHO / WHERE / WHY / WHEN + BEFORE/AFTER snapshots.
 */
export const logApiAction = ({
    level = "info",
    action,
    model,
    req,
    resourceId = null,
    before = null,
    after = null,
    reason = null,
    extra = {},
}) => {
    try {
        const cleanBefore = before ? sanitizeSnapshot(before) : null;
        const cleanAfter = after ? sanitizeSnapshot(after) : null;

        // 1. File/console log (never blocks)
        logger[level](`[API] ${action} | ${model}`, {
            what: { action, model, resourceId },
            who: getActor(req),
            where: getLocation(req),
            why: { reason: reason ?? req?.body?.reason ?? null },
            when: new Date().toISOString(),
            before: cleanBefore,
            after: cleanAfter,
            ...extra,
        });

        // 2. AuditLog DB entry (fire-and-forget)
        if (auditConfig.enabled) {
            const evt = buildBaseEvent(req, { action, model, resourceId });
            evt.sanitizedRequestBody = auditConfig.requestBodyEnabled && req?.body
                ? JSON.stringify(sanitizeSnapshot(req.body)).slice(0, auditConfig.maxBodySize)
                : undefined;
            evt.oldData = cleanBefore;
            evt.newData = cleanAfter;
            evt.changedFields = computeChangedFields(cleanBefore, cleanAfter);
            evt.noChange = Boolean(cleanBefore && cleanAfter && evt.changedFields.length === 0);
            evt.success = true;
            evt.result = "SUCCESS";
            evt.source = "USER_ACTION";
            evt.metadata = { reason: reason ?? req?.body?.reason ?? null, ...extra };

            writeToAuditDb(evt); // intentionally not awaited
        }
    } catch {
        // logging must never break business flow
    }
};

export const logApiError = (action, model, error, req, extra = {}) => {
    try {
        const errorMessage = error?.message;

        // 1. File/console log (never blocks)
        logger.error(`[API_ERROR] ${action} | ${model}`, {
            what: { action, model },
            who: getActor(req),
            where: getLocation(req),
            when: new Date().toISOString(),
            error: {
                message: errorMessage,
                name: error?.name,
                code: error?.code,
                stack: error?.stack,
            },
            ...extra,
        });

        // 2. AuditLog DB entry (fire-and-forget)
        if (auditConfig.enabled) {
            const evt = buildBaseEvent(req, { action, model, resourceId: extra.resourceId });
            delete evt.http.statusCode;
            evt.success = false;
            evt.result = "FAILURE";
            evt.errorCode = error?.code || error?.name || "INTERNAL_ERROR";
            evt.errorCategory = error?.name || "Error";
            evt.safeErrorMessage = String(errorMessage).slice(0, 500);
            evt.source = "USER_ACTION";
            evt.metadata = { ...extra };

            writeToAuditDb(evt); // intentionally not awaited
        }
    } catch {
        // logging must never break business flow
    }
};

export default { logApiAction, logApiError };
