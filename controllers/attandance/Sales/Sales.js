import { SalesSession } from "../../../models/Attandance/Salses/Salses.js";
import { uploadToCloudinary } from "../../../utils/Cloudinary.js";
import mongoose from "mongoose";
import { fileTypeFromBuffer } from "file-type";
import Attendance from "../../../models/Attandance/Attendance.js";
import Shift from "../../../models/Attandance/Shift.js";
import Holiday from "../../../models/Attandance/Holiday.js";

// ========== HELPER FUNCTIONS ==========

// Generate unique session ID
const generateSessionId = (salesPersonId) => {
  return `${salesPersonId}-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
};

// Calculate distance between two points using Haversine formula (in meters)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toStrictNumber = (val) => {
  if (val === null || val === undefined) return null;

  // Handle object cases (Flutter / Firebase / GPS SDK)
  if (typeof val === "object") {
    if ("latitude" in val) return Number(val.latitude);
    if ("longitude" in val) return Number(val.longitude);
    if ("_latitude" in val) return Number(val._latitude);
    if ("_longitude" in val) return Number(val._longitude);
    return null;
  }

  const num = Number(val);
  return Number.isFinite(num) ? num : null;
};

// ========== FIXED: createGeoPoint with better error handling ==========
export const createGeoPoint = (lng, lat) => {
  // Ensure we have valid numbers
  let parsedLng = lng;
  let parsedLat = lat;

  // Handle object cases
  if (typeof lng === 'object') {
    parsedLng = lng.lng ?? lng.longitude ?? lng.coordinates?.[0];
    parsedLat = lat ?? lng.lat ?? lng.latitude ?? lng.coordinates?.[1];
  }

  // Convert to numbers
  parsedLng = Number(parsedLng);
  parsedLat = Number(parsedLat);

  // Validate
  if (isNaN(parsedLng) || isNaN(parsedLat)) {
    throw new Error(`Invalid GeoJSON coordinates: lng=${parsedLng}, lat=${parsedLat}`);
  }

  if (parsedLng < -180 || parsedLng > 180) {
    throw new Error(`Longitude out of range: ${parsedLng}`);
  }

  if (parsedLat < -90 || parsedLat > 90) {
    throw new Error(`Latitude out of range: ${parsedLat}`);
  }

  return {
    type: "Point",
    coordinates: [parsedLng, parsedLat]
  };
};
// ========== FIXED: Validate and sanitize location ==========
const toNumber = (val) => {
  const num = Number(val);
  return isNaN(num) ? null : num;
};

export const validateLocation = (location) => {
  if (!location) throw new Error("Location required");

  let lat = location.lat ?? location.latitude;
  let lng = location.lng ?? location.longitude;

  lat = toNumber(lat);
  lng = toNumber(lng);

  if (lat === null || lng === null) {
    throw new Error("Invalid coordinates: must be numbers");
  }

  // Return both the GeoJSON object AND separate lat/lng for convenience
  return {
    type: "Point",
    coordinates: [lng, lat], // MongoDB expects [lng, lat]
    lat: lat,  // ADDED: expose lat
    lng: lng,  // ADDED: expose lng
    address: location.address,
    accuracy: location.accuracy,
    heading: location.heading
  };
};

// Upload image to Cloudinary
const uploadImage = async (file, folder) => {
  if (!file || !file.buffer) return null;

  const type = await fileTypeFromBuffer(file.buffer);

  if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type.mime)) {
    throw new Error("INVALID_FILE_SIGNATURE");
  }

  return await uploadToCloudinary(file.buffer, folder);
};

// ========== PUNCH IN ==========
// export const punchIn = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     let { salesPersonId, companyId, location, deviceInfo } = req.body;

//     if (!salesPersonId || !companyId) {
//       return res.status(400).json({
//         error: "Missing required fields: salesPersonId, companyId"
//       });
//     }
//     console.log("PunchIn request body:", req.body);

//     // Normalize input early
//     if (typeof location === "string") {
//       location = JSON.parse(location);
//     }

//     const validatedLocation = validateLocation(location);
//     console.log("Validated Location:", validatedLocation);

//     const parsedDeviceInfo =
//       typeof deviceInfo === "string" ? JSON.parse(deviceInfo) : deviceInfo;

//     // Check active session
//     const activeSession = await SalesSession.findOne({
//       salesPersonId,
//       status: "in_progress"
//     });

//     if (activeSession) {
//       return res.status(400).json({
//         error: "You have an active session. Please punch out first.",
//         sessionId: activeSession.sessionId
//       });
//     }

//     let punchInPhoto = null;
//     if (req.file) {
//       punchInPhoto = await uploadImage(req.file, "sales/punch-in");
//     }

//     const sessionId = generateSessionId(salesPersonId);

//     // ✅ FIXED: Use validatedLocation.lng and validatedLocation.lat directly
//     const punchInLocationGeo = createGeoPoint(
//       validatedLocation.lng,  // Now this exists
//       validatedLocation.lat   // Now this exists
//     );

//     const routePoint = {
//       location: createGeoPoint(
//         validatedLocation.lng,  // Now this exists
//         validatedLocation.lat   // Now this exists
//       ),
//       timestamp: new Date(),
//       accuracy: validatedLocation.accuracy,
//       speed: 0,
//       heading: validatedLocation.heading
//     };

//     // ✅ FINAL SANITY CHECK (production defensive layer)
//     const [lng, lat] = punchInLocationGeo.coordinates;
//     if (typeof lng !== "number" || typeof lat !== "number") {
//       throw new Error("Final Geo validation failed");
//     }

//     const sessionData = {
//       sessionId,
//       salesPersonId: new mongoose.Types.ObjectId(salesPersonId),
//       companyId: new mongoose.Types.ObjectId(companyId),

//       status: "in_progress",
//       punchInTime: new Date(),

//       punchInLocation: punchInLocationGeo,
//       ...(punchInPhoto && { punchInPhoto }),

//       punchInAddress: validatedLocation.address,
//       punchOutAddress: "",

//       routePath: [routePoint],

//       totalDistance: 0,
//       duration: 0,

//       customer: {
//         companyName: "",
//         contactName: "",
//         phoneNumber: "",
//         address: "",
//         landmark: ""
//       },

//       sales: {
//         dealStatus: "Negotiation",
//         paymentCollected: false,
//         amount: 0
//       },

//       SalesStatus: "open",

//       nextMeeting: {
//         decided: false,
//         time: "",
//         notes: ""
//       },

//       evideinceVisite: {
//         visitNotes: ""
//       },

//       createdBy: new mongoose.Types.ObjectId(salesPersonId)
//     };

//     const [newSession] = await SalesSession.create([sessionData], { session });

//     await session.commitTransaction();

//     return res.status(201).json({
//       success: true,
//       sessionId,
//       session: newSession
//     });

//   } catch (error) {
//     await session.abortTransaction();
//     console.error("PunchIn error:", error);

//     return res.status(500).json({
//       error: error.message
//     });
//   } finally {
//     session.endSession();
//   }
// };



export const punchIn = async (req, res) => {
  try {
    const { employeeId, companyId } = req.user;
    const { location, deviceInfo } = req.body;

    const validatedLocation = validateLocation(location);
    const now = new Date();

    /* ============================
       1. NORMALIZE DATE (IST SAFE)
    ============================ */
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    /* ============================
       2. FETCH EMPLOYEE + SHIFT
    ============================ */
    const employee = await Employee.findOne({
      _id: employeeId,
      companyId,
      employmentStatus: "active"
    });

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const shift = await Shift.findOne({
      _id: employee.shift,
      companyId,
      isDeleted: false
    });

    if (!shift || !shift.startTime || !shift.endTime) {
      return res.status(400).json({
        error: "Invalid shift configuration"
      });
    }

    /* ============================
       3. HOLIDAY CHECK (CONFIG)
    ============================ */
    const holiday = await Holiday.findOne({
      companyId,
      date: today
    });

    let attendanceStatus = "present";

    if (holiday) {
      if (!shift.allowHolidayWork) {
        return res.status(403).json({
          error: `Holiday (${holiday.name || "Holiday"}). Punch-in not allowed`
        });
      }
      attendanceStatus = "holiday_working";
    }

    /* ============================
       4. TIME CALCULATION (IST)
    ============================ */
    const shiftStart = createDateTimeIST(today, shift.startTime);
    const shiftEnd = createDateTimeIST(today, shift.endTime);

    const punchTimeIST = getPunchTimeIST(now);

    const earlyLimit = shift.earlyPunchLimit || 60;
    const maxLate = shift.maxLatePunch || 120;

    const minutesBefore = diffMinutes(punchTimeIST, shiftStart);
    const minutesAfter = diffMinutes(shiftStart, punchTimeIST);

    /* ============================
       5. TOO EARLY BLOCK
    ============================ */
    if (minutesBefore > earlyLimit) {
      return res.status(400).json({
        error: "Too early to punch-in",
        allowedBeforeMinutes: earlyLimit,
        current: minutesBefore
      });
    }

    /* ============================
       6. TOO LATE BLOCK
    ============================ */
    if (minutesAfter > maxLate) {
      return res.status(403).json({
        error: "Punch-in too late",
        allowedLateMinutes: maxLate,
        current: minutesAfter
      });
    }

    /* ============================
       7. UPSERT ATTENDANCE
    ============================ */
    const attendance = await Attendance.findOneAndUpdate(
      {
        companyId,
        employeeId,
        date: today
      },
      {
        $setOnInsert: {
          companyId,
          employeeId,
          date: today,
          status: attendanceStatus
        }
      },
      {
        new: true,
        upsert: true
      }
    );

    /* ============================
       8. IDEMPOTENCY CHECK
    ============================ */
    if (attendance.punchIn) {
      return res.status(200).json({
        success: true,
        message: "Already punched in (ignored)",
        punchIn: attendance.punchIn
      });
    }

    /* ============================
       9. SAFE UPDATE (RACE SAFE)
    ============================ */
    const updated = await Attendance.findOneAndUpdate(
      {
        _id: attendance._id,
        punchIn: { $exists: false }
      },
      {
        $set: {
          punchIn: now,
          lastPunchAt: now,
          deviceInfo,
          geoLocation: createGeoPoint(
            validatedLocation.lng,
            validatedLocation.lat
          )
        },
        $push: {
          punchHistory: {
            type: "in",
            time: now,
            geoLocation: validatedLocation,
            deviceInfo,
            source: "mobile"
          }
        }
      },
      { new: true }
    );

    if (!updated) {
      return res.status(200).json({
        success: true,
        message: "Punch already recorded (race safe)"
      });
    }

    /* ============================
       10. SUCCESS RESPONSE
    ============================ */
    return res.status(200).json({
      success: true,
      message: "Punch-in successful",
      data: {
        punchIn: updated.punchIn,
        status: updated.status,
        shift: {
          start: shift.startTime,
          end: shift.endTime
        }
      }
    });

  } catch (error) {
    console.error("PunchIn Error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ========== UPDATE ROUTE ==========
export const updateRoute = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { location, deviceInfo } = req.body;

    const validatedLocation = validateLocation(location);

    if (!sessionId) {
      return res.status(400).json({ error: "Missing required fields: sessionId" });
    }

    // Find session
    const salesSession = await SalesSession.findOne({ sessionId, status: "in_progress" });
    if (!salesSession) {
      return res.status(404).json({ error: "Session not found or already completed" });
    }

    // Get last route point
    const lastPoint = salesSession.routePath[salesSession.routePath.length - 1];

    // Calculate time difference
    const now = new Date();
    const timeDiff = (now - lastPoint.timestamp) / 1000;

    // Calculate distance
    const distance = calculateDistance(
      lastPoint.location.coordinates[1],
      lastPoint.location.coordinates[0],
      validatedLocation.lat,
      validatedLocation.lng
    );

    const speed = timeDiff > 0 ? distance / timeDiff : 0;

    // Create new route point with strict GeoJSON validation
    const routePoint = {
      location: createGeoPoint(validatedLocation.lng, validatedLocation.lat),
      timestamp: now,
      accuracy: validatedLocation.accuracy,
      speed: speed,
      heading: validatedLocation.heading
    };

    // Update session
    const updatedSession = await SalesSession.findOneAndUpdate(
      { sessionId },
      {
        $push: { routePath: routePoint },
        $inc: { totalDistance: distance }
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Route updated",
      distanceAdded: Math.round(distance),
      totalDistance: Math.round(updatedSession.totalDistance),
      speed: Math.round(speed * 3.6)
    });

  } catch (error) {
    console.error('UpdateRoute error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== COMPLETE SALES FORM ==========
export const completeSalesForm = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const {
      customer,
      sales,
      nextMeeting,
      evideinceVisite,
      SalesStatus,
    } = req.body;

    // Parse JSON strings if needed
    const parsedCustomer = typeof customer === 'string' ? JSON.parse(customer) : customer;
    const parsedSales = typeof sales === 'string' ? JSON.parse(sales) : sales;
    const parsedNextMeeting = typeof nextMeeting === 'string' ? JSON.parse(nextMeeting) : nextMeeting;
    const parsedEvidence = typeof evideinceVisite === 'string' ? JSON.parse(evideinceVisite) : evideinceVisite;

    // Find session
    const salesSession = await SalesSession.findOne({ sessionId });
    if (!salesSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (salesSession.status !== "in_progress") {
      return res.status(400).json({ error: "Session is not in progress" });
    }

    // Upload shop photo if provided
    let shopPhoto = null;
    if (req.files && req.files.shopPhoto) {
      shopPhoto = await uploadImage(req.files.shopPhoto[0], 'sales/shop-photos');
    }

    // Upload visit photo if provided
    let visitPhoto = null;
    if (req.files && req.files.visitPhoto) {
      visitPhoto = await uploadImage(req.files.visitPhoto[0], 'sales/visit-photos');
    }

    // Prepare customer location with strict validation
    let customerLocation = salesSession.customer?.location;
    if (parsedCustomer?.location && parsedCustomer.location.lat && parsedCustomer.location.lng) {
      try {
        customerLocation = createGeoPoint(
          parsedCustomer.location.lng,
          parsedCustomer.location.lat
        );
      } catch (error) {
        console.error('Error creating customer location:', error);
        customerLocation = undefined;
      }
    }

    // Prepare update data with sanitized values
    const updateData = {
      customer: {
        companyName: parsedCustomer?.companyName || salesSession.customer?.companyName || "",
        contactName: parsedCustomer?.contactName || salesSession.customer?.contactName || "",
        phoneNumber: parsedCustomer?.phoneNumber || salesSession.customer?.phoneNumber || "",
        address: parsedCustomer?.address || salesSession.customer?.address || "",
        landmark: parsedCustomer?.landmark || salesSession.customer?.landmark || "",
        ...(customerLocation && { location: customerLocation }),
        ...(shopPhoto && { shopPhoto })
      },
      sales: {
        dealStatus: parsedSales?.dealStatus || "Negotiation",
        paymentCollected: parsedSales?.paymentCollected === true,
        amount: Number(parsedSales?.amount) || 0,
        ...(parsedSales?.paymentMode && { paymentMode: parsedSales.paymentMode }),
        ...(parsedSales?.paymentDate && { paymentDate: new Date(parsedSales.paymentDate) })
      },
      formCompleted: true,
      SalesStatus: SalesStatus || "open",
      nextMeeting: {
        decided: parsedNextMeeting?.decided === true,
        ...(parsedNextMeeting?.date && { date: new Date(parsedNextMeeting.date) }),
        ...(parsedNextMeeting?.time && { time: parsedNextMeeting.time }),
        ...(parsedNextMeeting?.notes && { notes: parsedNextMeeting.notes })
      },
      evideinceVisite: {
        ...(parsedEvidence?.visitNotes && { visitNotes: parsedEvidence.visitNotes }),
        ...(visitPhoto && { visitPhoto })
      },
      updatedBy: req.userId
    };

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) delete updateData[key];
    });

    // Update session
    const updatedSession = await SalesSession.findOneAndUpdate(
      { sessionId },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Sales form completed successfully",
      session: updatedSession
    });

  } catch (error) {
    console.error('CompleteForm error:', error);
    res.status(500).json({ error: error.message });
  }
};


// ================= GEO BUILDER =================
const buildGeoPoint = (location) => {
  if (!location) return null;

  let lat = location.lat ?? location.latitude;
  let lng = location.lng ?? location.longitude;

  lat = Number(lat);
  lng = Number(lng);

  // Strict validation
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    isNaN(lat) ||
    isNaN(lng)
  ) {
    return null;
  }

  // Range validation (important)
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return {
    type: "Point",
    coordinates: [lng, lat] // MongoDB format
  };
};

// ================= CONTROLLER =================
// export const punchOut = async (req, res) => {
//   const dbSession = await mongoose.startSession();
//   dbSession.startTransaction();

//   try {
//     const { sessionId, location } = req.body;

//     // ===== VALIDATION =====
//     if (!sessionId) {
//       return res.status(400).json({ error: "sessionId is required" });
//     }

//     let parsedLocation = location;

//     if (typeof location === "string") {
//       try {
//         parsedLocation = JSON.parse(location);
//       } catch {
//         return res.status(400).json({ error: "Invalid location JSON" });
//       }
//     }

//     if (!parsedLocation) {
//       return res.status(400).json({ error: "location is required" });
//     }

//     // ===== BUILD SAFE GEO =====
//     const punchOutGeo = buildGeoPoint(parsedLocation);

//     if (!punchOutGeo) {
//       return res.status(400).json({
//         error: "Invalid geo coordinates",
//         received: parsedLocation
//       });
//     }

//     const [lng, lat] = punchOutGeo.coordinates;

//     // ===== FETCH SESSION =====
//     const salesSession = await SalesSession.findOne({
//       sessionId,
//       status: "in_progress"
//     }).session(dbSession);

//     if (!salesSession) {
//       return res.status(404).json({
//         error: "Session not found or already completed"
//       });
//     }

//     if (!salesSession.formCompleted) {
//       return res.status(400).json({
//         error: "Please complete the sales form before punching out"
//       });
//     }

//     // ===== FILE UPLOAD =====
//     let punchOutPhoto = null;
//     if (req.file) {
//       try {
//         punchOutPhoto = await uploadImage(req.file, "sales/punch-out");
//       } catch (err) {
//         console.error("Upload failed:", err);
//       }
//     }

//     // ===== DISTANCE CALC =====
//     let finalDistance = 0;

//     if (salesSession.routePath?.length > 0) {
//       const lastPoint = salesSession.routePath.at(-1);

//       const coords = lastPoint?.location?.coordinates;

//       if (Array.isArray(coords) && coords.length === 2) {
//         const [prevLng, prevLat] = coords;

//         if (!isNaN(prevLat) && !isNaN(prevLng)) {
//           finalDistance = calculateDistance(
//             prevLat,
//             prevLng,
//             lat,
//             lng
//           );
//         }
//       }
//     }

//     // ===== TIME CALC =====
//     const punchOutTime = new Date();

//     const durationSeconds = Math.max(
//       0,
//       Math.floor(
//         (punchOutTime - new Date(salesSession.punchInTime)) / 1000
//       )
//     );

//     // ===== ROUTE POINT =====
//     const finalRoutePoint = {
//       location: punchOutGeo, // reuse validated object
//       timestamp: punchOutTime,
//       accuracy: Number(parsedLocation.accuracy) || 0,
//       speed: 0,
//       heading: Number(parsedLocation.heading) || 0
//     };

//     // ===== UPDATE OBJECT =====
//     const updateObject = {
//       status: "completed",
//       punchOutTime,
//       punchOutLocation: punchOutGeo,
//       punchOutAddress: parsedLocation.address || "",
//       duration: durationSeconds
//     };

//     if (punchOutPhoto) {
//       updateObject.punchOutPhoto = punchOutPhoto;
//     }

//     // ===== SAFE UPDATE =====
//     const updatedSession = await SalesSession.findOneAndUpdate(
//       { sessionId, status: "in_progress" },
//       {
//         $set: updateObject,
//         $push: { routePath: finalRoutePoint },
//         $inc: { totalDistance: finalDistance }
//       },
//       {
//         new: true,
//         session: dbSession,
//         runValidators: true,
//         context: "query"
//       }
//     );

//     if (!updatedSession) {
//       await dbSession.abortTransaction();
//       return res.status(400).json({
//         error: "Failed to update session"
//       });
//     }

//     await dbSession.commitTransaction();

//     // ===== RESPONSE =====
//     const minutes = Math.round(durationSeconds / 60);
//     const meters = Math.round(updatedSession.totalDistance || 0);

//     return res.status(200).json({
//       success: true,
//       message: "Punch-out successful",
//       sessionId,
//       summary: {
//         duration: {
//           seconds: durationSeconds,
//           minutes: minutes,
//           formatted:
//             minutes >= 60
//               ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
//               : `${minutes}m`
//         },
//         distance: {
//           meters,
//           km: (meters / 1000).toFixed(2)
//         },
//         routePoints: updatedSession.routePath?.length || 0
//       }
//     });

//   } catch (error) {
//     await dbSession.abortTransaction();

//     console.error("PunchOut error:", error);

//     return res.status(500).json({
//       error: error.message
//     });

//   } finally {
//     dbSession.endSession();
//   }
// };





export const punchOut = async (req, res) => {
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const { sessionId, location } = req.body;

    /* ============================
       1. BASIC VALIDATION
    ============================ */
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    let parsedLocation = location;
    if (typeof location === "string") {
      try {
        parsedLocation = JSON.parse(location);
      } catch {
        return res.status(400).json({ error: "Invalid location JSON" });
      }
    }

    if (!parsedLocation) {
      return res.status(400).json({ error: "location is required" });
    }

    const punchOutGeo = buildGeoPoint(parsedLocation);
    if (!punchOutGeo) {
      return res.status(400).json({ error: "Invalid geo coordinates" });
    }

    const [lng, lat] = punchOutGeo.coordinates;

    /* ============================
       2. FETCH ACTIVE SESSION
    ============================ */
    const salesSession = await SalesSession.findOne({
      sessionId,
      status: "in_progress"
    }).session(dbSession);

    if (!salesSession) {
      return res.status(404).json({
        error: "Session not found or already completed"
      });
    }

    if (!salesSession.punchInTime) {
      return res.status(400).json({
        error: "Punch-in required before punch-out"
      });
    }

    if (!salesSession.formCompleted) {
      return res.status(400).json({
        error: "Complete form before punch-out"
      });
    }

    /* ============================
       3. ANTI-SPAM PROTECTION
    ============================ */
    if (salesSession.punchOutTime) {
      const gap = (Date.now() - new Date(salesSession.punchOutTime)) / 1000;
      if (gap < 20) {
        return res.status(429).json({
          error: "Punch too frequent",
          retryAfterSeconds: 20
        });
      }
    }

    /* ============================
       4. DISTANCE CALCULATION
    ============================ */
    let finalDistance = 0;

    const lastPoint = salesSession.routePath?.at(-1);
    if (lastPoint?.location?.coordinates) {
      const [prevLng, prevLat] = lastPoint.location.coordinates;
      finalDistance = calculateDistance(prevLat, prevLng, lat, lng);
    }

    /* ============================
       5. TIME CALCULATION
    ============================ */
    const punchOutTime = new Date();

    const durationSeconds = Math.max(
      0,
      Math.floor(
        (punchOutTime - new Date(salesSession.punchInTime)) / 1000
      )
    );

    /* ============================
       6. ROUTE POINT
    ============================ */
    const routePoint = {
      location: punchOutGeo,
      timestamp: punchOutTime,
      accuracy: parsedLocation.accuracy || 0,
      speed: 0,
      heading: parsedLocation.heading || 0
    };

    /* ============================
       7. UPDATE SESSION (ATOMIC)
    ============================ */
    const updatedSession = await SalesSession.findOneAndUpdate(
      { sessionId, status: "in_progress" },
      {
        $set: {
          status: "completed",
          punchOutTime,
          punchOutLocation: punchOutGeo,
          punchOutAddress: parsedLocation.address || "",
          duration: durationSeconds,
          lastPunchAt: punchOutTime
        },
        $push: { routePath: routePoint },
        $inc: { totalDistance: finalDistance }
      },
      {
        new: true,
        session: dbSession
      }
    );

    if (!updatedSession) {
      await dbSession.abortTransaction();
      return res.status(400).json({ error: "Session update failed" });
    }

    /* =====================================================
       8. ATTENDANCE SYNC (FINAL STATE OVERWRITE)
    ====================================================== */
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const attendance = await Attendance.findOne({
        companyId: updatedSession.companyId,
        employeeId: updatedSession.employeeId,
        date: today
      }).session(dbSession);

      if (attendance && attendance.punchIn) {
        const now = punchOutTime;

        // overwrite final state
        attendance.punchOut = now;
        attendance.lastPunchAt = now;

        // recalculate work
        const totalMinutes = Math.max(
          0,
          Math.floor((now - new Date(attendance.punchIn)) / 60000)
        );

        attendance.workSummary.totalMinutes = totalMinutes;
        attendance.workSummary.payableMinutes = totalMinutes;
        attendance.totalWorkingHours = totalMinutes / 60;

        // audit log
        attendance.punchHistory.push({
          type: "out",
          time: now,
          geoLocation: punchOutGeo,
          deviceInfo: { source: "session-sync" },
          source: "mobile"
        });

        await attendance.save({ session: dbSession });
      }

    } catch (err) {
      console.error("Attendance sync failed:", err);
      // do not break main flow
    }

    /* ============================
       9. COMMIT
    ============================ */
    await dbSession.commitTransaction();

    /* ============================
       10. RESPONSE
    ============================ */
    const minutes = Math.round(durationSeconds / 60);
    const meters = Math.round(updatedSession.totalDistance || 0);

    return res.status(200).json({
      success: true,
      message: "Punch-out successful",
      sessionId,
      summary: {
        duration: {
          seconds: durationSeconds,
          minutes,
          formatted:
            minutes >= 60
              ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
              : `${minutes}m`
        },
        distance: {
          meters,
          km: (meters / 1000).toFixed(2)
        },
        routePoints: updatedSession.routePath?.length || 0
      }
    });

  } catch (error) {
    await dbSession.abortTransaction();
    console.error("PunchOut error:", error);

    return res.status(500).json({
      error: error.message
    });

  } finally {
    dbSession.endSession();
  }
};

// ========== GET SESSION DETAILS ==========
export const getSessionDetails = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await SalesSession.findOne({ sessionId })
      .populate("salesPersonId", "name email phone")
      .populate("companyId", "name address");

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.status(200).json({
      success: true,
      session,
      stats: {
        duration: session.duration,
        distance: session.totalDistance,
        routePoints: session.routePath.length
      }
    });

  } catch (error) {
    console.error('GetSession error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== GET ALL SESSIONS ==========
export const getSessions = async (req, res) => {
  try {
    const {
      salesPersonId,
      companyId,
      status,
      startDate,
      endDate,
      page = 1,
      limit = 10
    } = req.query;

    const query = {};

    if (salesPersonId) query.salesPersonId = salesPersonId;
    if (companyId) query.companyId = companyId;
    if (status) query.status = status;

    if (startDate || endDate) {
      query.punchInTime = {};
      if (startDate) query.punchInTime.$gte = new Date(startDate);
      if (endDate) query.punchInTime.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const sessions = await SalesSession.find(query)
      .populate("salesPersonId", "name email")
      .populate("companyId", "name")
      .sort({ punchInTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await SalesSession.countDocuments(query);

    res.status(200).json({
      success: true,
      data: sessions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('GetSessions error:', error);
    res.status(500).json({ error: error.message });
  }
};


// ========== GET ACTIVE SESSIONS ==========
// controllers/leadController.js



export const getCompanyLeads = async (req, res) => {
  try {
    const {
      companyId,
      salesPersonId,
      status,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 10
    } = req.query;

    // ===== VALIDATION =====
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "companyId is required"
      });
    }

    // ===== QUERY BUILDING =====
    const query = {
      companyId: new mongoose.Types.ObjectId(companyId)
    };

    if (salesPersonId) {
      query.salesPersonId = new mongoose.Types.ObjectId(salesPersonId);
    }

    if (status) {
      query.status = status;
    }

    // Date filter (createdAt based)
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Search (name / phone)
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    // ===== PARALLEL EXECUTION (Netflix-level optimization) =====
    const [leads, total] = await Promise.all([
      Lead.find(query)
        .populate("salesPersonId", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(), // 🚀 performance boost

      Lead.countDocuments(query)
    ]);

    // ===== RESPONSE =====
    return res.status(200).json({
      success: true,
      data: leads,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error("getCompanyLeads error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  }
};

// ========== GET TODAY'S SESSIONS ==========
export const getTodaySessions = async (req, res) => {
  try {
    const { salesPersonId } = req.query;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const query = {
      punchInTime: { $gte: startOfDay, $lte: endOfDay }
    };

    if (salesPersonId) query.salesPersonId = salesPersonId;

    const sessions = await SalesSession.find(query)
      .populate("salesPersonId", "name email")
      .sort({ punchInTime: -1 });

    res.status(200).json({
      success: true,
      date: startOfDay,
      stats: {
        totalVisits: sessions.length,
        completedVisits: sessions.filter(s => s.status === "completed").length,
        inProgressVisits: sessions.filter(s => s.status === "in_progress").length
      },
      data: sessions
    });

  } catch (error) {
    console.error('GetTodaySessions error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== GET SESSION ROUTE MAP ==========
export const getSessionRoute = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await SalesSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.status(200).json({
      success: true,
      route: {
        sessionId: session.sessionId,
        punchIn: session.punchInLocation,
        punchOut: session.punchOutLocation,
        routePath: session.routePath,
        stats: {
          totalDistance: session.totalDistance,
          duration: session.duration,
          numberOfPoints: session.routePath.length
        }
      }
    });

  } catch (error) {
    console.error('GetSessionRoute error:', error);
    res.status(500).json({ error: error.message });
  }
};


//--========= get Active  ==========

export const getActiveSessionAgg = async (req, res) => {
  try {
    const { salesPersonId } = req.query;

    const pipeline = [
      {
        $match: {
          salesPersonId: new mongoose.Types.ObjectId(salesPersonId),
          $or: [
            { punchOutTime: null },
            { status: "in_progress" }
          ]
        }
      },
      { $sort: { punchInTime: -1 } },
      { $limit: 1 },

      // optional join
      {
        $lookup: {
          from: "users",
          localField: "salesPersonId",
          foreignField: "_id",
          as: "salesPerson"
        }
      },
      { $unwind: { path: "$salesPerson", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          sessionId: 1,
          punchInTime: 1,
          location: 1,
          status: 1,
          "salesPerson.name": 1,
          "salesPerson.email": 1
        }
      }
    ];

    const result = await SalesSession.aggregate(pipeline);

    res.status(200).json({
      success: true,
      data: result[0] || null
    });

  } catch (error) {
    console.error("getActiveSessionAgg error:", error);
    res.status(500).json({ error: error.message });
  }
};



export const assignToOther = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { sessionId } = req.params;
    const { targetUserId } = req.body;
    const assignerId = req.user.id;

    // ========== VALIDATION ==========
    if (!sessionId || !targetUserId) {
      return res.status(400).json({
        success: false,
        message: "sessionId and targetUserId are required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid targetUserId"
      });
    }

    // ========== FIND SESSION ==========
    const existingSession = await SalesSession.findOne({ sessionId }).session(session);

    if (!existingSession) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Session not found"
      });
    }

    // ========== PREVENT DUPLICATE ASSIGN ==========
    const alreadyAssigned = existingSession.assingnedTo.some(
      (id) => id.toString() === targetUserId
    );

    if (alreadyAssigned) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "User already assigned to this session"
      });
    }

    // ========== UPDATE ==========
    const updatedSession = await SalesSession.findOneAndUpdate(
      { sessionId },
      {
        $push: { assingnedTo: targetUserId }, // append to array
        $set: {
          assingnedBy: assignerId,
          assingnAt: new Date(),
          updatedBy: assignerId
        }
      },
      {
        new: true,
        session,
        runValidators: true
      }
    ).populate("assingnedTo", "name email");

    // ========== COMMIT ==========
    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Session assigned successfully",
      data: updatedSession
    });

  } catch (error) {
    await session.abortTransaction();

    console.error("assignToOther error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

export const getMyAssignedSessions = async (req, res) => {
  try {
    const userId = req.user._id; // from auth middleware

    // ===== QUERY PARAMS (ENTERPRISE LEVEL) =====
    const {
      page = 1,
      limit = 10,
      status,
      fromDate,
      toDate
    } = req.query;

    const skip = (page - 1) * limit;

    // ===== BUILD FILTER =====
    const filter = {
      assingnedTo: { $in: [userId] }
    };

    if (status) {
      filter.status = status;
    }

    if (fromDate || toDate) {
      filter.punchInTime = {};
      if (fromDate) filter.punchInTime.$gte = new Date(fromDate);
      if (toDate) filter.punchInTime.$lte = new Date(toDate);
    }

    // ===== MAIN QUERY =====
    const [sessions, total] = await Promise.all([
      SalesSession.find(filter)
        .sort({ punchInTime: -1 }) // recent first
        .skip(skip)
        .limit(Number(limit))
        .populate("salesPersonId", "name email")
        .populate("companyId", "name")
        .lean(), // performance optimization

      SalesSession.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      data: sessions,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error("GET_ASSIGNED_SESSIONS_ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch assigned sessions",
      error: error.message
    });
  }
};

export const getTodaySessionsAll = async (req, res) => {
  try {
    const {
      companyId,
      salesPersonId,
      status,          // optional filter
      page = 1,
      limit = 10
    } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "companyId is required"
      });
    }

    const parsedCompanyId = new mongoose.Types.ObjectId(companyId);

    // ===== TODAY RANGE =====
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // ===== QUERY =====
    const query = {
      companyId: parsedCompanyId,
      punchInTime: { $gte: startOfDay, $lte: endOfDay }
    };

    if (salesPersonId) {
      query.salesPersonId = new mongoose.Types.ObjectId(salesPersonId);
    }

    if (status) {
      query.status = status; // "in_progress" | "completed"
    }

    const skip = (Number(page) - 1) * Number(limit);

    // ===== PARALLEL EXECUTION =====
    const [sessions, total] = await Promise.all([
      SalesSession.find(query)
        .populate("salesPersonId", "name email")
        .populate("companyId", "name")
        .sort({ punchInTime: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),

      SalesSession.countDocuments(query)
    ]);

    // ===== OPTIONAL STATS =====
    const stats = await SalesSession.aggregate([
      {
        $match: {
          companyId: parsedCompanyId,
          punchInTime: { $gte: startOfDay, $lte: endOfDay }
        }
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    const formattedStats = {
      total: 0,
      inProgress: 0,
      completed: 0
    };

    stats.forEach(s => {
      formattedStats.total += s.count;
      if (s._id === "in_progress") formattedStats.inProgress = s.count;
      if (s._id === "completed") formattedStats.completed = s.count;
    });

    // ===== RESPONSE =====
    return res.status(200).json({
      success: true,
      date: startOfDay,
      stats: formattedStats, // optional
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit)
      },
      data: sessions
    });

  } catch (error) {
    console.error("getTodaySessions error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  }
};




export const getNearbyFilteredSessions = async (req, res) => {
  try {
    const { sessionId } = req.params;
    let { page = 1, limit = 10, radius = 500 } = req.query;

    const userId = req.user.id;
    const companyId = req.user.companyId;

    page = Number(page);
    limit = Number(limit);
    radius = Math.min(Number(radius), 2000);

    const skip = (page - 1) * limit;

    // ========== GET CURRENT SESSION ==========
    const currentSession = await SalesSession.findOne({ sessionId }).lean();

    if (!currentSession?.punchInLocation?.coordinates) {
      return res.status(404).json({
        success: false,
        message: "Session or location not found"
      });
    }

    const coordinates = currentSession.punchInLocation.coordinates;

    // ========== GEO QUERY ==========
    const results = await SalesSession.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates
          },
          distanceField: "distance",
          maxDistance: radius,
          spherical: true,
          query: {
            sessionId: { $ne: sessionId },
            SalesStatus: "open",

            // assigned OR created by me
            $or: [
              { assingnedTo: new mongoose.Types.ObjectId(userId) },
              { createdBy: new mongoose.Types.ObjectId(userId) }
            ],

            // company filter (direct)
            companyId: new mongoose.Types.ObjectId(companyId)
          }
        }
      },

      { $sort: { distance: 1 } },

      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                sessionId: 1,
                salesPersonId: 1,
                distance: 1,
                punchInTime: 1,
                SalesStatus: 1
              }
            }
          ],
          totalCount: [{ $count: "count" }]
        }
      }
    ]);

    const sessions = results[0].data;
    const total = results[0].totalCount[0]?.count || 0;

    return res.status(200).json({
      success: true,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      data: sessions
    });

  } catch (error) {
    console.error("getNearbyFilteredSessions error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  }
};