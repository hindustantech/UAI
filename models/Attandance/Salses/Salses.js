import mongoose from "mongoose";

const { Schema } = mongoose;

// ========== ATTACHMENT SCHEMA ==========
const attachmentSchema = new Schema({
  url: { 
    type: String, 
    required: true 
  },
  fileName: String,
  uploadedAt: { 
    type: Date, 
    default: Date.now 
  }
}, { _id: false });

// ========== CUSTOMER SCHEMA ==========
const customerSchema = new Schema({
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
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number]
    }
  },
  shopPhoto: attachmentSchema
}, { _id: false });

// ========== SALES SCHEMA ==========
const salesSchema = new Schema({
  dealStatus: {
    type: String,
    enum: ["Negotiation", "Closed Won", "Closed Lost", "Follow Up"],
    default: "Negotiation"
  },
  paymentCollected: { 
    type: Boolean, 
    default: false 
  },
  amount: { 
    type: Number, 
    default: 0 
  },
  paymentMode: { 
    type: String, 
    enum: ["Cash", "Card", "Bank Transfer", "UPI"],
    sparse: true
  },
  paymentDate: Date
}, { _id: false });

// ========== NEXT MEETING SCHEMA ==========
const nextMeetingSchema = new Schema({
  decided: { 
    type: Boolean, 
    default: false 
  },
  date: Date,
  time: { 
    type: String, 
    default: "" 
  },
  notes: { 
    type: String, 
    default: "" 
  }
}, { _id: false });

// ========== EVIDENCE SCHEMA ==========
const evidenceSchema = new Schema({
  visitNotes: { 
    type: String, 
    default: "" 
  },
  visitPhoto: attachmentSchema
}, { _id: false });

// ========== ROUTE POINT SCHEMA ==========
const routePointSchema = new Schema({
  location: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number]
    }
  },
  timestamp: { 
    type: Date, 
    default: Date.now 
  },
  accuracy: { 
    type: Number, 
    default: 0 
  },
  speed: { 
    type: Number, 
    default: 0 
  },
  heading: { 
    type: Number, 
    default: 0 
  }
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
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number]
    }
  },
  punchInPhoto: attachmentSchema,
  punchInAddress: { 
    type: String, 
    default: "" 
  },

  // ========== PUNCH OUT ==========
  punchOutTime: Date,
  punchOutLocation: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number]
    }
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
    default: 0 
  },
  duration: { 
    type: Number, 
    default: 0 
  },

  // ========== CUSTOMER DETAILS ==========
  customer: {
    type: customerSchema,
    default: {}
  },

  // ========== SALES DETAILS ==========
  sales: {
    type: salesSchema,
    default: {}
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
    default: {}
  },

  // ========== VISIT NOTES ==========
  evideinceVisite: {
    type: evidenceSchema,
    default: {}
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
      if (Array.isArray(this.punchInLocation.coordinates) && this.punchInLocation.coordinates.length === 2) {
        this.punchInLocation.coordinates = this.punchInLocation.coordinates.map(c => {
          const num = Number(c?.valueOf ? c.valueOf() : c);
          if (!isFinite(num)) throw new Error(`Invalid coordinate: ${c}`);
          return num;
        });
      }
    }

    // Ensure punchOutLocation has correct structure if present
    if (this.punchOutLocation && this.punchOutLocation.coordinates) {
      if (!this.punchOutLocation.type) {
        this.punchOutLocation.type = "Point";
      }
      this.punchOutLocation.coordinates = this.punchOutLocation.coordinates.map(c => {
        const num = Number(c?.valueOf ? c.valueOf() : c);
        if (!isFinite(num)) throw new Error(`Invalid coordinate: ${c}`);
        return num;
      });
    }

    // Ensure customer location has correct structure if present
    if (this.customer && this.customer.location && this.customer.location.coordinates) {
      if (!this.customer.location.type) {
        this.customer.location.type = "Point";
      }
      this.customer.location.coordinates = this.customer.location.coordinates.map(c => {
        const num = Number(c?.valueOf ? c.valueOf() : c);
        if (!isFinite(num)) throw new Error(`Invalid coordinate: ${c}`);
        return num;
      });
    }

    // Ensure routePath locations have correct structure
    if (this.routePath && Array.isArray(this.routePath)) {
      this.routePath.forEach((point, index) => {
        if (point.location && point.location.coordinates) {
          if (!point.location.type) {
            point.location.type = "Point";
          }
          point.location.coordinates = point.location.coordinates.map(c => {
            const num = Number(c?.valueOf ? c.valueOf() : c);
            if (!isFinite(num)) throw new Error(`Invalid coordinate at routePath[${index}]: ${c}`);
            return num;
          });
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

// Compound indexes
salesSessionSchema.index({ salesPersonId: 1, punchInTime: -1 });
salesSessionSchema.index({ companyId: 1, punchInTime: -1 });
salesSessionSchema.index({ status: 1, punchInTime: -1 });
salesSessionSchema.index({ salesPersonId: 1, status: 1 });

// ========== EXPORT ==========
export const SalesSession = mongoose.model("SalesSession", salesSessionSchema);