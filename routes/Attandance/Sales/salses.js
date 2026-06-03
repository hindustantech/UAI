import express from "express";
import { getCompanySalesRecords, getCompanySalesSummary, getSalesBySalesPerson } from "../../../controllers/attandance/Sales/salesController.js";
import authMiddleware from "../../../middlewares/authMiddleware.js";
import { checkPermission } from "../../../middlewares/checkPermission.js";
const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

router.get("/company/:companyId/records", checkPermission('sales.view'), getCompanySalesRecords);
router.get("/company/:companyId/summary", checkPermission('sales.view'), getCompanySalesSummary);
router.get("/company/:companyId/salesperson/:salesPersonId", checkPermission('sales.view'), getSalesBySalesPerson);

export default router;
