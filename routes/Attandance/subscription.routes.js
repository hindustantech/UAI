// routes/subscription.routes.js

import express from "express";
import { getAllSubscriptions ,
    getCurrentActiveSubscription,
    getSubscriptionHistory,
    exportSubscriptions
} from "../../controllers/attandance/Subscriptions/subscription.controller.js";
import authMiddleware from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/admin/subscriptions", authMiddleware, getAllSubscriptions);
router.get("/admin/subscriptions/export", authMiddleware, exportSubscriptions);
router.get("/admin/getCurrentActiveSubscription", authMiddleware, getCurrentActiveSubscription);
router.get("/admin/getSubscriptionHistory", authMiddleware, getSubscriptionHistory);
// r    
export default router;