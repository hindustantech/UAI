import config from './config.js';

const REDACTED = '[REDACTED]';

/**
 * Deep-clone an object, redacting sensitive fields recursively.
 * Non-serializable values (Date, ObjectId) are left as-is.
 */
const deepCloneAndRedact = (obj, sensitiveFields, depth = 0) => {
    if (depth > 12) return REDACTED;

    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
        return obj.map(item => deepCloneAndRedact(item, sensitiveFields, depth + 1));
    }

    if (typeof obj !== 'object' || obj instanceof Date || obj.constructor?.name === 'ObjectId') {
        return obj;
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveFields.has(lowerKey) || lowerKey.endsWith('password') || lowerKey.endsWith('token') || lowerKey === 'otp') {
            cleaned[key] = REDACTED;
        } else {
            cleaned[key] = deepCloneAndRedact(value, sensitiveFields, depth + 1);
        }
    }
    return cleaned;
};

/**
 * Sanitize a request body for audit storage:
 * - Redact sensitive fields
 * - Respect maxBodySize (truncate and flag)
 * - Handle non-JSON bodies gracefully
 */
export const sanitizeRequestBody = (body) => {
    if (!body || typeof body !== 'object') return null;

    try {
        const cloned = deepCloneAndRedact(body, config.sensitiveFields);

        let stringified = JSON.stringify(cloned);

        if (stringified.length > config.maxBodySize) {
            stringified = stringified.slice(0, config.maxBodySize);
            const truncated = JSON.parse(stringified);
            truncated._audit_truncated = true;
            truncated._audit_note = 'Body exceeded max payload size';
            return truncated;
        }

        return cloned;
    } catch {
        return { _audit_parse_error: true };
    }
};

/**
 * Sanitize a response object/metadata for audit storage.
 * Never store full responses — extract useful metadata only.
 */
export const sanitizeResponseMetadata = (resBody, res) => {
    if (!resBody && !res) return null;

    const meta = {};

    if (resBody && typeof resBody === 'object') {
        if ('success' in resBody) meta.success = resBody.success;
        if ('message' in resBody) meta.message = resBody.message;
        if (resBody.data && typeof resBody.data === 'object') {
            if (Array.isArray(resBody.data)) meta.dataType = 'array';
            else if (resBody.data._id) meta.resourceId = String(resBody.data._id);
            meta.dataKeys = Object.keys(resBody.data).slice(0, 10);
        }
    }

    if (res) {
        if (typeof res.statusCode === 'number') meta.statusCode = res.statusCode;
    }

    return Object.keys(meta).length > 0 ? meta : null;
};

/**
 * Recursively collect all field paths containing potentially large nested documents.
 * Used to detect when we should only store the entire data instead of old/new
 * for audit purposes (to avoid huge nested storage).
 */
export const isLargeNestedDocument = (obj, depth = 0, maxSize = 100) => {
    if (depth > 5 || !obj || typeof obj !== 'object') return false;

    try {
        return JSON.stringify(obj).length > maxSize;
    } catch {
        return true;
    }
};

/**
 * Remove potentially large nested fields from an object.
 * Returns a copy with arrays and deep objects removed.
 */
export const shallowTrimDocument = (doc, maxArrayLength = 5) => {
    if (!doc || typeof doc !== 'object') return doc;

    const trimmed = Array.isArray(doc) ? [] : {};

    for (const [key, value] of Object.entries(doc)) {
        if (Array.isArray(value)) {
            trimmed[key] = value.slice(0, maxArrayLength);
            if (value.length > maxArrayLength) {
                trimmed[key].push({ _audit_truncated: true, _originalLength: value.length });
            }
        } else if (value && typeof value === 'object' && value.constructor?.name !== 'ObjectId' && !(value instanceof Date)) {
            trimmed[key] = shallowTrimDocument(value, maxArrayLength);
        } else {
            trimmed[key] = value;
        }
    }
    return trimmed;
};