import config from './config.js';

const REDACTED = '[REDACTED]';

/**
 * Deep-clone an object, redacting sensitive fields recursively.
 * Circular-reference safe (WeakSet seen-guard), depth-limited,
 * and handles Date / ObjectId / non-enumerable / bigint gracefully.
 */
const deepCloneAndRedact = (obj, sensitiveFields, depth = 0, seen = new WeakSet()) => {
    if (depth > 12) return REDACTED;
    if (obj === null || obj === undefined) return obj;

    // Primitives pass through
    if (typeof obj === 'boolean' || typeof obj === 'number' || typeof obj === 'string') return obj;
    if (typeof obj === 'bigint') return String(obj);

    // Date / ObjectId — leave as-is (caller serializes if needed)
    if (obj instanceof Date) return obj;
    if (typeof obj?.toHexString === 'function') return obj;

    // Circular guard
    if (typeof obj === 'object' || typeof obj === 'function') {
        if (seen.has(obj)) return '[Circular]';
        seen.add(obj);
    }

    if (Array.isArray(obj)) {
        return obj.map(item => deepCloneAndRedact(item, sensitiveFields, depth + 1, seen));
    }

    if (typeof obj !== 'object') return obj;

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveFields.has(lowerKey) || lowerKey.endsWith('password') || lowerKey.endsWith('token') || lowerKey === 'otp') {
            cleaned[key] = REDACTED;
        } else {
            cleaned[key] = deepCloneAndRedact(value, sensitiveFields, depth + 1, seen);
        }
    }
    return cleaned;
};

/* ────────────────────────────────────────────────────────────────
   FINANCIAL DATA MASKING
   Masks sensitive card / account numbers while keeping the last 4
   characters for identification.  Safe for stored metadata.
   ──────────────────────────────────────────────────────────────── */

const MASKABLE_KEY_FRAGMENTS = [
    'cardnumber',
    'cardno',
    'cvv',
    'accountnumber',
    'routingnumber',
    'upiid',
    'upinumber',
];

/** Normalize any casing (camelCase/Snake/kebab) then fragment-match */
const isMaskableKey = (key) => {
    const norm = String(key).toLowerCase().replace(/[^a-z]/g, '');
    return MASKABLE_KEY_FRAGMENTS.some(f => norm.includes(f));
};

const maskValue = (val) => {
    if (typeof val !== 'string') return val;
    if (val.length <= 4) return val;
    return '*'.repeat(val.length - 4) + val.slice(-4);
};

const maskSensitiveFinancial = (obj, depth = 0) => {
    if (depth > 10 || !obj || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return obj;
    if (typeof obj?.toHexString === 'function') return obj;

    if (Array.isArray(obj)) return obj.map(v => maskSensitiveFinancial(v, depth + 1));

    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && isMaskableKey(key)) {
            out[key] = maskValue(value);
        } else if (value && typeof value === 'object' && !(value instanceof Date) && typeof value?.toHexString !== 'function') {
            out[key] = maskSensitiveFinancial(value, depth + 1);
        } else {
            out[key] = value;
        }
    }
    return out;
};

/**
 * Sanitize a request body for audit storage:
 * - Redact sensitive fields
 * - Mask financial identifiers (card numbers, account numbers)
 * - Respect maxBodySize (truncate and flag)
 * - Handle non-JSON / circular bodies gracefully
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

/* ────────────────────────────────────────────────────────────────
   CONSOLIDATED SNAPSHOT SANITIZER
   Used by apiLogger.js and cronLogger.js.  This is the single
   source of truth — do not duplicate in apiLogger.
   ──────────────────────────────────────────────────────────────── */

const EXTRA_SENSITIVE = new Set([
    'password', 'otp', 'pin', 'token', 'refreshtoken', 'accesstoken',
    'secret', 'apikey', 'privatekey', 'privatekey',
    'authorization', 'cookie', 'cvv',
]);

/**
 * Sanitize an arbitrary data snapshot (before/after, request body, metadata)
 * for safe audit storage.  Handles circular references via WeakSet.
 *
 * @param {*} data  arbitrary JS value
 * @returns {*}     sanitized shallow copy with redacted sensitive fields
 */
export const sanitizeSnapshot = (data) => {
    if (!data || typeof data !== 'object') return data;
    if (data instanceof Date) return data.toISOString();
    if (Array.isArray(data)) return data.slice(0, 50).map(v => sanitizeSnapshot(v));

    const seen = new WeakSet();

    const toJSON = (v) => {
        if (v && typeof v.toJSON === 'function') return v.toJSON();
        if (v && typeof v.toObject === 'function') return v.toObject();
        return v;
    };

    const redact = (obj, depth = 0) => {
        if (depth > 8) return '[MaxDepth]';
        const raw = toJSON(obj);
        if (!raw || typeof raw !== 'object') return raw;
        if (raw instanceof Date) return raw.toISOString();
        if (typeof raw?.toHexString === 'function') return raw.toString();
        if (Array.isArray(raw)) return raw.slice(0, 50).map(v => redact(v, depth + 1));

        if (seen.has(raw)) return '[Circular]';
        seen.add(raw);

        const out = {};
        for (const [k, v] of Object.entries(raw)) {
            if (EXTRA_SENSITIVE.has(k.toLowerCase()) || config.sensitiveFields.has(k.toLowerCase())) {
                out[k] = '[REDACTED]';
            } else if (v instanceof Date) {
                out[k] = v.toISOString();
            } else if (typeof v?.toHexString === 'function') {
                out[k] = v.toString();
            } else if (v && typeof v === 'object') {
                out[k] = redact(v, depth + 1);
            } else {
                out[k] = v;
            }
        }
        return out;
    };

    return redact(data);
};

/**
 * Mask a metadata object intended for financial events.
 * Order: mask card/account numbers first, then redact remaining
 * sensitive fields (passwords, tokens, etc.).
 */
export const maskFinancialMetadata = (meta) => {
    if (!meta || typeof meta !== 'object') return meta;
    const masked = maskSensitiveFinancial(meta);
    return redactSensitive(masked);
};

/** Internal helper used by maskFinancialMetadata */
function redactSensitive(obj, depth = 0, seen = new WeakSet()) {
    if (depth > 8 || !obj || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return obj;
    if (Array.isArray(obj)) return obj.map(v => redactSensitive(v, depth + 1, seen));
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);

    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (config.sensitiveFields.has(k.toLowerCase()) || EXTRA_SENSITIVE.has(k.toLowerCase())) {
            out[k] = '[REDACTED]';
        } else if (v && typeof v === 'object' && !(v instanceof Date) && typeof v?.toHexString !== 'function') {
            out[k] = redactSensitive(v, depth + 1, seen);
        } else {
            out[k] = v;
        }
    }
    return out;
}

export default {
    sanitizeRequestBody,
    sanitizeResponseMetadata,
    sanitizeSnapshot,
    maskFinancialMetadata,
    isLargeNestedDocument,
    shallowTrimDocument,
};