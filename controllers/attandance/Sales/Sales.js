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

// Helper function to create and validate GeoJSON Point
const createGeoPoint = (lng, lat) => {
  // Convert to numbers and validate
  const longitude = Number(lng);
  const latitude = Number(lat);
  
  if (isNaN(longitude) || isNaN(latitude)) {
    throw new Error("Invalid coordinates: longitude and latitude must be numbers");
  }
  
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error("Invalid coordinates: out of range");
  }
  
  return {
    type: "Point",
    coordinates: [longitude, latitude]
  };
};

// Validate and sanitize location object
const validateLocation = (location) => {
  if (!location) throw new Error("Location is required");
  
  let parsedLocation = location;
  if (typeof location === "string") {
    try {
      parsedLocation = JSON.parse(location);
    } catch (error) {
      throw new Error("Invalid location JSON format");
    }
  }
  
  if (!parsedLocation.lat || !parsedLocation.lng) {
    throw new Error("Location must have lat and lng coordinates");
  }
  
  return {
    lat: Number(parsedLocation.lat),
    lng: Number(parsedLocation.lng),
    address: parsedLocation.address || "",
    accuracy: Number(parsedLocation.accuracy) || 0,
    heading: Number(parsedLocation.heading) || 0
  };
};

// Upload image to Cloudinary
const uploadImage = async (file, folder) => {
  if (!file || !file.buffer) return null;

  // 🔍 Detect real file type
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

    // Validate and parse location
    const validatedLocation = validateLocation(location);
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

    // Create route point for punch in
    const routePoint = {
      location: createGeoPoint(validatedLocation.lng, validatedLocation.lat),
      timestamp: new Date(),
      accuracy: validatedLocation.accuracy,
      speed: 0,
      heading: validatedLocation.heading
    };

    // Create new session
    const newSession = await SalesSession.create([{
      sessionId,
      salesPersonId,
      companyId,
      status: "in_progress",
      punchInTime: new Date(),
      punchInLocation: createGeoPoint(validatedLocation.lng, validatedLocation.lat),
      punchInPhoto,
      punchInAddress: validatedLocation.address,
      routePath: [routePoint],
      totalDistance: 0,
      duration: 0,
      createdBy: salesPersonId
    }], { session });

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
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

// ========== UPDATE ROUTE (Optional - for real-time tracking) ==========
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
    const timeDiff = (now - lastPoint.timestamp) / 1000; // seconds

    // Calculate distance from last point
    const distance = calculateDistance(
      lastPoint.location.coordinates[1],
      lastPoint.location.coordinates[0],
      validatedLocation.lat,
      validatedLocation.lng
    );

    // Calculate speed (m/s)
    const speed = timeDiff > 0 ? distance / timeDiff : 0;

    // Create new route point
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
      speed: Math.round(speed * 3.6) // Convert to km/h for response
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

    // Prepare customer location with validation
    let customerLocation = salesSession.customer?.location;
    if (parsedCustomer?.location) {
      try {
        // Ensure coordinates are numbers
        const lng = Number(parsedCustomer.location.lng);
        const lat = Number(parsedCustomer.location.lat);
        if (!isNaN(lng) && !isNaN(lat)) {
          customerLocation = createGeoPoint(lng, lat);
        }
      } catch (error) {
        console.error('Error creating customer location:', error);
      }
    }

    // Prepare update data
    const updateData = {
      // Customer details
      customer: {
        companyName: parsedCustomer?.companyName || salesSession.customer?.companyName,
        contactName: parsedCustomer?.contactName || salesSession.customer?.contactName,
        phoneNumber: parsedCustomer?.phoneNumber || salesSession.customer?.phoneNumber,
        address: parsedCustomer?.address || salesSession.customer?.address,
        landmark: parsedCustomer?.landmark || salesSession.customer?.landmark,
        location: customerLocation,
        shopPhoto: shopPhoto || salesSession.customer?.shopPhoto
      },

      // Sales details
      sales: {
        dealStatus: parsedSales?.dealStatus || "Negotiation",
        paymentCollected: parsedSales?.paymentCollected || false,
        amount: Number(parsedSales?.amount) || 0,
        paymentMode: parsedSales?.paymentMode,
        paymentDate: parsedSales?.paymentDate ? new Date(parsedSales.paymentDate) : undefined
      },

      SalesStatus: SalesStatus || "open",

      // Next meeting
      nextMeeting: {
        decided: parsedNextMeeting?.decided || false,
        date: parsedNextMeeting?.date ? new Date(parsedNextMeeting.date) : undefined,
        time: parsedNextMeeting?.time,
        notes: parsedNextMeeting?.notes
      },

      // Evidence/Visit notes
      evideinceVisite: {
        visitNotes: parsedEvidence?.visitNotes,
        visitPhoto: visitPhoto || salesSession.evideinceVisite?.visitPhoto
      },

      updatedBy: req.userId
    };

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

    // Calculate distance from last point to punch out location
    const finalDistance = calculateDistance(
      lastPoint.location.coordinates[1],
      lastPoint.location.coordinates[0],
      validatedLocation.lat,
      validatedLocation.lng
    );

    // Calculate total duration in seconds
    const punchOutTime = new Date();
    const durationSeconds = Math.round((punchOutTime - salesSession.punchInTime) / 1000);
    const durationMinutes = Math.round(durationSeconds / 60);

    // Create final route point
    const finalRoutePoint = {
      location: createGeoPoint(validatedLocation.lng, validatedLocation.lat),
      timestamp: punchOutTime,
      accuracy: validatedLocation.accuracy,
      speed: 0,
      heading: validatedLocation.heading
    };

    // Update session
    const updatedSession = await SalesSession.findOneAndUpdate(
      { sessionId },
      {
        status: "completed",
        punchOutTime,
        punchOutLocation: createGeoPoint(validatedLocation.lng, validatedLocation.lat),
        punchOutPhoto,
        punchOutAddress: validatedLocation.address,
        $push: { routePath: finalRoutePoint },
        $inc: { totalDistance: finalDistance },
        duration: durationSeconds
      },
      { new: true, session }
    );

    await session.commitTransaction();

    // Prepare response
    const response = {
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
    };

    res.status(200).json(response);

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

    // Calculate additional stats
    const stats = {
      duration: {
        seconds: session.duration,
        minutes: Math.round(session.duration / 60),
        formatted: session.duration >= 3600 ?
          `${Math.floor(session.duration / 3600)}h ${Math.floor((session.duration % 3600) / 60)}m` :
          `${Math.round(session.duration / 60)}m`
      },
      distance: {
        meters: session.totalDistance,
        kilometers: (session.totalDistance / 1000).toFixed(2),
        formatted: session.totalDistance > 1000 ?
          `${(session.totalDistance / 1000).toFixed(2)} km` :
          `${Math.round(session.totalDistance)} m`
      },
      routePoints: session.routePath.length,
      hasCustomerData: !!session.customer?.contactName,
      hasPayment: session.sales?.paymentCollected,
      hasNextMeeting: session.nextMeeting?.decided
    };

    res.status(200).json({
      success: true,
      session,
      stats
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

    // Date range filter
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

    // Summary stats
    const summary = {
      totalSessions: total,
      totalDistance: sessions.reduce((sum, s) => sum + (s.totalDistance || 0), 0),
      totalDuration: sessions.reduce((sum, s) => sum + (s.duration || 0), 0),
      totalSales: sessions.reduce((sum, s) => sum + (s.sales?.amount || 0), 0),
      completedVisits: sessions.filter(s => s.status === "completed").length,
      paymentsCollected: sessions.filter(s => s.sales?.paymentCollected).length
    };

    res.status(200).json({
      success: true,
      data: sessions,
      summary,
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

    const stats = {
      totalVisits: sessions.length,
      completedVisits: sessions.filter(s => s.status === "completed").length,
      inProgressVisits: sessions.filter(s => s.status === "in_progress").length,
      totalDistance: sessions.reduce((sum, s) => sum + (s.totalDistance || 0), 0),
      totalSales: sessions.reduce((sum, s) => sum + (s.sales?.amount || 0), 0),
      paymentsCollected: sessions.filter(s => s.sales?.paymentCollected).length
    };

    res.status(200).json({
      success: true,
      date: startOfDay,
      stats,
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

    const route = {
      sessionId: session.sessionId,
      salesPersonId: session.salesPersonId,
      punchIn: {
        time: session.punchInTime,
        location: session.punchInLocation,
        address: session.punchInAddress,
        photo: session.punchInPhoto
      },
      punchOut: session.punchOutTime ? {
        time: session.punchOutTime,
        location: session.punchOutLocation,
        address: session.punchOutAddress,
        photo: session.punchOutPhoto
      } : null,
      routePath: session.routePath,
      stats: {
        totalDistance: session.totalDistance,
        duration: session.duration,
        numberOfPoints: session.routePath.length
      }
    };

    res.status(200).json({
      success: true,
      route
    });

  } catch (error) {
    console.error('GetSessionRoute error:', error);
    res.status(500).json({ error: error.message });
  }
};