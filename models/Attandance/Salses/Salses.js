import mongoose from "mongoose";

const { Schema } = mongoose;

// ================= GEO SCHEMA =================
const geoSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["Point"]
    },
    coordinates: {
      type: [Number],
      validate: {
        validator: function (v) {
          if (!v) return true; // allow undefined
          return (
            Array.isArray(v) &&
            v.length === 2 &&
            typeof v[0] === "number" &&
            typeof v[1] === "number"
          );
        },
        message: "Coordinates must be [lng, lat]"
      }
    }
  },
  { _id: false }
);

// ================= ATTACHMENT =================
const attachmentSchema = new Schema(
  {
    url: String,
    fileName: String,
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

// ================= ROUTE POINT =================
const routePointSchema = new Schema(
  {
    location: {
      type: geoSchema,
      required: true
    },
    timestamp: { type: Date, default: Date.now },
    accuracy: { type: Number, default: 0 },
    speed: { type: Number, default: 0 },
    heading: { type: Number, default: 0 }
  },
  { _id: true }
);

// ================= MAIN SCHEMA =================
const salesSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    salesPersonId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    companyId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // ===== Punch In =====
    punchInTime: { type: Date, required: true },
    punchInLocation: {
      type: geoSchema,
      required: true
    },
    punchInPhoto: attachmentSchema,
    punchInAddress: { type: String, default: "" },

    // ===== Punch Out =====
    punchOutTime: Date,
    punchOutLocation: {
      type: geoSchema,
      default: null   // ✅ IMPORTANT
    },
    punchOutPhoto: attachmentSchema,
    punchOutAddress: { type: String, default: "" },

    // ===== Route =====
    routePath: [routePointSchema],
    totalDistance: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },

    // ===== Customer =====
    customer: {
      companyName: String,
      contactName: String,
      phoneNumber: String,
      address: String,
      landmark: String,

      location: {
        type: geoSchema,
        default: null   // ✅ IMPORTANT
      },

      shopPhoto: attachmentSchema
    },

    // ===== Sales =====
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

    SalesStatus: {
      type: String,
      enum: ["open", "close", "suspened"],
      default: "open"
    },

    nextMeeting: {
      decided: { type: Boolean, default: false },
      date: Date,
      time: String,
      notes: String
    },

    evideinceVisite: {
      visitNotes: String,
      visitPhoto: attachmentSchema
    },

    status: {
      type: String,
      enum: ["in_progress", "completed"],
      default: "in_progress"
    },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

// ================= GEO INDEX =================
salesSessionSchema.index({ punchInLocation: "2dsphere" });
salesSessionSchema.index({ punchOutLocation: "2dsphere" });
salesSessionSchema.index({ "customer.location": "2dsphere" });
salesSessionSchema.index({ "routePath.location": "2dsphere" });

export const SalesSession = mongoose.model("SalesSession", salesSessionSchema);