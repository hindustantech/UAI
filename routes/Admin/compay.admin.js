import express from "express";
import {
    getCompanyAttendanceDashboard
    , getAllPartners
    , getCompanyEmployees
    , getTodayAllCompaniesAttendance
} from "../../controllers/Admin/company.admin.js";
import authMiddleware from "../../middlewares/authMiddleware.js";

const router = express.Router();
router.get(
    "/attendance-dashboard",
    authMiddleware,
    getCompanyAttendanceDashboard
);
router.get(
    "/all-partners",
    authMiddleware,
    getAllPartners
);
router.get(
    "/employees",
    authMiddleware,
    getCompanyEmployees
);
router.get(
    "/today-attendance",
    authMiddleware,
    getTodayAllCompaniesAttendance
);

export default router;
