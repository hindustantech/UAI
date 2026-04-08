import express from "express";

/* ===============================
   Controllers
================================ */

import {
    createHoliday,
    updateHoliday,
    deleteHoliday,
    getAllHolidays,
    getHolidayById,
    getAllEmpHolidays
} from "../../controllers/attandance/Holiday.js";


/* ===============================
   Middlewares
================================ */

import authMiddleware from "../../middlewares/authMiddleware.js";
import { checkPermission } from "../../middlewares/checkPermission.js";

/* ===============================
   Router Init
================================ */

const router = express.Router();

/* ===============================
   ADMIN / HR HOLIDAY ROUTES
================================ */

/**
 * Create Holiday
 * POST /api/holidays
 */
router.post(
    "/",
    authMiddleware,
    checkPermission('holiday.create'),
    createHoliday
);

/**
 * Update Holiday
 * PUT /api/holidays/:id
 */
router.put(
    "/:id",
    authMiddleware,
    checkPermission('holiday.update'),
    updateHoliday
);

/**
 * Delete Holiday
 * DELETE /api/holidays/:id
 */
router.delete(
    "/:id",
    authMiddleware,
    checkPermission('holiday.delete'),
    deleteHoliday
);

/**
 * Get All Holidays (Company Wise)
 * GET /api/holidays
 */
router.get(
    "/",
    authMiddleware,
    getAllHolidays
);
router.get(
    "/getAllEmpHolidays",
    authMiddleware,
    getAllEmpHolidays
);

/**
 * Get Single Holiday
 * GET /api/holidays/:id
 */
router.get(
    "/getHolidayById/:id",
    authMiddleware,
    getHolidayById
);

export default router;
