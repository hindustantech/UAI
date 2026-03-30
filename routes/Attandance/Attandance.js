import express from "express";

/* ===============================
   Controllers
================================ */


import {
    markAttendance,
    getAttendance,
    getMonthlySummary,
    getTodayAttendance,
    getDailyAttendance,
    getRangeSummary,
    exportAttendanceCSV,
    getEmployeeAttendanceSummary,
    getEmployeeSimpleMonthlySummary,
    getCompanyTodayAttendance,
    debugAttendanceData,
    exportCompanyAttendanceToExcel,
    getAttendanceExport,
    exportAttendanceAsExcel,
    exportAttendanceAsCSV,
    getTodayPunchStatus,
    getAttendanceSummary
} from "../../controllers/attandance/Attandance.js";
/* ===============================
   Middlewares
================================ */
import authMiddleware from "../../middlewares/authMiddleware.js";

/* ===============================
   Router Init
================================ */

const router = express.Router();

/* ===============================
   EMPLOYEE ROUTES
================================ */

/**
 * Mark Punch In / Punch Out
 * POST /api/attendance/mark
 */
router.post(
    "/mark",
    authMiddleware,
    markAttendance
);

/**
 * Get Monthly Attendance
 * GET /api/attendance/monthly
 */
router.get(
    "/monthly",
    authMiddleware,
    getAttendance
);
router.get(
    "/getAttendanceSummary/:companyId",
    authMiddleware,
    getAttendanceSummary
);
router.get(
    "/getTodayPunchStatus",
    authMiddleware,
    getTodayPunchStatus
);
router.get(
    "/getAttendanceExport",
    authMiddleware,
    getAttendanceExport
);


router.get(
    "/exportAttendanceAsCSV",
    authMiddleware,
    exportAttendanceAsCSV
);
router.get(
    "/exportAttendanceAsExcel",
    authMiddleware,
    exportAttendanceAsExcel
);

router.get(
    "/employee-monthly-cards",
    authMiddleware,
    getEmployeeSimpleMonthlySummary
);
router.get(
    "/exportCompanyAttendanceToExcel",
    authMiddleware,
    exportCompanyAttendanceToExcel
);
router.get(
    "/debugAttendanceData",
    authMiddleware,
    debugAttendanceData
);

router.get(
    "/company-today",
    authMiddleware,
    getCompanyTodayAttendance
);

/**
 * Get Monthly Salary Summary
 * GET /api/attendance/summary
 */
router.get(
    "/summary",
    authMiddleware,
    getMonthlySummary
);
router.get(
    "/employee-summary",
    authMiddleware,
    getEmployeeAttendanceSummary
);


/**
 * Get Today Attendance
 * GET /api/attendance/today
 */
router.get(
    "/today",
    authMiddleware,
    getTodayAttendance
);

/**
 * Get Attendance By Date
 * GET /api/attendance/daily
 */
router.get(
    "/daily",
    authMiddleware,
    getDailyAttendance
);

/**
 * Get Custom Range Summary
 * GET /api/attendance/range
 */
router.get(
    "/range",
    authMiddleware,
    getRangeSummary
);

/* ===============================
   ADMIN / HR ROUTES
================================ */

/**
 * Export Attendance CSV
 * GET /api/attendance/export
 */
router.get(
    "/export",
    authMiddleware,
    exportAttendanceCSV
);

export default router;
