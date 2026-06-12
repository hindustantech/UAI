import express from "express";
import { BulkAssignSales, getCompanySalesRecords, getCompanySalesSummary, getSalesBySalesPerson } from "../../../controllers/attandance/Sales/salesController.js";
import authMiddleware from "../../../middlewares/authMiddleware.js";
import { checkPermission } from "../../../middlewares/checkPermission.js";
const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

router.get("/company/:companyId/records", getCompanySalesRecords);
router.get("/company/:companyId/summary", getCompanySalesSummary);
router.get("/company/:companyId/salesperson/:salesPersonId", getSalesBySalesPerson);
router.post("/BulkAssignSales", BulkAssignSales);

export default router;
