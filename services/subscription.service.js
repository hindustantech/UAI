// services/subscription.service.js
import { Subscription } from "../models/Attandance/subscration/Subscription.js";

export const getActiveSubscription = async (companyId) => {
    return await Subscription.findOne({
        company: companyId,
        status: "ACTIVE",
        isActive: true,
        endDate: { $gte: new Date() }
    }).lean();
};