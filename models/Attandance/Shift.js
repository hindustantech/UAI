import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Break Schema
 */
const BreakSchema = new Schema({
    name: {
        type: String,
        default: "Default Break"
    },
    duration: {
        type: Number,
        default: 30 // 30 mins default
    },
    isPaid: {
        type: Boolean,
        default: false
    }
}, { _id: false });

/**
 * Shift Schema
 */
const ShiftSchema = new Schema({

    companyId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    shiftName: {
        type: String,
        required: true,
        trim: true,
        default: "General Shift"
    },

    shiftCode: {
        type: String,
        required: true,
        uppercase: true,
        default: "GEN"
    },

    startTime: {
        type: String,
        required: true,
        default: "09:00"
    },

    endTime: {
        type: String,
        required: true,
        default: "18:00"
    },

    /**
     * Shift Type
     */
    shiftType: {
        type: String,
        enum: ["fixed", "rotational", "flexible"],
        default: "fixed"
    },

    /**
     * Weekly Off Default = Sunday
     */
    weeklyOff: {
        type: [String],
        enum: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        default: ["Sunday"]
    },

    /**
     * Breaks Default
     */
    breaks: {
        type: [BreakSchema],
        default: () => [{
            name: "Lunch Break",
            duration: 30,
            isPaid: false
        }]
    },

    /**
     * Grace Periods (Safe Defaults)
     */
    gracePeriod: {
        earlyEntry: {   // ✅ ADD THIS
            type: Number,
            default: 30
        },
        lateEntry: {
            type: Number,
            default: 10
        },
        afterAbsentMark: {
            type: Number,
            default: 30
        },
        earlyExit: {
            type: Number,
            default: 10
        }
    }
    ,
    /**
     * Overtime Rules
     */
    overtime: {
        allowed: {
            type: Boolean,
            default: true
        },
        maxHoursPerDay: {
            type: Number,
            default: 4
        }
    },

    /**
     * Night Shift
     */
    isNightShift: {
        type: Boolean,
        default: false
    },

    /**
     * Soft Delete
     */
    isDeleted: {
        type: Boolean,
        default: false,
        index: true
    },

    deletedAt: Date

}, {
    timestamps: true
});

/**
 * Index (multi-tenant safe)
 */
ShiftSchema.index({ companyId: 1, shiftCode: 1 }, { unique: true });

/**
 * Auto Apply Defaults Middleware (CRITICAL)
 */
ShiftSchema.pre("save", function (next) {

    // Ensure breaks always exist
    if (!this.breaks || this.breaks.length === 0) {
        this.breaks = [{
            name: "Lunch Break",
            duration: 30,
            isPaid: false
        }];
    }

    // Ensure weeklyOff exists
    if (!this.weeklyOff || this.weeklyOff.length === 0) {
        this.weeklyOff = ["Sunday"];
    }

    // Ensure gracePeriod exists
    if (!this.gracePeriod) {
        this.gracePeriod = {
            lateEntry: 10,
            afterAbsentMark: 30,
            earlyExit: 10
        };
    }

    next();
});

/**
 * Query Middleware (Soft Delete Safe)
 */
ShiftSchema.pre(/^find/, function (next) {
    this.where({ isDeleted: false });
    next();
});

export default mongoose.model("Shift", ShiftSchema);