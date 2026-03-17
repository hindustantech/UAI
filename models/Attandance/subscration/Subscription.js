// models/Subscription.js
import mongoose from "mongoose";

const featureSnapshotSchema = new mongoose.Schema({
    key: String,
    value: mongoose.Schema.Types.Mixed,
}, { _id: false });

const subscriptionSchema = new mongoose.Schema({

    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },

    plan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Plan",
        required: true,
    },

    // Immutable snapshot (VERY IMPORTANT)
    planSnapshot: {
        name: String,
        price: Number,
        discount: Number,
        finalPrice: Number,
        validityDays: Number,
        features: [featureSnapshotSchema],
    },

    startDate: {
        type: Date,
        default: Date.now,
        index: true,
    },

    endDate: {
        type: Date,
        required: true,
        index: true,
    },

    status: {
        type: String,
        enum: ["PENDING", "ACTIVE", "EXPIRED", "CANCELLED", "PAST_DUE"],
        default: "PENDING",
        index: true,
    },

    payment: {
        transactionId: String,
        orderId: String,
        paymentGateway: {
            type: String,
            enum: ["RAZORPAY", "STRIPE", "MANUAL"],
        },
        paymentStatus: {
            type: String,
            enum: ["PENDING", "SUCCESS", "FAILED"],
            default: "PENDING",
        },
        amountPaid: Number,
        currency: {
            type: String,
            default: "INR",
        },
        paidAt: Date,
    },

    autoRenew: {
        type: Boolean,
        default: false,
    },

    renewalHistory: [
        {
            renewedAt: Date,
            oldEndDate: Date,
            newEndDate: Date,
            transactionId: String,
        }
    ],

    usage: {
        employeesUsed: {
            type: Number,
            default: 0,
        }
    },

    isActive: {
        type: Boolean,
        default: true,
    }

}, { timestamps: true });


// 🔥 Middleware: Auto-expire
subscriptionSchema.pre("save", function (next) {
    if (this.endDate < new Date()) {
        this.status = "EXPIRED";
    }
    next();
});

export const Subscription = mongoose.model("Subscription", subscriptionSchema);