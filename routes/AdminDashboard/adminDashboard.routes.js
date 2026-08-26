// routes/AdminDashboard/adminDashboard.routes.js
import express from "express";
import { getAdminDashboardStats } from "../../controllers/AdminDashboard/adminDashboard.controller.js";
import authMiddleware from "../../middlewares/authMiddleware.js";

const router = express.Router();

/**
 * GET /api/admin-dashboard/stats?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Main admin dashboard: KPIs + revenue/user-growth series +
 * recent users + recent audit logs. JWT required.
 */
router.get("/stats", authMiddleware, getAdminDashboardStats);

export default router;