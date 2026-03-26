// routes/attendanceRoutes.js

import express from "express";
import { generateAttendanceCSV, generateAttendanceMatrixCSV,generateAttendanceSummaryCSV } from "../../../controllers/attandance/Export/attendanceController.js";
import authMiddleware from "../../../middlewares/authMiddleware.js";

const router = express.Router();

// Generate attendance CSV reports
router.get(
    "/attendance/export/csv",
    authMiddleware,
    generateAttendanceCSV
);
router.get(
    "/generateAttendanceSummaryCSV",
    authMiddleware,
    generateAttendanceSummaryCSV
);

router.get(
    "/attendance/export/matrix-csv",
    authMiddleware,
    generateAttendanceMatrixCSV
);

export default router;