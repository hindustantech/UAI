import express from "express";
import { exportSalesReport ,exportSalesPersonReport} from "../../../controllers/attandance/Sales/SalesReoptExport.js";
import authMiddleware from "../../../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/export", authMiddleware, exportSalesReport);
router.get("/exportSalesPersonReport", authMiddleware, exportSalesPersonReport);


export default router;