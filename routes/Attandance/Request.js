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
import optionalAuth from "../../middlewares/optionalAuth.js";
import { checkPermission } from "../../middlewares/checkPermission.js";
import authmiddleware from "../../middlewares/authMiddleware.js";
const router = express.Router();

// All routes are protected
router.post("/", authmiddleware, createAttendanceRequest);
router.get("/", optionalAuth, getAttendanceRequests);
router.use(optionalAuth );

/*
====================================
EMPLOYEE ROUTES
====================================
*/

// Create a new attendance request (leave/punch correction)

// Get all requests for logged-in user (with filters)

// Get request statistics for dashboard
router.get("/statistics", getRequestStatistics);

// Get single request by ID
router.get("/:requestId", getAttendanceRequestById);

// Cancel a pending request (only by the user who created it)
router.put("/:requestId/cancel/:companyId", cancelAttendanceRequest);

// Update a pending request
router.put("/:requestId/update/:companyId", updateAttendanceRequest);

/*
====================================
ADMIN/MANAGER ROUTES
====================================
*/

// Approve a request (admin/manager only)
router.put("/:requestId/approve", checkPermission('request.update'), approveAttendanceRequest);

// Reject a request (admin/manager only)
router.put("/:requestId/reject", checkPermission('request.update'), rejectAttendanceRequest);

// Bulk approve requests (admin only)
router.post("/bulk-approve", checkPermission('request.update'), bulkApproveRequests);

export default router;