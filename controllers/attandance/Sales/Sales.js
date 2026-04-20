// controllers/SalesController.js
import { SalesPunchEvent, SalesSession, SalesPayment, Contact, NextMeeting } from "../../../models/Attandance/Salses/Salses.js";
import mongoose from "mongoose";

// Helper: Calculate distance between two geo points (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Helper: Generate unique session ID
const generateSessionId = (salesPersonId) => {
  return `${salesPersonId}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
};

// ========== PUNCH IN WITH FORM ==========
export const punchIn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      salesPersonId,
      companyId,
      contactId,
      location,
      officeLocation,
      geofenceRadius,
      deviceInfo,
      punchInPhoto
    } = req.body;

    // Validate required fields
    if (!salesPersonId || !companyId || !contactId || !location || !officeLocation) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Check if there's an active session
    const activeSession = await SalesSession.findOne({
      salesPersonId,
      status: "in_progress",
      isDeleted: false
    });

    if (activeSession) {
      return res.status(400).json({
        error: "You already have an active session. Please punch out first.",
        activeSessionId: activeSession.sessionId
      });
    }

    // Calculate distance from office
    const distance = calculateDistance(
      officeLocation.latitude,
      officeLocation.longitude,
      location.latitude,
      location.longitude
    );

    const isWithinRadius = distance <= geofenceRadius;
    const sessionId = generateSessionId(salesPersonId);

    // Fetch contact info
    const contact = await Contact.findById(contactId).lean();

    // Create punch-in event
    const punchEvent = await SalesPunchEvent.create([{
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
      rejectionReason: isWithinRadius ? null : "Outside geofence",
      deviceInfo,
      photoAttachment: punchInPhoto
    }], { session });

    // Create session
    const newSession = await SalesSession.create([{
      sessionId,
      salesPersonId,
      companyId,
      contactId,
      contactName: contact?.name,
      contactPhone: contact?.phone,
      contactEmail: contact?.email,
      contactDesignation: contact?.designation,
      contactPhoto: contact?.photo,
      status: "in_progress",
      isWithinRadius,
      distanceFromOffice: Math.round(distance),
      startTime: new Date(),
      routePath: [{
        type: "Point",
        coordinates: [location.longitude, location.latitude],
        timestamp: new Date(),
        accuracy: location.accuracy
      }],
      createdBy: salesPersonId,
      punchInPhoto
    }], { session });

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: "Punched in successfully",
      sessionId,
      session: newSession[0],
      punchEvent: punchEvent[0],
      isWithinRadius,
      distance: Math.round(distance),
      requiresFormCompletion: true
    });

  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

// ========== COMPLETE SALES FORM (After Punch In) ==========
export const completeSalesForm = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const {
      // Sales Details
      salesDetails,
      visitOutcome,
      remark,
      salesStatus,
      closureProbability,
      
 
      // Payment
      payment,
      
      // Next Meeting
      nextMeeting,
      
      // Attachments
      attachments,
      signature,
      
      // Contact Updates
      contactUpdates
    } = req.body;

    // Find session
    const session = await SalesSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status !== "in_progress") {
      return res.status(400).json({ error: "Session is not in progress" });
    }

    // Update contact info if provided
    if (contactUpdates && session.contactId) {
      await Contact.findByIdAndUpdate(session.contactId, {
        $set: {
          ...contactUpdates,
          lastVisitDate: new Date()
        },
        $inc: { totalVisits: 1 }
      });
    }

   

    // Create payment if provided
    let paymentDoc = null;
    if (payment && payment.amount > 0) {
      paymentDoc = await SalesPayment.create({
        sessionId: session._id,
        amount: payment.amount,
        currency: payment.currency || "INR",
        paymentMode: payment.paymentMode,
        transactionId: payment.transactionId,
        paymentDate: payment.paymentDate || new Date(),
        status: payment.status || "pending",
        notes: payment.notes,
        partialPayment: payment.amount < totalAmount,
        installments: payment.installments
      });
    }

    // Create next meeting if decided
    let nextMeetingDoc = null;
    if (nextMeeting && nextMeeting.isDecided) {
      nextMeetingDoc = await NextMeeting.create({
        sessionId: session._id,
        isDecided: true,
        meetingDate: nextMeeting.meetingDate,
        meetingTime: nextMeeting.meetingTime,
        agenda: nextMeeting.agenda,
        location: nextMeeting.location,
        meetingType: nextMeeting.meetingType,
        meetingLink: nextMeeting.meetingLink,
        notes: nextMeeting.notes,
        createdBy: session.salesPersonId
      });
    } else if (nextMeeting && !nextMeeting.isDecided) {
      nextMeetingDoc = await NextMeeting.create({
        sessionId: session._id,
        isDecided: false,
        notes: nextMeeting.notes || "Next meeting not decided",
        createdBy: session.salesPersonId
      });
    }

    // Update session with all data
    const updateData = {
      salesDetails,
      visitOutcome,
      remark,
      salesStatus,
      closureProbability,
      attachments,
      signature,
      totalAmount,
      amountReceived: payment?.amount || 0,
      pendingAmount: totalAmount - (payment?.amount || 0),
      lastModifiedBy: req.userId
    };

    if (paymentDoc) {
      updateData.paymentIds = [paymentDoc._id];
    }

    if (nextMeetingDoc) {
      updateData.nextMeetingId = nextMeetingDoc._id;
      if (nextMeeting?.meetingDate) {
        updateData.nextMeetingDate = nextMeeting.meetingDate;
      }
    }

    const updatedSession = await SalesSession.findOneAndUpdate(
      { sessionId },
      { $set: updateData },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Sales form completed successfully",
      session: updatedSession,
      payment: paymentDoc,
      nextMeeting: nextMeetingDoc
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========== PUNCH OUT ==========
export const punchOut = async (req, res) => {
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const {
      sessionId,
      location,
      officeLocation,
      geofenceRadius,
      punchOutPhoto,
      deviceInfo
    } = req.body;

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
    const punchEvent = await SalesPunchEvent.create([{
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
      rejectionReason: isWithinRadius ? null : "Outside geofence",
      deviceInfo,
      photoAttachment: punchOutPhoto
    }], { session: dbSession });

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

    // Add final distance
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
        punchOutPhoto,
        $push: {
          routePath: {
            type: "Point",
            coordinates: [location.longitude, location.latitude],
            timestamp: endTime,
            accuracy: location.accuracy
          }
        }
      },
      { new: true, session: dbSession }
    );

    await dbSession.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Punched out successfully",
      sessionId,
      session: updatedSession,
      punchEvent: punchEvent[0],
      duration: durationMinutes,
      totalDistance: Math.round(totalDistance)
    });

  } catch (error) {
    await dbSession.abortTransaction();
    res.status(500).json({ error: error.message });
  } finally {
    dbSession.endSession();
  }
};

// ========== GET SESSION WITH ALL DETAILS ==========
export const getFullSessionDetails = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await SalesSession.findOne({ sessionId })
      .populate("salesPersonId", "name email phone profilePic")
      .populate("companyId", "name location")
      .populate("contactId")
      .populate("paymentIds")
      .populate("nextMeetingId");

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const punchEvents = await SalesPunchEvent.find({ sessionId }).sort({ eventTime: 1 });

    res.status(200).json({
      success: true,
      session,
      punchEvents,
      timeline: {
        start: session.startTime,
        end: session.endTime,
        duration: session.duration,
        events: punchEvents
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


const getSessions = async (req, res) => {
    // Implementation from your original code
    try {
      const { salesPersonId, companyId, status, startDate, endDate, page = 1, limit = 10 } = req.query;
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
      res.status(200).json({ success: true, data: sessions, pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) } });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

// ========== UPDATE SESSION WITH ADDITIONAL DATA ==========
export const updateSessionData = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const updateData = req.body;

    const allowedUpdates = [
      "salesDetails", "visitOutcome", "remark", "salesStatus",
      "closureProbability", "attachments", "signature",
      "internalNotes", "nextMeetingDate"
    ];

    const filteredUpdate = {};
    allowedUpdates.forEach(field => {
      if (updateData[field] !== undefined) {
        filteredUpdate[field] = updateData[field];
      }
    });

    filteredUpdate.lastModifiedBy = req.userId;

    const updatedSession = await SalesSession.findOneAndUpdate(
      { sessionId },
      { $set: filteredUpdate },
      { new: true }
    );

    if (!updatedSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.status(200).json({
      success: true,
      message: "Session updated successfully",
      session: updatedSession
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

