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
        type: Number, // minutes
        default: 30,
        min: 0
    },
    isPaid: {
        type: Boolean,
        default: false
    }
}, { _id: false });

/**
 * Shift Schema (Production Ready)
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
        trim: true,
        default: "GEN"
    },

    /**
     * ✅ CRITICAL FIX: Store business time + timezone
     */
    startTime: {
        type: String, // "HH:mm"
        required: true,
        default: "09:00",
        match: /^([01]\d|2[0-3]):([0-5]\d)$/
    },

    endTime: {
        type: String,
        required: true,
        default: "18:00",
        match: /^([01]\d|2[0-3]):([0-5]\d)$/
    },

    timezone: {
        type: String,
        default: "Asia/Kolkata",
        index: true
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
     * Weekly Off
     */
    weeklyOff: {
        type: [String],
        enum: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        default: ["Sunday"]
    },

    /**
     * Breaks
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
     * Grace Periods (Validated)
     */
    gracePeriod: {
        earlyEntry: {
            type: Number,
            default: 30,
            min: 0,
            max: 180
        },
        lateEntry: {
            type: Number,
            default: 10,
            min: 0,
            max: 60
        },
        afterAbsentMark: {
            type: Number,
            default: 30,
            min: 0,
            max: 180
        },
        earlyExit: {
            type: Number,
            default: 10,
            min: 0,
            max: 60
        }
    },

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
            default: 4,
            min: 0,
            max: 24
        }
    },

    /**
     * Night Shift Handling
     */
    isNightShift: {
        type: Boolean,
        default: false
    },

    /**
     * Versioning (CRITICAL for audit)
     */
    version: {
        type: Number,
        default: 1
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
 * Unique Index (multi-tenant safe)
 */
ShiftSchema.index(
    { companyId: 1, shiftCode: 1 },
    { unique: true }
);

/**
 * Pre-save Middleware (Hardened)
 */
ShiftSchema.pre("save", function (next) {

    // Normalize shiftCode
    if (this.shiftCode) {
        this.shiftCode = this.shiftCode.toUpperCase().trim();
    }

    // Ensure breaks
    if (!this.breaks || this.breaks.length === 0) {
        this.breaks = [{
            name: "Lunch Break",
            duration: 30,
            isPaid: false
        }];
    }

    // Ensure weeklyOff
    if (!this.weeklyOff || this.weeklyOff.length === 0) {
        this.weeklyOff = ["Sunday"];
    }

    // Ensure gracePeriod
    if (!this.gracePeriod) {
        this.gracePeriod = {
            earlyEntry: 30,
            lateEntry: 10,
            afterAbsentMark: 30,
            earlyExit: 10
        };
    }

    // Detect night shift automatically
    const [startHour] = this.startTime.split(":").map(Number);
    const [endHour] = this.endTime.split(":").map(Number);

    this.isNightShift = endHour < startHour;

    next();
});

/**
 * Soft Delete Query Middleware
 */
ShiftSchema.pre(/^find/, function (next) {
    this.where({ isDeleted: false });
    next();
});

export default mongoose.model("Shift", ShiftSchema);