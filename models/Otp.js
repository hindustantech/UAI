import mongoose from "mongoose";

const otpSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        phone: {
            type: String,
            required: true,
            index: true,
        },

        otp: {
            type: String,
            required: true,
        },

        attempts: {
            type: Number,
            default: 0,
        },

        expiresAt: {
            type: Date,
            required: true,
            index: true,
        },

        verified: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

/* AUTO DELETE AFTER EXPIRY */

otpSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

export default mongoose.model("Otp", otpSchema);