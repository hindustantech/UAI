// routes/todayAttendanceRoutes.js

import express from "express";
import TodayAttendanceController from '../../controllers/attandance/todayAttendanceController.js';
import authMiddleware from "../../middlewares/authMiddleware.js";
import { checkPermission } from "../../middlewares/checkPermission.js";


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

// Export today's attendance as XLSX (all employees, optional department filter)
router.get(
    "/today/export",
    checkPermission('attendance.export'),
    TodayAttendanceController.exportTodayAttendance
);

// Get department list for filter dropdown
router.get(
    "/today/departments",

    TodayAttendanceController.getDepartmentList
);

export default router;