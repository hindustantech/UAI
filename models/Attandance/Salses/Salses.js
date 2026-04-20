import mongoose from "mongoose";

const { Schema } = mongoose;

// Simple attachment
const attachmentSchema = new Schema(
  {
    url: String,
    fileName: String,
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

// Simple route point
const routePointSchema = new Schema(
  {
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: [Number]
    },
    timestamp: { type: Date, default: Date.now },
    accuracy: { type: Number, default: 0 },
    speed: { type: Number, default: 0 },
    heading: { type: Number, default: 0 }
  },
  { _id: true }
);

// Main sales session schema
const salesSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    salesPersonId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Punch in
    punchInTime: { type: Date, required: true, index: true },
    punchInLocation: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
        default: "Point"
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: function (value) {
            return (
              Array.isArray(value) &&
              value.length === 2 &&
              typeof value[0] === "number" &&
              typeof value[1] === "number"
            );
          },
          message: "Coordinates must be [longitude, latitude]"
        }
      }
    },
    punchInPhoto: attachmentSchema,
    punchInAddress: { type: String, default: "" },

    // Punch out
    punchOutTime: Date,
    punchOutLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: [Number]
    },
    punchOutPhoto: attachmentSchema,
    punchOutAddress: { type: String, default: "" },

    // Route
    routePath: [routePointSchema],
    totalDistance: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },

    // Customer
    customer: {
      companyName: String,
      contactName: String,
      phoneNumber: String,
      address: String,
      landmark: String,
      location: {
        type: {
          type: String,
          enum: ["Point"],
          default: "Point"
        },
        coordinates: [Number]
      },
      shopPhoto: attachmentSchema
    },

    // Sales
    sales: {
      dealStatus: {
        type: String,
        enum: ["Negotiation", "Closed Won", "Closed Lost", "Follow Up"],
        default: "Negotiation"
      },
      paymentCollected: { type: Boolean, default: false },
      amount: { type: Number, default: 0 },
      paymentMode: String,
      paymentDate: Date
    },

    SalesStatus: { type: String, enum: ["open", "close", "suspened"], default: "open", index: true },

    // Next meeting
    nextMeeting: {
      decided: { type: Boolean, default: false },
      date: Date,
      time: String,
      notes: String
    },

    // Evidence
    evideinceVisite: {
      visitNotes: String,
      visitPhoto: attachmentSchema
    },

    // Status
    status: { type: String, enum: ["in_progress", "completed"], default: "in_progress", index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

// Pre-save middleware to ensure coordinates are primitives
salesSessionSchema.pre("save", function (next) {
  try {
    // punchInLocation
    if (this.punchInLocation && Array.isArray(this.punchInLocation.coordinates)) {
      this.punchInLocation.type = "Point";
      this.punchInLocation.coordinates = this.punchInLocation.coordinates.map(c => Number(c));
    }

    // punchOutLocation
    if (this.punchOutLocation && Array.isArray(this.punchOutLocation.coordinates)) {
      this.punchOutLocation.type = "Point";
      this.punchOutLocation.coordinates = this.punchOutLocation.coordinates.map(c => Number(c));
    }

    // customer location
    if (this.customer?.location && Array.isArray(this.customer.location.coordinates)) {
      this.customer.location.type = "Point";
      this.customer.location.coordinates = this.customer.location.coordinates.map(c => Number(c));
    }

    // routePath locations
    if (Array.isArray(this.routePath)) {
      this.routePath.forEach(point => {
        if (point.location && Array.isArray(point.location.coordinates)) {
          point.location.type = "Point";
          point.location.coordinates = point.location.coordinates.map(c => Number(c));
        }
      });
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Geospatial indexes
salesSessionSchema.index({ punchInLocation: "2dsphere" });
salesSessionSchema.index({ "customer.location": "2dsphere" });
salesSessionSchema.index({ "routePath.location": "2dsphere" });
salesSessionSchema.index({ salesPersonId: 1, punchInTime: -1 });
salesSessionSchema.index({ companyId: 1, punchInTime: -1 });
salesSessionSchema.index({ status: 1, punchInTime: -1 });

export const SalesSession = mongoose.model("SalesSession", salesSessionSchema);