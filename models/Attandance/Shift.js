// models/Shift.js

import mongoose from "mongoose";

const { Schema } = mongoose;

const BreakSchema = new Schema({
    name: String,
    duration: Number, // minutes
    isPaid: {
        type: Boolean,
        default: false
    }
}, { _id: false });

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
        trim: true
    },

    shiftCode: {
        type: String,
        required: true,
        uppercase: true
    },

    startTime: {
        type: String, // "09:00"
        required: true
    },

    endTime: {
        type: String, // "18:00"
        required: true
    },

    /**
     * 🔹 Shift Type
     */
    shiftType: {
        type: String,
        enum: ["fixed", "rotational", "flexible"],
        default: "fixed"
    },

    /**
     * 🔹 Weekly Offs
     */
    weeklyOff: [{
        type: String,
        enum: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    }],

    /**
     * 🔹 Breaks
     */
    breaks: [BreakSchema],

    /**
     * 🔹 Grace Periods
     */
    gracePeriod: {
        lateEntry: { type: Number, default: 10 },   // minutes
        earlyExit: { type: Number, default: 10 }
    },

    /**
     * 🔹 Overtime Rules
     */
    overtime: {
        allowed: { type: Boolean, default: true },
        maxHoursPerDay: { type: Number, default: 4 }
    },

    /**
     * 🔹 Night Shift Config
     */
    isNightShift: {
        type: Boolean,
        default: false
    },

    /**
     * 🔹 Soft Delete
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
 * Indexing
 */
ShiftSchema.index({ companyId: 1, shiftCode: 1 }, { unique: true });

/**
 * Middleware
 */
ShiftSchema.pre(/^find/, function (next) {
    this.where({ isDeleted: false });
    next();
});

export default mongoose.model("Shift", ShiftSchema);