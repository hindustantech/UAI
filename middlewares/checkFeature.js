// middleware/checkFeature.js

import { hasFeatureAccess } from "../services/featureAccess.service.js";

export const checkFeature = (featureKey) => {
    return (req, res, next) => {
        const subscription = req.subscription;

        if (!hasFeatureAccess(subscription, featureKey)) {
            return res.status(403).json({
                success: false,
                message: `Feature '${featureKey}' not available in your plan`
            });
        }

        next();
    };
};