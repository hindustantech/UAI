

import express from "express";
import {
  exportEmployeeMonthlyReport,
  exportCustomerTypeBreakdownReport,
  exportNewVsRepeatCustomerReport,
  exportPaymentRevenueReport,
  exportAppointmentsNextMonthReport,
  exportAttendanceFieldTimeReport
} from "../../../controllers/attandance/Sales/salesReports.controller.js";

const router = express.Router();

router.get("/reports/employee-monthly", exportEmployeeMonthlyReport);
router.get("/reports/customer-type-breakdown", exportCustomerTypeBreakdownReport);
router.get("/reports/new-vs-repeat-customers", exportNewVsRepeatCustomerReport);
router.get("/reports/payment-revenue", exportPaymentRevenueReport);
router.get("/reports/appointments-next-month", exportAppointmentsNextMonthReport);
router.get("/reports/attendance-field-time", exportAttendanceFieldTimeReport);

// Example: GET /reports/employee-monthly?companyId=64f...&startDate=2026-06-01&endDate=2026-06-30
export default router;

