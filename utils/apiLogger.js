import logger from "./logger.js";

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

/**
 * Structured API action logger.
 * Captures: WHAT (action+model), WHO (actor), WHERE (http route), WHY (reason),
 * WHEN (winston auto-timestamp + explicit iso), BEFORE/AFTER snapshots.
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
        logger[level](`[API] ${action} | ${model}`, {
            what: { action, model, resourceId },
            who: getActor(req),
            where: getLocation(req),
            why: { reason: reason ?? req?.body?.reason ?? null },
            when: new Date().toISOString(),
            before: before ? sanitizeSnapshot(before) : null,
            after: after ? sanitizeSnapshot(after) : null,
            ...extra,
        });
    } catch {
        // logging must never break business flow
    }
};

export const logApiError = (action, model, error, req, extra = {}) => {
    try {
        logger.error(`[API_ERROR] ${action} | ${model}`, {
            what: { action, model },
            who: getActor(req),
            where: getLocation(req),
            when: new Date().toISOString(),
            error: {
                message: error?.message,
                name: error?.name,
                code: error?.code,
                stack: error?.stack,
            },
            ...extra,
        });
    } catch {
        // logging must never break business flow
    }
};

// Strip sensitive fields before persisting snapshots
const SENSITIVE_FIELDS = [
    "password", "otp", "pin", "token", "refreshToken", "accessToken",
    "secret", "key", "credential", "devicetoken", "deviceToken",
];

function sanitizeSnapshot(data) {
    if (!data || typeof data !== "object") return data;
    if (data instanceof Date) return data.toISOString();
    if (Array.isArray(data)) return data.slice(0, 50).map(sanitizeSnapshot);

    // Convert Mongoose sub-documents to plain objects
    const obj = typeof data.toJSON === "function" ? data.toJSON() : (typeof data.toObject === "function" ? data.toObject() : data);

    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
        if (SENSITIVE_FIELDS.some((f) => k.toLowerCase().includes(f.toLowerCase()))) {
            clean[k] = "[REDACTED]";
        } else if (v && typeof v === "object" && !(v instanceof Date)) {
            clean[k] = sanitizeSnapshot(v);
        } else {
            clean[k] = v;
        }
    }
    return clean;
}

export default { logApiAction, logApiError };
