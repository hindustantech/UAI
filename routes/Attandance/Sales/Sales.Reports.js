import express from "express";
import { exportSalesReport } from "../../../controllers/attandance/Sales/SalesReoptExport.js";
import authMiddleware from "../../../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/export", authMiddleware, exportSalesReport);


export default router;