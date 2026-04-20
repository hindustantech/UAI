import mongoose from "mongoose";

const { Schema } = mongoose;

// ====================== GEOJSON POINT SHAPE ======================
// Correct way to define reusable GeoJSON Point for MongoDB 2dsphere
const geoPointShape = {
  type: {
    type: String,
    enum: ["Point"],
    default: "Point"
  },
  coordinates: {
    type: [Number],           // [longitude, latitude]
    required: true
  }
};

// ====================== ATTACHMENT SCHEMA ======================
const attachmentSchema = new Schema({
  url: { 
    type: String, 
    required: true 
  },
  fileName: { 
    type: String 
  },
  uploadedAt: { 
    type: Date, 
    default: Date.now 
  }
}, { _id: false });

// ====================== CUSTOMER SCHEMA ======================
const customerSchema = new Schema({
  companyName: { type: String, default: "" },
  contactName: { type: String, default: "" },
  phoneNumber: { type: String, default: "" },
  address: { type: String, default: "" },
  landmark: { type: String, default: "" },
  location: geoPointShape,           // ← Fixed: Direct assignment
  shopPhoto: attachmentSchema
}, { _id: false });

// ====================== SALES SCHEMA ======================
const salesSchema = new Schema({
  dealStatus: {
    type: String,
    enum: ["Negotiation", "Closed Won", "Closed Lost", "Follow Up"],
    default: "Negotiation"
  },
  paymentCollected: { type: Boolean, default: false },
  amount: { type: Number, default: 0, min: 0 },
  paymentMode: { 
    type: String, 
    enum: [null, "Cash", "Card", "Bank Transfer", "UPI"], 
    default: null 
  },
  paymentDate: { type: Date, default: null }
}, { _id: false });

// ====================== NEXT MEETING SCHEMA ======================
const nextMeetingSchema = new Schema({
  decided: { type: Boolean, default: false },
  date: { type: Date, default: null },
  time: { type: String, default: "" },
  notes: { type: String, default: "" }
}, { _id: false });

// ====================== EVIDENCE VISITE SCHEMA ======================
const evidenceSchema = new Schema({
  visitNotes: { type: String, default: "" },
  visitPhoto: attachmentSchema
}, { _id: false });

// ====================== ROUTE POINT SCHEMA ======================
const routePointSchema = new Schema({
  location: geoPointShape,           // ← Fixed: Direct assignment
  timestamp: { type: Date, required: true, default: Date.now },
  accuracy: { type: Number, default: 0, min: 0 },
  speed: { type: Number, default: 0, min: 0 },
  heading: { type: Number, default: 0, min: 0, max: 360 }
}, { _id: true });

// ====================== MAIN SALES SESSION SCHEMA ======================
const salesSessionSchema = new Schema({
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
    ref: "User", 
    required: true,
    index: true 
  },

  // ========== PUNCH IN ==========
  punchInTime: { 
    type: Date, 
    required: true,
    index: true 
  },
  punchInLocation: {                 // ← Fixed
    ...geoPointShape,
    required: true 
  },
  punchInPhoto: attachmentSchema,
  punchInAddress: { 
    type: String, 
    default: "" 
  },

  // ========== PUNCH OUT ==========
  punchOutTime: {
    type: Date,
    default: null
  },
  punchOutLocation: {                // ← Fixed
    ...geoPointShape 
    // No required because it's set during punch out
  },
  punchOutPhoto: attachmentSchema,
  punchOutAddress: { 
    type: String, 
    default: "" 
  },

  // ========== ROUTE TRACKING ==========
  routePath: [routePointSchema],     // ← Already correct as array of schema
  totalDistance: { 
    type: Number, 
    default: 0,
    min: 0 
  },
  duration: { 
    type: Number, 
    default: 0,
    min: 0 
  },

  // ========== CUSTOMER & SALES DETAILS ==========
  customer: {
    type: customerSchema,
    default: () => ({})
  },

  sales: {
    type: salesSchema,
    default: () => ({})
  },
  
  SalesStatus: { 
    type: String, 
    enum: ["open", "close", "suspened"],
    default: "open",
    index: true 
  },
  
  nextMeeting: {
    type: nextMeetingSchema,
    default: () => ({})
  },

  evideinceVisite: {
    type: evidenceSchema,
    default: () => ({})
  },

  // Status
  status: {
    type: String,
    enum: ["in_progress", "completed"],
    default: "in_progress",
    index: true
  },
  
  createdBy: { 
    type: Schema.Types.ObjectId, 
    ref: "User" 
  },
  updatedBy: { 
    type: Schema.Types.ObjectId, 
    ref: "User" 
  }
  
}, { 
  timestamps: true 
});

// ====================== PRE-SAVE MIDDLEWARE ======================
salesSessionSchema.pre('save', function(next) {
  try {
    // Ensure punchInLocation
    if (this.punchInLocation) {
      this.punchInLocation.type = "Point";
      if (Array.isArray(this.punchInLocation.coordinates)) {
        this.punchInLocation.coordinates = this.punchInLocation.coordinates.map(c => Number(c));
      }
    }

    // Ensure punchOutLocation
    if (this.punchOutLocation && Object.keys(this.punchOutLocation).length > 0) {
      this.punchOutLocation.type = "Point";
      if (Array.isArray(this.punchOutLocation.coordinates)) {
        this.punchOutLocation.coordinates = this.punchOutLocation.coordinates.map(c => Number(c));
      }
    }

    // Ensure customer location
    if (this.customer?.location && Object.keys(this.customer.location).length > 0) {
      this.customer.location.type = "Point";
      if (Array.isArray(this.customer.location.coordinates)) {
        this.customer.location.coordinates = this.customer.location.coordinates.map(c => Number(c));
      }
    }

    // Ensure all routePath locations
    if (Array.isArray(this.routePath)) {
      this.routePath.forEach((point, index) => {
        if (point?.location) {
          point.location.type = "Point";
          if (Array.isArray(point.location.coordinates)) {
            point.location.coordinates = point.location.coordinates.map(c => Number(c));
          }
        }
      });
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ====================== GEOSPATIAL INDEXES ======================
salesSessionSchema.index({ punchInLocation: "2dsphere" });
salesSessionSchema.index({ "customer.location": "2dsphere" });
salesSessionSchema.index({ "routePath.location": "2dsphere" });

// Compound indexes
salesSessionSchema.index({ salesPersonId: 1, punchInTime: -1 });
salesSessionSchema.index({ companyId: 1, punchInTime: -1 });
salesSessionSchema.index({ status: 1, punchInTime: -1 });
salesSessionSchema.index({ salesPersonId: 1, status: 1 });

export const SalesSession = mongoose.model("SalesSession", salesSessionSchema);