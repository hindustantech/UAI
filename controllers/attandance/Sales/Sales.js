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

// ========== FIXED: Strict GeoJSON Point creator - ensures PRIMITIVE numbers only ==========
const createGeoPoint = (lng, lat) => {
  // Step 1: Validate inputs exist
  if (lng === undefined || lng === null || lat === undefined || lat === null) {
    throw new Error(`Missing coordinates: lng=${lng}, lat=${lat}`);
  }

  // Step 2: Convert to primitive numbers, handling Mongoose objects
  let longitude, latitude;
  
  try {
    // Handle if lng/lat are objects with valueOf (Mongoose Number wrappers)
    longitude = Number(typeof lng === 'object' && lng.valueOf ? lng.valueOf() : lng);
    latitude = Number(typeof lat === 'object' && lat.valueOf ? lat.valueOf() : lat);
  } catch (e) {
    longitude = Number(lng);
    latitude = Number(lat);
  }

  // Step 3: Validate numeric conversion - ensure primitives
  if (!isFinite(longitude) || !isFinite(latitude)) {
    throw new Error(
      `Invalid coordinates after conversion: lng=${longitude} (${typeof longitude}), ` +
      `lat=${latitude} (${typeof latitude}). Both must be finite numbers.`
    );
  }

  // Step 4: Validate geospatial bounds
  if (longitude < -180 || longitude > 180) {
    throw new Error(`Longitude out of range: ${longitude} (must be between -180 and 180)`);
  }
  if (latitude < -90 || latitude > 90) {
    throw new Error(`Latitude out of range: ${latitude} (must be between -90 and 90)`);
  }

  // Step 5: Return PLAIN object with primitive numbers
  // CRITICAL: type MUST be "Point" (uppercase P) - MongoDB GeoJSON standard requires this
  const point = {
    type: "Point",  // Must be exactly "Point" with capital P - enum requires this
    coordinates: [longitude, latitude]
  };

  // Verify it's correct before returning
  if (typeof point.coordinates[0] !== 'number' || typeof point.coordinates[1] !== 'number') {
    throw new Error(`GeoPoint coordinates are not primitives: [${typeof point.coordinates[0]}, ${typeof point.coordinates[1]}]`);
  }

  if (point.type !== "Point") {
    throw new Error(`GeoPoint type must be "Point" (capital P), got "${point.type}"`);
  }

  return point;
};

// ========== FIXED: Validate and sanitize location ==========
const validateLocation = (location) => {
  if (!location) throw new Error("Location is required");
  
  let parsedLocation = location;
  
  // Parse JSON if needed
  if (typeof location === "string") {
    try {
      parsedLocation = JSON.parse(location);
    } catch (error) {
      throw new Error("Invalid location JSON format");
    }
  }

  // Step 1: Extract and convert to primitives
  let lat = Number(typeof parsedLocation.lat === 'object' && parsedLocation.lat.valueOf 
    ? parsedLocation.lat.valueOf() 
    : parsedLocation.lat);
    
  let lng = Number(typeof parsedLocation.lng === 'object' && parsedLocation.lng.valueOf 
    ? parsedLocation.lng.valueOf() 
    : parsedLocation.lng);

  // Step 2: Validate conversion was successful
  if (!isFinite(lat) || !isFinite(lng)) {
    throw new Error(
      `Invalid location coordinates: lat=${parsedLocation.lat} (${typeof parsedLocation.lat}), ` +
      `lng=${parsedLocation.lng} (${typeof parsedLocation.lng}). Both must be valid numbers.`
    );
  }

  // Step 3: Return primitive values only
  return {
    lat: lat,
    lng: lng,
    address: String(parsedLocation.address || ""),
    accuracy: Number(parsedLocation.accuracy) || 0,
    heading: Number(parsedLocation.heading) || 0
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
    const {
      salesPersonId,
      companyId,
      location,
      deviceInfo
    } = req.body;

    console.log("Raw location received:", location);
    console.log("Location type:", typeof location);
    
    // Validate and parse location
    const validatedLocation = validateLocation(location);
    console.log("Validated location:", validatedLocation);
    console.log("Coordinate types:", typeof validatedLocation.lng, typeof validatedLocation.lat);
    
    const parsedDeviceInfo = typeof deviceInfo === 'string' ? JSON.parse(deviceInfo) : deviceInfo;

    // Validate required fields
    if (!salesPersonId || !companyId) {
      return res.status(400).json({
        error: "Missing required fields: salesPersonId, companyId"
      });
    }

    // Check for active session
    const activeSession = await SalesSession.findOne({
      salesPersonId,
      status: "in_progress"
    });

    if (activeSession) {
      return res.status(400).json({
        error: "You have an active session. Please punch out first.",
        sessionId: activeSession.sessionId,
        punchInTime: activeSession.punchInTime
      });
    }

    // Upload punch-in photo if provided
    let punchInPhoto = null;
    if (req.file) {
      punchInPhoto = await uploadImage(req.file, 'sales/punch-in');
    }

    const sessionId = generateSessionId(salesPersonId);
    
    // ========== CRITICAL: Create GeoJSON with strict validation ==========
    // IMPORTANT: type MUST be "Point" (capital P) - not "point"
    const punchInLocationGeo = createGeoPoint(validatedLocation.lng, validatedLocation.lat);
    console.log("Created punchInLocation GeoPoint:", JSON.stringify(punchInLocationGeo));
    console.log("Coordinate types in GeoPoint:", typeof punchInLocationGeo.coordinates[0], typeof punchInLocationGeo.coordinates[1]);
    console.log("GeoPoint type field:", punchInLocationGeo.type);

    // Verify coordinates are primitives before proceeding
    if (typeof punchInLocationGeo.coordinates[0] !== 'number' || 
        typeof punchInLocationGeo.coordinates[1] !== 'number') {
      throw new Error(`GeoPoint coordinates failed type check: [${typeof punchInLocationGeo.coordinates[0]}, ${typeof punchInLocationGeo.coordinates[1]}]`);
    }

    // Verify type is correct case
    if (punchInLocationGeo.type !== 'Point') {
      throw new Error(`GeoPoint type must be "Point" (capital P), got "${punchInLocationGeo.type}"`);
    }

    // Create route point with same strict validation
    const routePoint = {
      location: createGeoPoint(validatedLocation.lng, validatedLocation.lat),
      timestamp: new Date(),
      accuracy: Number(validatedLocation.accuracy) || 0,
      speed: 0,
      heading: Number(validatedLocation.heading) || 0
    };

    // Create session document with explicit primitive values
    const sessionData = {
      sessionId,
      salesPersonId: new mongoose.Types.ObjectId(salesPersonId),
      companyId: new mongoose.Types.ObjectId(companyId),
      status: "in_progress",
      punchInTime: new Date(),
      punchInLocation: punchInLocationGeo,
      // Only include photo if it exists
      ...(punchInPhoto && { punchInPhoto }),
      punchInAddress: validatedLocation.address || "",
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
    
    console.log("Session data coordinates:", JSON.stringify(sessionData.punchInLocation, null, 2));

    // IMPORTANT: Use create() instead of insertOne() to use Mongoose serialization
    const newSession = await SalesSession.create([sessionData], { session });

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: "Punched in successfully",
      sessionId,
      session: newSession[0],
      requiresFormCompletion: true
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('PunchIn error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack 
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
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { sessionId, location } = req.body;

    const validatedLocation = validateLocation(location);
    
    if (!sessionId) {
      return res.status(400).json({ error: "Missing required fields: sessionId" });
    }

    // Find session
    const salesSession = await SalesSession.findOne({ sessionId });
    if (!salesSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (salesSession.status !== "in_progress") {
      return res.status(400).json({ error: "Session is not in progress" });
    }

    // Upload punch-out photo if provided
    let punchOutPhoto = null;
    if (req.file) {
      punchOutPhoto = await uploadImage(req.file, 'sales/punch-out');
    }

    // Get last route point
    const lastPoint = salesSession.routePath[salesSession.routePath.length - 1];

    // Calculate distance
    const finalDistance = calculateDistance(
      lastPoint.location.coordinates[1],
      lastPoint.location.coordinates[0],
      validatedLocation.lat,
      validatedLocation.lng
    );

    // Calculate total duration
    const punchOutTime = new Date();
    const durationSeconds = Math.round((punchOutTime - salesSession.punchInTime) / 1000);

    // Create final route point with strict GeoJSON validation
    const finalRoutePoint = {
      location: createGeoPoint(validatedLocation.lng, validatedLocation.lat),
      timestamp: punchOutTime,
      accuracy: validatedLocation.accuracy,
      speed: 0,
      heading: validatedLocation.heading
    };

    // Prepare update object
    const updateObject = {
      status: "completed",
      punchOutTime,
      punchOutLocation: createGeoPoint(validatedLocation.lng, validatedLocation.lat),
      punchOutAddress: validatedLocation.address || "",
      duration: durationSeconds
    };

    // Only add punchOutPhoto if it exists
    if (punchOutPhoto) {
      updateObject.punchOutPhoto = punchOutPhoto;
    }

    // Update session
    const updatedSession = await SalesSession.findOneAndUpdate(
      { sessionId },
      {
        $set: updateObject,
        $push: { routePath: finalRoutePoint },
        $inc: { totalDistance: finalDistance }
      },
      { new: true, session }
    );

    await session.commitTransaction();

    const durationMinutes = Math.round(durationSeconds / 60);

    res.status(200).json({
      success: true,
      message: "Punched out successfully",
      sessionId,
      session: updatedSession,
      summary: {
        duration: {
          seconds: durationSeconds,
          minutes: durationMinutes,
          formatted: durationMinutes >= 60 ?
            `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m` :
            `${durationMinutes}m`
        },
        totalDistance: {
          meters: Math.round(updatedSession.totalDistance),
          kilometers: (updatedSession.totalDistance / 1000).toFixed(2),
          formatted: updatedSession.totalDistance > 1000 ?
            `${(updatedSession.totalDistance / 1000).toFixed(2)} km` :
            `${Math.round(updatedSession.totalDistance)} m`
        },
        routePoints: updatedSession.routePath.length
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('PunchOut error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
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