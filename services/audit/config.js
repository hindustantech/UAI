const parseBool = (v, fallback) => {
    if (v === undefined || v === null) return fallback;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
};

const parseIntEnv = (v, fallback) => {
    if (v === undefined || v === null || String(v).trim() === '') return fallback;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : fallback;
};

export default {
    enabled: parseBool(process.env.AUDIT_LOG_ENABLED, true),
    hashChainEnabled: parseBool(process.env.AUDIT_HASH_CHAIN_ENABLED, true),
    requestBodyEnabled: parseBool(process.env.AUDIT_REQUEST_BODY_ENABLED, true),
    responseBodyEnabled: parseBool(process.env.AUDIT_RESPONSE_BODY_ENABLED, false),
    maxBodySize: parseIntEnv(process.env.AUDIT_MAX_BODY_SIZE_BYTES, 16 * 1024),
    retentionDays: (() => {
        const n = parseIntEnv(process.env.AUDIT_LOG_RETENTION_DAYS, 365);
        return n >= 0 ? n : 365;
    })(),
    sensitiveFields: new Set(
        (process.env.AUDIT_SENSITIVE_FIELDS
            ? String(process.env.AUDIT_SENSITIVE_FIELDS).split(',')
            : ['password','otp','token','authorization','apikey','apiKey','secret','refreshToken','refresh_token','jwt','authorizationHeader']
        ).map(s => s.trim().toLowerCase()).filter(Boolean)
    ),
    excludedRoutePrefixes: (() => {
        const defaults = ['/', '/exports', '/uploads', '/health'];
        const extra = process.env.AUDIT_EXCLUDED_ROUTES
            ? String(process.env.AUDIT_EXCLUDED_ROUTES).split(',').map(s=>s.trim()).filter(Boolean)
            : [];
        return [...defaults, ...extra];
    })(),
    excludedExactRoutes: new Set([
        'favicon', 'favicon.ico'
    ]),
    asyncEnabled: parseBool(process.env.AUDIT_ASYNC_ENABLED, true),
    queueName: process.env.AUDIT_QUEUE_NAME || 'audit-queue',
    strictGapMode: parseBool(process.env.AUDIT_STRICT_GAP_MODE, false),
    fallbackLogPath: process.env.AUDIT_FALLBACK_LOG_PATH || 'logs/audit-fallback.log',
    maxPaginationLimit: Math.max(1, parseIntEnv(process.env.AUDIT_MAX_PAGINATION_LIMIT, 100)),
    exportMaxRows: Math.max(1, parseIntEnv(process.env.AUDIT_EXPORT_MAX_ROWS, 10000)),
    genesisHash: process.env.AUDIT_GENESIS_HASH || 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000',
    globallyKnownTags: new Set(['ATTENDANCE.approve','ATTENDANCE.reject','ATTENDANCE.close','Sales.store']),
};