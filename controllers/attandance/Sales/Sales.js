import { SalesSession } from "../../../models/Attandance/Salses/Salses.js";
import { uploadToCloudinary } from "../../../utils/Cloudinary.js";
import mongoose from "mongoose";
import { fileTypeFromBuffer } from "file-type";

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

export const createGeoPoint = (lng, lat) => {
  const parsedLng = toStrictNumber(lng);
  const parsedLat = toStrictNumber(lat);

  if (parsedLng === null || parsedLat === null) {
    throw new Error(`Invalid GeoJSON coordinates: [${lng}, ${lat}]`);
  }

  return {
    type: "Point",
    coordinates: [parsedLng, parsedLat], // STRICT numbers only
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
export const punchIn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let { salesPersonId, companyId, location, deviceInfo } = req.body;

    if (!salesPersonId || !companyId) {
      return res.status(400).json({
        error: "Missing required fields: salesPersonId, companyId"
      });
    }
    console.log("PunchIn request body:", req.body);
    
    // Normalize input early
    if (typeof location === "string") {
      location = JSON.parse(location);
    }

    const validatedLocation = validateLocation(location);
    console.log("Validated Location:", validatedLocation);
    
    const parsedDeviceInfo =
      typeof deviceInfo === "string" ? JSON.parse(deviceInfo) : deviceInfo;

    // Check active session
    const activeSession = await SalesSession.findOne({
      salesPersonId,
      status: "in_progress"
    });

    if (activeSession) {
      return res.status(400).json({
        error: "You have an active session. Please punch out first.",
        sessionId: activeSession.sessionId
      });
    }

    let punchInPhoto = null;
    if (req.file) {
      punchInPhoto = await uploadImage(req.file, "sales/punch-in");
    }

    const sessionId = generateSessionId(salesPersonId);

    // ✅ FIXED: Use validatedLocation.lng and validatedLocation.lat directly
    const punchInLocationGeo = createGeoPoint(
      validatedLocation.lng,  // Now this exists
      validatedLocation.lat   // Now this exists
    );

    const routePoint = {
      location: createGeoPoint(
        validatedLocation.lng,  // Now this exists
        validatedLocation.lat   // Now this exists
      ),
      timestamp: new Date(),
      accuracy: validatedLocation.accuracy,
      speed: 0,
      heading: validatedLocation.heading
    };

    // ✅ FINAL SANITY CHECK (production defensive layer)
    const [lng, lat] = punchInLocationGeo.coordinates;
    if (typeof lng !== "number" || typeof lat !== "number") {
      throw new Error("Final Geo validation failed");
    }

    const sessionData = {
      sessionId,
      salesPersonId: new mongoose.Types.ObjectId(salesPersonId),
      companyId: new mongoose.Types.ObjectId(companyId),

      status: "in_progress",
      punchInTime: new Date(),

      punchInLocation: punchInLocationGeo,
      ...(punchInPhoto && { punchInPhoto }),

      punchInAddress: validatedLocation.address,
      punchOutAddress: "",

      routePath: [routePoint],

      totalDistance: 0,
      duration: 0,

      customer: {
        companyName: "",
        contactName: "",
        phoneNumber: "",
        address: "",
        landmark: ""
      },

      sales: {
        dealStatus: "Negotiation",
        paymentCollected: false,
        amount: 0
      },

      SalesStatus: "open",

      nextMeeting: {
        decided: false,
        time: "",
        notes: ""
      },

      evideinceVisite: {
        visitNotes: ""
      },

      createdBy: new mongoose.Types.ObjectId(salesPersonId)
    };

    const [newSession] = await SalesSession.create([sessionData], { session });

    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      sessionId,
      session: newSession
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("PunchIn error:", error);

    return res.status(500).json({
      error: error.message
    });
  } finally {
    session.endSession();
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
      SalesStatus
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

// ========== PUNCH OUT ==========
export const punchOut = async (req, res) => {
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const { sessionId, location } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    // ===== STEP 1: VALIDATE & CLONE LOCATION =====
    const validatedLocation = validateLocation(location);

    // Deep clone to avoid reference issues
    const safeLocation = JSON.parse(JSON.stringify(validatedLocation));

    const lat = Number(safeLocation.lat);
    const lng = Number(safeLocation.lng);

    if (!isFinite(lat) || !isFinite(lng)) {
      throw new Error("Invalid latitude/longitude values");
    }

    // ===== STEP 2: FETCH SESSION =====
    const salesSession = await SalesSession.findOne({ sessionId }).session(dbSession);

    if (!salesSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (salesSession.status !== "in_progress") {
      return res.status(400).json({ error: "Session already completed" });
    }

    // ===== STEP 3: HANDLE PHOTO =====
    let punchOutPhoto = null;
    if (req.file) {
      punchOutPhoto = await uploadImage(req.file, "sales/punch-out");
    }

    // ===== STEP 4: DISTANCE CALCULATION (SAFE) =====
    let finalDistance = 0;

    if (salesSession.routePath.length > 0) {
      const lastPoint = salesSession.routePath[salesSession.routePath.length - 1];

      if (lastPoint?.location?.coordinates) {
        const [prevLng, prevLat] = lastPoint.location.coordinates;

        finalDistance = calculateDistance(
          prevLat,
          prevLng,
          lat,
          lng
        );
      }
    }

    // ===== STEP 5: TIME CALCULATION =====
    const punchOutTime = new Date();
    const durationSeconds = Math.max(
      0,
      Math.round((punchOutTime - salesSession.punchInTime) / 1000)
    );

    // ===== STEP 6: CREATE GEOJSON (IMMUTABLE) =====
    const punchOutGeo = createGeoPoint(lng, lat);

    const finalRoutePoint = {
      location: createGeoPoint(lng, lat),
      timestamp: punchOutTime,
      accuracy: Number(safeLocation.accuracy) || 0,
      speed: 0,
      heading: Number(safeLocation.heading) || 0
    };

    // ===== STEP 7: BUILD UPDATE OBJECT =====
    const updateObject = {
      status: "completed",
      punchOutTime,
      punchOutLocation: punchOutGeo,
      punchOutAddress: safeLocation.address || "",
      duration: durationSeconds
    };

    if (punchOutPhoto) {
      updateObject.punchOutPhoto = punchOutPhoto;
    }

    // ===== STEP 8: ATOMIC UPDATE =====
    const updatedSession = await SalesSession.findOneAndUpdate(
      { sessionId, status: "in_progress" }, // prevents double punchOut
      {
        $set: updateObject,
        $push: { routePath: finalRoutePoint },
        $inc: { totalDistance: finalDistance }
      },
      {
        new: true,
        session: dbSession
      }
    );

    if (!updatedSession) {
      throw new Error("Session update failed (possibly already completed)");
    }

    await dbSession.commitTransaction();

    // ===== STEP 9: RESPONSE =====
    const durationMinutes = Math.round(durationSeconds / 60);

    res.status(200).json({
      success: true,
      message: "Punch-out successful",
      sessionId,
      summary: {
        duration: {
          seconds: durationSeconds,
          minutes: durationMinutes,
          formatted:
            durationMinutes >= 60
              ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
              : `${durationMinutes}m`
        },
        totalDistance: {
          meters: Math.round(updatedSession.totalDistance),
          kilometers: (updatedSession.totalDistance / 1000).toFixed(2),
          formatted:
            updatedSession.totalDistance > 1000
              ? `${(updatedSession.totalDistance / 1000).toFixed(2)} km`
              : `${Math.round(updatedSession.totalDistance)} m`
        },
        routePoints: updatedSession.routePath.length
      },
      session: updatedSession
    });

  } catch (error) {
    await dbSession.abortTransaction();
    console.error("PunchOut error:", error);

    res.status(500).json({
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