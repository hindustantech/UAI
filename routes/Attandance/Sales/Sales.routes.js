// ============================================
// ROUTES
// ============================================

import express from "express";
import {
  punchIn,
  punchOut,
  getSessions,
  getSessionById,
  updateSession,
  deleteSession,
  getSessionsNearby,
  getGeofenceViolations,
  getSalesPersonMetrics,
  getCompanyAnalytics,
  createPayment,
  approvePayment,
  getPayments
} from "../../../controllers/attandance/Sales/Sales.js";
import authMiddleware from "../../../middlewares/authMiddleware.js";

const router = express.Router();



router.use(authMiddleware);

// ========== PUNCH IN / OUT ==========
router.post("/punch-in", punchIn);
router.post("/punch-out", punchOut);

// ========== SESSION CRUD ==========
router.get("/sessions", getSessions);
router.get("/sessions/:sessionId", getSessionById);
router.put("/sessions/:sessionId", updateSession);
router.delete("/sessions/:sessionId", deleteSession);

// ========== GEOLOCATION ==========
router.get("/sessions/nearby", getSessionsNearby);
router.get("/geofence-violations", getGeofenceViolations);

// ========== ANALYTICS ==========
router.get("/metrics/sales-person", getSalesPersonMetrics);
router.get("/analytics/company", getCompanyAnalytics);

// ========== PAYMENTS ==========
router.post("/payments", createPayment);
router.put("/payments/:paymentId/approve", approvePayment);
router.get("/payments", getPayments);

export default router;
