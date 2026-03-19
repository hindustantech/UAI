import mongoose from "mongoose";

const { Schema } = mongoose;

const attendanceRequestSchema = new Schema(
    {
        companyId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        employeeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
            required: true,
            index: true
        },

        requestType: {
            type: String,
            enum: [
                "leave",
                "punch_in_out",
                "punch_in",
                "punch_in_and_out"
            ],
            required: true,
            index: true
        },

        reason: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500
        },

        /*
            LEAVE DETAILS
        */
        leaveDetails: {

            startDate: {
                type: Date
            },

            endDate: {
                type: Date
            }

        },

        /*
            PUNCH CORRECTION DETAILS
        */
        punchDetails: {

            date: {
                type: Date
            },

            punchInTime: {
                type: Date
            },

            punchOutTime: {
                type: Date
            }

        },

        /*
            APPROVAL SYSTEM
        */
        status: {
            type: String,
            enum: [
                "pending",
                "approved",
                "rejected",
                "cancelled"
            ],
            default: "pending",
            index: true
        },

        approvedBy: {
            type: Schema.Types.ObjectId,
            ref: "User"
        },

        approvedAt: {
            type: Date
        },

        rejectionReason: {
            type: String
        }

    },
    {
        timestamps: true
    }
);

export default mongoose.model("AttendanceRequest", attendanceRequestSchema);