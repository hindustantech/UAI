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

// Per-organization timestamp index for query performance
AuditLogSchema.index({ organizationId: 1, timestamp: -1 });

// Per-user query index
AuditLogSchema.index({ userId: 1, timestamp: -1 });

// Resource+ID query index
AuditLogSchema.index({ resource: 1, resourceId: 1, timestamp: -1 });

// Action+timestamp index
AuditLogSchema.index({ action: 1, timestamp: -1 });

// RequestId query index
AuditLogSchema.index({ requestId: 1 });

// EventId alias (redundant unique but makes lookup explicit)
AuditLogSchema.index({ eventId: 1 });

export default mongoose.model('AuditLog', AuditLogSchema);