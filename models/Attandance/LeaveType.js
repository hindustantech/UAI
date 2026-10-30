import mongoose from "mongoose";

const { Schema } = mongoose;

const LeaveTypeSchema = new Schema(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        name: {
            type: String,
            required: true
        },

        code: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },

        category: {
            type: String,
            enum: ["yearly_fixed", "monthly", "earned"],
            required: true
        },

        paid: {
            type: Boolean,
            default: true
        },

        allowHalfDay: {
            type: Boolean,
            default: false
        },

        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

// Unique code per company
LeaveTypeSchema.index({ companyId: 1, code: 1 }, { unique: true });

export default mongoose.model("LeaveType", LeaveTypeSchema);