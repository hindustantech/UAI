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
    createHoliday
);

/**
 * Update Holiday
 * PUT /api/holidays/:id
 */
router.put(
    "/:id",
    authMiddleware,
    updateHoliday
);

/**
 * Delete Holiday
 * DELETE /api/holidays/:id
 */
router.delete(
    "/:id",
    authMiddleware,
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
    "/:id",
    authMiddleware,
    getHolidayById
);

export default router;
