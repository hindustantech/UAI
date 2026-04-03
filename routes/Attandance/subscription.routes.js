// routes/subscription.routes.js

import express from "express";
import { getAllSubscriptions ,
    getCurrentActiveSubscription,
    getSubscriptionHistory
} from "../../controllers/attandance/Subscriptions/subscription.controller.js";
import authMiddleware from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/admin/subscriptions", authMiddleware, getAllSubscriptions);
router.get("/admin/getCurrentActiveSubscription", authMiddleware, getCurrentActiveSubscription);
router.get("/admin/getSubscriptionHistory", authMiddleware, getSubscriptionHistory);
    
export default router;