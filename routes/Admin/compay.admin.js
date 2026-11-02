import express from "express";
import {
    getCompanyAttendanceDashboard
    , getAllPartners
    , getCompanyEmployees
    , getTodayAllCompaniesAttendance
} from "../../controllers/Admin/company.admin.js";
import authMiddleware from "../../middlewares/authMiddleware.js";
import { isSuperAdmin } from "../../middlewares/checkuser.js";
import {
    getCompaniesReport,
    exportCompaniesReportCSV,
    exportCompaniesReportExcel
} from "../../controllers/Admin/companyReport.controller.js";

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

router.get(
    "/report",
    authMiddleware,
    isSuperAdmin,
    getCompaniesReport
);

router.get(
    "/report/export/csv",
    authMiddleware,
    isSuperAdmin,
    exportCompaniesReportCSV
);

router.get(
    "/report/export/excel",
    authMiddleware,
    isSuperAdmin,
    exportCompaniesReportExcel
);

export default router;
