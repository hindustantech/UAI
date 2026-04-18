// ============================================
// MODELS / SCHEMAS
// ============================================

import mongoose from "mongoose";

const { Schema } = mongoose;

// ========== GEO SCHEMA ==========
const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  { _id: false }
);

const routePointSchema = new Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true },
    timestamp: { type: Date, required: true, default: Date.now }
  },
  { _id: false }
);

// ========== SALES PUNCH EVENT ==========
const salesPunchEventSchema = new Schema(
  {
    eventType: {
      type: String,
      enum: ["punch_in", "punch_out"],
      required: true,
      index: true
    },

    sessionId: {
      type: String,
      required: true,
      index: true
    },

    salesPersonId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true
    },

    eventTime: {
      type: Date,
      required: true,
      index: true,
      default: Date.now
    },

    location: {
      type: geoPointSchema,
      required: true
    },

    isWithinRadius: {
      type: Boolean,
      required: true,
      index: true
    },

    distanceFromOffice: {
      type: Number, // meters
      required: true
    },

    rejectionReason: String
  },
  {
    timestamps: true
  }
);

// 2dsphere index for geospatial queries
salesPunchEventSchema.index({ location: "2dsphere" });
salesPunchEventSchema.index({ sessionId: 1, eventType: 1 });

export const SalesPunchEvent = mongoose.model("SalesPunchEvent", salesPunchEventSchema);

// ========== SALES SESSION ==========
const salesSessionSchema = new Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    salesPersonId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true
    },

    contactId: {
      type: Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
      index: true
    },

    // Denormalized contact info for quick access
    contactName: String,
    contactPhone: String,
    contactEmail: String,

    // -------- SESSION STATUS --------
    status: {
      type: String,
      enum: ["in_progress", "completed", "paused", "cancelled", "rejected"],
      default: "in_progress",
      index: true
    },

    rejectionReason: String,

    // -------- SOFT DELETE --------
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    },

    deletedAt: Date,
    deletedReason: String,

    // -------- GEO VALIDATION --------
    isWithinRadius: {
      type: Boolean,
      default: true,
      index: true
    },

    distanceFromOffice: {
      type: Number, // meters
      index: true
    },

    // -------- PUNCH TIMES --------
    startTime: {
      type: Date,
      required: true,
      index: true
    },

    endTime: Date,

    duration: Number, // minutes (computed)

    // -------- ROUTE TRACKING --------
    routePath: {
      type: [routePointSchema],
      default: []
    },

    totalDistance: {
      type: Number,
      default: 0 // meters
    },

    dwellTime: {
      type: Number,
      default: 0 // seconds
    },

    // -------- SALES OUTCOME --------
    visitOutcome: {
      type: String,
      enum: ["completed", "rescheduled", "not_interested", "pending", "follow_up"],
      default: "pending"
    },

    remark: String,

    salesStatus: {
      type: String,
      enum: ["open", "closed", "suspended"],
      default: "open"
    },

    nextMeetingDate: Date,

    // -------- PAYMENTS --------
    paymentIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "SalesPayment"
      }
    ],

    // -------- AUDIT FIELDS --------
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },

    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },

    internalNotes: String
  },
  {
    timestamps: true,
    versionKey: false
  }
);

// Indexes for common queries
salesSessionSchema.index({ salesPersonId: 1, status: 1 });
salesSessionSchema.index({ companyId: 1, startTime: -1 });
salesSessionSchema.index({ contactId: 1 });
salesSessionSchema.index({ isDeleted: 1, status: 1 });
salesSessionSchema.index({ startTime: 1, isDeleted: 1 });

export const SalesSession = mongoose.model("SalesSession", salesSessionSchema);

// ========== SALES PAYMENT ==========
const salesPaymentSchema = new Schema(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "SalesSession",
      required: true,
      index: true
    },

    amount: {
      type: Number,
      required: true
    },

    currency: {
      type: String,
      default: "INR"
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "completed"],
      default: "pending",
      index: true
    },

    paymentDate: Date,

    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },

    approvalNotes: String,

    nextFollowUpDate: Date
  },
  {
    timestamps: true
  }
);

export const SalesPayment = mongoose.model("SalesPayment", salesPaymentSchema);

// ========== CONTACT ==========
const contactSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      index: true
    },

    phone: {
      type: String,
      required: true,
      index: true
    },

    email: {
      type: String,
      sparse: true,
      index: true
    },

    company: String,

    address: String,

    landmark: String,

    location: geoPointSchema,

    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true
    },

    totalVisits: {
      type: Number,
      default: 0
    },

    lastVisitDate: Date,

    notes: String,

    isActive: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

export const Contact = mongoose.model("Contact", contactSchema);
