import mongoose from "mongoose";

const { Schema } = mongoose;

// ========== GEOJSON POINT SCHEMA (MongoDB Standard) ==========
const geoPointSchema = new Schema({
  type: {
    type: String,
    enum: ["Point"],
    default: "Point"
  },
  coordinates: {
    type: [Number],  // [longitude, latitude]
    required: true
  }
}, { _id: false });

// ========== ROUTE POINT SCHEMA ==========
const routePointSchema = new Schema({
  location: { type: geoPointSchema, required: true },
  timestamp: { type: Date, required: true },
  accuracy: Number,
  speed: Number,
  heading: Number
}, { _id: false });

// ========== ATTACHMENT SCHEMA ==========
const attachmentSchema = new Schema({
  url: { type: String, required: true },
  fileName: String,
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

// ========== MAIN SALES SESSION SCHEMA ==========
const salesSessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true },
  salesPersonId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  companyId: { type: Schema.Types.ObjectId, ref: "User", required: true },

  // ========== PUNCH IN ==========
  punchInTime: { type: Date, required: true },
  punchInLocation: { type: geoPointSchema, required: true },
  punchInPhoto: attachmentSchema,
  punchInAddress: String,

  // ========== PUNCH OUT ==========
  punchOutTime: Date,
  punchOutLocation: geoPointSchema,
  punchOutPhoto: attachmentSchema,
  punchOutAddress: String,

  // ========== ROUTE TRACKING ==========
  routePath: [routePointSchema],
  totalDistance: { type: Number, default: 0 }, // meters
  duration: { type: Number, default: 0 }, // seconds

  // ========== CUSTOMER DETAILS (from form) ==========
  customer: {
    companyName: String,
    contactName: String,
    phoneNumber: String,
    address: String,
    landmark: String,
    location: geoPointSchema, // Customer's location if needed
    shopPhoto: attachmentSchema
  },

  // ========== SALES DETAILS (from form) ==========
  sales: {
    dealStatus: {
      type: String,
      enum: ["Negotiation", "Closed Won", "Closed Lost", "Follow Up"],
      default: "Negotiation"
    },
    paymentCollected: { type: Boolean, default: false },
    amount: { type: Number, default: 0 },
    paymentMode: { type: String, enum: ["Cash", "Card", "Bank Transfer", "UPI"] },
    paymentDate: Date
  },
  SalesStatus: { type: String, enum: ["open", "close"] },
  // ========== NEXT MEETING (from form) ==========
  nextMeeting: {
    decided: { type: Boolean, default: false },
    date: Date,
    time: String,
    notes: String
  },

  // ========== VISIT NOTES ==========
  evideinceVisite: {
    visitNotes: String,
    visitPhoto: attachmentSchema
  },


  // Status
  status: {
    type: String,
    enum: ["in_progress", "completed"],
    default: "in_progress",
    index: true
  }
}, { timestamps: true });

// Indexes for geospatial queries
salesSessionSchema.index({ punchInLocation: "2dsphere" });
salesSessionSchema.index({ routePath: "2dsphere" });
salesSessionSchema.index({ salesPersonId: 1, punchInTime: -1 });

export const SalesSession = mongoose.model("SalesSession", salesSessionSchema);