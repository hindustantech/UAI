// services/featureAccess.service.js

/**
 * Check if company can create new employee based on subscription
 * @param {Object} subscription - The subscription object
 * @returns {boolean} - True if employee can be created
 */
export const canCreateEmployee = (subscription) => {
    if (!subscription) return false;
    
    // Check if subscription is active
    if (subscription.status !== "ACTIVE") return false;
    
    // Check if subscription is expired
    if (subscription.endDate < new Date()) return false;
    
    // Get employee limit from usage.maxEmployees
    const employeeLimit = subscription.usage?.maxEmployees || 0;
    const employeesUsed = subscription.usage?.employeesUsed || 0;
    
    return employeesUsed < employeeLimit;
};

/**
 * Check if subscription has access to DATA_SEE feature
 * @param {Object} subscription - The subscription object
 * @returns {boolean} - True if DATA_SEE is accessible
 */
export const hasDataSeeAccess = (subscription) => {
    if (!subscription) return false;
    if (subscription.status !== "ACTIVE") return false;
    if (subscription.endDate < new Date()) return false;
    
    return subscription.usage?.DATA_SEE === true;
};

/**
 * Check if subscription has access to DATA_EXPORT feature
 * @param {Object} subscription - The subscription object
 * @returns {boolean} - True if DATA_EXPORT is accessible
 */
export const hasDataExportAccess = (subscription) => {
    if (!subscription) return false;
    if (subscription.status !== "ACTIVE") return false;
    if (subscription.endDate < new Date()) return false;
    
    return subscription.usage?.DATA_EXPORT === true;
};

/**
 * Generic feature access check using schema fields
 * @param {Object} subscription - The subscription object
 * @param {string} featureKey - Feature key (DATA_SEE, DATA_EXPORT, etc.)
 * @returns {boolean} - True if feature is accessible
 */
export const hasFeatureAccess = (subscription, featureKey) => {
    if (!subscription) return false;
    if (subscription.status !== "ACTIVE") return false;
    if (subscription.endDate < new Date()) return false;
    
    // Handle specific features based on schema fields
    switch(featureKey) {
        case 'DATA_SEE':
            return subscription.usage?.DATA_SEE === true;
        case 'DATA_EXPORT':
            return subscription.usage?.DATA_EXPORT === true;
        case 'maxEmployees':
            // This is handled by canCreateEmployee separately
            return true;
        default:
            // For any other features, check if they exist in usage object
            return subscription.usage?.[featureKey] === true;
    }
};

/**
 * Get employee limit for the subscription
 * @param {Object} subscription - The subscription object
 * @returns {number} - Maximum employees allowed
 */
export const getEmployeeLimit = (subscription) => {
    if (!subscription) return 0;
    return subscription.usage?.maxEmployees || 0;
};

/**
 * Get current employee count
 * @param {Object} subscription - The subscription object
 * @returns {number} - Current employees used
 */
export const getCurrentEmployeeCount = (subscription) => {
    if (!subscription) return 0;
    return subscription.usage?.employeesUsed || 0;
};

/**
 * Check if subscription has remaining employee slots
 * @param {Object} subscription - The subscription object
 * @returns {number} - Remaining employee slots
 */
export const getRemainingEmployeeSlots = (subscription) => {
    if (!subscription) return 0;
    
    const limit = getEmployeeLimit(subscription);
    const used = getCurrentEmployeeCount(subscription);
    
    return Math.max(0, limit - used);
};

/**
 * Check if subscription is nearing employee limit (e.g., 80% used)
 * @param {Object} subscription - The subscription object
 * @param {number} threshold - Percentage threshold (default: 80)
 * @returns {boolean} - True if nearing limit
 */
export const isNearingEmployeeLimit = (subscription, threshold = 80) => {
    if (!subscription) return false;
    
    const limit = getEmployeeLimit(subscription);
    if (limit === 0) return true;
    
    const used = getCurrentEmployeeCount(subscription);
    const percentageUsed = (used / limit) * 100;
    
    return percentageUsed >= threshold;
};

/**
 * Get all accessible features as an object from schema fields
 * @param {Object} subscription - The subscription object
 * @returns {Object} - Object containing all features and their values
 */
export const getAllFeatures = (subscription) => {
    if (!subscription) return {};
    
    const features = {
        // Dedicated fields from usage
        DATA_SEE: subscription.usage?.DATA_SEE || false,
        DATA_EXPORT: subscription.usage?.DATA_EXPORT || false,
        MAX_EMPLOYEES: getEmployeeLimit(subscription),
        CURRENT_EMPLOYEES: getCurrentEmployeeCount(subscription),
        REMAINING_EMPLOYEES: getRemainingEmployeeSlots(subscription),
        
        // Plan info
        PLAN_NAME: subscription.planSnapshot?.name,
        PLAN_PRICE: subscription.planSnapshot?.finalPrice,
        VALIDITY_DAYS: subscription.planSnapshot?.validityDays,
        
        // Status
        IS_ACTIVE: subscription.status === "ACTIVE",
        AUTO_RENEW: subscription.autoRenew || false,
    };
    
    return features;
};

/**
 * Check if subscription can upgrade employees (has upgrade history)
 * @param {Object} subscription - The subscription object
 * @returns {boolean} - True if employee upgrade is possible
 */
export const canUpgradeEmployees = (subscription) => {
    if (!subscription) return false;
    
    // Check if subscription is active
    if (subscription.status !== "ACTIVE") return false;
    if (subscription.endDate < new Date()) return false;
    
    // Check if already at max limit
    const limit = getEmployeeLimit(subscription);
    const used = getCurrentEmployeeCount(subscription);
    
    return used >= limit && limit > 0;
};

/**
 * Get upgrade history for employees
 * @param {Object} subscription - The subscription object
 * @returns {Array} - Array of upgrade history entries
 */
export const getUpgradeHistory = (subscription) => {
    if (!subscription) return [];
    return subscription.usage?.upgradeHistory || [];
};

/**
 * Check subscription status and return detailed info
 * @param {Object} subscription - The subscription object
 * @returns {Object} - Detailed subscription status
 */
export const getSubscriptionStatus = (subscription) => {
    if (!subscription) {
        return {
            isValid: false,
            message: "No subscription found",
            status: "NONE",
            daysRemaining: 0
        };
    }
    
    const now = new Date();
    const isExpired = subscription.endDate < now;
    const isActive = subscription.status === "ACTIVE" && !isExpired;
    const daysRemaining = Math.ceil((subscription.endDate - now) / (1000 * 60 * 60 * 24));
    
    return {
        isValid: isActive,
        status: subscription.status,
        isExpired: isExpired || subscription.status === "EXPIRED",
        isActive: isActive,
        daysRemaining: Math.max(0, daysRemaining),
        planName: subscription.planSnapshot?.name,
        planPrice: subscription.planSnapshot?.finalPrice,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        autoRenew: subscription.autoRenew,
        message: isActive 
            ? `Subscription active for ${Math.max(0, daysRemaining)} more days`
            : `Subscription ${subscription.status.toLowerCase()}`
    };
};

/**
 * Validate subscription for API access
 * @param {Object} subscription - The subscription object
 * @returns {Object} - Validation result
 */
export const validateSubscription = (subscription) => {
    if (!subscription) {
        return {
            valid: false,
            error: "NO_SUBSCRIPTION",
            message: "No active subscription found"
        };
    }
    
    if (subscription.status !== "ACTIVE") {
        return {
            valid: false,
            error: "INACTIVE_SUBSCRIPTION",
            message: `Subscription is ${subscription.status.toLowerCase()}`,
            status: subscription.status
        };
    }
    
    const now = new Date();
    if (subscription.endDate < now) {
        return {
            valid: false,
            error: "EXPIRED_SUBSCRIPTION",
            message: "Subscription has expired",
            endDate: subscription.endDate,
            daysOverdue: Math.abs(Math.ceil((subscription.endDate - now) / (1000 * 60 * 60 * 24)))
        };
    }
    
    const daysRemaining = Math.ceil((subscription.endDate - now) / (1000 * 60 * 60 * 24));
    
    return {
        valid: true,
        message: "Subscription is active",
        daysRemaining: daysRemaining,
        planName: subscription.planSnapshot?.name,
        features: {
            dataSee: subscription.usage?.DATA_SEE || false,
            dataExport: subscription.usage?.DATA_EXPORT || false,
            maxEmployees: subscription.usage?.maxEmployees || 0,
            employeesUsed: subscription.usage?.employeesUsed || 0
        }
    };
};

/**
 * Increment employee count
 * @param {Object} subscription - The subscription object
 * @returns {Promise<Object>} - Updated subscription
 */
export const incrementEmployeeCount = async (subscription) => {
    if (!canCreateEmployee(subscription)) {
        throw new Error("Cannot create more employees. Limit reached.");
    }
    
    subscription.usage.employeesUsed += 1;
    await subscription.save();
    
    return subscription;
};

/**
 * Decrement employee count
 * @param {Object} subscription - The subscription object
 * @returns {Promise<Object>} - Updated subscription
 */
export const decrementEmployeeCount = async (subscription) => {
    if (subscription.usage.employeesUsed > 0) {
        subscription.usage.employeesUsed -= 1;
        await subscription.save();
    }
    
    return subscription;
};

/**
 * Check if subscription has specific plan type
 * @param {Object} subscription - The subscription object
 * @param {string} planType - Plan type (FREE, BASIC, STANDARD, PREMIUM, ENTERPRISE)
 * @returns {boolean} - True if subscription matches plan type
 */
export const hasPlanType = (subscription, planType) => {
    if (!subscription) return false;
    return subscription.planSnapshot?.name?.toUpperCase() === planType.toUpperCase();
};

/**
 * Get subscription expiry warning
 * @param {Object} subscription - The subscription object
 * @param {number} warningDays - Days before expiry to warn (default: 7)
 * @returns {Object} - Warning information
 */
export const getExpiryWarning = (subscription, warningDays = 7) => {
    const status = getSubscriptionStatus(subscription);
    
    if (!status.isActive) {
        return {
            showWarning: false,
            message: status.message
        };
    }
    
    const showWarning = status.daysRemaining <= warningDays;
    
    return {
        showWarning: showWarning,
        daysRemaining: status.daysRemaining,
        message: showWarning 
            ? `Your subscription will expire in ${status.daysRemaining} days. Please renew to continue using all features.`
            : `Subscription valid for ${status.daysRemaining} more days`,
        isExpiringSoon: showWarning
    };
};