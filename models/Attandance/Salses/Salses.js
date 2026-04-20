// models/Sales/Sales.js
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
    timestamp: { type: Date, required: true, default: Date.now },
    accuracy: Number, // GPS accuracy in meters
    speed: Number, // Speed in m/s
    heading: Number // Direction in degrees
  },
  { _id: false }
);

// ========== ATTACHMENT SCHEMA ==========
const attachmentSchema = new Schema({
  type: { type: String, enum: ["image", "document", "signature"], required: true },
  url: { type: String, required: true },
  fileName: String,
  fileSize: Number,
  mimeType: String,
  uploadedAt: { type: Date, default: Date.now },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User" }
});

// ========== SALES PUNCH EVENT ==========
const salesPunchEventSchema = new Schema(
  {
    eventType: {
      type: String,
      enum: ["punch_in", "punch_out"],
      required: true,
      index: true
    },
    sessionId: { type: String, required: true, index: true },
    salesPersonId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    eventTime: { type: Date, required: true, index: true, default: Date.now },
    location: { type: geoPointSchema, required: true },
    isWithinRadius: { type: Boolean, required: true, index: true },
    distanceFromOffice: { type: Number, required: true },
    rejectionReason: String,
    deviceInfo: {
      deviceId: String,
      deviceModel: String,
      platform: String,
      appVersion: String
    },
    photoAttachment: attachmentSchema // Selfie or location photo
  },
  { timestamps: true }
);

salesPunchEventSchema.index({ location: "2dsphere" });
salesPunchEventSchema.index({ sessionId: 1, eventType: 1 });

export const SalesPunchEvent = mongoose.model("SalesPunchEvent", salesPunchEventSchema);

// ========== NEXT MEETING SCHEMA ==========
const nextMeetingSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "SalesSession", required: true, index: true },
    isDecided: { type: Boolean, default: false },
    meetingDate: { type: Date, index: true },
    meetingTime: String,
    agenda: String,
    location: String,
    locationCoordinates: geoPointSchema,
    meetingType: { type: String, enum: ["online", "physical", "phone"], default: "physical" },
    meetingLink: String,
    notes: String,
    reminderSent: { type: Boolean, default: false },
    reminderDate: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    confirmedBy: { type: Schema.Types.ObjectId, ref: "User" },
    isConfirmed: { type: Boolean, default: false },
    followUpAction: String
  },
  { timestamps: true }
);

export const NextMeeting = mongoose.model("NextMeeting", nextMeetingSchema);

// ========== SALES SESSION ==========
const salesSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    salesPersonId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true, index: true },

    // Denormalized contact info
    contactName: String,
    contactPhone: String,
    contactEmail: String,
    contactDesignation: String,
    contactPhoto: String,

    // Session Status
    status: {
      type: String,
      enum: ["in_progress", "completed", "paused", "cancelled", "rejected"],
      default: "in_progress",
      index: true
    },
    rejectionReason: String,

    // Soft Delete
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedReason: String,

    // Geo Validation
    isWithinRadius: { type: Boolean, default: true, index: true },
    distanceFromOffice: { type: Number, index: true },

    // Punch Times
    startTime: { type: Date, required: true, index: true },
    endTime: Date,
    duration: Number, // minutes

    // Route Tracking
    routePath: { type: [routePointSchema], default: [] },
    totalDistance: { type: Number, default: 0 }, // meters
    dwellTime: { type: Number, default: 0 }, // seconds

    // Sales Details Form
    salesDetails: {
      leadSource: { type: String, enum: ["referral", "website", "call", "walkin", "campaign", "other"] },
      leadScore: { type: Number, min: 0, max: 100 },
      budget: Number,
      requirement: String,
      timeline: String,
      competitor: String,
      painPoints: String,
      decisionMaker: { type: Boolean, default: false },
      decisionMakerName: String,
      decisionMakerDesignation: String
    },

    // Visit Outcome
    visitOutcome: {
      type: String,
      enum: ["completed", "rescheduled", "not_interested", "pending", "follow_up", "converted"],
      default: "pending"
    },
    remark: String,

    // Sales Status
    salesStatus: {
      type: String,
      enum: ["open", "qualified", "proposal_sent", "negotiation", "closed_won", "closed_lost", "suspended"],
      default: "open"
    },
    salesStage: String,
    closureProbability: { type: Number, min: 0, max: 100 },

    // Attachments
    attachments: [attachmentSchema],
    signature: attachmentSchema,

  

    // Payments
    paymentIds: [{ type: Schema.Types.ObjectId, ref: "SalesPayment" }],
    totalAmount: { type: Number, default: 0 },
    amountReceived: { type: Number, default: 0 },
    pendingAmount: { type: Number, default: 0 },

    // Next Meeting
    nextMeetingId: { type: Schema.Types.ObjectId, ref: "NextMeeting" },
    nextMeetingDate: Date,

    // Audit Fields
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    lastModifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", index: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User" },
    assignedAt: { type: Date, default: Date.now },
    internalNotes: String,

    // Check-in/out photos
    punchInPhoto: attachmentSchema,
    punchOutPhoto: attachmentSchema
  },
  { timestamps: true, versionKey: false }
);

// Indexes
salesSessionSchema.index({ salesPersonId: 1, status: 1 });
salesSessionSchema.index({ companyId: 1, startTime: -1 });
salesSessionSchema.index({ contactId: 1 });
salesSessionSchema.index({ isDeleted: 1, status: 1 });
salesSessionSchema.index({ startTime: 1, isDeleted: 1 });
salesSessionSchema.index({ salesStatus: 1, visitOutcome: 1 });

export const SalesSession = mongoose.model("SalesSession", salesSessionSchema);

// ========== SALES PAYMENT ==========
const salesPaymentSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "SalesSession", required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    paymentMode: {
      type: String,
      enum: ["cash", "card", "upi", "bank_transfer", "cheque", "online"],
      required: true
    },
    transactionId: String,
    paymentDate: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "completed", "refunded"],
      default: "pending",
      index: true
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,
    approvalNotes: String,
    receiptUrl: String,
    notes: String,
    partialPayment: { type: Boolean, default: false },
    installments: [
      {
        dueDate: Date,
        amount: Number,
        status: { type: String, enum: ["pending", "paid", "overdue"], default: "pending" },
        paidDate: Date
      }
    ]
  },
  { timestamps: true }
);

export const SalesPayment = mongoose.model("SalesPayment", salesPaymentSchema);

// ========== CONTACT ==========
const contactSchema = new Schema(
  {
    name: { type: String, required: true, index: true },
    phone: { type: String, required: true, index: true },
    email: { type: String, sparse: true, index: true },
    designation: String,
    department: String,
    company: String,
    address: String,
    landmark: String,
    location: geoPointSchema,
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    photo: String,
    totalVisits: { type: Number, default: 0 },
    totalSales: { type: Number, default: 0 },
    lastVisitDate: Date,
    lastPurchaseDate: Date,
    notes: String,
    tags: [String],
    isActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

export const Contact = mongoose.model("Contact", contactSchema);