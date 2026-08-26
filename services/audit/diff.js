/**
 * Deep diff utility for audit logging.
 * Computes changed fields between old and new versions of a document.
 * Produces:
 *   - changedFields: flat array of stable dotted paths ("salaryStructure.basic")
 *   - changes:       [{ field, oldValue, newValue }]
 *   - noChange:      boolean
 *
 * IGNORED_CHANGE_FIELDS: system / metadata fields that must NOT appear
 * in changedFields / changes even if their values differ.
 * Raw snapshots (oldData / newData) are always preserved by the caller.
 */

export const IGNORED_CHANGE_FIELDS = [
    'updatedAt',
    'createdAt',
    '__v',
];

const MAX_DIFF_DEPTH = 12;

const IGNORED = new Set(IGNORED_CHANGE_FIELDS);

/* ────────────────────────────────────────────────────────────────
   VALUE NORMALIZATION + COMPARISON
   ──────────────────────────────────────────────────────────────── */

const normalize = (v) => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v.toHexString === 'function') return v.toString(); // ObjectId
    return v;
};

const valueEquals = (a, b) => {
    const na = normalize(a);
    const nb = normalize(b);
    if (na === nb) return true;
    if (na === null || nb === null) return false;

    if (typeof na !== typeof nb) return false;

    if (typeof na !== 'object') return na === nb || String(na) === String(nb);

    try {
        return JSON.stringify(na) === JSON.stringify(nb);
    } catch {
        return false;
    }
};

const isPlainObject = (v) =>
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    typeof v.toHexString !== 'function';

/* ────────────────────────────────────────────────────────────────
   DEEP DIFF CORE
   Only leaf paths are recorded — nested object parents are walked,
   never reported as changed themselves.
   ──────────────────────────────────────────────────────────────── */

export const diff = (oldDoc, newDoc) => {
    if (!oldDoc && !newDoc) {
        return { changedFields: [], oldData: null, newData: null, changes: [], noChange: true };
    }
    if (!oldDoc || !newDoc) {
        return {
            changedFields: [],
            oldData: oldDoc ?? null,
            newData: newDoc ?? null,
            changes: [],
            noChange: false,
        };
    }

    const changes = [];

    const compare = (a, b, path = '', depth = 0) => {
        const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];

        for (const key of keys) {
            // Internal/Mongoose-managed keys never count as business changes
            if (key.startsWith('_')) continue;
            if (IGNORED.has(key)) continue;

            const currentPath = path ? `${path}.${key}` : key;
            const valA = a?.[key];
            const valB = b?.[key];

            if (valueEquals(valA, valB)) continue;

            // Both plain objects → recurse (only leaves get recorded)
            if (isPlainObject(valA) && isPlainObject(valB) && depth < MAX_DIFF_DEPTH) {
                compare(valA, valB, currentPath, depth + 1);
                continue;
            }

            // Leaf (or depth-exceeded): record old → new
            changes.push({
                field: currentPath,
                oldValue: normalize(valA),
                newValue: normalize(valB),
            });
        }
    };

    compare(oldDoc, newDoc);

    return {
        changedFields: changes.map(c => c.field),
        changes,
        oldData: changes.length > 0 ? oldDoc : null,
        newData: changes.length > 0 ? newDoc : null,
        noChange: changes.length === 0,
    };
};

/**
 * Format diff result into human-readable pairs for export/readable diff view.
 * Falls back to generating values from oldData / newData when only
 * changedFields is available (historical records).
 */
export const formatDiffForDisplay = (oldDoc, newDoc, changedFields) => {
    if (!changedFields || changedFields.length === 0) return [];

    const getField = (obj, path) => {
        if (!obj) return null;
        return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    };

    return changedFields.map(field => ({
        field,
        oldValue: getField(oldDoc, field) ?? null,
        newValue: getField(newDoc, field) ?? null,
    }));
};

/**
 * Given a Mongoose document object (lean()), strip internal/auditing-irrelevant fields.
 * Returns a cleaned copy safe for oldData/newData storage.
 */
export const extractAuditSnapshot = (doc) => {
    if (!doc || typeof doc !== 'object') return null;

    const ignore = new Set(['__v', 'updatedAt', 'createdAt', 'password', 'otp', 'token', 'refreshToken']);

    const clean = (obj) => {
        if (Array.isArray(obj)) return obj.map(clean);

        if (obj && typeof obj === 'object' && obj.constructor?.name !== 'ObjectId' && !(obj instanceof Date)) {
            const result = {};
            for (const [k, v] of Object.entries(obj)) {
                if (ignore.has(k)) continue;
                result[k] = clean(v);
            }
            return result;
        }
        return obj;
    };

    return clean(doc);
};