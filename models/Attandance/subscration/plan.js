import mongoose from "mongoose";

const featureSchema = new mongoose.Schema({
    key: {
        type: String, // e.g. "MAX_EMPLOYEES", "ATTENDANCE_REPORTS"
        required: true,
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
        // number | boolean | string (flexible for scaling)
        required: true,
    },
    description: {
        type: String,
    }
}, { _id: false });

const planSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },

    price: {
        type: Number,
        required: true,
        min: 0,
    },

    discount: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
    },

    finalPrice: {
        type: Number,
    },

    validityDays: {
        type: Number,
        required: true, // e.g. 30, 90, 365
    },

    features: [featureSchema],

    // Example:
    // [
    //   { key: "MAX_EMPLOYEES", value: 50 },
    //   { key: "CAN_EXPORT_REPORT", value: true }
    // ]

    isActive: {
        type: Boolean,
        default: true,
    },

    planType: {
        type: String,
        enum: ["FREE", "BASIC", "PREMIUM", "ENTERPRISE"],
        default: "BASIC",
    },

    metadata: {
        type: Map,
        of: String,
    }

}, {
    timestamps: true
});


// Middleware for auto final price calculation
planSchema.pre("save", function (next) {
    if (this.discount > 0) {
        this.finalPrice = this.price - (this.price * this.discount / 100);
    } else {
        this.finalPrice = this.price;
    }
    next();
});

export default mongoose.model("Plan", planSchema);