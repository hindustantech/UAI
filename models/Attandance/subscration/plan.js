import mongoose from "mongoose";

const featureSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
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
        required: true,
    },
    features: [featureSchema],   // Array of objects
    isActive: {
        type: Boolean,
        default: true,
    },
    planType: {
        type: String,
        enum: ["FREE", "BASIC", "STANDARD", "PREMIUM", "ENTERPRISE"],
        default: "BASIC",
        uppercase: true,
    },
    metadata: {
        type: Map,
        of: String,
    }
}, {
    timestamps: true
});

// Auto calculate finalPrice before saving
planSchema.pre("save", function (next) {
    if (this.discount > 0) {
        this.finalPrice = Math.round(this.price * (1 - this.discount / 100));
    } else {
        this.finalPrice = this.price;
    }
    next();
});

export default mongoose.model("Plan", planSchema);