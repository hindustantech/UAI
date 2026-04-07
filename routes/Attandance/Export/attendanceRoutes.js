// routes/attendanceRoutes.js

import express from "express";
import { generateAttendanceCSV, generateAttendanceMatrixCSV,generateAttendanceSummaryCSV } from "../../../controllers/attandance/Export/attendanceController.js";
import authMiddleware from "../../../middlewares/authMiddleware.js";
import { checkPermission } from "../../../middlewares/checkPermission.js";

const router = express.Router();

// Generate attendance CSV reports
router.get(
    "/attendance/export/csv",
    authMiddleware,
    checkPermission('attendance.export'),
    generateAttendanceCSV
);
router.get(
    "/generateAttendanceSummaryCSV",
    authMiddleware,
    checkPermission('attendance_summary.export'),
    generateAttendanceSummaryCSV
);

router.get(
    "/attendance/export/matrix-csv",
    authMiddleware,
    checkPermission('attendance_matrix.export'),
    generateAttendanceMatrixCSV
);

export default router;