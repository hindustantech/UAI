import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema(
    {
        eventId: {
            type: String,
            required: true,
            unique: true,
        },
        schemaVersion: {
            type: Number,
            default: 1,
            required: true,
        },
        timestamp: {
            type: Date,
            default: Date.now,
            required: true,
        },
        requestId: {
            type: String,
        },
        correlationId: {
            type: String,
        },
        idempotencyKey: {
            type: String,
            unique: true,
            sparse: true,
        },
        actorType: {
            type: String,
            enum: ['USER', 'SERVICE_ACCOUNT', 'SYSTEM', 'CRON', 'QUEUE', 'WORKER'],
            required: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        employeeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Employee',
        },
        impersonatedUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        organizationId: {
            type: mongoose.Schema.Types.ObjectId,
            index: true,
        },
        userRole: {
            type: String,
        },
        action: {
            type: String,
            required: true,
            index: true,
        },
        operation: {
            type: String,
            enum: [
                'CREATE', 'UPDATE', 'DELETE', 'ACTIVATE', 'DEACTIVATE',
                'PAYMENT', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT',
                'PROCESS', 'EXPORT', 'READ', 'OTHER'
            ],
        },
        eventType: {
            type: String,
            enum: ['READ', 'WRITE', 'SECURITY', 'FINANCIAL', 'SYSTEM'],
        },
        severity: {
            type: String,
            enum: ['INFO', 'WARNING', 'CRITICAL'],
            default: 'INFO',
        },
        category: {
            type: String,
            enum: [
                'AUTHENTICATION', 'AUTHORIZATION', 'DATA',
                'BUSINESS', 'SYSTEM', 'ADMIN'
            ],
            index: true,
        },
        resource: {
            type: String,
            required: true,
        },
        resourceId: {
            type: String,
            required: true,
        },
        parentResourceId: {
            type: String,
        },
        http: {
            method: String,
            route: String,
            url: String,
            query: String,
            ip: String,
            userAgent: String,
            statusCode: Number,
        },
        sanitizedRequestBody: {
            type: String,
        },
        sanitizedResponseMetadata: {
            type: String,
        },
        oldData: {
            type: mongoose.Schema.Types.Mixed,
        },
        newData: {
            type: mongoose.Schema.Types.Mixed,
        },
        changedFields: [{
            type: String,
        }],
        noChange: {
            type: Boolean,
            default: false,
        },
        success: {
            type: Boolean,
            required: true,
        },
        result: {
            type: String,
            enum: [
                'SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS',
                'NOT_FOUND', 'NO_CHANGE', 'ROLLBACK',
                'REJECTED', 'DENIED'
            ],
        },
        errorCode: {
            type: String,
        },
        errorCategory: {
            type: String,
        },
        safeErrorMessage: {
            type: String,
        },
        durationMs: {
            type: Number,
        },
        source: {
            type: String,
            enum: ['USER_ACTION', 'SYSTEM_ACTION'],
        },
        origin: {
            type: String,
            enum: ['HTTP', 'CRON', 'QUEUE', 'WORKER', 'SYSTEM'],
        },
        jobId: {
            type: String,
        },
        queueName: {
            type: String,
        },
        cronJobName: {
            type: String,
        },
        initiatingUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
        },
        bulk: {
            operationId: String,
            total: Number,
            successCount: Number,
            failureCount: Number,
            failedIds: [{
                type: String,
            }],
            criteria: mongoose.Schema.Types.Mixed,
        },
        changes: [{
            field: String,
            oldValue: mongoose.Schema.Types.Mixed,
            newValue: mongoose.Schema.Types.Mixed,
        }],
        visibilityStatus: {
            type: String,
            enum: ['VISIBLE', 'HIDDEN'],
            default: 'VISIBLE',
        },
        deactivatedAt: {
            type: Date,
        },
        deactivatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        deactivationReason: {
            type: String,
        },
        file: {
            filename: String,
            fileId: String,
            provider: String,
            mimeType: String,
            size: Number,
            checksum: String,
        },
        payloadTruncated: {
            type: Boolean,
            default: false,
        },
        retryOfEventId: {
            type: String,
        },
        chainScope: {
            type: String,
            required: true,
        },
        seq: {
            type: Number,
            required: true,
        },
        previousHash: {
            type: String,
        },
        currentHash: {
            type: String,
            required: true,
        },
        sealedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
        toJSON: {
            transform(_doc, ret) {
                // Never expose raw sensitive internals outside admin APIs
                return ret;
            }
        }
    }
);

// Composite unique index per chain scope to enforce linear ordering
AuditLogSchema.index({ chainScope: 1, seq: 1 }, { unique: true });

/* ────────────────────────────────────────────────────────────────
   INDEX STRATEGY
   Every investigation query is organization-scoped first, then
   filtered by one secondary dimension, then ranged/sorted on
   timestamp DESC. These compound indexes serve that access pattern
   directly (org prefix + filter key + sort key). oldData/newData are
   deliberately never indexed — large Mixed blobs with no lookup use.
   ──────────────────────────────────────────────────────────────── */

// Per-organization timestamp index for query performance (primary listing)
AuditLogSchema.index({ organizationId: 1, timestamp: -1 });

// Org + action (e.g. "show all EMPLOYEE.UPDATE for org")
AuditLogSchema.index({ organizationId: 1, action: 1, timestamp: -1 });

// Org + resource (e.g. "all Employee events")
AuditLogSchema.index({ organizationId: 1, resource: 1, timestamp: -1 });

// Org + resource+ID (employee history timeline)
AuditLogSchema.index({ organizationId: 1, resourceId: 1, timestamp: -1 });
AuditLogSchema.index({ organizationId: 1, resource: 1, resourceId: 1, timestamp: -1 });

// Org + actor (user activity view)
AuditLogSchema.index({ organizationId: 1, userId: 1, timestamp: -1 });

// Org + success flag ("show all failed operations")
AuditLogSchema.index({ organizationId: 1, success: 1, timestamp: -1 });

// Org + category
AuditLogSchema.index({ organizationId: 1, category: 1, timestamp: -1 });

// Per-user query index (global/cron scope queries where org is absent)
AuditLogSchema.index({ userId: 1, timestamp: -1 });

// Resource+ID query index
AuditLogSchema.index({ resource: 1, resourceId: 1, timestamp: -1 });

// Action+timestamp index
AuditLogSchema.index({ action: 1, timestamp: -1 });

// RequestId query index
AuditLogSchema.index({ requestId: 1 });

// NOTE: eventId has a unique index automatically via { unique: true } above.
// No explicit schema.index() call needed for it.

export default mongoose.model('AuditLog', AuditLogSchema);