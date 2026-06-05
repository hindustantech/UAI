// middleware/checkSubscription.js

import { getActiveSubscription } from "../services/subscription.service.js";
import { Subscription } from "../models/Attandance/subscration/Subscription.js";
import Plan from '../models/Attandance/subscration/plan.js';

export const checkSubscription = async (req, res, next) => {
    try {
        let companyId;

        companyId = req.user._id || req.user?.id;
        const role = req.user?.role || req.user?.type;
        if (role === 'user') {
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




export const checkFreeSubscription = ({
    allowFreePlan = true,
    requirePaidPlan = false
} = {}) => {
    return async (req, res, next) => {
        try {
            const companyId = req.user._id;

            const subscription = await Subscription
                .findOne({
                    company: companyId,
                    isActive: true
                })
                .populate("plan")
                .sort({ endDate: -1 });

            if (!subscription) {
                return res.status(403).json({
                    success: false,
                    message: "No active subscription found"
                });
            }

            // Auto expire check
            if (
                subscription.status === "ACTIVE" &&
                subscription.endDate < new Date()
            ) {
                subscription.status = "EXPIRED";
                await subscription.save();

                return res.status(403).json({
                    success: false,
                    message: "Subscription expired"
                });
            }

            if (subscription.status !== "ACTIVE") {
                return res.status(403).json({
                    success: false,
                    message: `Subscription is ${subscription.status}`
                });
            }

            const plan = subscription.plan;

            if (!plan) {
                return res.status(403).json({
                    success: false,
                    message: "Plan not found"
                });
            }

            // Only paid plan allowed
            if (requirePaidPlan && plan.isfree) {
                return res.status(403).json({
                    success: false,
                    message: "Upgrade your plan to access this feature"
                });
            }

            // Free plan blocked
            if (!allowFreePlan && plan.isfree) {
                return res.status(403).json({
                    success: false,
                    message: "Free plan is not allowed"
                });
            }

            req.subscription = subscription;
            req.plan = plan;

            next();
        } catch (error) {
            console.error("Subscription Middleware Error:", error);

            return res.status(500).json({
                success: false,
                message: "Subscription validation failed"
            });
        }
    };
};