import mongoose from "mongoose";

const { Schema } = mongoose;

// ========== GEOJSON POINT SCHEMA (MongoDB Standard) ==========
// CRITICAL: This schema ensures coordinates are stored as primitive numbers
const geoPointSchema = new Schema({
  type: {
    type: String,
    enum: ["Point"],  // Must be exactly "Point" with capital P
    default: "Point",
    required: true
  },
  coordinates: {
    type: [Number],  // [longitude, latitude]
    required: true,
    validate: {
      validator: function (coords) {
        // Validate structure
        if (!Array.isArray(coords)) {
          return false;
        }
        if (coords.length !== 2) {
          return false;
        }
        // CRITICAL: Ensure coordinates are PRIMITIVE numbers, not objects
        return coords.every(coord => {
          const num = Number(coord);
          return typeof num === 'number' && isFinite(num);
        });
      },
      message: 'Coordinates must be an array of exactly two finite numbers'
    },
    set: function (coords) {
      // CRITICAL: Force conversion to primitives on assignment
      if (!Array.isArray(coords)) {
        throw new Error('Coordinates must be an array');
      }

      if (coords.length !== 2) {
        throw new Error('Coordinates array must have exactly 2 elements');
      }

      // Convert each coordinate to primitive number
      const primitiveCoords = coords.map((c, index) => {
        let num;

        // Handle Mongoose wrapper objects
        if (typeof c === 'object' && c !== null && typeof c.valueOf === 'function') {
          num = Number(c.valueOf());
        } else {
          num = Number(c);
        }

        if (!isFinite(num)) {
          throw new Error(`Coordinate at index ${index} is not a finite number: ${c} (${typeof c})`);
        }

        return num;
      });

      return primitiveCoords;
    }
  }
}, { _id: false, strict: true });

// ========== ROUTE POINT SCHEMA ==========
const routePointSchema = new Schema({
  location: {
    type: geoPointSchema,
    required: true
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  accuracy: {
    type: Number,
    default: 0,
    min: 0
  },
  speed: {
    type: Number,
    default: 0,
    min: 0
  },
  heading: {
    type: Number,
    default: 0,
    min: 0,
    max: 360
  }
}, { _id: true }); // Keep _id for route point tracking

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
    type: geoPointSchema,
    required: true
  },
  punchInPhoto: {
    type: attachmentSchema,
    default: undefined
  },
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
    type: geoPointSchema,
    default: undefined
  },
  punchOutPhoto: {
    type: attachmentSchema,
    default: undefined
  },
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
  }, // meters
  duration: {
    type: Number,
    default: 0,
    min: 0
  }, // seconds

  // ========== CUSTOMER DETAILS (from form) ==========
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

  // ========== SALES DETAILS (from form) ==========
  sales: {
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
      default: 0,
      min: 0
    },
    paymentMode: {
      type: String,
      enum: [null, "Cash", "Card", "Bank Transfer", "UPI"],
      default: null
    },
    paymentDate: {
      type: Date,
      default: null
    }
  },

  SalesStatus: {
    type: String,
    enum: ["open", "close", "suspened"],
    default: "open",
    index: true
  },

  // ========== NEXT MEETING (from form) ==========
  nextMeeting: {
    decided: {
      type: Boolean,
      default: false
    },
    date: {
      type: Date,
      default: null
    },
    time: {
      type: String,
      default: ""
    },
    notes: {
      type: String,
      default: ""
    }
  },

  // ========== VISIT NOTES ==========
  evideinceVisite: {
    visitNotes: {
      type: String,
      default: ""
    },
    visitPhoto: {
      type: attachmentSchema,
      default: undefined
    }
  },

  // Status
  status: {
    type: String,
    enum: ["in_progress", "completed"],
    default: "in_progress",
    index: true
  },

  assingnedTo: [{
    type: Schema.Types.ObjectId,
    ref: "User",
    default: null
  }],
  assingnedBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  assingnAt: {
    type: Date,
    default: null
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

// ========== PRE-SAVE VALIDATION MIDDLEWARE ==========
salesSessionSchema.pre('save', function (next) {
  try {
    // Validate punchInLocation coordinates
    if (this.punchInLocation && this.punchInLocation.coordinates) {
      validateGeoPointCoordinates(this.punchInLocation.coordinates, 'punchInLocation');
    }

    // Validate punchOutLocation if present
    if (this.punchOutLocation && this.punchOutLocation.coordinates) {
      validateGeoPointCoordinates(this.punchOutLocation.coordinates, 'punchOutLocation');
    }

    // Validate customer location if present
    if (this.customer && this.customer.location && this.customer.location.coordinates) {
      validateGeoPointCoordinates(this.customer.location.coordinates, 'customer.location');
    }

    // Validate routePath locations
    if (this.routePath && this.routePath.length > 0) {
      this.routePath.forEach((point, index) => {
        if (point.location && point.location.coordinates) {
          validateGeoPointCoordinates(point.location.coordinates, `routePath[${index}].location`);
        }
      });
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ========== PRE-FINDONEANDUPDATE VALIDATION ==========
salesSessionSchema.pre('findOneAndUpdate', function (next) {
  try {
    const update = this.getUpdate();

    // Check if update contains location data that needs validation
    if (update.$set) {
      // Validate punchInLocation
      if (update.$set.punchInLocation && update.$set.punchInLocation.coordinates) {
        validateGeoPointCoordinates(update.$set.punchInLocation.coordinates, 'punchInLocation in $set');
      }

      // Validate punchOutLocation
      if (update.$set.punchOutLocation && update.$set.punchOutLocation.coordinates) {
        validateGeoPointCoordinates(update.$set.punchOutLocation.coordinates, 'punchOutLocation in $set');
      }

      // Validate customer location
      if (update.$set.customer && update.$set.customer.location && update.$set.customer.location.coordinates) {
        validateGeoPointCoordinates(update.$set.customer.location.coordinates, 'customer.location in $set');
      }
    }

    // Validate $push operations for routePath
    if (update.$push && update.$push.routePath) {
      const routePoint = update.$push.routePath;
      if (routePoint.location && routePoint.location.coordinates) {
        validateGeoPointCoordinates(routePoint.location.coordinates, 'routePath in $push');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ========== HELPER: Validate coordinates are primitive numbers ==========
function validateGeoPointCoordinates(coords, location) {
  if (!Array.isArray(coords)) {
    throw new Error(`${location}: Coordinates must be an array`);
  }

  if (coords.length !== 2) {
    throw new Error(`${location}: Coordinates array must have exactly 2 elements, got ${coords.length}`);
  }

  coords.forEach((coord, index) => {
    // CRITICAL: Check type is PRIMITIVE number
    if (typeof coord !== 'number') {
      throw new Error(`${location}[${index}]: Coordinate must be a primitive number, got ${typeof coord} (value: ${coord})`);
    }

    if (!isFinite(coord)) {
      throw new Error(`${location}[${index}]: Coordinate must be finite, got ${coord}`);
    }
  });
}

// ========== GEOSPATIAL INDEXES ==========
// Create 2dsphere indexes for geospatial queries
salesSessionSchema.index({ punchInLocation: "2dsphere" });
salesSessionSchema.index({ "customer.location": "2dsphere" });
salesSessionSchema.index({ "routePath.location": "2dsphere" });

// Compound indexes for common queries
salesSessionSchema.index({ salesPersonId: 1, punchInTime: -1 });
salesSessionSchema.index({ companyId: 1, punchInTime: -1 });
salesSessionSchema.index({ status: 1, punchInTime: -1 });
salesSessionSchema.index({ salesPersonId: 1, status: 1 });

// ========== POST-SAVE LOGGING (DEBUG) ==========
// Remove in production
salesSessionSchema.post('save', function () {
  if (process.env.DEBUG_GEOJSON === 'true') {
    console.log('✓ Session saved with punchInLocation coordinates:', this.punchInLocation.coordinates);
    console.log('  Coordinate types:', typeof this.punchInLocation.coordinates[0], typeof this.punchInLocation.coordinates[1]);
  }
});

export const SalesSession = mongoose.model("SalesSession", salesSessionSchema);