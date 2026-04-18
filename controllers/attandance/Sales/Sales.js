// ============================================
// CONTROLLERS
// ============================================

import { SalesPunchEvent, SalesSession, SalesPayment, Contact } from "../../../models/Attandance/Salses/Salses.js";

// Helper: Calculate distance between two geo points (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
};

// ========== PUNCH IN / PUNCH OUT ==========

/**
 * Punch In: Start a sales session
 */
export const punchIn = async (req, res) => {
  try {
    const {
      salesPersonId,
      companyId,
      contactId,
      location, // { latitude, longitude }
      officeLocation, // { latitude, longitude }
      geofenceRadius // meters
    } = req.body;

    // Validate required fields
    if (!salesPersonId || !companyId || !contactId || !location || !officeLocation) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Calculate distance from office
    const distance = calculateDistance(
      officeLocation.latitude,
      officeLocation.longitude,
      location.latitude,
      location.longitude
    );

    const isWithinRadius = distance <= geofenceRadius;

    // Generate session ID
    const sessionId = `${salesPersonId}-${Date.now()}`;

    // Fetch contact info for denormalization
    const contact = await Contact.findById(contactId).lean();

    // Create punch-in event
    const punchEvent = await SalesPunchEvent.create({
      eventType: "punch_in",
      sessionId,
      salesPersonId,
      companyId,
      eventTime: new Date(),
      location: {
        type: "Point",
        coordinates: [location.longitude, location.latitude]
      },
      isWithinRadius,
      distanceFromOffice: Math.round(distance),
      rejectionReason: isWithinRadius ? null : "Outside geofence"
    });

    // Create session
    const session = await SalesSession.create({
      sessionId,
      salesPersonId,
      companyId,
      contactId,
      contactName: contact?.name,
      contactPhone: contact?.phone,
      contactEmail: contact?.email,
      status: "in_progress",
      isWithinRadius,
      distanceFromOffice: Math.round(distance),
      startTime: new Date(),
      routePath: [
        {
          type: "Point",
          coordinates: [location.longitude, location.latitude],
          timestamp: new Date()
        }
      ],
      createdBy: salesPersonId
    });

    res.status(201).json({
      success: true,
      message: "Punched in successfully",
      sessionId,
      punchEvent,
      session,
      isWithinRadius,
      distance: Math.round(distance)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Punch Out: End a sales session
 */
export const punchOut = async (req, res) => {
  try {
    const {
      sessionId,
      location, // { latitude, longitude }
      officeLocation,
      geofenceRadius,
      visitOutcome,
      remark
    } = req.body;

    // Validate
    if (!sessionId || !location || !officeLocation) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Find session
    const session = await SalesSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status !== "in_progress") {
      return res.status(400).json({ error: "Session is not in progress" });
    }

    // Calculate distance
    const distance = calculateDistance(
      officeLocation.latitude,
      officeLocation.longitude,
      location.latitude,
      location.longitude
    );

    const isWithinRadius = distance <= geofenceRadius;

    // Create punch-out event
    const punchEvent = await SalesPunchEvent.create({
      eventType: "punch_out",
      sessionId,
      salesPersonId: session.salesPersonId,
      companyId: session.companyId,
      eventTime: new Date(),
      location: {
        type: "Point",
        coordinates: [location.longitude, location.latitude]
      },
      isWithinRadius,
      distanceFromOffice: Math.round(distance),
      rejectionReason: isWithinRadius ? null : "Outside geofence"
    });

    // Calculate duration
    const endTime = new Date();
    const durationMs = endTime - session.startTime;
    const durationMinutes = Math.round(durationMs / 1000 / 60);

    // Calculate total distance from route
    let totalDistance = 0;
    const routePath = session.routePath || [];

    for (let i = 0; i < routePath.length - 1; i++) {
      const dist = calculateDistance(
        routePath[i].coordinates[1],
        routePath[i].coordinates[0],
        routePath[i + 1].coordinates[1],
        routePath[i + 1].coordinates[0]
      );
      totalDistance += dist;
    }

    // Add final distance to endpoint
    if (routePath.length > 0) {
      const lastPoint = routePath[routePath.length - 1];
      const finalDist = calculateDistance(
        lastPoint.coordinates[1],
        lastPoint.coordinates[0],
        location.latitude,
        location.longitude
      );
      totalDistance += finalDist;
    }

    // Update session
    const updatedSession = await SalesSession.findOneAndUpdate(
      { sessionId },
      {
        status: "completed",
        endTime,
        duration: durationMinutes,
        isWithinRadius,
        distanceFromOffice: Math.round(distance),
        totalDistance: Math.round(totalDistance),
        visitOutcome: visitOutcome || "pending",
        remark,
        $push: {
          routePath: {
            type: "Point",
            coordinates: [location.longitude, location.latitude],
            timestamp: endTime
          }
        }
      },
      { new: true }
    );

    // Update contact stats
    await Contact.findByIdAndUpdate(session.contactId, {
      $inc: { totalVisits: 1 },
      lastVisitDate: endTime
    });

    res.status(200).json({
      success: true,
      message: "Punched out successfully",
      sessionId,
      punchEvent,
      session: updatedSession,
      duration: durationMinutes,
      totalDistance: Math.round(totalDistance)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========== SESSION MANAGEMENT ==========

/**
 * Get all sessions with filters
 */
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

    const query = { isDeleted: false };

    if (salesPersonId) query.salesPersonId = salesPersonId;
    if (companyId) query.companyId = companyId;
    if (status) query.status = status;

    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const sessions = await SalesSession.find(query)
      .populate("salesPersonId", "name email")
      .populate("companyId", "name")
      .populate("contactId", "name phone")
      .sort({ startTime: -1 })
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
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get single session with details
 */
export const getSessionById = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await SalesSession.findOne({ sessionId })
      .populate("salesPersonId", "name email phone")
      .populate("companyId", "name location")
      .populate("contactId")
      .populate("paymentIds");

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Fetch punch events
    const punchEvents = await SalesPunchEvent.find({ sessionId });

    res.status(200).json({
      success: true,
      session,
      punchEvents
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Update session details
 */
export const updateSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { visitOutcome, remark, salesStatus, nextMeetingDate, internalNotes } = req.body;

    const updatedSession = await SalesSession.findOneAndUpdate(
      { sessionId },
      {
        visitOutcome,
        remark,
        salesStatus,
        nextMeetingDate,
        internalNotes,
        lastModifiedBy: req.userId // Assuming auth middleware sets this
      },
      { new: true }
    );

    if (!updatedSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.status(200).json({
      success: true,
      message: "Session updated",
      session: updatedSession
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Delete session (soft delete)
 */
export const deleteSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { reason } = req.body;

    const deletedSession = await SalesSession.findOneAndUpdate(
      { sessionId },
      {
        isDeleted: true,
        deletedAt: new Date(),
        deletedReason: reason
      },
      { new: true }
    );

    if (!deletedSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.status(200).json({
      success: true,
      message: "Session deleted",
      session: deletedSession
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========== GEOLOCATION QUERIES ==========

/**
 * Find sessions within a geographic radius
 */
export const getSessionsNearby = async (req, res) => {
  try {
    const { latitude, longitude, radiusMeters = 5000, companyId } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: "Latitude and longitude required" });
    }

    const query = {
      isDeleted: false,
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: parseInt(radiusMeters)
        }
      }
    };

    if (companyId) query.companyId = companyId;

    const sessions = await SalesSession.find(query)
      .populate("contactId", "name phone")
      .populate("salesPersonId", "name")
      .limit(50);

    res.status(200).json({
      success: true,
      data: sessions,
      count: sessions.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Check geofence violations
 */
export const getGeofenceViolations = async (req, res) => {
  try {
    const { companyId, startDate, endDate, page = 1, limit = 10 } = req.query;

    const query = {
      isDeleted: false,
      isWithinRadius: false
    };

    if (companyId) query.companyId = companyId;

    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const violations = await SalesSession.find(query)
      .populate("salesPersonId", "name email")
      .populate("contactId", "name phone")
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await SalesSession.countDocuments(query);

    res.status(200).json({
      success: true,
      data: violations,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========== ANALYTICS ==========

/**
 * Get sales person performance metrics
 */
export const getSalesPersonMetrics = async (req, res) => {
  try {
    const { salesPersonId, startDate, endDate } = req.query;

    if (!salesPersonId) {
      return res.status(400).json({ error: "salesPersonId required" });
    }

    const query = { salesPersonId, isDeleted: false };

    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    const sessions = await SalesSession.find(query);

    const metrics = {
      totalSessions: sessions.length,
      completedSessions: sessions.filter(s => s.status === "completed").length,
      totalDistance: sessions.reduce((sum, s) => sum + (s.totalDistance || 0), 0),
      totalTime: sessions.reduce((sum, s) => sum + (s.duration || 0), 0), // minutes
      geofenceViolations: sessions.filter(s => !s.isWithinRadius).length,
      averageSessionDuration: Math.round(
        sessions.reduce((sum, s) => sum + (s.duration || 0), 0) / sessions.length
      ), // minutes
      successRate: (
        (sessions.filter(s => s.visitOutcome === "completed").length / sessions.length) *
        100
      ).toFixed(2) + "%",
      closedDeals: sessions.filter(s => s.salesStatus === "closed").length,
      pendingFollowUps: sessions.filter(s => s.nextMeetingDate && s.nextMeetingDate > new Date())
        .length
    };

    res.status(200).json({
      success: true,
      salesPersonId,
      metrics
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get company-wide analytics
 */
export const getCompanyAnalytics = async (req, res) => {
  try {
    const { companyId, startDate, endDate } = req.query;

    if (!companyId) {
      return res.status(400).json({ error: "companyId required" });
    }

    const query = { companyId, isDeleted: false };

    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    const sessions = await SalesSession.find(query).populate("salesPersonId", "name");

    // Group by sales person
    const byPerson = {};
    sessions.forEach(session => {
      const name = session.salesPersonId?.name || "Unknown";
      if (!byPerson[name]) {
        byPerson[name] = {
          sessions: 0,
          distance: 0,
          time: 0,
          closures: 0
        };
      }
      byPerson[name].sessions++;
      byPerson[name].distance += session.totalDistance || 0;
      byPerson[name].time += session.duration || 0;
      if (session.salesStatus === "closed") byPerson[name].closures++;
    });

    const analytics = {
      totalSessions: sessions.length,
      totalDistance: sessions.reduce((sum, s) => sum + (s.totalDistance || 0), 0),
      totalTime: sessions.reduce((sum, s) => sum + (s.duration || 0), 0),
      closedDeals: sessions.filter(s => s.salesStatus === "closed").length,
      conversionRate: (
        (sessions.filter(s => s.salesStatus === "closed").length / sessions.length) *
        100
      ).toFixed(2) + "%",
      geofenceViolations: sessions.filter(s => !s.isWithinRadius).length,
      bySalesPerson: byPerson
    };

    res.status(200).json({
      success: true,
      companyId,
      analytics
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========== PAYMENT MANAGEMENT ==========

/**
 * Create payment record
 */
export const createPayment = async (req, res) => {
  try {
    const { sessionId, amount, currency = "INR", approvalNotes } = req.body;

    if (!sessionId || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const payment = await SalesPayment.create({
      sessionId,
      amount,
      currency,
      status: "pending",
      approvalNotes
    });

    // Link payment to session
    await SalesSession.findOneAndUpdate(
      { sessionId },
      { $push: { paymentIds: payment._id } }
    );

    res.status(201).json({
      success: true,
      message: "Payment created",
      payment
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Approve payment
 */
export const approvePayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { approvalNotes } = req.body;

    const payment = await SalesPayment.findByIdAndUpdate(
      paymentId,
      {
        status: "approved",
        approvedBy: req.userId,
        approvalNotes,
        paymentDate: new Date()
      },
      { new: true }
    );

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    res.status(200).json({
      success: true,
      message: "Payment approved",
      payment
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get payments for session
 */
export const getPayments = async (req, res) => {
  try {
    const { sessionId } = req.query;

    const query = {};
    if (sessionId) query.sessionId = sessionId;

    const payments = await SalesPayment.find(query)
      .populate("sessionId", "sessionId contactName")
      .populate("approvedBy", "name");

    res.status(200).json({
      success: true,
      data: payments
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
