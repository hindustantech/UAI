import { getCompanySubscriptionStatus } from '../controllers/payrollController.js'

// Attaches subscription status to req — use on any protected route
export async function requireActiveSubscription(req, res, next) {
    try {
        const companyId = req.user.type === "partner" ? req.user.id : req.user.companyId;

        const status = await getCompanySubscriptionStatus(companyId);

        if (!status.isActive) {
            return res.status(403).json({ success: false, message: "No active subscription." });
        }

        req.subscription = status; // available downstream as req.subscription
        next();
    } catch (err) {
        next(err);
    }
}

// Use AFTER requireActiveSubscription
export function requirePaidPlan(req, res, next) {
    if (req.subscription?.isFree) {
        return res.status(403).json({ success: false, message: "Upgrade required for this feature." });
    }
    next();
}