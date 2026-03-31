// models/PaymentLog.js

import mongoose from "mongoose";

const paymentLogSchema = new mongoose.Schema({

    companyId: mongoose.Schema.Types.ObjectId,

    subscriptionId: mongoose.Schema.Types.ObjectId,

    amount: Number,

    status: String,

    razorpayPaymentId: String,

    razorpayOrderId: String,

    rawPayload: Object,
    upgradeType: {
        type: String,
        enum: ["EMPLOYEE_UPGRADE", "PLAN_UPGRADE", null],
        default: null,
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
    paymentCompletedAt: {
        type: Date,
    },

}, { timestamps: true });

export default mongoose.model("PaymentLog", paymentLogSchema);
