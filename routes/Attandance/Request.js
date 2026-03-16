// routes/attendanceRequestRoutes.js
import express from "express";
import {
    createAttendanceRequest,
    getAttendanceRequests,
    getAttendanceRequestById,
    approveAttendanceRequest,
    rejectAttendanceRequest,
    cancelAttendanceRequest,
    updateAttendanceRequest,
    bulkApproveRequests,
    getRequestStatistics
} from "../../controllers/attandance/Request.js";
import authMiddleware from "../../middlewares/authMiddleware.js";

const router = express.Router();

// All routes are protected
router.use(authMiddleware  );

/*
====================================
EMPLOYEE ROUTES
====================================
*/

// Create a new attendance request (leave/punch correction)
router.post("/", createAttendanceRequest);

// Get all requests for logged-in user (with filters)
router.get("/", getAttendanceRequests);

// Get request statistics for dashboard
router.get("/statistics", getRequestStatistics);

// Get single request by ID
router.get("/:requestId", getAttendanceRequestById);

// Cancel a pending request (only by the user who created it)
router.put("/:requestId/cancel", cancelAttendanceRequest);

// Update a pending request
router.put("/:requestId", updateAttendanceRequest);

/*
====================================
ADMIN/MANAGER ROUTES
====================================
*/

// Approve a request (admin/manager only)
router.put("/:requestId/approve",  approveAttendanceRequest);

// Reject a request (admin/manager only)
router.put("/:requestId/reject",  rejectAttendanceRequest);

// Bulk approve requests (admin only)
router.post("/bulk-approve",  bulkApproveRequests);

export default router;