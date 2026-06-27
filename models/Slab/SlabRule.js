import mongoose from "mongoose";

const slabSchema = new mongoose.Schema(
    {
        minEmployees: {
            type: Number,
            required: [true, "minEmployees is required"],
            min: [0, "minEmployees cannot be negative"],
        },

        maxEmployees: {
            type: Number,
            default: null, // null = unlimited
            validate: {
                validator: function (value) {
                    if (value === null) return true;
                    return value > this.minEmployees;
                },
                message: "maxEmployees must be greater than minEmployees",
            },
        },

        pricePerEmployeePerYear: {
            type: Number,
            required: [true, "pricePerEmployeePerYear is required"],
            min: [0, "Price cannot be negative"],
        },
    },
    { _id: false }
);

const modulePricingSchema = new mongoose.Schema(
    {
        module: {
            type: String,
            enum: {
                values: ["ATTENDANCE", "SALES", "PRO_SALES", "PAYROLL"],
                message: "Invalid module type",
            },
            required: [true, "Module is required"],
        },

        slabs: {
            type: [slabSchema],
            required: [true, "At least one slab is required"],
            validate: {
                validator: function (value) {
                    return value.length > 0;
                },
                message: "Slabs array cannot be empty",
            },
        },

        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { _id: false }
);

const pricingRuleSchema = new mongoose.Schema(
    {
        modules: {
            type: [modulePricingSchema],
            required: [true, "At least one module is required"],
            validate: {
                validator: function (value) {
                    return value.length > 0;
                },
                message: "Modules array cannot be empty",
            },
        },
    },
    {
        timestamps: true,
    }
);

// Compound unique index for module field within modules array
pricingRuleSchema.index(
    { "modules.module": 1 },
    { unique: true, sparse: true }
);

export default mongoose.model("PricingRule", pricingRuleSchema);