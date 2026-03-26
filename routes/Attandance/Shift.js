import express from "express";
import authMiddleware from "../../middlewares/authMiddleware.js";

// (Optional - enterprise permission layer)
// import checkPermission from "../../middlewares/checkPermission.js";

import {
    createShift,
    updateShift,
    deleteShift,
    getAllShifts,
    toggleNightShift,
    toggleOvertime,
    toggleWeeklyOff
} from "../../controllers/attandance/Shift.js";

const router = express.Router();

/**
 * ================================
 * 📦 SHIFT ROUTES
 * Base Path: /api/shifts
 * ================================
 */

/**
 * 🔹 Create Shift
 * POST /api/shifts
 */
router.post(
    "/",
    authMiddleware,
    createShift
);

/**
 * 🔹 Get All Shifts (Pagination + Search)
 * GET /api/shifts?page=1&limit=10&search=morning
 */
router.get(
    "/",
    authMiddleware,
    // checkPermission("shift.view"),
    getAllShifts
);

/**
 * 🔹 Update Shift
 * PUT /api/shifts/:id
 */
router.put(
    "/:id",
    authMiddleware,
    // checkPermission("shift.update"),
    updateShift
);

/**
 * 🔹 Delete Shift (Soft Delete)
 * DELETE /api/shifts/:id
 */
router.delete(
    "/:id",
    authMiddleware,
    // checkPermission("shift.delete"),
    deleteShift
);

/**
 * ================================
 * 🔁 TOGGLE ROUTES (Partial Updates)
 * ================================
 */

/**
 * 🔹 Toggle Night Shift
 * PATCH /api/shifts/:id/toggle-night
 */
router.patch(
    "/:id/toggle-night",
    authMiddleware,
    toggleNightShift
);

/**
 * 🔹 Toggle Overtime Allowed
 * PATCH /api/shifts/:id/toggle-overtime
 */
router.patch(
    "/:id/toggle-overtime",
    authMiddleware,
    toggleOvertime
);

/**
 * 🔹 Toggle Weekly Off
 * PATCH /api/shifts/:id/toggle-weekly-off
 * body: { "day": "Sunday" }
 */
router.patch(
    "/:id/toggle-weekly-off",
    authMiddleware,
    toggleWeeklyOff
);

export default router;