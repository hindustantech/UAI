// routes/subscription.routes.js

import express from "express";
import { getAllSubscriptions } from "../../controllers/attandance/Subscriptions/subscription.controller.js";
import authMiddleware from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/admin/subscriptions", authMiddleware, getAllSubscriptions);

export default router;