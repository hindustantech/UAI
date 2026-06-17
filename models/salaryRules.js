import mongoose from "mongoose";

const SalaryRuleSchema = new mongoose.Schema(
    {
        late: {
            ruleName: {
                type: String,
                default: "3 Late = 0.5 Day Cut",
                trim: true
            },
            count: {
                type: Number,
                default: 3,
                min: 1
            },
            deductionDays: {
                type: Number,
                default: 0.5,
                min: 0
            }
        },

        halfDay: {
            ruleName: {
                type: String,
                default: "2 Half Days = 1 Day Cut",
                trim: true
            },
            count: {
                type: Number,
                default: 2,
                min: 1
            },
            deductionDays: {
                type: Number,
                default: 1,
                min: 0
            }
        }
    },
    {
        timestamps: true
    }
);

export default mongoose.model("SalaryRule", SalaryRuleSchema);