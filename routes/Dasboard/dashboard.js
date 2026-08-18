import express from "express";
import { getDashboardCompanyMonthlyAttendance } from "../../controllers/Dasboard/dashboard.js";
import authMiddleware from "../../middlewares/authMiddleware.js";
import { checkPermission } from "../../middlewares/checkPermission.js";

const router = express.Router();

router.get(
    "/getDashboardCompanyMonthlyAttendance",
    authMiddleware,
    checkPermission("attendance_summary.read"),
    getDashboardCompanyMonthlyAttendance
);

export default router;