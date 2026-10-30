import mongoose from "mongoose";

const { Schema } = mongoose;

const LeaveLedgerSchema = new Schema(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        employeeId: {
            type: Schema.Types.ObjectId,
            ref: "Employee",
            required: true,
            index: true
        },

        leaveTypeId: {
            type: Schema.Types.ObjectId,
            ref: "LeaveType",
            required: true,
            index: true
        },

        year: {
            type: Number,
            required: true,
            min: 2000,
            max: 2100
        },

        month: {
            type: Number,
            min: 1,
            max: 12
        },

        type: {
            type: String,
            enum: [
                "credit",
                "debit",
                "carry_forward",
                "expire",
                "adjustment",
                "reversal"
            ],
            required: true
        },

        days: {
            type: Number,
            required: true,
            min: 0
        },

        // Source reference (optional)
        requestId: {
            type: Schema.Types.ObjectId,
            ref: "AttendanceRequest"
        },

        reason: {
            type: String
        },

        // Balance after this transaction
        balanceAfter: {
            type: Number,
            required: true
        },

        // Who triggered it (admin userId). Null for system/cron entries.
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        // Whether the entry came from a user action, a cron job or the system
        source: {
            type: String,
            enum: ["user", "cron", "system"],
            default: "user"
        }
    },
    {
        timestamps: true
    }
);

// Idempotent key: same employee+type+year+month+type+reason prevents duplicate cron runs
LeaveLedgerSchema.index(
    { employeeId: 1, leaveTypeId: 1, year: 1, month: 1, type: 1, reason: 1 },
    { unique: true, partialFilterExpression: { reason: { $type: "String" } } }
);

export default mongoose.model("LeaveLedger", LeaveLedgerSchema);
