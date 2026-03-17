import express from "express";
import authMiddleware from "../../middlewares/authMiddleware.js";
import {
  createOrder,
  verifyPayment,
  getPaymentHistory,
  cancelSubscription,
  getActiveSubscription,
} from "../../controllers/attandance/Subscriptions/Payment.js";

const router = express.Router();

/**
 * ================================
 * USER ROUTES (Authenticated)
 * ================================
 */

// Create Razorpay Order
router.post(
  "/create-order",
  authMiddleware,
  createOrder
);

// Verify Payment (after frontend payment success)
router.post(
  "/verify",
  authMiddleware,
  verifyPayment
);

// Get Payment History (User)
router.get(
  "/history",
  authMiddleware,
  getPaymentHistory
);

// Get Active Subscription
router.get(
  "/active",
  authMiddleware,
  getActiveSubscription
);

// Cancel Subscription
router.post(
  "/cancel",
  authMiddleware,
  cancelSubscription
);


/**
 * ================================
 * ADMIN ROUTES (Optional)
 * ================================
 */

// Admin can view all subscriptions/payments
router.get(
  "/admin/all",
  authMiddleware,
  authMiddleware,
  getPaymentHistory
);

export default router;