// routes/todayAttendanceRoutes.js

import express from "express";
import TodayAttendanceController from '../../controllers/attandance/todayAttendanceController.js';
import authMiddleware from "../../middlewares/authMiddleware.js";


const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Get today's attendance dashboard with pie chart
router.get(
    "/today/dashboard",

    TodayAttendanceController.getTodayDashboard
);

// Get employee's today attendance
router.get(
    "/today/employee/:employeeId",
    TodayAttendanceController.getEmployeeTodayAttendance
);

// Get date range dashboard
router.get(
    "/date-range/dashboard",

    TodayAttendanceController.getDateRangeDashboard
);

// Get attendance by department
router.get(
    "/today/by-department",

    TodayAttendanceController.getAttendanceByDepartment
);

export default router;