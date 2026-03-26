// middlewares/subscriptionMiddleware.js
import { Subscription } from "../models/Attandance/subscration/Subscription.js";
import Employee from "../models/Attandance/Employee.js";
import mongoose from "mongoose";

/**
 * Middleware to check subscription limits for employee creation
 * This only checks, does NOT update the count
 */
export const checkEmployeeLimit = async (req, res, next) => {
    try {
        const companyId = req.user?._id || req.user?.id;
        
        if (!companyId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        // Find active subscription for the company
        const activeSubscription = await Subscription.findOne({
            company: companyId,
            status: { $in: ["ACTIVE", "PENDING"] },
            endDate: { $gt: new Date() },
            isActive: true
        });

        if (!activeSubscription) {
            return res.status(403).json({
                success: false,
                message: "No active subscription found. Please activate a subscription plan."
            });
        }

        // Get the employee limit from plan features
        const employeeLimitFeature = activeSubscription.planSnapshot?.features?.find(
            feature => feature.key === "maxEmployees"
        );

        const maxEmployees = employeeLimitFeature?.value || 0;

        if (maxEmployees === 0) {
            return res.status(403).json({
                success: false,
                message: "Your plan does not allow employee creation. Please upgrade your plan."
            });
        }

        // Get current active employee count
        const currentEmployeeCount = await Employee.countDocuments({
            companyId: companyId,
            employmentStatus: "active"
        });

        // Check if creating new employee would exceed limit
        if (currentEmployeeCount >= maxEmployees) {
            return res.status(403).json({
                success: false,
                message: `Employee limit exceeded. Your plan allows maximum ${maxEmployees} employees. Please upgrade your plan or remove inactive employees.`,
                currentCount: currentEmployeeCount,
                maxLimit: maxEmployees
            });
        }

        // Attach subscription info to request for use in controller
        req.subscriptionInfo = {
            subscriptionId: activeSubscription._id,
            maxEmployees,
            currentEmployeeCount,
            planName: activeSubscription.planSnapshot?.name
        };

        next();
        
    } catch (error) {
        console.error("Subscription check error:", error);
        return res.status(500).json({
            success: false,
            message: "Error checking subscription limits",
            error: error.message
        });
    }
};

/**
 * Middleware to update employee count AFTER successful creation
 * This should be called after the employee is created
 */
export const updateEmployeeCountAfterCreate = async (req, res, next) => {
    // Store the original res.json function
    const originalJson = res.json;
    
    // Override res.json to update count after sending response
    res.json = function(data) {
        // Only update if creation was successful
        if (data && data.success === true) {
            // Update count asynchronously (don't await to not block response)
            updateEmployeeCount(req.user?._id || req.user?.id)
                .catch(error => console.error("Error updating employee count:", error));
        }
        
        // Call the original json function
        originalJson.call(this, data);
    };
    
    next();
};

/**
 * Helper function to update employee count in subscription
 */
const updateEmployeeCount = async (companyId) => {
    try {
        const subscription = await Subscription.findOne({
            company: companyId,
            status: { $in: ["ACTIVE", "PENDING"] },
            endDate: { $gt: new Date() },
            isActive: true
        });

        if (subscription) {
            const employeeCount = await Employee.countDocuments({
                companyId: companyId,
                employmentStatus: "active"
            });

            await Subscription.updateOne(
                { _id: subscription._id },
                {
                    $set: {
                        "usage.employeesUsed": employeeCount
                    }
                }
            );
            
            console.log(`Updated employee count for company ${companyId}: ${employeeCount}`);
        }
    } catch (error) {
        console.error("Error updating employee count:", error);
    }
};

/**
 * Alternative: Update count in the controller after successful creation
 * This approach gives more control
 */
export const incrementEmployeeCount = async (companyId) => {
    try {
        const subscription = await Subscription.findOne({
            company: companyId,
            status: { $in: ["ACTIVE", "PENDING"] },
            endDate: { $gt: new Date() },
            isActive: true
        });

        if (subscription) {
            await Subscription.updateOne(
                { _id: subscription._id },
                {
                    $inc: {
                        "usage.employeesUsed": 1
                    }
                }
            );
            
            console.log(`Incremented employee count for company ${companyId}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error incrementing employee count:", error);
        return false;
    }
};

/**
 * Decrement employee count when employee is deleted/inactivated
 */
export const decrementEmployeeCount = async (companyId) => {
    try {
        const subscription = await Subscription.findOne({
            company: companyId,
            status: { $in: ["ACTIVE", "PENDING"] },
            endDate: { $gt: new Date() },
            isActive: true
        });

        if (subscription && subscription.usage.employeesUsed > 0) {
            await Subscription.updateOne(
                { _id: subscription._id },
                {
                    $inc: {
                        "usage.employeesUsed": -1
                    }
                }
            );
            
            console.log(`Decremented employee count for company ${companyId}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error decrementing employee count:", error);
        return false;
    }
};