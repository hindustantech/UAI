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
    required: true,
    validate: {
      validator: function(coords) {
        return Array.isArray(coords) && 
               coords.length === 2 && 
               coords.every(coord => typeof coord === 'number' && !isNaN(coord));
      },
      message: 'Coordinates must be an array of two numbers'
    }
  }
}, { _id: false });

// ========== ROUTE POINT SCHEMA ==========
const routePointSchema = new Schema({
  location: { type: geoPointSchema, required: true },
  timestamp: { type: Date, required: true },
  accuracy: { type: Number, default: 0 },
  speed: { type: Number, default: 0 },
  heading: { type: Number, default: 0 }
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
  punchInAddress: { type: String, default: "" },

  // ========== PUNCH OUT ==========
  punchOutTime: Date,
  punchOutLocation: geoPointSchema,
  punchOutPhoto: attachmentSchema,
  punchOutAddress: { type: String, default: "" },

  // ========== ROUTE TRACKING ==========
  routePath: [routePointSchema],
  totalDistance: { type: Number, default: 0 }, // meters
  duration: { type: Number, default: 0 }, // seconds

  // ========== CUSTOMER DETAILS (from form) ==========
  customer: {
    companyName: { type: String, default: "" },
    contactName: { type: String, default: "" },
    phoneNumber: { type: String, default: "" },
    address: { type: String, default: "" },
    landmark: { type: String, default: "" },
    location: geoPointSchema,
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
  
  SalesStatus: { 
    type: String, 
    enum: ["open", "close", "suspened"],
    default: "open"
  },
  
  // ========== NEXT MEETING (from form) ==========
  nextMeeting: {
    decided: { type: Boolean, default: false },
    date: Date,
    time: { type: String, default: "" },
    notes: { type: String, default: "" }
  },

  // ========== VISIT NOTES ==========
  evideinceVisite: {
    visitNotes: { type: String, default: "" },
    visitPhoto: attachmentSchema
  },

  // Status
  status: {
    type: String,
    enum: ["in_progress", "completed"],
    default: "in_progress",
    index: true
  },
  
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  
}, { timestamps: true });

// ========== PRE-SAVE VALIDATION MIDDLEWARE ==========
salesSessionSchema.pre('save', function(next) {
  // Validate punchInLocation coordinates
  if (this.punchInLocation && this.punchInLocation.coordinates) {
    if (!Array.isArray(this.punchInLocation.coordinates) || 
        this.punchInLocation.coordinates.length !== 2 ||
        this.punchInLocation.coordinates.some(coord => typeof coord !== 'number' || isNaN(coord))) {
      next(new Error('Invalid punchInLocation coordinates: must be an array of two numbers'));
    }
  }
  
  // Validate punchOutLocation if present
  if (this.punchOutLocation && this.punchOutLocation.coordinates) {
    if (!Array.isArray(this.punchOutLocation.coordinates) || 
        this.punchOutLocation.coordinates.length !== 2 ||
        this.punchOutLocation.coordinates.some(coord => typeof coord !== 'number' || isNaN(coord))) {
      next(new Error('Invalid punchOutLocation coordinates: must be an array of two numbers'));
    }
  }
  
  // Validate customer location if present
  if (this.customer && this.customer.location && this.customer.location.coordinates) {
    if (!Array.isArray(this.customer.location.coordinates) || 
        this.customer.location.coordinates.length !== 2 ||
        this.customer.location.coordinates.some(coord => typeof coord !== 'number' || isNaN(coord))) {
      next(new Error('Invalid customer location coordinates: must be an array of two numbers'));
    }
  }
  
  // Validate routePath locations
  if (this.routePath && this.routePath.length > 0) {
    for (let i = 0; i < this.routePath.length; i++) {
      const point = this.routePath[i];
      if (point.location && point.location.coordinates) {
        if (!Array.isArray(point.location.coordinates) || 
            point.location.coordinates.length !== 2 ||
            point.location.coordinates.some(coord => typeof coord !== 'number' || isNaN(coord))) {
          next(new Error(`Invalid routePath coordinates at index ${i}: must be an array of two numbers`));
        }
      }
    }
  }
  
  next();
});

// ========== PRE-FINDONEANDUPDATE VALIDATION ==========
salesSessionSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  // Check if update contains location data that needs validation
  if (update.$set) {
    // Validate punchInLocation
    if (update.$set.punchInLocation && update.$set.punchInLocation.coordinates) {
      const coords = update.$set.punchInLocation.coordinates;
      if (!Array.isArray(coords) || coords.length !== 2 || coords.some(coord => typeof coord !== 'number' || isNaN(coord))) {
        next(new Error('Invalid punchInLocation coordinates in update: must be an array of two numbers'));
      }
    }
    
    // Validate punchOutLocation
    if (update.$set.punchOutLocation && update.$set.punchOutLocation.coordinates) {
      const coords = update.$set.punchOutLocation.coordinates;
      if (!Array.isArray(coords) || coords.length !== 2 || coords.some(coord => typeof coord !== 'number' || isNaN(coord))) {
        next(new Error('Invalid punchOutLocation coordinates in update: must be an array of two numbers'));
      }
    }
    
    // Validate customer location
    if (update.$set.customer && update.$set.customer.location && update.$set.customer.location.coordinates) {
      const coords = update.$set.customer.location.coordinates;
      if (!Array.isArray(coords) || coords.length !== 2 || coords.some(coord => typeof coord !== 'number' || isNaN(coord))) {
        next(new Error('Invalid customer location coordinates in update: must be an array of two numbers'));
      }
    }
  }
  
  // Validate $push operations for routePath
  if (update.$push && update.$push.routePath && update.$push.routePath.location && update.$push.routePath.location.coordinates) {
    const coords = update.$push.routePath.location.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2 || coords.some(coord => typeof coord !== 'number' || isNaN(coord))) {
      next(new Error('Invalid routePath coordinates in push operation: must be an array of two numbers'));
    }
  }
  
  next();
});

// Indexes for geospatial queries
salesSessionSchema.index({ punchInLocation: "2dsphere" });
salesSessionSchema.index({ "routePath.location": "2dsphere" });
salesSessionSchema.index({ salesPersonId: 1, punchInTime: -1 });
salesSessionSchema.index({ companyId: 1, punchInTime: -1 });
salesSessionSchema.index({ status: 1, punchInTime: -1 });

export const SalesSession = mongoose.model("SalesSession", salesSessionSchema);