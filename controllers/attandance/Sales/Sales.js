import { SalesSession } from "../../../models/Attandance/Salses/Salses.js";
import { uploadToCloudinary } from "../../../utils/Cloudinary.js";
import mongoose from "mongoose";
import { fileTypeFromBuffer } from "file-type";
import Attendance from "../../../models/Attandance/Attendance.js";
import Shift from "../../../models/Attandance/Shift.js";
import Holiday from "../../../models/Attandance/Holiday.js";
import Employee from "../../../models/Attandance/Employee.js";




/**
 * Calculate distance between two geographic points using Haversine formula
 * 
 * @param {number} lat1 - First latitude
 * @param {number} lng1 - First longitude
 * @param {number} lat2 - Second latitude
 * @param {number} lng2 - Second longitude
 * @returns {number} Distance in meters
 */
export const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

/**
 * Get current IST (Indian Standard Time)
 * IST is UTC+5:30
 * 
 * @param {Date} [date] - Date to convert (defaults to now)
 * @returns {Date} Date object in IST timezone
 */
export const getIST = (date = new Date()) => {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const istTime = new Date(utc + (5.5 * 60 * 60 * 1000));
  return istTime;
};

/**
 * Get punch time in IST format
 * 
 * @param {Date} [now] - Date to convert
 * @returns {Date} Punch time in IST
 */
export const getPunchTimeIST = (now = new Date()) => {
  return getIST(now);
};

/**
 * Create a DateTime object for IST
 * Combines a date with a time string (HH:MM format)
 * 
 * @param {Date} dateObj - Base date
 * @param {string} timeStr - Time string in HH:MM format
 * @returns {Date} Combined DateTime in IST
 * 
 * @example
 * createDateTimeIST(new Date(), "09:00") // 9 AM IST
 */
export const createDateTimeIST = (dateObj, timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') {
    throw new Error("timeStr must be in HH:MM format");
  }

  const [hours, minutes] = timeStr.split(':').map(Number);

  if (isNaN(hours) || isNaN(minutes)) {
    throw new Error("Invalid time format. Use HH:MM");
  }

  const date = new Date(dateObj);
  date.setHours(hours, minutes, 0, 0);

  // Convert to IST
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + (5.5 * 60 * 60 * 1000));
};

/**
 * Calculate difference in minutes between two dates
 * 
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {number} Difference in minutes (positive = date2 is after date1)
 */
export const diffMinutes = (date1, date2) => {
  const diffMs = date2 - date1;
  return Math.floor(diffMs / 1000 / 60);
};

/**
 * Format duration in milliseconds to readable string
 * 
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "2h 30m")
 * 
 * @example
 * formatDuration(9000000) // "2h 30m"
 */
export const formatDuration = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
};

/**
 * Check if two coordinates are within a certain distance
 * Useful for geofencing
 * 
 * @param {Object} point1 - First point {lat, lng}
 * @param {Object} point2 - Second point {lat, lng}
 * @param {number} maxDistance - Maximum distance in meters
 * @returns {boolean} True if points are within max distance
 * 
 * @example
 * isWithinDistance({lat: 28.6, lng: 77.2}, {lat: 28.61, lng: 77.21}, 1000)
 */
export const isWithinDistance = (point1, point2, maxDistance = 100) => {
  const distance = calculateDistance(
    point1.lat,
    point1.lng,
    point2.lat,
    point2.lng
  );

  return distance <= maxDistance;
};

export const validateShiftTiming = (shiftStart, shiftEnd, punchTime, options = {}) => {
  const { earlyLimit = 60, lateLimit = 120 } = options;

  const minutesBefore = diffMinutes(punchTime, shiftStart);
  const minutesAfter = diffMinutes(shiftStart, punchTime);

  // Too early
  if (minutesBefore > earlyLimit) {
    return {
      valid: false,
      error: "Too early to punch-in",
      minutesBefore,
      allowedMinutes: earlyLimit
    };
  }

  // Too late
  if (minutesAfter > lateLimit) {
    return {
      valid: false,
      error: "Punch-in too late",
      minutesAfter,
      allowedMinutes: lateLimit
    };
  }

  return {
    valid: true,
    minutesBefore: Math.abs(minutesBefore),
    minutesAfter
  };
};

/**
 * Generate a unique session ID
 * Format: {salesPersonId}-{timestamp}-{random}
 * 
 * @param {string} salesPersonId - ID of sales person
 * @returns {string} Unique session ID
 * 
 * @example
 * generateSessionId("507f1f77bcf86cd799439011")
 * // "507f1f77bcf86cd799439011-1713975600000-abc12345"
 */
export const generateSessionId = (salesPersonId) => {
  return `${salesPersonId}-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
};

/**
 * Normalize date to start of day (00:00:00)
 * 
 * @param {Date} [date] - Date to normalize (defaults to today)
 * @returns {Date} Date at 00:00:00
 */
export const normalizeToDateStart = (date = new Date()) => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

/**
 * Normalize date to end of day (23:59:59)
 * 
 * @param {Date} [date] - Date to normalize (defaults to today)
 * @returns {Date} Date at 23:59:59
 */
export const normalizeToDateEnd = (date = new Date()) => {
  const normalized = new Date(date);
  normalized.setHours(23, 59, 59, 999);
  return normalized;
};

/**
 * Extract hours and minutes from time string
 * 
 * @param {string} timeStr - Time string in HH:MM format
 * @returns {Object} {hours, minutes}
 * @throws {Error} If time format is invalid
 * 
 * @example
 * parseTimeString("09:30") // {hours: 9, minutes: 30}
 */
export const parseTimeString = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') {
    throw new Error("timeStr must be a string");
  }

  const [hours, minutes] = timeStr.split(':').map(Number);

  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error("Invalid time format. Use HH:MM (00:00 - 23:59)");
  }

  return { hours, minutes };
};

/**
 * Format time to HH:MM string
 * 
 * @param {number} hours - Hours (0-23)
 * @param {number} minutes - Minutes (0-59)
 * @returns {string} Formatted time string (HH:MM)
 * 
 * @example
 * formatTimeString(9, 30) // "09:30"
 */
export const formatTimeString = (hours, minutes) => {
  const h = String(hours).padStart(2, '0');
  const m = String(minutes).padStart(2, '0');
  return `${h}:${m}`;
};

export const getBusinessHours = (startDate, endDate, options = {}) => {
  const { workStartHour = 9, workEndHour = 17 } = options;
  const hoursPerDay = workEndHour - workStartHour;

  let businessHours = 0;
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();

    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessHours += hoursPerDay;
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return businessHours;

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

  // 🔥 CASE 1: already object
  if (typeof location === "object") {
    return normalizeLocation(location);
  }

  // 🔥 CASE 2: string → try JSON.parse
  if (typeof location === "string") {
    try {
      const parsed = JSON.parse(location);
      return normalizeLocation(parsed);
    } catch (e) {
      // 🔥 CASE 3: malformed string like "{lat: 25, lng: 85}"
      try {
        const fixed = location
          .replace(/([a-zA-Z0-9_]+):/g, '"$1":') // fix keys
          .replace(/'/g, '"');

        const parsed = JSON.parse(fixed);
        return normalizeLocation(parsed);
      } catch (err) {
        throw new Error(`Invalid location format: ${location}`);
      }
    }
  }

  throw new Error(`Unsupported location type: ${typeof location}`);
};


// 🔧 Separate clean normalizer
const normalizeLocation = (location) => {
  let lat, lng;

  if (location.lat !== undefined || location.latitude !== undefined) {
    lat = location.lat ?? location.latitude;
    lng = location.lng ?? location.longitude;
  } else if (Array.isArray(location.coordinates)) {
    lng = location.coordinates[0];
    lat = location.coordinates[1];
  } else {
    throw new Error(`Invalid location structure: ${JSON.stringify(location)}`);
  }

  lat = Number(lat);
  lng = Number(lng);

  if (isNaN(lat) || isNaN(lng)) {
    throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng}`);
  }

  if (lng < -180 || lng > 180) {
    throw new Error(`Longitude out of range: ${lng}`);
  }

  if (lat < -90 || lat > 90) {
    throw new Error(`Latitude out of range: ${lat}`);
  }

  return {
    type: "Point",
    coordinates: [lng, lat],
    lat,
    lng,
    address: location.address || ""
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

export const punchIn = async (req, res) => {
  try {
    const { id, companyId } = req.user;
    const { location, deviceInfo, sessionId } = req.body;
    const employeeId = id;

    const validatedLocation = validateLocation(location);
    const now = new Date();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    /* ============================
       EMPLOYEE + SHIFT
    ============================ */
    const employee = await Employee.findOne({
      userId: employeeId,
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
      return res.status(400).json({ error: "Invalid shift configuration" });
    }

    /* ============================
       HOLIDAY CHECK
    ============================ */
    const holiday = await Holiday.findOne({ companyId, date: today });

    let attendanceStatus = "present";

    if (holiday) {
      if (!shift.allowHolidayWork) {
        return res.status(403).json({
          error: `Holiday (${holiday.name || "Holiday"})`
        });
      }
      attendanceStatus = "holiday_working";
    }

    /* ============================
       UPSERT ATTENDANCE
    ============================ */
    const attendance = await Attendance.findOneAndUpdate(
      { companyId, employeeId, date: today },
      {
        $setOnInsert: {
          companyId,
          employeeId,
          date: today,
          status: attendanceStatus
        }
      },
      { new: true, upsert: true }
    );

    if (attendance.punchIn) {
      return res.status(200).json({
        success: true,
        message: "Already punched in",
        punchIn: attendance.punchIn
      });
    }

    const updated = await Attendance.findOneAndUpdate(
      { _id: attendance._id, punchIn: { $exists: false } },
      {
        $set: {
          punchIn: now,
          lastPunchAt: now,
          deviceInfo,
          geoLocation: {
            type: "Point",
            coordinates: [validatedLocation.lng, validatedLocation.lat],
            verified: false,
            source: "gps"
          }
        },
        $push: {
          punchHistory: {
            type: "in",
            time: now,
            geoLocation: validatedLocation,
            deviceInfo
          }
        }
      },
      { new: true }
    );

    if (!updated) {
      return res.status(200).json({
        success: true,
        message: "Already punched (race safe)"
      });
    }

    /* ============================
       SESSION + VISIT LOG (FIXED)
    ============================ */
    let visitLogResponse = null;

    try {
      let finalSessionId = sessionId?.trim();

      if (!finalSessionId) {
        finalSessionId = generateSessionId(employeeId);
      }

      const geoPoint = createGeoPoint(
        validatedLocation.lng,
        validatedLocation.lat
      );

      const visitLogEntry = {
        userId: employeeId,
        punchInTime: now,
        punchInLocation: geoPoint,
        punchOutTime: null,
        punchOutLocation: null
      };

      let session = await SalesSession.findOne({
        sessionId: finalSessionId,
        companyId,
        status: "in_progress"
      });

      /* ========= CREATE ========= */
      if (!session) {
        session = await SalesSession.create({
          sessionId: finalSessionId,
          companyId,
          employeeId,
          status: "in_progress",
          punchInTime: now,
          punchInLocation: geoPoint,
          lastPunchAt: now,

          // ✅ CRITICAL FIX (routePath required)
          routePath: [
            {
              location: geoPoint,
              timestamp: now
            }
          ],

          visitLogs: [visitLogEntry]
        });
      } else {
        /* ========= UPDATE ========= */
        session.visitLogs.push(visitLogEntry);

        // ✅ CRITICAL FIX
        session.routePath.push({
          location: geoPoint,
          timestamp: now
        });

        session.lastPunchAt = now;

        if (!session.punchInTime) session.punchInTime = now;
        if (!session.punchInLocation)
          session.punchInLocation = geoPoint;

        await session.save();
      }

      visitLogResponse = {
        sessionId: session.sessionId,
        visitLogId:
          session.visitLogs[session.visitLogs.length - 1]._id,
        punchInTime: now,
        punchInLocation: validatedLocation
      };

    } catch (err) {
      console.error("Session Error:", err);
    }

    /* ============================
       RESPONSE
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
        },
        ...(visitLogResponse && {
          sessionVisitLog: visitLogResponse
        })
      }
    });

  } catch (error) {
    console.error("PunchIn Error:", error);
    return res.status(500).json({ error: error.message });
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
      evidence,
      SalesStatus
    } = req.body;

    // ========= PARSE =========
    const parsedCustomer =
      typeof customer === "string" ? JSON.parse(customer) : customer;

    const parsedSales =
      typeof sales === "string" ? JSON.parse(sales) : sales;

    const parsedNextMeeting =
      typeof nextMeeting === "string" ? JSON.parse(nextMeeting) : nextMeeting;

    const parsedEvidence =
      typeof evidence === "string" ? JSON.parse(evidence) : evidence;

    // ========= FIND =========
    let session = await SalesSession.findOne({ sessionId });

    // ========= RULE: BLOCK IF COMPLETED =========
    if (session && session.status === "completed") {
      return res.status(400).json({
        error: "Session already completed. You cannot modify it."
      });
    }

    // ========= CREATE =========
    if (!session) {
      const location = buildGeoPoint(parsedCustomer?.location);

      session = new SalesSession({
        sessionId: sessionId || `SS-${Date.now()}`,

        companyId: req.userId,
        createdBy: req.userId,
        employeeId: req.userId,

        customer: {
          companyName: parsedCustomer?.companyName || "",
          contactName: parsedCustomer?.contactName || "",
          phoneNumber: parsedCustomer?.phoneNumber || "",
          address: parsedCustomer?.address || "",
          landmark: parsedCustomer?.landmark || "",
          ...(location && { location })
        },

        punchInTime: new Date(),
        punchInLocation: location,

        visitLogs: location
          ? [
            {
              userId: req.userId,
              punchInLocation: location
            }
          ]
          : []
      });
    }

    // ========= FILES =========
    let shopPhoto = null;
    let visitPhoto = null;

    if (req.files?.shopPhoto) {
      shopPhoto = await uploadImage(req.files.shopPhoto[0], "sales/shop");
    }

    if (req.files?.visitPhoto) {
      visitPhoto = await uploadImage(req.files.visitPhoto[0], "sales/visit");
    }

    // ========= GEO =========
    const customerLocation = buildGeoPoint(parsedCustomer?.location);

    // ========= UPDATE CUSTOMER =========
    if (parsedCustomer) {
      session.customer = {
        ...session.customer,
        companyName: parsedCustomer.companyName || session.customer.companyName,
        contactName: parsedCustomer.contactName || session.customer.contactName,
        phoneNumber: parsedCustomer.phoneNumber || session.customer.phoneNumber,
        address: parsedCustomer.address || session.customer.address,
        landmark: parsedCustomer.landmark || session.customer.landmark,
        ...(customerLocation && { location: customerLocation }),
        ...(shopPhoto && { shopPhoto })
      };
    }

    // ========= SALES LOG =========
    if (parsedSales) {
      session.salesLogs.push({
        userId: req.userId,
        dealStatus: parsedSales.dealStatus || "Negotiation",
        amount: Number(parsedSales.amount) || 0,
        paymentCollected: parsedSales.paymentCollected === true,
        paymentMode: parsedSales.paymentMode || null,
        note: parsedSales.note || ""
      });
    }

    // ========= MEETING =========
    if (parsedNextMeeting?.decided) {
      const meetingData = {
        userId: req.userId,
        date: parsedNextMeeting.date
          ? new Date(parsedNextMeeting.date)
          : undefined,
        time: parsedNextMeeting.time,
        notes: parsedNextMeeting.notes
      };

      session.nextMeeting = {
        decided: true,
        date: meetingData.date,
        time: meetingData.time,
        notes: meetingData.notes
      };

      session.meetingLogs.push(meetingData);
    }

    // ========= VISIT NOTES / EVIDENCE =========
    if (parsedEvidence?.visitNotes || visitPhoto) {
      session.visitNotes.push({
        userId: req.userId,
        note: parsedEvidence?.visitNotes || "",
        ...(visitPhoto && { photo: visitPhoto })
      });

      session.evidence = {
        visitNotes: parsedEvidence?.visitNotes || "",
        ...(visitPhoto && { visitPhoto })
      };
    }

    // ========= STATUS =========
    if (SalesStatus) {
      session.SalesStatus = SalesStatus;
    }

    session.formCompleted = true;

    // Auto-complete only when user submits data
    // if (session.status === "in_progress") {
    //   session.status = "in_progress";
    // }

    await session.save();

    res.status(200).json({
      success: true,
      message: "Session processed successfully",
      data: session
    });

  } catch (err) {
    console.error("Upsert Session Error:", err);
    res.status(500).json({ error: err.message });
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



/**
 * PRODUCTION PUNCH-OUT CONTROLLER
 * 
 * Handles:
 * 1. Session punch-out with status change to "completed"
 * 2. Attendance record sync
 * 3. Route tracking and distance calculation
 * 4. Transaction safety with rollback
 * 5. Idempotency and anti-spam protection
 * 
 * @param {Object} req - Express request
 * @param {Object} req.user - Auth user {employeeId, companyId}
 * @param {Object} req.body - Request body
 * @param {string} req.body.sessionId - SalesSession ID
 * @param {Object} req.body.location - Geolocation {lat, lng, address, accuracy, heading}
 * @param {Object} [req.body.deviceInfo] - Device info {deviceId, os, appVersion}
 * @param {Object} res - Express response
 */
export const punchOut = async (req, res) => {
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const { id, companyId } = req.user;
    const { sessionId, location, deviceInfo } = req.body;
    const employeeId = id;
    /* ============================
       1. STRICT VALIDATION
    ============================ */
    if (!sessionId || typeof sessionId !== 'string') {
      await dbSession.abortTransaction();
      return res.status(400).json({
        error: "sessionId is required and must be a string"
      });
    }

    // Parse location if string
    let parsedLocation = location;
    if (typeof location === "string") {
      try {
        parsedLocation = JSON.parse(location);
      } catch {
        await dbSession.abortTransaction();
        return res.status(400).json({
          error: "Invalid location JSON format"
        });
      }
    }

    if (!parsedLocation || typeof parsedLocation !== 'object') {
      await dbSession.abortTransaction();
      return res.status(400).json({
        error: "location object is required"
      });
    }

    // Validate location with our utility
    let validatedLocation;
    try {
      validatedLocation = validateLocation(parsedLocation);
    } catch (locErr) {
      await dbSession.abortTransaction();
      return res.status(400).json({
        error: locErr.message
      });
    }

    const punchOutGeo = createGeoPoint(
      validatedLocation.lng,
      validatedLocation.lat
    );

    /* ============================
       2. FETCH ACTIVE SESSION
    ============================ */
    const salesSession = await SalesSession.findOne({
      sessionId,
      companyId,
      status: "in_progress"
    }).session(dbSession);

    if (!salesSession) {
      await dbSession.abortTransaction();
      return res.status(404).json({
        error: "Session not found or already completed",
        sessionId
      });
    }

    /* ============================
       3. VERIFY PUNCH-IN EXISTS
    ============================ */
    if (!salesSession.punchInTime) {
      await dbSession.abortTransaction();
      return res.status(400).json({
        error: "Cannot punch-out without punch-in",
        sessionId
      });
    }

    /* ============================
       4. OPTIONAL: FORM VALIDATION
    ============================ */
    // Uncomment if form completion is required
    // if (!salesSession.formCompleted) {
    //   await dbSession.abortTransaction();
    //   return res.status(400).json({
    //     error: "Complete session form before punch-out",
    //     sessionId
    //   });
    // }

    /* ============================
       5. ANTI-SPAM PROTECTION
    ============================ */
    const now = new Date();

    if (salesSession.punchOutTime) {
      const timeSinceLastPunchOut = (now - new Date(salesSession.punchOutTime)) / 1000;

      if (timeSinceLastPunchOut < 20) {
        await dbSession.abortTransaction();
        return res.status(429).json({
          error: "Punch-out too frequent (rate limited)",
          retryAfterSeconds: Math.ceil(20 - timeSinceLastPunchOut),
          lastPunchOut: salesSession.punchOutTime
        });
      }
    }

    /* ============================
       6. DISTANCE CALCULATION
    ============================ */
    let distanceForThisPoint = 0;
    let totalRouteDistance = salesSession.totalDistance || 0;

    // Calculate from last route point
    if (salesSession.routePath && salesSession.routePath.length > 0) {
      const lastPoint = salesSession.routePath[salesSession.routePath.length - 1];

      if (lastPoint?.location?.coordinates) {
        const [prevLng, prevLat] = lastPoint.location.coordinates;
        const [currLng, currLat] = punchOutGeo.coordinates;

        distanceForThisPoint = calculateDistance(
          prevLat,
          prevLng,
          currLat,
          currLng
        );

        totalRouteDistance += distanceForThisPoint;
      }
    }

    /* ============================
       7. DURATION CALCULATION
    ============================ */
    const punchInTime = new Date(salesSession.punchInTime);
    const durationMs = now - punchInTime;

    if (durationMs < 0) {
      await dbSession.abortTransaction();
      return res.status(400).json({
        error: "Punch-out time cannot be before punch-in",
        punchIn: punchInTime,
        punchOut: now
      });
    }

    const durationSeconds = Math.floor(durationMs / 1000);
    const durationMinutes = Math.floor(durationMs / 60000);
    const durationHours = (durationMinutes / 60).toFixed(2);

    /* ============================
       8. BUILD ROUTE POINT
    ============================ */
    const routePoint = {
      userId: employeeId,
      location: punchOutGeo,
      timestamp: now,
      accuracy: validatedLocation.accuracy || 0,
      speed: validatedLocation.speed || 0,
      heading: validatedLocation.heading || 0
    };

    /* ============================
       9. UPDATE SESSION (ATOMIC)
    ============================ */
    const updatedSession = await SalesSession.findOneAndUpdate(
      {
        _id: salesSession._id,
        status: "in_progress"  // Ensure still in_progress
      },
      {
        $set: {
          status: "completed",
          punchOutTime: now,
          punchOutLocation: punchOutGeo,
          punchOutAddress: validatedLocation.address || "",
          duration: durationSeconds,
          lastPunchAt: now,
          employeeId
        },
        $push: {
          routePath: routePoint
        },
        $inc: {
          totalDistance: distanceForThisPoint
        }
      },
      {
        new: true,
        session: dbSession,
        runValidators: true
      }
    );

    if (!updatedSession) {
      await dbSession.abortTransaction();
      return res.status(400).json({
        error: "Failed to update session (already completed or concurrent punch-out)",
        sessionId
      });
    }

    /* ============================
       10. SYNC ATTENDANCE (BEST EFFORT)
    ============================ */
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const attendance = await Attendance.findOne({
        companyId,
        userId:employeeId,
        date: today
      }).session(dbSession);

      if (attendance && attendance.punchIn) {
        // Calculate final work duration
        const punchOutFromAttendance = now;
        const totalWorkMs = punchOutFromAttendance - new Date(attendance.punchIn);
        const totalWorkMinutes = Math.max(0, Math.floor(totalWorkMs / 60000));
        const totalWorkHours = (totalWorkMinutes / 60).toFixed(2);

        // Update attendance record
        const updatedAttendance = await Attendance.findOneAndUpdate(
          {
            _id: attendance._id,
            date: today
          },
          {
            $set: {
              punchOut: punchOutFromAttendance,
              lastPunchAt: punchOutFromAttendance,
              totalWorkingHours: parseFloat(totalWorkHours),
              workSummary: {
                totalMinutes: totalWorkMinutes,
                payableMinutes: totalWorkMinutes,
                deductionMinutes: 0
              }
            },
            $push: {
              punchHistory: {
                type: "out",
                time: now,
                geoLocation: punchOutGeo,
                deviceInfo: deviceInfo || { source: "session-punch-out" },
                source: "mobile"
              }
            }
          },
          {
            new: true,
            session: dbSession,
            runValidators: true
          }
        );

        // Verify update succeeded
        if (!updatedAttendance) {
          console.warn(
            "Attendance update warning: record may have been modified concurrently"
          );
        }
      } else if (!attendance) {
        console.warn(
          `No attendance record found for employee ${employeeId} on ${today.toISOString()}`
        );
      }
    } catch (attendanceErr) {
      console.error("Attendance sync error:", attendanceErr);
      // Log but don't fail the punch-out
      // The session is already updated
    }

    /* ============================
       11. VISIT LOG UPDATE (If needed)
    ============================ */
    // Update the last visit log in the session if exists
    try {
      if (updatedSession.visitLogs && updatedSession.visitLogs.length > 0) {
        const lastVisitLogIndex = updatedSession.visitLogs.length - 1;

        const visitLogUpdateResult = await SalesSession.findOneAndUpdate(
          {
            _id: updatedSession._id,
            "visitLogs._id": updatedSession.visitLogs[lastVisitLogIndex]._id
          },
          {
            $set: {
              "visitLogs.$.punchOutTime": now,
              "visitLogs.$.punchOutLocation": punchOutGeo
            }
          },
          {
            new: true,
            session: dbSession
          }
        );

        if (!visitLogUpdateResult) {
          console.warn("Visit log update skipped (may have concurrent punches)");
        }
      }
    } catch (visitErr) {
      console.warn("Visit log update error:", visitErr.message);
      // Non-critical, continue
    }

    /* ============================
       12. COMMIT TRANSACTION
    ============================ */
    await dbSession.commitTransaction();

    /* ============================
       13. BUILD RESPONSE
    ============================ */
    const formattedDuration = formatDurationString(durationSeconds);
    const formattedDistance = (totalRouteDistance / 1000).toFixed(2);

    return res.status(200).json({
      success: true,
      message: "Punch-out successful",
      data: {
        sessionId: updatedSession._id,
        sessionStatus: "completed",

        timing: {
          punchInTime: updatedSession.punchInTime,
          punchOutTime: updatedSession.punchOutTime,
          duration: {
            seconds: durationSeconds,
            minutes: durationMinutes,
            hours: parseFloat(durationHours),
            formatted: formattedDuration
          }
        },

        location: {
          punchOutCoordinates: {
            latitude: validatedLocation.lat,
            longitude: validatedLocation.lng
          },
          punchOutAddress: validatedLocation.address,
          accuracy: validatedLocation.accuracy
        },

        route: {
          totalRoutePoints: updatedSession.routePath?.length || 0,
          totalDistance: {
            meters: Math.round(totalRouteDistance),
            km: formattedDistance
          },
          lastSegmentDistance: {
            meters: Math.round(distanceForThisPoint),
            km: (distanceForThisPoint / 1000).toFixed(3)
          }
        },

        sessionSummary: {
          status: updatedSession.status,
          customerName: updatedSession.customer?.companyName || "N/A",
          totalVisits: updatedSession.visitLogs?.length || 0,
          salesLogsCount: updatedSession.salesLogs?.length || 0,
          meetingLogsCount: updatedSession.meetingLogs?.length || 0
        }
      }
    });

  } catch (error) {
    await dbSession.abortTransaction();
    console.error("PunchOut error:", error);

    return res.status(500).json({
      error: error.message || "Internal server error",
      errorType: error.constructor.name
    });

  } finally {
    await dbSession.endSession();
  }
};

/**
 * VALIDATE AND UPSERT PUNCH-OUT
 * 
 * Alternative endpoint that checks if punch-out already exists
 * Useful for handling network retries
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
export const punchOutSafe = async (req, res) => {
  try {
    const { employeeId, companyId } = req.user;
    const { sessionId, location, deviceInfo } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    // Check if already punched out
    const existingSession = await SalesSession.findOne({
      _id: sessionId,
      companyId,
      punchOutTime: { $exists: true, $ne: null }
    });

    if (existingSession) {
      return res.status(200).json({
        success: true,
        message: "Already punched out (cached response)",
        data: {
          sessionId: existingSession._id,
          punchOutTime: existingSession.punchOutTime,
          duration: existingSession.duration
        }
      });
    }

    // Proceed with normal punch-out
    return punchOut(req, res);

  } catch (error) {
    console.error("PunchOutSafe error:", error);
    return res.status(500).json({ error: error.message });
  }
};

export const getSessionSummary = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { companyId } = req.user;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    // ✅ Use sessionId (NOT _id)
    const session = await SalesSession.findOne({
      sessionId,
      companyId
    }).populate([
      { path: "createdBy", select: "name email" },
      { path: "assignedTo", select: "name email" },
      { path: "employeeId", select: "name email phone" }
    ]);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    /* ================= VISIT STATS ================= */
    let totalVisitDuration = 0;
    let completedVisits = 0;

    for (const log of session.visitLogs || []) {
      if (log.punchInTime && log.punchOutTime) {
        const duration =
          (new Date(log.punchOutTime) - new Date(log.punchInTime)) / 1000;

        if (duration > 0) {
          totalVisitDuration += duration;
          completedVisits++;
        }
      }
    }

    /* ================= SALES STATS ================= */
    const totalSalesAmount = (session.salesLogs || []).reduce(
      (sum, log) => sum + (log.amount || 0),
      0
    );

    const closedDeals = (session.salesLogs || []).filter(
      (log) => log.dealStatus === "Closed Won"
    ).length;

    /* ================= GEO HELPERS ================= */
    const extractGeo = (geo) => {
      if (!geo?.coordinates || geo.coordinates.length !== 2) return null;

      return {
        latitude: geo.coordinates[1],
        longitude: geo.coordinates[0]
      };
    };

    /* ================= RESPONSE ================= */
    const summary = {
      success: true,
      session: {
        id: session.sessionId,
        status: session.status,

        customer: {
          name: session.customer?.companyName || "",
          contact: session.customer?.contactName || "",
          phone: session.customer?.phoneNumber || "",
          address: session.customer?.address || "",
          landmark: session.customer?.landmark || "",
          location: extractGeo(session.customer?.location)
        },

        timeline: {
          createdAt: session.createdAt,
          punchInTime: session.punchInTime,
          punchOutTime: session.punchOutTime,
          duration: session.duration
            ? formatDurationString(session.duration)
            : null
        },

        location: {
          punchIn: extractGeo(session.punchInLocation),
          punchOut: extractGeo(session.punchOutLocation),
          punchOutAddress: session.punchOutAddress || ""
        },

        route: {
          totalDistance: {
            meters: Math.round(session.totalDistance || 0),
            km: ((session.totalDistance || 0) / 1000).toFixed(2)
          },
          routePoints: session.routePath?.length || 0,
          routeCoordinates: (session.routePath || []).map((p) => ({
            latitude: p.location.coordinates[1],
            longitude: p.location.coordinates[0],
            timestamp: p.timestamp,
            accuracy: p.accuracy
          }))
        },

        activities: {
          visits: {
            total: session.visitLogs?.length || 0,
            completed: completedVisits,
            totalDuration: formatDurationString(totalVisitDuration)
          },
          sales: {
            total: session.salesLogs?.length || 0,
            closed: closedDeals,
            totalAmount: totalSalesAmount
          },
          meetings: session.meetingLogs?.length || 0,
          notes: session.visitNotes?.length || 0
        },

        salesStatus: {
          status: session.SalesStatus,
          formCompleted: session.formCompleted,
          nextMeeting: session.nextMeeting?.decided
            ? {
              date: session.nextMeeting.date,
              time: session.nextMeeting.time,
              notes: session.nextMeeting.notes
            }
            : null
        },

        assignees: {
          createdBy: session.createdBy || null,
          assignedTo: session.assignedTo || [],
          employee: session.employeeId || null
        }
      }
    };

    return res.status(200).json(summary);

  } catch (error) {
    console.error("GetSessionSummary error:", error);
    return res.status(500).json({ error: error.message });
  }
};






// ========== GET SESSION DETAILS ==========
export const getSessionDetails = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { companyId } = req.user;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const session = await SalesSession.findOne({
      sessionId,
      companyId
    })
      .populate("employeeId", "name email phone")
      .populate("createdBy", "name email")
      .populate("assignedTo", "name email")
      .populate("companyId", "name address");

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    /* ========= GEO HELPER ========= */
    const extractGeo = (geo) => {
      if (!geo?.coordinates || geo.coordinates.length !== 2) return null;
      return {
        latitude: geo.coordinates[1],
        longitude: geo.coordinates[0]
      };
    };

    /* ========= ROUTE ========= */
    const routeCoordinates = (session.routePath || []).map((p) => ({
      latitude: p.location.coordinates[1],
      longitude: p.location.coordinates[0],
      timestamp: p.timestamp,
      accuracy: p.accuracy,
      speed: p.speed,
      heading: p.heading
    }));

    /* ========= RESPONSE ========= */
    res.status(200).json({
      success: true,

      session: {
        id: session.sessionId,
        status: session.status,

        customer: {
          ...session.customer,
          location: extractGeo(session.customer?.location)
        },

        employee: session.employeeId,
        createdBy: session.createdBy,
        assignedTo: session.assignedTo,
        company: session.companyId,

        punch: {
          inTime: session.punchInTime,
          outTime: session.punchOutTime,
          inLocation: extractGeo(session.punchInLocation),
          outLocation: extractGeo(session.punchOutLocation),
          outAddress: session.punchOutAddress
        },

        logs: {
          visits: session.visitLogs || [],
          sales: session.salesLogs || [],
          meetings: session.meetingLogs || [],
          notes: session.visitNotes || []
        },

        evidence: session.evidence || null,

        nextMeeting: session.nextMeeting || null,

        route: {
          totalDistance: {
            meters: Math.round(session.totalDistance || 0),
            km: ((session.totalDistance || 0) / 1000).toFixed(2)
          },
          totalPoints: routeCoordinates.length,
          coordinates: routeCoordinates
        },

        timestamps: {
          createdAt: session.createdAt,
          updatedAt: session.updatedAt
        }
      },

      stats: {
        duration: session.duration || 0,
        formattedDuration: session.duration
          ? formatDurationString(session.duration)
          : null,
        distance: session.totalDistance || 0,
        routePoints: session.routePath?.length || 0,
        totalVisits: session.visitLogs?.length || 0,
        totalSales: session.salesLogs?.length || 0
      }
    });

  } catch (error) {
    console.error("GetSessionDetails error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ========== GET ALL SESSIONS ==========
export const getSessions = async (req, res) => {
  try {
    const {
      employeeId,
      status,
      SalesStatus,
      startDate,
      endDate,
      page = 1,
      limit = 10
    } = req.query;

    // ✅ enforce company isolation
    const companyId = req.user.companyId;

    /* ========= QUERY BUILD ========= */
    const query = { companyId };

    if (employeeId) query.employeeId = employeeId;
    if (status) query.status = status;
    if (SalesStatus) query.SalesStatus = SalesStatus;

    if (startDate || endDate) {
      query.punchInTime = {};
      if (startDate) query.punchInTime.$gte = new Date(startDate);
      if (endDate) query.punchInTime.$lte = new Date(endDate);
    }

    /* ========= PAGINATION ========= */
    const pageNumber = Math.max(1, parseInt(page));
    const limitNumber = Math.max(1, Math.min(100, parseInt(limit))); // cap at 100
    const skip = (pageNumber - 1) * limitNumber;

    /* ========= FETCH ========= */
    const sessions = await SalesSession.find(query)
      .populate("employeeId", "name email phone")
      .populate("createdBy", "name email")
      .populate("assignedTo", "name email")
      .sort({ punchInTime: -1 })
      .skip(skip)
      .limit(limitNumber)
      .lean(); // faster response

    const total = await SalesSession.countDocuments(query);

    /* ========= GEO HELPER ========= */
    const extractGeo = (geo) => {
      if (!geo?.coordinates || geo.coordinates.length !== 2) return null;
      return {
        latitude: geo.coordinates[1],
        longitude: geo.coordinates[0]
      };
    };

    /* ========= FORMAT RESPONSE ========= */
    const formatted = sessions.map((s) => ({
      id: s.sessionId,
      status: s.status,
      SalesStatus: s.SalesStatus,

      customer: {
        name: s.customer?.companyName || "",
        contact: s.customer?.contactName || "",
        phone: s.customer?.phoneNumber || "",
        location: extractGeo(s.customer?.location)
      },

      employee: s.employeeId,
      createdBy: s.createdBy,

      punch: {
        inTime: s.punchInTime,
        outTime: s.punchOutTime,
        inLocation: extractGeo(s.punchInLocation),
        outLocation: extractGeo(s.punchOutLocation)
      },

      stats: {
        distance: Math.round(s.totalDistance || 0),
        duration: s.duration || 0,
        visits: s.visitLogs?.length || 0,
        sales: s.salesLogs?.length || 0
      },

      timestamps: {
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      }
    }));

    /* ========= RESPONSE ========= */
    res.status(200).json({
      success: true,
      data: formatted,
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        pages: Math.ceil(total / limitNumber)
      }
    });

  } catch (error) {
    console.error("GetSessions error:", error);
    res.status(500).json({ error: error.message });
  }
};
// ========== GET COMPANY LEADS ==========
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
      query.employeeId = new mongoose.Types.ObjectId(salesPersonId);
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

    // Search (customer name / phone)
    if (search) {
      query.$or = [
        { "customer.contactName": { $regex: search, $options: "i" } },
        { "customer.phoneNumber": { $regex: search, $options: "i" } },
        { "customer.companyName": { $regex: search, $options: "i" } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    // ===== PARALLEL EXECUTION =====
    const [leads, total] = await Promise.all([
      SalesSession.find(query)
        .populate("employeeId", "name email")
        .populate("assignedTo", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),

      SalesSession.countDocuments(query)
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

    if (salesPersonId) query.employeeId = salesPersonId;

    const sessions = await SalesSession.find(query)
      .populate("employeeId", "name email")
      .populate("assignedTo", "name email")
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

// ========== GET ACTIVE SESSION ==========
export const getActiveSessionAgg = async (req, res) => {
  try {
    const { salesPersonId } = req.query;

    if (!salesPersonId) {
      return res.status(400).json({
        success: false,
        message: "salesPersonId is required"
      });
    }

    const pipeline = [
      {
        $match: {
          employeeId: new mongoose.Types.ObjectId(salesPersonId),
          $or: [
            { punchOutTime: null },
            { status: "in_progress" }
          ]
        }
      },
      { $sort: { punchInTime: -1 } },
      { $limit: 1 },

      {
        $lookup: {
          from: "users",
          localField: "employeeId",
          foreignField: "_id",
          as: "employee"
        }
      },
      { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "users",
          localField: "assignedTo",
          foreignField: "_id",
          as: "assignedTo"
        }
      },

      {
        $project: {
          sessionId: 1,
          punchInTime: 1,
          punchInLocation: 1,
          status: 1,
          "employee.name": 1,
          "employee.email": 1,
          assignedTo: 1,
          customer: 1,
          SalesStatus: 1
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

// ========== ASSIGN TO OTHER USER ==========
export const assignToOther = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { sessionId } = req.params;
    const { targetUserId } = req.body;
    const assignerId = req.user?.id || req.user?._id;

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
    const alreadyAssigned = existingSession.assignedTo.some(
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
        $push: { assignedTo: new mongoose.Types.ObjectId(targetUserId) },
        $set: {
          updatedBy: assignerId,
          updatedAt: new Date()
        }
      },
      {
        new: true,
        session,
        runValidators: true
      }
    ).populate("assignedTo", "name email");

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

// ========== GET MY ASSIGNED SESSIONS ==========
export const getMyAssignedSessions = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated"
      });
    }

    const {
      page = 1,
      limit = 10,
      status,
      fromDate,
      toDate
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    // ===== BUILD FILTER =====
    const filter = {
      assignedTo: { $in: [new mongoose.Types.ObjectId(userId)] }
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
        .sort({ punchInTime: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("employeeId", "name email")
        .populate("companyId", "name email")
        .lean(),

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

// ========== GET TODAY'S SESSIONS ALL (COMPANY WIDE) ==========
export const getTodaySessionsAll = async (req, res) => {
  try {
    const {
      companyId,
      salesPersonId,
      status,
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
      query.employeeId = new mongoose.Types.ObjectId(salesPersonId);
    }

    if (status) {
      query.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);

    // ===== PARALLEL EXECUTION =====
    const [sessions, total] = await Promise.all([
      SalesSession.find(query)
        .populate("employeeId", "name email")
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
      stats: formattedStats,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit)
      },
      data: sessions
    });

  } catch (error) {
    console.error("getTodaySessionsAll error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  }
};

// ========== GET NEARBY FILTERED SESSIONS ==========
export const getNearbyFilteredSessions = async (req, res) => {
  try {
    const { sessionId } = req.params;
    let { page = 1, limit = 10, radius = 500 } = req.query;

    const userId = req.user?.id || req.user?._id;
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "Company ID not found"
      });
    }

    page = Math.max(1, Number(page));
    limit = Math.min(100, Number(limit));
    radius = Math.min(Number(radius), 5000);

    const skip = (page - 1) * limit;

    const currentSession = await SalesSession.findOne({ sessionId })
      .select("punchInLocation.coordinates")
      .lean();

    if (!currentSession?.punchInLocation?.coordinates) {
      return res.status(404).json({
        success: false,
        message: "Session or location not found"
      });
    }

    const coordinates = currentSession.punchInLocation.coordinates;

    const pipeline = [
      {
        $geoNear: {
          near: { type: "Point", coordinates },
          distanceField: "distance",
          maxDistance: radius,
          spherical: true,
          key: "punchInLocation",
          query: {
            sessionId: { $ne: sessionId },
            SalesStatus: "open",
            companyId: new mongoose.Types.ObjectId(companyId),
            $or: [
              { assignedTo: new mongoose.Types.ObjectId(userId) },
              { createdBy: new mongoose.Types.ObjectId(userId) },
              { employeeId: new mongoose.Types.ObjectId(userId) }
            ]
          }
        }
      },

      { $sort: { distance: 1 } },

      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit }
          ],
          totalCount: [{ $count: "count" }]
        }
      }
    ];

    const [result] = await SalesSession.aggregate(pipeline);

    return res.status(200).json({
      success: true,
      pagination: {
        total: result?.totalCount?.[0]?.count || 0,
        page,
        limit,
        totalPages: Math.ceil((result?.totalCount?.[0]?.count || 0) / limit)
      },
      data: result?.data || []
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

// ========== GET NEARBY SALES BY LOCATION ==========
export const getNearbySalesByLocation = async (req, res) => {
  try {
    let { lat, lng, radius = 1000, page = 1, limit = 10 } = req.query;

    const userId = new mongoose.Types.ObjectId(req.user?.id || req.user?._id);
    const companyId = new mongoose.Types.ObjectId(req.user?.companyId);

    // ===== VALIDATION =====
    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "lat and lng are required"
      });
    }

    lat = Number(lat);
    lng = Number(lng);
    radius = Math.min(Number(radius), 3000);
    page = Math.max(1, Number(page));
    limit = Math.min(50, Number(limit));

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates"
      });
    }

    const skip = (page - 1) * limit;

    // ===== GEO QUERY =====
    const pipeline = [
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [lng, lat],
          },
          distanceField: "distance",
          spherical: true,
          maxDistance: radius,
          key: "punchInLocation",

          query: {
            SalesStatus: "open",
            companyId,
            $or: [
              { assignedTo: userId },
              { employeeId: userId }
            ]
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
                _id: 0,
                sessionId: 1,
                employeeId: 1,
                assignedTo: 1,
                distance: 1,
                punchInTime: 1,
                SalesStatus: 1,
                punchInLocation: 1,
                customer: 1
              }
            }
          ],
          total: [{ $count: "count" }]
        }
      }
    ];

    const [result] = await SalesSession.aggregate(pipeline);

    const total = result?.total?.[0]?.count || 0;

    return res.status(200).json({
      success: true,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      data: result?.data || []
    });

  } catch (error) {
    console.error("getNearbySalesByLocation error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  }
};

// ========== GET NEARBY OPEN SALES (ADMIN OPTIMIZED) ==========
export const getNearbyOpenSalesAdminOptimized = async (req, res) => {
  try {
    const { sessionId } = req.params;
    let { page = 1, limit = 10, radius = 1000, userFilterId } = req.query;

    const companyId = new mongoose.Types.ObjectId(req.user?.companyId || req.user?.id);

    page = Math.max(1, Number(page));
    limit = Math.min(100, Number(limit));
    radius = Math.min(Number(radius), 10000);

    const skip = (page - 1) * limit;

    const baseSession = await SalesSession.findOne(
      { sessionId },
      { "punchInLocation.coordinates": 1, _id: 0 }
    ).lean();

    if (!baseSession?.punchInLocation?.coordinates) {
      return res.status(404).json({
        success: false,
        message: "Session or location not found"
      });
    }

    const coordinates = baseSession.punchInLocation.coordinates;

    const matchFilter = {
      sessionId: { $ne: sessionId },
      SalesStatus: "open",
      companyId
    };

    if (userFilterId && mongoose.Types.ObjectId.isValid(userFilterId)) {
      const userId = new mongoose.Types.ObjectId(userFilterId);

      matchFilter.$or = [
        { employeeId: userId },
        { assignedTo: userId }
      ];
    }

    const dataPipeline = [
      {
        $geoNear: {
          near: { type: "Point", coordinates },
          distanceField: "distance",
          spherical: true,
          maxDistance: radius,
          key: "punchInLocation"
        }
      },

      { $match: matchFilter },

      { $sort: { distance: 1 } },

      { $skip: skip },
      { $limit: limit }
    ];

    const countPipeline = [
      {
        $geoNear: {
          near: { type: "Point", coordinates },
          distanceField: "distance",
          spherical: true,
          maxDistance: radius,
          key: "punchInLocation"
        }
      },
      { $match: matchFilter },
      { $count: "total" }
    ];

    const [data, countResult] = await Promise.all([
      SalesSession.aggregate(dataPipeline),
      SalesSession.aggregate(countPipeline)
    ]);

    const total = countResult[0]?.total || 0;

    return res.status(200).json({
      success: true,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      data
    });

  } catch (error) {
    console.error("Optimized Geo Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  }
};