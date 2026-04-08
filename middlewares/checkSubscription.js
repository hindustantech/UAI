// middleware/checkSubscription.js

import { getActiveSubscription } from "../services/subscription.service.js";

export const checkSubscription = async (req, res, next) => {
    try {
        let companyId;

        companyId = req.user._id || req.user?.id;
        if (req.user?.role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }

        const subscription = await getActiveSubscription(companyId);

        if (!subscription) {
            return res.status(403).json({
                success: false,
                message: "No active subscription. Please upgrade your plan."
            });
        }

        req.subscription = subscription;

        next();
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Subscription validation failed",
            error: error.message
        });
    }
};