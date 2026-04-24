import mongoose from "mongoose";
const { Schema } = mongoose;

/* ============================================================
   GEO POINT (STRICT + VALIDATED)
============================================================ */
const geoPointSchema = new Schema({
    type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true
    },
    coordinates: {
        type: [Number], // [lng, lat]
        required: true,
        validate: {
            validator: function (coords) {
                return (
                    Array.isArray(coords) &&
                    coords.length === 2 &&
                    isFinite(coords[0]) &&
                    isFinite(coords[1]) &&
                    coords[0] >= -180 && coords[0] <= 180 &&
                    coords[1] >= -90 && coords[1] <= 90
                );
            },
            message: "Coordinates must be [lng, lat] with valid range"
        }
    }
}, { _id: false });

/* ============================================================
   ATTACHMENT
============================================================ */
const attachmentSchema = new Schema({
    url: { type: String, required: true },
    fileName: String,
    uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

/* ============================================================
   VISIT LOG (PUNCH IN / OUT)
============================================================ */
const visitLogSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    punchInTime: { type: Date, default: Date.now },

    punchInLocation: {
        type: geoPointSchema,
        required: true
    },

    punchOutTime: { type: Date, default: null },

    punchOutLocation: {
        type: geoPointSchema,
        default: undefined
    }

}, { timestamps: true });

/* ============================================================
   SALES LOG
============================================================ */
const salesLogSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: "User" },

    dealStatus: {
        type: String,
        enum: ["Negotiation", "Closed Won", "Closed Lost", "Follow Up"],
        default: "Negotiation"
    },

    amount: { type: Number, default: 0 },

    paymentCollected: { type: Boolean, default: false },

    paymentMode: {
        type: String,
        enum: ["Cash", "Card", "UPI", "Bank Transfer", null],
        default: null
    },

    note: String,

    createdAt: { type: Date, default: Date.now }

});

/* ============================================================
   MEETING LOG
============================================================ */
const meetingLogSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: "User" },

    date: Date,
    time: String,
    notes: String,

    createdAt: { type: Date, default: Date.now }
});

/* ============================================================
   VISIT NOTES / EVIDENCE
============================================================ */
const visitNoteSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: "User" },

    note: String,

    photo: attachmentSchema,

    createdAt: { type: Date, default: Date.now }
});

/* ============================================================
   ROUTE TRACKING (IMPORTANT GEO FIELD)
============================================================ */
const routePointSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: "User" },

    location: {
        type: geoPointSchema,
        required: true
    },

    timestamp: { type: Date, default: Date.now },

    accuracy: { type: Number, default: 0 },
    speed: { type: Number, default: 0 },
    heading: { type: Number, default: 0 }

});

/* ============================================================
   MAIN SESSION
============================================================ */
const salesSessionSchema = new Schema({

    sessionId: {
        type: String,
        required: true,
        unique: true
    },

    customer: {
        companyName: {
            type: String,
            default: ""
        },
        contactName: {
            type: String,
            default: ""
        },
        phoneNumber: {
            type: String,
            default: ""
        },
        address: {
            type: String,
            default: ""
        },
        landmark: {
            type: String,
            default: ""
        },
        location: {
            type: geoPointSchema,
            default: undefined
        },
        shopPhoto: {
            type: attachmentSchema,
            default: undefined
        }
    },

    companyId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    createdBy: {
        type: Schema.Types.ObjectId,
        ref: "User"
    },

    assignedTo: [{  // Fixed spelling from "assingnedTo"
        type: Schema.Types.ObjectId,
        ref: "User"
    }],

    /* ================= LOGS ================= */

    visitLogs: {
        type: [visitLogSchema],
        default: []
    },

    salesLogs: {
        type: [salesLogSchema],
        default: []
    },

    meetingLogs: {
        type: [meetingLogSchema],
        default: []
    },

    visitNotes: {
        type: [visitNoteSchema],
        default: []
    },

    /* ================= ROUTE ================= */

    routePath: {
        type: [routePointSchema],
        default: [0.0, 0.0]
    },

    totalDistance: {
        type: Number,
        default: 0
    },

    duration: {
        type: Number,
        default: 0
    },

    /* ================= STATUS ================= */

    status: {
        type: String,
        enum: ["in_progress", "completed"],
        default: "in_progress",
        index: true
    },

    /* ================= SALES STATUS ================= */
    SalesStatus: {
        type: String,
        enum: ["open", "closed", "follow_up"],
        default: "open"
    },

    /* ================= FORM COMPLETION ================= */
    formCompleted: {
        type: Boolean,
        default: false
    },

    /* ================= NEXT MEETING ================= */
    nextMeeting: {
        decided: { type: Boolean, default: false },
        date: Date,
        time: String,
        notes: String
    },

    /* ================= EVIDENCE ================= */
    evidence: {
        visitNotes: String,
        visitPhoto: {
            type: attachmentSchema,
            default: undefined
        }
    },

    /* ================= PUNCH INFO ================= */
    punchInTime: {
        type: Date,
        default: null
    },

    punchInLocation: {
        type: geoPointSchema,
        default: undefined
    },

    punchOutTime: {
        type: Date,
        default: null
    },

    punchOutLocation: {
        type: geoPointSchema,
        default: undefined
    },

    punchOutAddress: {
        type: String,
        default: ""
    },

    lastPunchAt: {
        type: Date,
        default: null
    },

    employeeId: {
        type: Schema.Types.ObjectId,
        ref: "User"
    }

}, { timestamps: true });

/* ============================================================
   INDEXES
============================================================ */
// Route tracking
salesSessionSchema.index({ "routePath.location": "2dsphere" });

// Punch-in geo
salesSessionSchema.index({ punchInLocation: "2dsphere" });

// Punch-out geo
salesSessionSchema.index({ punchOutLocation: "2dsphere" });

// Compound index for active sessions
salesSessionSchema.index({
    status: 1,
    punchInLocation: "2dsphere"
});

// Company + status index
salesSessionSchema.index({ companyId: 1, status: 1, SalesStatus: 1 });

/* ============================================================
   EXPORT
============================================================ */
export const SalesSession = mongoose.model("SalesSession", salesSessionSchema);