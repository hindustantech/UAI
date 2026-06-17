// models/Attendance.js

import mongoose from "mongoose";


const BreakSchema = new mongoose.Schema({

    type: {
        type: String,
        enum: ["lunch", "tea", "personal", "meeting"],
        required: true
    },

    breakName: {
        type: String,
        default: "Lunch Break"
    },

    startTime: {
        type: Date,
        required: true
    },

    endTime: {
        type: Date,
        default: null
    },

    /**
     * Total Minutes
     */
    durationMinutes: {
        type: Number,
        default: 0
    },

    /**
     * HH:MM FORMAT
     */
    durationHHMM: {
        type: String,
        default: "00:00"
    },

    /**
     * Shift Allowed Minutes
     */
    allowedMinutes: {
        type: Number,
        default: 0
    },

    /**
     * Extra Minutes
     */
    exceededMinutes: {
        type: Number,
        default: 0
    },

    isPaid: {
        type: Boolean,
        default: false
    },

    status: {
        type: String,
        enum: ["active", "completed"],
        default: "active"
    }

}, { _id: true });

const attendanceSchema = new mongoose.Schema({


    /* ===========================
       Organization Mapping
    ============================ */

    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true // ✅ CRITICAL for performance
    },

    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        index: true
    },


    /* ===========================
       Date & Shift
    ============================ */

    date: {
        type: Date,
        required: true,
        index: true
    },

    shift: {
        name: String,

        startTime: String, // "09:00"
        endTime: String,   // "18:00"

        shiftMinutes: {
            type: Number,
            default: 0
        }
    },

    totalWorkingHours: {
        type: Number,
        default: 0
    },
    lateByMinutes: {
        type: Number,
        default: 0
    },


    /* ===========================
       Punch Timing
    ============================ */

    punchIn: {
        type: Date,
        index: true
    },

    punchOut: {
        type: Date,
        index: true
    },


    breaks: {
        type: [BreakSchema],
        default: []
    },
    /* ===========================
       Punch History (Audit Trail)
    ============================ */

    punchHistory: [
        {
            punchOut: {
                type: Date,

            },

            type: {
                type: String,
                enum: ["in", "out"],

            },

            time: {
                type: Date,

            },
            geoLocation: Object,

            deviceInfo: Object,

            source: {
                type: String,
                enum: ["mobile", "web", "biometric", "admin",'system_auto'],
                default: "mobile"
            },

            createdAt: {
                type: Date,
                default: Date.now
            }
        }
    ],


    lastPunchAt: {
        type: Date,
        index: true
    },



    /* ===========================
       Work Calculation
    ============================ */

    workSummary: {

        totalMinutes: {
            type: Number,
            default: 0
        },

        payableMinutes: {
            type: Number,
            default: 0
        },

        overtimeMinutes: {
            type: Number,
            default: 0
        },

        lateMinutes: {
            type: Number,
            default: 0
        },

        earlyLeaveMinutes: {
            type: Number,
            default: 0
        }
    },


    /* ===========================
       Attendance Status
    ============================ */

    status: {
        type: String,
        enum: [
            "present",
            "absent",
            "leave",
            "holiday",
            "half_day",
            "week_off",
            "pending_approval",
            "rejected",
            "system_auto"
        ],
        default: "present"
    },


    approvalStatus: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "approved"
    },


    /* ===========================
       Location (GeoJSON)
    ============================ */

    geoLocation: {
        type: {
            type: String,
            enum: ["Point"]
        },

        coordinates: {
            type: [Number],
            default: undefined,
            validate: {
                validator: function (v) {
                    return !v || (Array.isArray(v) && v.length === 2);
                },
                message: "Coordinates must be [lng, lat]"
            }
        },

        accuracy: Number,

        verified: Boolean,   // ✅ REMOVE default

    },

    /* ===========================
       Device Binding
    ============================ */

    deviceInfo: {

        deviceId: {
            type: String,
            index: true
        },

        ip: String,

        platform: {
            type: String,
            enum: ["android", "ios", "web"]
        },

        appVersion: String
    },


    /* ===========================
       Audit & Review
    ============================ */

    remarks: String,


    editLogs: [
        {
            editedBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User"
            },

            reason: String,

            oldValue: Object,
            newValue: Object,

            editedAt: {
                type: Date,
                default: Date.now
            }
        }
    ],


    isAutoMarked: {
        type: Boolean,
        default: false
    },

    isSuspicious: {
        type: Boolean,
        default: false
    }

},
    {
        timestamps: true
    });


/* ===========================
   Indexes (CRITICAL)
=========================== */

// Prevent duplicate attendance (per day)
attendanceSchema.index(
    { companyId: 1, employeeId: 1, date: 1 },
    { unique: true }
);


// Geo Spatial
// ✅ Must be sparse to skip documents without geoLocation
attendanceSchema.index({ geoLocation: "2dsphere" }, { sparse: true });

// Device Fraud
attendanceSchema.index({
    "deviceInfo.deviceId": 1
});


// Fast Reports
attendanceSchema.index({
    employeeId: 1,
    date: -1
});


attendanceSchema.index({
    status: 1,
    approvalStatus: 1
});


export default mongoose.model("Attendance", attendanceSchema);
