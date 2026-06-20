import express from "express";
import { exportSalesReport, exportSalesPersonReport, exportDataSalesCSV, exportCrmReport, exportSalesPersonExitReport } from "../../../controllers/attandance/Sales/SalesReoptExport.js";
import authMiddleware from "../../../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/export", authMiddleware, exportSalesReport);
router.get("/exportSalesPersonReport", authMiddleware, exportSalesPersonReport);
router.get("/exportDataSalesCSV", authMiddleware, exportDataSalesCSV);
router.get("/crm", authMiddleware, exportCrmReport);

// GET /api/reports/sales-person-exit?personId=<id>&startDate=&endDate=
router.get("/sales-person-exit", authMiddleware, exportSalesPersonExitReport);


export default router;