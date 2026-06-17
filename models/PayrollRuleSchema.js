import mongoose from "mongoose";

const PayrollRuleSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        deductions: {
            gratuity: {
                enabled: {
                    type: Boolean,
                    default: true
                },
                calculationType: {
                    type: String,
                    enum: ["percentage", "fixed"],
                    default: "percentage"
                },
                value: {
                    type: Number,
                    default: 4.81
                }
            },

            pf: {
                enabled: {
                    type: Boolean,
                    default: true
                },
                calculationType: {
                    type: String,
                    enum: ["percentage", "fixed"],
                    default: "percentage"
                },
                value: {
                    type: Number,
                    default: 12
                }
            },

            esi: {
                enabled: {
                    type: Boolean,
                    default: true
                },
                calculationType: {
                    type: String,
                    enum: ["percentage", "fixed"],
                    default: "percentage"
                },
                value: {
                    type: Number,
                    default: 0.75
                }
            },

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

export default mongoose.model("PayrollRule", PayrollRuleSchema);