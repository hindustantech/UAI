import express from "express";

/* ===============================
   Controllers
================================ */

import {
    getCompanyByUser,
    createEmployee,
    findbyPhone,
    getAllEmployees,
    getEmpDetails,
    getEmpByUserId,
    findbyReferralCode,
    checkEmpButton,
    delteEmployee,
    updateEmployee,
    getLatestSubscription
} from "../../controllers/attandance/Employee.js";

/* ===============================
   Middlewares
================================ */
import authMiddleware from "../../middlewares/authMiddleware.js";
import { checkFeature } from "../../middlewares/checkFeature.js";
import { checkSubscription } from "../../middlewares/checkSubscription.js";
/* ===============================
   Router Init
================================ */

const router = express.Router();

/* ===============================
   ADMIN / HR ROUTES
================================ */

/**
 * Create Employee
 * POST /api/employees
 * Only: Admin / Partner / Super Admin
 */
router.post(
    "/",
    authMiddleware,
    checkSubscription,                // 🔐 must have active plan
    checkFeature("EMPLOYEE_CREATE"),  // 🔐 feature-level access
    createEmployee
);
router.get(
    "/latest-subscription",
    authMiddleware,
    getLatestSubscription
);

/**
 * Find User By Phone (Before Creating Employee)
 * POST /api/employees/find-by-phone
 */
router.post(
    "/find-by-phone-employee",
    authMiddleware,
    findbyPhone
);
router.post(
    "/find-by-Referral-Code",
    authMiddleware,
    findbyReferralCode
);
router.patch(
    "/updateEmployee/:employeeId",
    authMiddleware,
    updateEmployee
);

/**
 * Get All Employees (Paginated)
 * GET /api/employees
 */
router.get(
    "/",
    authMiddleware,
    getAllEmployees
);
router.get(
    "/getCompanyByUser/:userType",
    authMiddleware,
    getCompanyByUser
);
router.delete(
    "/delteEmployee/:empId",
    authMiddleware,
    delteEmployee
);
router.get(
    "/checkEmpButton",
    authMiddleware,
    checkEmpButton
);
router.get(
    "/",
    authMiddleware,
    getAllEmployees
);

/**
 * Get Employee Details By Employee ID
 * GET /api/employees/:empId
 */
router.get(
    "/:empId",
    authMiddleware,
    getEmpDetails
);

/* ===============================
   EMPLOYEE ROUTES
================================ */

/**
 * Get Own Employee Profile
 * GET /api/employees/me
 */
router.get(
    "/me/profile",
    authMiddleware,
    getEmpByUserId
);

export default router;
