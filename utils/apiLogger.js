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
import {
    deriveOperation,
    deriveEventType,
    deriveSeverity,
} from "../services/audit/taxonomy.js";
import {
    sanitizeRequestBody,
    sanitizeSnapshot,
    maskFinancialMetadata,
} from "../services/audit/sanitizer.js";
import { diff as deepDiff } from "../services/audit/diff.js";

const GLOBAL_SCOPE = "__GLOBAL__";

/* ────────────────────────────────────────────────────────────────
   FIELD EXTRACTORS
   ──────────────────────────────────────────────────────────────── */

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

/* ────────────────────────────────────────────────────────────────
   EVENT SCAFFOLDING
   Derives operation / eventType / severity from the taxonomy and
   captures WHO / WHERE / WHEN.  Snapshot sanitization happens in
   services/audit/sanitizer.js — circular-safe, sensitive-redacting.
   ──────────────────────────────────────────────────────────────── */

function buildBaseEvent(req, { action, model, resourceId }) {
    const who = getActor(req);
    const where = getLocation(req);

    const fullAction = `${String(model).toUpperCase()}.${String(action).toUpperCase()}`;

    return {
        eventId: crypto.randomUUID(),
        timestamp: new Date(),
        requestId: req?.headers?.["x-request-id"] || req?.id || null,
        actorType: "USER",
        userId: who.userId && mongoose.isValidObjectId(who.userId) ? who.userId : undefined,
        organizationId: who.companyId && mongoose.isValidObjectId(who.companyId) ? who.companyId : undefined,
        userRole: who.userType,
        action: fullAction,
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

        /* Taxonomy-derived investigation dimensions */
        operation: deriveOperation(fullAction),
        eventType: deriveEventType(fullAction),
        severity: deriveSeverity(fullAction),
    };
}

/* ────────────────────────────────────────────────────────────────
   CHANGE DETECTION (deep diff over sanitized snapshots)
   CREATE / DELETE (one-sided) keep empty changedFields — the full
   snapshot lives in oldData / newData respectively.
   ──────────────────────────────────────────────────────────────── */

function applySnapshots(evt, cleanBefore, cleanAfter) {
    evt.oldData = cleanBefore ?? null;
    evt.newData = cleanAfter ?? null;

    if (cleanBefore && cleanAfter) {
        const d = deepDiff(cleanBefore, cleanAfter);
        evt.changedFields = d.changedFields;
        evt.changes = d.changes;
        evt.noChange = d.noChange;
    } else {
        evt.changedFields = [];
        evt.changes = [];
        evt.noChange = false;
    }
}

/* ────────────────────────────────────────────────────────────────
   AUDIT DB WRITE (fire-and-forget, tamper-proof)
   Never awaited by business flow — failures are silent.
   Idempotency: when a reliable x-request-id is present, an
   idempotencyKey guards against transaction/HTTP retry duplicates.
   The sparse-unique index absorbs collisions; a dropped duplicate
   leaves a tolerable seq gap (see AuditSequence docs).
   ──────────────────────────────────────────────────────────────── */

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
            operation: evt.operation,
            eventType: evt.eventType,
            severity: evt.severity,
            category: evt.category,
            resource: evt.resource,
            resourceId: evt.resourceId,
            parentResourceId: evt.parentResourceId || undefined,
            http: evt.http,
            sanitizedRequestBody: evt.sanitizedRequestBody,
            oldData: evt.oldData ?? null,
            newData: evt.newData ?? null,
            changedFields: evt.changedFields,
            changes: evt.changes ?? [],
            noChange: Boolean(evt.noChange),
            success: evt.success,
            result: evt.result,
            errorCode: evt.errorCode,
            errorCategory: evt.errorCategory,
            safeErrorMessage: evt.safeErrorMessage,
            durationMs: evt.durationMs,
            source: evt.source,
            origin: evt.origin,
            jobId: evt.jobId,
            queueName: evt.queueName,
            cronJobName: evt.cronJobName,
            initiatingUserId: evt.initiatingUserId || undefined,
            metadata: evt.metadata,
            bulk: evt.bulk,
            file: evt.file,
            payloadTruncated: evt.payloadTruncated ?? false,
            idempotencyKey: evt.idempotencyKey || undefined,
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

/* ────────────────────────────────────────────────────────────────
   PUBLIC API
   ──────────────────────────────────────────────────────────────── */

/**
 * Structured API action logger — dual write:
 *   1. Winston → logs/app.log (fast, sync-ish)
 *   2. AuditLog → MongoDB (fire-and-forget, searchable, tamper-proof)
 *
 * Captures WHAT / WHO / WHERE / WHY / WHEN + BEFORE/AFTER snapshots.
 *
 * NOTE: call AFTER the DB transaction commits (existing controller
 * pattern) — audit logging is eventual/after-commit by design so a
 * MongoDB WriteConflict in the audit path can never abort the
 * primary business operation.
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
                ? JSON.stringify(sanitizeRequestBody(req.body)).slice(0, auditConfig.maxBodySize)
                : undefined;

            applySnapshots(evt, cleanBefore, cleanAfter);

            evt.success = true;
            evt.result = "SUCCESS";
            evt.source = "USER_ACTION";
            evt.metadata = maskFinancialMetadata({
                reason: reason ?? req?.body?.reason ?? null,
                ...extra,
            });

            if (evt.requestId) {
                evt.idempotencyKey = `${evt.requestId}:${evt.action}:${evt.resourceId}`;
            }

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
            evt.success = false;
            evt.result = "FAILURE";
            evt.errorCode = error?.code || error?.name || "INTERNAL_ERROR";
            evt.errorCategory = error?.name || "Error";
            evt.safeErrorMessage = String(errorMessage).slice(0, 500);
            evt.source = "USER_ACTION";
            evt.metadata = maskFinancialMetadata({ ...extra });

            applySnapshots(evt, null, null);

            if (evt.requestId) {
                evt.idempotencyKey = `${evt.requestId}:${evt.action}:${evt.resourceId}`;
            }

            writeToAuditDb(evt); // intentionally not awaited
        }
    } catch {
        // logging must never break business flow
    }
};

export default { logApiAction, logApiError };