import { Subscription } from "../../models/Attandance/subscration/Subscription.js";
import User from '../../models/userModel.js'


export const checkLimit = async (req, res, next) => {
    try {
        let companyId;
        
        if (req.user.type === 'user') {
            companyId = req.user.companyId || req.user.createdBy;
        } else {
            companyId = req.user._id;
        }

        // Find active subscription
        const subscription = await Subscription.findOne({ 
            company: companyId, 
            isActive: true,
            status: "ACTIVE",
            endDate: { $gt: new Date() }
        }).sort({ createdAt: -1 });

        if (!subscription) {    
            return res.status(403).json({
                success: false,
                message: "No active subscription found. Please subscribe to a plan."
            });
        }

        // Calculate total users created from all categories
        const usage = subscription.usage || {};
        const totalUserCreated = (usage.new_users_created || 0) + 
                                (usage.employeesUsed || 0) + 
                                (usage.no_of_sales_person_employeesUsed || 0) + 
                                (usage.no_of_pro_sales_person_employeesUsed || 0);
        
        const maxEmployees = usage.maxEmployees || 0;

        // Check if total users reached the limit
        if (totalUserCreated >= maxEmployees) {
            return res.status(403).json({
                success: false,
                message: "User limit reached. Please upgrade your subscription to add more users.",
                totalUsers: totalUserCreated,
                maxLimit: maxEmployees
            });
        }

        // Attach subscription to request for later usage update
        req.subscription = subscription;
        req.totalUserCreated = totalUserCreated;
        
        next();
    } catch (error) {
        console.error("Error in checkLimit middleware:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error in checkLimit middleware",
            error: error.message
        });
    }
};

// After user creation, increment the count
export const incrementUserCount = async (req, res, next) => {
    try {
        if (req.subscription) {
            await Subscription.findByIdAndUpdate(
                req.subscription._id,
                { $inc: { 'usage.new_users_created': 1 } }
            );
        }
        next();
    } catch (error) {
        console.error("Error incrementing user count:", error);
        next(error);
    }
};
