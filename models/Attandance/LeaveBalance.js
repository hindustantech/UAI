import mongoose from "mongoose";

const { Schema } = mongoose;

const LeaveBalanceSchema = new Schema(
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

        policyId: {
            type: Schema.Types.ObjectId,
            ref: "LeavePolicy"
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

        // --- Balance tracking ---
        allocated: {
            type: Number,
            default: 0
        },

        carriedForward: {
            type: Number,
            default: 0
        },

        used: {
            type: Number,
            default: 0
        },

        pending: {
            type: Number,
            default: 0
        },

        expired: {
            type: Number,
            default: 0
        },

        adjusted: {
            type: Number,
            default: 0
        },

        // --- Derived balance (cached for fast reads) ---
        balance: {
            type: Number,
            default: 0
        },

        // --- Monthly buckets for the year ---
        monthly: [{
            month: {
                type: Number,
                min: 1,
                max: 12
            },
            credited: {
                type: Number,
                default: 0
            },
            used: {
                type: Number,
                default: 0
            },
            carriedForward: {
                type: Number,
                default: 0
            },
            expired: {
                type: Number,
                default: 0
            }
        }]
    },
    {
        timestamps: true
    }
);

// One balance document per employee + leave type + year
LeaveBalanceSchema.index({ employeeId: 1, leaveTypeId: 1, year: 1 }, { unique: true });

export default mongoose.model("LeaveBalance", LeaveBalanceSchema);
