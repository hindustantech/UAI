// routes/salesRoutes.js
import express from "express";

import {
  punchIn,
  completeSalesForm,
  punchOut,
  getFullSessionDetails,
  updateSessionData,
  // getSessions
} from "../../../controllers/attandance/Sales/Sales.js";

// Import auth middleware (adjust based on your auth setup)
import authMiddleware from "../../../middlewares/authMiddleware.js";

const router = express.Router();

// ============================================
// SESSION MANAGEMENT ROUTES
// ============================================

/**
 * @route   POST /api/sales/punch-in
 * @desc    Punch in to start a sales session
 * @access  Private (Sales Person)
 * @body    { salesPersonId, companyId, contactId, location, officeLocation, geofenceRadius, deviceInfo, punchInPhoto }
 */
router.post("/punch-in", authMiddleware, punchIn);

/**
 * @route   POST /api/sales/session/:sessionId/complete-form
 * @desc    Complete the sales form after punch in
 * @access  Private
 * @body    { salesDetails, visitOutcome, remark, salesStatus, productsSold, payment, nextMeeting, attachments, signature, contactUpdates }
 */
router.post("/session/:sessionId/complete-form", authMiddleware, completeSalesForm);

/**
 * @route   POST /api/sales/punch-out
 * @desc    Punch out to end a sales session
 * @access  Private
 * @body    { sessionId, location, officeLocation, geofenceRadius, punchOutPhoto, deviceInfo }
 */
router.post("/punch-out", authMiddleware, punchOut);


/**
 * @route   GET /api/sales/session/:sessionId/full
 * @desc    Get full session details with timeline, payments, next meeting
 * @access  Private
 */
router.get("/session/:sessionId/full", authMiddleware, getFullSessionDetails);

/**
 * @route   PATCH /api/sales/session/:sessionId
 * @desc    Update session with additional data (sales details, products, etc.)
 * @access  Private
 */
router.patch("/session/:sessionId", authMiddleware, updateSessionData);

/** 
 * @route   GET /api/sales/sessions
 *  @desc    Get paginated list of sales sessions with filters    
 *  @access  Private  
 * @query   { salesPersonId, companyId, status, startDate, endDate, page, limit }
 * */
// router.get("/sessions", authMiddleware, getSessions);


export default router;