// routes/salary.routes.js
import express from "express";
import {
    calculateAll,
    calculateOne,
    calculateByEmployee,
    calculateByDepartment,
    exportExcel,
    exportSalarySlip,
    getRules,
    getSummary
} from "../controllers/Salary.controller.js";
import authMiddleware from "../middlewares/authMiddleware.js";
const router = express.Router();

// Apply authentication middleware
router.use(authMiddleware);

// Calculation routes
router.get("/calculate-all", calculateAll);                                    // GET /api/salary/calculate-all?month=6&year=2026&companyId=xxx&department=Engineering
router.post("/calculate", calculateOne);          // POST /api/salary/calculate
router.get("/calculate/:empCode", calculateByEmployee);                       // GET /api/salary/calculate/E001?month=6&year=2026
router.get("/calculate-by-department/:department", calculateByDepartment);    // GET /api/salary/calculate-by-department/Engineering?month=6&year=2026

// Export routes
router.get("/export", exportExcel);               // GET /api/salary/export?month=6&year=2026
router.get("/slip/:empCode", exportSalarySlip);                               // GET /api/salary/slip/E001?month=6&year=2026

// Information routes
router.get("/rules", getRules);                                               // GET /api/salary/rules?companyId=xxx
router.get("/summary", getSummary);    // GET /api/salary/summary?month=6&year=2026

export default router;