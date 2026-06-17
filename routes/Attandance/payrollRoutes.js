// routes/payrollRoutes.js

import express from "express";
import {
    generatePayroll,
    generateBulkPayroll,
    getEmployeePayroll,
    getCompanyPayroll,
    updatePayrollStatus,
    downloadCompanyExcel,
    downloadSalarySlipPDF
} from "../../controllers/payrollController.js";


import authMiddleware from "../../middlewares/authMiddleware.js";

const router = express.Router();

/* ─────────────────────────────────────────────────────────────
   All payroll routes require authentication
───────────────────────────────────────────────────────────── */
router.use(authMiddleware);


/* ─────────────────────────────────────────────────────────────
   GENERATION
───────────────────────────────────────────────────────────── */

/**
 * POST /api/payroll/generate
 * Generate & save payroll for a single employee
 * Body: { employeeId, month, year, payDate?, overrideAttendance? }
 * Role: admin | hr
 */
router.post(
    "/generate",
    authMiddleware,
    generatePayroll
);

/**
 * POST /api/payroll/generate-bulk
 * Generate payroll for ALL active employees of the company
 * Body: { month, year, payDate? }
 * Role: admin | super_admin
 */
router.post(
    "/generate-bulk",
    authMiddleware,
    generateBulkPayroll
);


/* ─────────────────────────────────────────────────────────────
   READ
───────────────────────────────────────────────────────────── */

/**
 * GET /api/payroll/company
 * All employees payroll for a company in a given month
 * Query: month, year, department?, status?, page?, limit?
 * Role: admin | hr | super_admin
 */
router.get(
    "/company",
    authMiddleware,
    getCompanyPayroll
);

/**
 * GET /api/payroll/employee/:employeeId
 * Single employee's payroll history or specific month
 * Query: month?, year?, page?, limit?
 * Role: admin | hr | employee (own record) | super_admin
 */
router.get(
    "/employee/:employeeId",
    authMiddleware,
    getEmployeePayroll
);


/* ─────────────────────────────────────────────────────────────
   STATUS UPDATE
───────────────────────────────────────────────────────────── */

/**
 * PATCH /api/payroll/:payrollId/status
 * Approve / Mark Paid / Cancel a payroll record
 * Body: { status: "approved"|"paid"|"cancelled", remarks? }
 * Role: admin | super_admin
 */
router.patch(
    "/:payrollId/status",
    authMiddleware,
    updatePayrollStatus
);


/* ─────────────────────────────────────────────────────────────
   DOWNLOADS
───────────────────────────────────────────────────────────── */

/**
 * GET /api/payroll/download/excel
 * Download company-wide payroll register as Excel
 * Query: month, year
 * Role: admin | hr | super_admin
 */
router.get(
    "/download/excel",
    authMiddleware,
    downloadCompanyExcel
);

/**
 * GET /api/payroll/download/pdf/:payrollId
 * Download individual salary slip PDF
 * Role: admin | hr | employee (own) | super_admin
 */
router.get(
    "/download/pdf/:payrollId",
    authMiddleware,
    downloadSalarySlipPDF
);


export default router;
