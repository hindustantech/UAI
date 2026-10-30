import mongoose from "mongoose";

const { Schema } = mongoose;

const LeavePolicySchema = new Schema(
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

        description: {
            type: String
        },

        isDefault: {
            type: Boolean,
            default: false
        },

        financialYearStartMonth: {
            type: Number,
            min: 1,
            max: 12,
            default: 1
        },

        leaveRules: [{
            leaveTypeId: {
                type: Schema.Types.ObjectId,
                ref: "LeaveType",
                required: true
            },

            // --- Accrual & eligibility ---
            accrual: {
                // yearly_fixed
                yearlyQuota: {
                    type: Number,
                    min: 1,
                    default: 15
                },
                eligibility: {
                    afterMonths: {
                        type: Number,
                        min: 0,
                        default: 0
                    },
                    afterDays: {
                        type: Number,
                        min: 0,
                        default: 0
                    }
                },
                allocationMode: {
                    type: String,
                    enum: ["lumpsum", "monthly_prorated"],
                    default: "lumpsum"
                },
                prorateOnJoining: {
                    type: Boolean,
                    default: false
                },

                // monthly
                creditPerMonth: {
                    type: Number,
                    min: 0,
                    default: 1
                },
                creditOnDay: {
                    type: Number,
                    min: 1,
                    max: 31,
                    default: 1
                },
                prorateFirstMonth: {
                    type: Boolean,
                    default: false
                },

                // earned
                workingDaysPerCredit: {
                    type: Number,
                    min: 1,
                    default: 20
                },
                creditDays: {
                    type: Number,
                    min: 0.5,
                    default: 1
                },
                countStatuses: {
                    type: [String],
                    enum: ["present", "half_day"],
                    default: ["present", "half_day"]
                },
                halfDayCredit: {
                    type: Number,
                    default: 0.5
                },
                countFrom: {
                    type: String,
                    enum: ["joining", "last_credit", "year_start"],
                    default: "joining"
                }
            },

            // --- Limits ---
            limits: {
                maxPerMonth: {
                    type: Number,
                    min: 0,
                    default: null
                },
                maxPerYear: {
                    type: Number,
                    min: 0,
                    default: null
                },
                maxPerRequest: {
                    type: Number,
                    min: 1,
                    default: null
                }
            },

            // --- Lifecycle ---
            lifecycle: {
                unusedAction: {
                    type: String,
                    enum: ["lapse", "carry_forward"],
                    default: "lapse"
                },
                carryTo: {
                    type: String,
                    enum: ["month", "year", "both"],
                    default: "month"
                },
                maxCarryDays: {
                    type: Number,
                    min: 0,
                    default: null
                },
                carryExpiryMonths: {
                    type: Number,
                    min: 0,
                    default: null
                }
            },

            // --- Request rules ---
            requestRules: {
                minNoticeDays: {
                    type: Number,
                    min: 0,
                    default: 0
                },
                allowBackdated: {
                    type: Boolean,
                    default: false
                },
                allowHalfDay: {
                    type: Boolean,
                    default: false
                },
                requiresAttachment: {
                    type: Boolean,
                    default: false
                }
            }
        }],

        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

export default mongoose.model("LeavePolicy", LeavePolicySchema);