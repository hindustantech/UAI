/**
 * Deep diff utility for audit logging.
 * Computes changed fields between old and new versions of a document.
 */

/**
 * Compare two objects and return the changed fields with their old and new values.
 * Returns null if objects are identical or input is invalid.
 */
export const diff = (oldDoc, newDoc) => {
    if (!oldDoc && !newDoc) return { changedFields: [], oldData: null, newData: null, noChange: true };
    if (!oldDoc || !newDoc) return { changedFields: [], oldData: oldDoc || null, newData: newDoc || null, noChange: false };

    const changes = [];

    const compare = (a, b, path = '') => {
        const keysA = new Set(Object.keys(a || {}));
        const keysB = new Set(Object.keys(b || {}));
        const allKeys = [...new Set([...keysA, ...keysB])];

        for (const key of allKeys) {
            if (key.startsWith('_')) continue; // skip internal fields
            if (key === '__v' || key === 'updatedAt' || key === 'createdAt') continue; // skip meta

            const currentPath = path ? `${path}.${key}` : key;
            const valA = a?.[key];
            const valB = b?.[key];

            const typeA = typeof valA;
            const typeB = typeof valB;

            if (typeA !== typeB) {
                changes.push(currentPath);
                continue;
            }

            if (typeA !== 'object' || valA === null || valB === null) {
                if (valA !== valB) {
                    changes.push(currentPath);
                }
                continue;
            }

            // Both are objects — recurse
            const isArrA = Array.isArray(valA);
            const isArrB = Array.isArray(valB);

            if (isArrA !== isArrB) {
                changes.push(currentPath);
                continue;
            }

            if (isArrA) {
                if (valA.length !== valB.length || JSON.stringify(valA) !== JSON.stringify(valB)) {
                    changes.push(currentPath);
                }
                continue;
            }

            // Both plain objects — recurse
            const subKeysA = Object.keys(valA);
            const subKeysB = Object.keys(valB);
            if (subKeysA.length !== subKeysB.length || !subKeysA.every(k => k in valB)) {
                changes.push(currentPath);
                continue;
            }

            compare(valA, valB, currentPath);
        }
    };

    compare(oldDoc, newDoc);

    return {
        changedFields: changes,
        oldData: changes.length > 0 ? oldDoc : null,
        newData: changes.length > 0 ? newDoc : null,
        noChange: changes.length === 0,
    };
};

/**
 * Format diff result into human-readable pairs for export/readable diff view.
 * Returns array of { field, oldValue, newValue } for each changed field.
 */
export const formatDiffForDisplay = (oldDoc, newDoc, changedFields) => {
    if (!changedFields || changedFields.length === 0) return [];

    const getField = (obj, path) => {
        return path.split('.').reduce((o, k) => o?.[k], obj);
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