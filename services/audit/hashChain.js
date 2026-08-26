import crypto from 'crypto';
import mongoose from 'mongoose';
import config from './config.js';

/* ────────────────────────────────────────────────────────────────
   CANONICAL SERIALIZATION
   Deterministic JSON used as hash input. Key-sorted at every level,
   internal/system fields excluded so they never affect the hash.
   ──────────────────────────────────────────────────────────────── */

const SYSTEM_KEYS = new Set(['_id', '__v', 'updatedAt', 'createdAt', 'sealedAt', 'payloadTruncated', 'retryOfEventId']);

const stringifyValue = (value) => {
    if (value === null || value === undefined) return 'null';

    const type = typeof value;
    if (type === 'number') return Number.isFinite(value) ? String(value) : 'null';
    if (type === 'boolean') return String(value);
    if (type === 'string') return JSON.stringify(value);

    if (value instanceof Date) return JSON.stringify(value.toISOString());

    // ObjectId-like
    if (typeof value.toHexString === 'function') return JSON.stringify(value.toString());

    if (Array.isArray(value)) {
        return '[' + value.map(stringifyValue).join(',') + ']';
    }

    if (type === 'object') {
        const keys = Object.keys(value).filter(k => !SYSTEM_KEYS.has(k)).sort();
        const parts = keys.map(k => `${JSON.stringify(k)}:${stringifyValue(value[k])}`);
        return '{' + parts.join(',') + '}';
    }

    return 'null';
};

export const canonicalJson = (obj) => stringifyValue(obj);

/** Strip system fields from a snapshot before storing/hashing */
export const stripSystemFields = (doc) => {
    if (!doc || typeof doc !== 'object') return doc ?? null;

    if (Array.isArray(doc)) return doc.map(stripSystemFields);

    if (doc instanceof Date) return doc.toISOString();
    if (typeof doc.toHexString === 'function') return doc.toString();

    const out = {};
    for (const [k, v] of Object.entries(doc)) {
        if (SYSTEM_KEYS.has(k)) continue;
        out[k] = stripSystemFields(v);
    }
    return out;
};

/* ────────────────────────────────────────────────────────────────
   HASH PAYLOAD
   The exact field set covered by the chain hash.
   ──────────────────────────────────────────────────────────────── */

const buildHashPayload = (evt) => ({
    eventId: evt.eventId,
    timestamp: evt.timestamp instanceof Date ? evt.timestamp.toISOString() : evt.timestamp,
    actorType: evt.actorType,
    actorId: evt.actorId ? String(evt.actorId) : null,
    action: evt.action,
    resource: evt.resource,
    resourceId: evt.resourceId,
    requestId: evt.requestId ?? null,
    success: Boolean(evt.success),
    oldData: evt.oldData ?? null,
    newData: evt.newData ?? null,
    previousHash: evt.previousHash,
});

export const computeEventHash = (evt) =>
    crypto.createHash('sha256').update(canonicalJson(buildHashPayload(evt))).digest('hex');

/* ────────────────────────────────────────────────────────────────
   CHAIN APPEND PRIMITIVES
   ──────────────────────────────────────────────────────────────── */

/**
 * Atomically reserve the next sequence number for a scope.
 * Safe across processes (PM2 cluster / containers): Mongo is the
 * single coordination point; no process-local state.
 */
export async function allocateSequence(chainScope, session = null) {
    const opts = { upsert: true, new: true };
    if (session) opts.session = session;
    const doc = await mongoose.model('AuditSequence').findOneAndUpdate(
        { _id: chainScope },
        { $inc: { seq: 1 }, $setOnInsert: { _id: chainScope } },
        opts
    );
    return doc.seq;
}

/**
 * Fetch the previous event's currentHash for chaining.
 * Returns genesisHash when seq === 1.
 */
export async function getPreviousHash(chainScope, seq) {
    if (seq <= 1) return config.genesisHash;

    const prev = await mongoose.model('AuditLog')
        .findOne({ chainScope, seq: seq - 1 })
        .select('currentHash')
        .lean();

    return prev?.currentHash ?? null; // null ⇒ predecessor missing (race or retention gap)
}

/* ────────────────────────────────────────────────────────────────
   VERIFICATION
   ──────────────────────────────────────────────────────────────── */

const retentionCutoff = () => {
    const days = config.retentionDays;
    if (!days || days <= 0) return null;
    return new Date(Date.now() - days * 86400000);
};

/**
 * Verify one event by eventId.
 * Returns:
 *  { valid:true }
 *  { valid:false, reason:'EVENT_NOT_FOUND' }
 *  { valid:false, reason:'TAMPERED'|'CHAIN_BREAK'|'MISSING_PREDECESSOR',
 *    eventId, chainPosition, expected?, actual?, message }
 *  { valid:false, reason:'RETENTION_GAP', ... } — predecessor outside retention window
 */
export async function verifyAuditEvent(eventId) {
    const evt = await mongoose.model('AuditLog').findOne({ eventId }).lean();
    if (!evt) return { valid: false, reason: 'EVENT_NOT_FOUND', eventId };

    // 1. Chain link check
    if (evt.seq === 1) {
        if (evt.previousHash !== config.genesisHash) {
            return {
                valid: false, reason: 'CHAIN_BREAK', eventId,
                chainPosition: evt.seq,
                expected: config.genesisHash, actual: evt.previousHash,
                message: 'First event previousHash must equal genesis hash',
            };
        }
    } else {
        const prev = await mongoose.model('AuditLog')
            .findOne({ chainScope: evt.chainScope, seq: evt.seq - 1 })
            .select('currentHash')
            .lean();

        if (!prev) {
            const cutoff = retentionCutoff();
            const isOld = cutoff && new Date(evt.timestamp) < cutoff;
            return {
                valid: false,
                reason: isOld ? 'RETENTION_GAP' : 'MISSING_PREDECESSOR',
                eventId,
                chainPosition: evt.seq,
                message: isOld
                    ? `Predecessor seq ${evt.seq - 1} removed by retention policy`
                    : `Predecessor seq ${evt.seq - 1} missing`,
            };
        }

        if (prev.currentHash !== evt.previousHash) {
            return {
                valid: false, reason: 'CHAIN_BREAK', eventId,
                chainPosition: evt.seq,
                expected: prev.currentHash, actual: evt.previousHash,
                message: 'previousHash does not match predecessor currentHash',
            };
        }
    }

    // 2. Content hash check
    const expected = computeEventHash(evt);
    if (expected !== evt.currentHash) {
        return {
            valid: false, reason: 'TAMPERED', eventId,
            chainPosition: evt.seq,
            expected, actual: evt.currentHash,
            message: 'Stored currentHash does not match recomputed hash — record was modified after creation',
        };
    }

    return { valid: true, eventId };
}

/**
 * Verify a contiguous range [fromSeq, toSeq] within a scope (inclusive).
 * Walks the chain in order; stops at first break.
 *
 * Returns { ok, verifiedCount, brokenAt|null, note }
 *   brokenAt: { reason, eventId, chainPosition, expected?, actual?, message }
 *   note: set when RETENTION_GAP encountered (informational)
 */
export async function verifyAuditRange({ chainScope, fromSeq = 1, toSeq = null }) {
    const query = { chainScope, seq: { $gte: fromSeq } };
    if (toSeq) query.seq.$lte = toSeq;

    // Only fields needed for verification
    const events = await mongoose.model('AuditLog')
        .find(query)
        .select('eventId seq timestamp actorType userId employeeId organizationId action resource resourceId requestId success oldData newData previousHash currentHash')
        .sort({ seq: 1 })
        .limit(5000)
        .lean();

    if (!events.length) return { ok: true, verifiedCount: 0, brokenAt: null, note: 'NO_EVENTS_IN_RANGE' };

    let prevHash = fromSeq === 1 ? config.genesisHash : null;

    // If starting mid-range, seed prevHash from event before range start
    if (fromSeq > 1) {
        const anchor = await mongoose.model('AuditLog')
            .findOne({ chainScope, seq: fromSeq - 1 })
            .select('currentHash')
            .lean();

        if (!anchor) {
            const cutoff = retentionCutoff();
            const firstEvtDate = new Date(events[0].timestamp);
            if (cutoff && firstEvtDate < cutoff) {
                prevHash = events[0].previousHash; // accept stored link across retention boundary
            } else {
                return {
                    ok: false, verifiedCount: 0,
                    brokenAt: { reason: 'MISSING_PREDECESSOR', chainPosition: fromSeq, message: `Anchor seq ${fromSeq - 1} not found` },
                    note: null,
                };
            }
        } else {
            prevHash = anchor.currentHash;
        }
    }

    let expectedSeq = events[0].seq === fromSeq ? fromSeq : null;
    let note = null;
    let verified = 0;

    for (let i = 0; i < events.length; i++) {
        const evt = events[i];

        // Sequence continuity check
        if (expectedSeq !== null && evt.seq !== expectedSeq) {
            const cutoff = retentionCutoff();
            const isOld = cutoff && new Date(evt.timestamp) < cutoff;
            if (isOld) {
                note = { type: 'RETENTION_GAP', between: [expectedSeq, evt.seq] };
                expectedSeq = evt.seq;
            } else {
                return {
                    ok: false, verifiedCount: verified,
                    brokenAt: { reason: 'SEQUENCE_GAP', eventId: evt.eventId, chainPosition: evt.seq, expected: expectedSeq, actual: evt.seq, message: 'Missing sequence number within retention window' },
                    note,
                };
            }
        }
        if (expectedSeq === null) expectedSeq = evt.seq;

        // Chain link check
        if (evt.previousHash !== prevHash) {
            return {
                ok: false, verifiedCount: verified,
                brokenAt: { reason: 'CHAIN_BREAK', eventId: evt.eventId, chainPosition: evt.seq, expected: prevHash, actual: evt.previousHash, message: 'previousHash mismatch' },
                note,
            };
        }

        // Content hash check
        const expectedHash = computeEventHash(evt);
        if (expectedHash !== evt.currentHash) {
            return {
                ok: false, verifiedCount: verified,
                brokenAt: { reason: 'TAMPERED', eventId: evt.eventId, chainPosition: evt.seq, expected: expectedHash, actual: evt.currentHash, message: 'Recomputed hash mismatch — record modified after creation' },
                note,
            };
        }

        prevHash = evt.currentHash;
        expectedSeq = evt.seq + 1;
        verified++;
    }

    return { ok: true, verifiedCount: verified, brokenAt: null, note };
}

/**
 * Detailed chain verification — collects ALL errors in the range
 * (up to maxErrors) instead of stopping at the first break.
 * Read-only: never mutates records.
 *
 * Detects:
 *   - SEQUENCE_GAP          missing seq numbers
 *   - DUPLICATE_SEQ         duplicate sequence numbers
 *   - CHAIN_BREAK           previousHash does not match predecessor
 *   - HASH_MISMATCH         currentHash fails recomputation (tampering)
 *   - MISSING_PREDECESSOR   anchor event absent
 *
 * Returns { valid, checked, errors[], notes[] }
 */
export async function verifyChainDetailed({ chainScope, fromSeq = 1, toSeq = null, maxErrors = 100 }) {
    const query = { chainScope, seq: { $gte: fromSeq } };
    if (toSeq) query.seq.$lte = toSeq;

    const events = await mongoose.model('AuditLog')
        .find(query)
        .select('eventId seq timestamp actorType userId organizationId action resource resourceId requestId success oldData newData previousHash currentHash')
        .sort({ seq: 1 })
        .limit(5000)
        .lean();

    if (!events.length) {
        return { valid: true, checked: 0, errors: [], notes: ['NO_EVENTS_IN_RANGE'] };
    }

    const errors = [];
    const notes = [];

    // Seed prevHash from the event immediately before the range
    let prevHash = null;
    let expectedSeq = events[0].seq;

    if (fromSeq === 1 || events[0].seq === 1) {
        prevHash = config.genesisHash;
    } else {
        const anchor = await mongoose.model('AuditLog')
            .findOne({ chainScope, seq: events[0].seq - 1 })
            .select('currentHash')
            .lean();
        if (anchor) {
            prevHash = anchor.currentHash;
        } else {
            const cutoff = retentionCutoff();
            const firstOld = cutoff && new Date(events[0].timestamp) < cutoff;
            if (firstOld) {
                prevHash = events[0].previousHash; // accept stored link across retention boundary
                notes.push({
                    type: 'RETENTION_GAP',
                    message: `Predecessor seq ${events[0].seq - 1} outside retention window — accepted stored link`,
                });
            } else {
                errors.push({
                    seq: events[0].seq,
                    type: 'MISSING_PREDECESSOR',
                    eventId: events[0].eventId,
                    message: `Anchor seq ${events[0].seq - 1} not found`,
                });
                prevHash = events[0].previousHash; // continue checking subsequent links
            }
        }
    }

    let checked = 0;
    let seenSeqs = new Set();

    for (const evt of events) {
        if (errors.length >= maxErrors) {
            notes.push({ type: 'TRUNCATED', message: `Verification stopped after ${maxErrors} errors` });
            break;
        }

        /* Duplicate sequence detection */
        if (seenSeqs.has(evt.seq)) {
            errors.push({
                seq: evt.seq,
                type: 'DUPLICATE_SEQ',
                eventId: evt.eventId,
                message: 'Duplicate sequence number within scope',
            });
            continue;
        }
        seenSeqs.add(evt.seq);

        /* Sequence continuity */
        if (evt.seq !== expectedSeq) {
            errors.push({
                seq: evt.seq,
                type: 'SEQUENCE_GAP',
                eventId: evt.eventId,
                expected: expectedSeq,
                actual: evt.seq,
                message: `Missing sequence number(s): ${expectedSeq}…${evt.seq - 1}`,
            });
        }

        /* Chain linkage */
        if (evt.previousHash !== prevHash) {
            errors.push({
                seq: evt.seq,
                type: 'CHAIN_BREAK',
                eventId: evt.eventId,
                expected: prevHash,
                actual: evt.previousHash,
                message: 'previousHash does not match predecessor currentHash',
            });
        }

        /* Content hash */
        const recomputed = computeEventHash(evt);
        if (recomputed !== evt.currentHash) {
            errors.push({
                seq: evt.seq,
                type: 'HASH_MISMATCH',
                eventId: evt.eventId,
                expected: recomputed,
                actual: evt.currentHash,
                message: 'Stored currentHash does not match recomputed hash — record was modified after creation',
            });
        }

        prevHash = evt.currentHash;
        expectedSeq = evt.seq + 1;
        checked++;
    }

    return { valid: errors.length === 0, checked, errors, notes };
}
