// models/Attendance.js

import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema({


    /* ===========================
       Organization Mapping
    ============================ */

    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
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

    totalworkinghars: {
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


    /* ===========================
       Punch History (Audit Trail)
    ============================ */

    punchHistory: [
        {
            punchOut: {
                type: Date,
                required: true
            },

            geoLocation: Object,

            deviceInfo: Object,

            source: {
                type: String,
                enum: ["mobile", "web", "biometric", "admin"],
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
       Breaks
    ============================ */

    breaks: [
        {
            start: Date,
            end: Date,
            reason: String
        }
    ],


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
            "rejected"
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
            enum: ["Point"],
            default: "Point"
        },

        coordinates: {
            type: [Number],
            required: true
        },

        accuracy: Number,

        verified: {
            type: Boolean,
            default: false
        },

        source: {
            type: String,
            enum: ["gps", "network", "manual"],
            default: "gps"
        }
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
attendanceSchema.index({
    geoLocation: "2dsphere"
});


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
