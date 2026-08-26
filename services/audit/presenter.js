/**
 * Audit event normalizer / presenter.
 *
 * Enriches raw Mongoose lean() documents with derived fields
 * (operation, eventType, actor info, chain info) so that
 * investigation endpoints return a consistent, frontend-friendly shape.
 * For historical records missing operation / eventType / changes[],
 * these are derived on-the-fly from the action string and oldData/newData.
 */

import { deriveFromAction } from './taxonomy.js';
import { diff as deepDiff, formatDiffForDisplay } from './diff.js';

/* ────────────────────────────────────────────────────────────────
   NORMALIZE SINGLE EVENT
   ──────────────────────────────────────────────────────────────── */

/**
 * @param {object} doc  — raw lean() audit document
 * @returns {object}    — enriched, flat, frontend-safe event
 */
export const normalizeAuditEvent = (doc) => {
    if (!doc) return null;

    const derived = deriveFromAction(doc.action);

    const operation    = doc.operation    || derived.operation;
    const eventType    = doc.eventType    || derived.eventType;
    const severity     = doc.severity     || derived.severity;

    // Changes: use stored changes[] if present; otherwise derive from oldData/newData/changedFields
    let changes = doc.changes || null;
    if (!changes && doc.oldData && doc.changedFields && doc.changedFields.length > 0) {
        changes = formatDiffForDisplay(doc.oldData, doc.newData, doc.changedFields);
    }
    if (!changes && doc.oldData && doc.newData) {
        const computed = deepDiff(doc.oldData, doc.newData);
        changes = computed.changes;
    }

    return {
        _id:            doc._id,
        eventId:        doc.eventId,
        schemaVersion:  doc.schemaVersion,
        timestamp:      doc.timestamp,

        actor: {
            userId:    doc.userId    ?? doc.actorId ?? null,
            userRole:  doc.userRole  ?? null,
            employeeId: doc.employeeId ?? null,
            actorType: doc.actorType ?? null,
        },

        organizationId: doc.organizationId ?? null,
        organization:   doc.organizationId ?? null,  // alias for convenience

        operation,
        eventType,
        severity,
        action:         doc.action,
        category:       doc.category,
        resource:       doc.resource,
        resourceId:     doc.resourceId,

        success:        doc.success,
        result:         doc.result,
        errorCode:      doc.errorCode ?? null,
        safeErrorMessage: doc.safeErrorMessage ?? null,

        http: doc.http ?? null,
        origin: doc.origin ?? null,
        source: doc.source ?? null,

        changedFields:  doc.changedFields ?? [],
        changes:        changes ?? [],
        noChange:       doc.noChange ?? false,

        bulk:           doc.bulk ?? null,
        metadata:       doc.metadata ?? null,

        chainInfo: doc.chainScope ? {
            chainScope:  doc.chainScope,
            seq:         doc.seq,
            previousHash: doc.previousHash,
            currentHash:  doc.currentHash,
        } : null,

        visibilityStatus: doc.visibilityStatus ?? 'VISIBLE',
    };
};

/* ────────────────────────────────────────────────────────────────
   NORMALIZE A LIST
   ──────────────────────────────────────────────────────────────── */

/**
 * @param {object[]} docs — array of raw lean() documents
 * @returns {object[]}
 */
export const normalizeAuditEvents = (docs) => {
    if (!Array.isArray(docs)) return [];
    return docs.map(normalizeAuditEvent);
};

export default normalizeAuditEvent;
