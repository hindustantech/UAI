// routes/attendanceReportRoutes.js

import express from "express";
import AttendanceReportController from '../../controllers/attandance/attendanceReportController.js';
import authMiddleware from "../../middlewares/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Get monthly attendance report with filters
router.get(
    "/monthly",
    AttendanceReportController.getMonthlyReport
);

// Get monthly trend for last 12 months
router.get(
    "/trend",
    AttendanceReportController.getMonthlyTrend
);

// Get dashboard chart data
router.get(
    "/chart",
    AttendanceReportController.getDashboardChart
);

// Get daily breakdown
router.get(
    "/daily-breakdown",
    AttendanceReportController.getDailyBreakdown
);

// Export report to CSV
router.get(
    "/export",
    AttendanceReportController.exportReport
);

export default router;