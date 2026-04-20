import mongoose from "mongoose";

const { Schema } = mongoose;

// ========== SIMPLE GEOJSON POINT DEFINITION ==========
// MongoDB 2dsphere requires coordinates as [longitude, latitude] with NO nested schema
const geoPointShape = {
  type: {
    type: String,
    enum: ["Point"],
    default: "Point"
  },
  coordinates: {
    type: [Number],  // MUST be primitive numbers, not nested type definition
    required: true
  }
};

// ========== ATTACHMENT SCHEMA ==========
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

// ========== CUSTOMER SCHEMA ==========
const customerSchema = new Schema({
  companyName: { type: String, default: "" },
  contactName: { type: String, default: "" },
  phoneNumber: { type: String, default: "" },
  address: { type: String, default: "" },
  landmark: { type: String, default: "" },
  location: geoPointShape,  // Simple object, not nested Schema
  shopPhoto: attachmentSchema
}, { _id: false });

// ========== SALES SCHEMA ==========
const salesSchema = new Schema({
  dealStatus: {
    type: String,
    enum: ["Negotiation", "Closed Won", "Closed Lost", "Follow Up"],
    default: "Negotiation"
  },
  paymentCollected: { type: Boolean, default: false },
  amount: { type: Number, default: 0, min: 0 },
  paymentMode: { type: String, enum: [null, "Cash", "Card", "Bank Transfer", "UPI"], default: null },
  paymentDate: { type: Date, default: null }
}, { _id: false });

// ========== NEXT MEETING SCHEMA ==========
const nextMeetingSchema = new Schema({
  decided: { type: Boolean, default: false },
  date: { type: Date, default: null },
  time: { type: String, default: "" },
  notes: { type: String, default: "" }
}, { _id: false });

// ========== EVIDENCE VISITE SCHEMA ==========
const evidenceSchema = new Schema({
  visitNotes: { type: String, default: "" },
  visitPhoto: attachmentSchema
}, { _id: false });

// ========== ROUTE POINT SCHEMA ==========
// CRITICAL: Don't use nested geoPointSchema, use simple object
const routePointSchema = new Schema({
  location: geoPointShape,  // Simple object shape, NOT Schema
  timestamp: { type: Date, required: true, default: Date.now },
  accuracy: { type: Number, default: 0, min: 0 },
  speed: { type: Number, default: 0, min: 0 },
  heading: { type: Number, default: 0, min: 0, max: 360 }
}, { _id: true });

// ========== MAIN SALES SESSION SCHEMA ==========
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
  punchInLocation: {
    type: geoPointShape,
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
  punchOutLocation: {
    type: geoPointShape,
    default: null
  },
  punchOutPhoto: attachmentSchema,
  punchOutAddress: { 
    type: String, 
    default: "" 
  },

  // ========== ROUTE TRACKING ==========
  routePath: {
    type: [routePointSchema],
    default: []
  },
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

  // ========== CUSTOMER DETAILS ==========
  customer: {
    type: customerSchema,
    default: () => ({})
  },

  // ========== SALES DETAILS ==========
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
  
  // ========== NEXT MEETING ==========
  nextMeeting: {
    type: nextMeetingSchema,
    default: () => ({})
  },

  // ========== VISIT NOTES ==========
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
  
}, { timestamps: true });

// ========== PRE-SAVE MIDDLEWARE ==========
salesSessionSchema.pre('save', function(next) {
  try {
    // Ensure punchInLocation has correct structure
    if (this.punchInLocation) {
      if (!this.punchInLocation.type) {
        this.punchInLocation.type = "Point";
      }
      if (!Array.isArray(this.punchInLocation.coordinates) || this.punchInLocation.coordinates.length !== 2) {
        throw new Error('punchInLocation.coordinates must be [longitude, latitude]');
      }
      // Force coordinates to primitives
      this.punchInLocation.coordinates = this.punchInLocation.coordinates.map(c => {
        const num = Number(c?.valueOf ? c.valueOf() : c);
        if (!isFinite(num)) throw new Error(`Invalid coordinate: ${c}`);
        return num;
      });
    }

    // Ensure punchOutLocation has correct structure if present
    if (this.punchOutLocation && Object.keys(this.punchOutLocation).length > 0) {
      if (!this.punchOutLocation.type) {
        this.punchOutLocation.type = "Point";
      }
      if (Array.isArray(this.punchOutLocation.coordinates) && this.punchOutLocation.coordinates.length === 2) {
        this.punchOutLocation.coordinates = this.punchOutLocation.coordinates.map(c => {
          const num = Number(c?.valueOf ? c.valueOf() : c);
          if (!isFinite(num)) throw new Error(`Invalid coordinate: ${c}`);
          return num;
        });
      }
    }

    // Ensure customer location has correct structure if present
    if (this.customer && this.customer.location && Object.keys(this.customer.location).length > 0) {
      if (!this.customer.location.type) {
        this.customer.location.type = "Point";
      }
      if (Array.isArray(this.customer.location.coordinates) && this.customer.location.coordinates.length === 2) {
        this.customer.location.coordinates = this.customer.location.coordinates.map(c => {
          const num = Number(c?.valueOf ? c.valueOf() : c);
          if (!isFinite(num)) throw new Error(`Invalid coordinate: ${c}`);
          return num;
        });
      }
    }

    // Ensure routePath locations have correct structure
    if (this.routePath && Array.isArray(this.routePath)) {
      this.routePath.forEach((point, index) => {
        if (point.location) {
          if (!point.location.type) {
            point.location.type = "Point";
          }
          if (Array.isArray(point.location.coordinates) && point.location.coordinates.length === 2) {
            point.location.coordinates = point.location.coordinates.map(c => {
              const num = Number(c?.valueOf ? c.valueOf() : c);
              if (!isFinite(num)) throw new Error(`Invalid coordinate at routePath[${index}]: ${c}`);
              return num;
            });
          }
        }
      });
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ========== GEOSPATIAL INDEXES ==========
salesSessionSchema.index({ punchInLocation: "2dsphere" });
salesSessionSchema.index({ "customer.location": "2dsphere" });
salesSessionSchema.index({ "routePath.location": "2dsphere" });

// Compound indexes for common queries
salesSessionSchema.index({ salesPersonId: 1, punchInTime: -1 });
salesSessionSchema.index({ companyId: 1, punchInTime: -1 });
salesSessionSchema.index({ status: 1, punchInTime: -1 });
salesSessionSchema.index({ salesPersonId: 1, status: 1 });

// ========== EXPORT ==========
export const SalesSession = mongoose.model("SalesSession", salesSessionSchema);