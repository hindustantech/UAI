import express from "express";

import {
    createCustomPlanOrder,
    verifyPayment,
    previewCustomPlan,
} from "../controllers/attandance/Subscriptions/orderController.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const router = express.Router();

// Public route - preview pricing
router.post("/preview-custom-plan", previewCustomPlan);

// Protected routes
router.post("/create-custom-plan", authMiddleware, createCustomPlanOrder);
router.post("/verify-payment", authMiddleware, verifyPayment);

export default router;