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

const router = express.Router();

// All routes are protected
router.post("/", optionalAuth, createAttendanceRequest);
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

const APPROVAL_ROLES = ['super_admin', 'admin', 'manager','hr']; // Roles allowed to approve/reject requests

// Approve a request (admin/manager/permitted employee only)
router.put("/:requestId/approve", checkPermission('request.update', { allowRoles: APPROVAL_ROLES }), approveAttendanceRequest);

// Reject a request (admin/manager/permitted employee only)
router.put("/:requestId/reject", checkPermission('request.update', { allowRoles: APPROVAL_ROLES }), rejectAttendanceRequest);

// Bulk approve requests (admin/manager/permitted employee only)
router.post("/bulk-approve", checkPermission('request.update', { allowRoles: APPROVAL_ROLES }), bulkApproveRequests);

export default router;
