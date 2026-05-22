// services/featureAccess.service.js


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
    switch (featureKey) {
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


















// services/featureAccess.service.js
// ✅ TYPE-AWARE Feature Service for SaaS Subscription Management

/**
 * Get employee limit based on type
 * @param {Object} subscription - The subscription object
 * @param {string} employeeType - "sales", "pro_sales", or "non_sales"
 * @returns {number} - Maximum employees allowed for this type
 */
export const getEmployeeLimit = (subscription, employeeType = "non_sales") => {
    if (!subscription || !subscription.usage) return 0;

    const usage = subscription.usage;

    switch (employeeType) {
        case "sales":
            return usage.no_of_sales_person_maxEmployees || 0;
        case "pro_sales":
            return usage.no_of_pro_sales_person_maxEmployees || 0;
        default: // non_sales
            return usage.maxEmployees || 0;
    }
};

/**
 * Get current employee count for a specific type
 * @param {Object} subscription - The subscription object
 * @param {string} employeeType - "sales", "pro_sales", or "non_sales"
 * @returns {number} - Current employees of this type
 */
export const getCurrentEmployeeCount = (subscription, employeeType = "non_sales") => {
    console.log("238 :Subscription object in getCurrentEmployeeCount:", subscription);
    if (!subscription || !subscription.usage) return 0;

    const usage = subscription.usage;
    console.log("242 : Usage object in getCurrentEmployeeCount:", usage);
    console.log("244 : Employee type requested:", employeeType);

    switch (employeeType) {
        case "sales":
            return usage.no_of_sales_person_employeesUsed || 0;
            console.log("246 : Sales employee count:", usage.no_of_sales_person_employeesUsed || 0);
        case "pro_sales":
            return usage.no_of_pro_sales_person_employeesUsed || 0;
            console.log("248 : Pro Sales employee count:", usage.no_of_pro_sales_person_employeesUsed || 0);    
        default: // non_sales (derived)
            const total = usage.employeesUsed || 0;
            const sales = usage.no_of_sales_person_employeesUsed || 0;
            const proSales = usage.no_of_pro_sales_person_employeesUsed || 0;
            console.log("252 : Non-sales employee count calculated:", Math.max(0, total - sales - proSales));
            return Math.max(0, total - sales - proSales);
    }
};

/**
 * Get total employees across all types
 * @param {Object} subscription - The subscription object
 * @returns {number} - Total employees
 */
export const getTotalEmployeeCount = (subscription) => {
    if (!subscription || !subscription.usage) return 0;
    return subscription.usage.employeesUsed || 0;
};

/**
 * Get breakdown of employees by type
 * @param {Object} subscription - The subscription object
 * @returns {Object} - { total, sales, proSales, nonSales }
 */
export const getEmployeeBreakdown = (subscription) => {
    if (!subscription || !subscription.usage) {
        return {
            total: 0,
            sales: 0,
            proSales: 0,
            nonSales: 0
        };
    }

    const usage = subscription.usage;
    const total = usage.employeesUsed || 0;
    const sales = usage.no_of_sales_person_employeesUsed || 0;
    const proSales = usage.no_of_pro_sales_person_employeesUsed || 0;
    const nonSales = Math.max(0, total - sales - proSales);

    return {
        total,
        sales,
        proSales,
        nonSales
    };
};

/**
 * Get remaining slots for a specific employee type
 * @param {Object} subscription - The subscription object
 * @param {string} employeeType - "sales", "pro_sales", or "non_sales"
 * @returns {number} - Remaining employee slots
 */
export const getRemainingEmployeeSlots = (subscription, employeeType = "non_sales") => {
    const limit = getEmployeeLimit(subscription, employeeType);
    const used = getCurrentEmployeeCount(subscription, employeeType);
    return Math.max(0, limit - used);
};

/**
 * Check if can create employee of specific type
 * ✅ MAIN VALIDATION - use this in controllers
 * @param {Object} subscription - The subscription object
 * @param {string} employeeType - "sales", "pro_sales", or "non_sales"
 * @returns {Object} - { canCreate: boolean, remaining: number, limit: number, message: string }
 */
export const canCreateEmployee = (subscription, employeeType = "non_sales") => {
    if (!subscription) {
        return {
            canCreate: false,
            remaining: 0,
            limit: 0,
            message: "No subscription found"
        };
    }

    // Check subscription status
    if (subscription.status !== "ACTIVE") {
        return {
            canCreate: false,
            remaining: 0,
            limit: 0,
            message: `Subscription is ${subscription.status.toLowerCase()}`
        };
    }

    // Check expiry
    if (subscription.endDate < new Date()) {
        return {
            canCreate: false,
            remaining: 0,
            limit: 0,
            message: "Subscription has expired"
        };
    }

    const limit = getEmployeeLimit(subscription, employeeType);
    const remaining = getRemainingEmployeeSlots(subscription, employeeType);

    if (limit === 0) {
        return {
            canCreate: false,
            remaining: 0,
            limit: 0,
            message: `No ${employeeType} employee slots in your plan`
        };
    }

    if (remaining <= 0) {
        return {
            canCreate: false,
            remaining: 0,
            limit,
            message: `${employeeType} employee limit reached. Upgrade to add more.`
        };
    }

    return {
        canCreate: true,
        remaining,
        limit,
        message: "Can create employee"
    };
};

/**
 * Check if nearing employee limit for warning
 * @param {Object} subscription - The subscription object
 * @param {string} employeeType - "sales", "pro_sales", or "non_sales"
 * @param {number} threshold - Percentage threshold (default: 80)
 * @returns {Object} - { isNearing: boolean, percentage: number, remaining: number }
 */
export const isNearingEmployeeLimit = (subscription, employeeType = "non_sales", threshold = 80) => {
    if (!subscription || !subscription.usage) {
        return {
            isNearing: false,
            percentage: 0,
            remaining: 0
        };
    }

    const limit = getEmployeeLimit(subscription, employeeType);
    if (limit === 0) return { isNearing: true, percentage: 100, remaining: 0 };

    const used = getCurrentEmployeeCount(subscription, employeeType);
    const percentage = (used / limit) * 100;
    const remaining = Math.max(0, limit - used);

    return {
        isNearing: percentage >= threshold,
        percentage: Math.round(percentage),
        remaining
    };
};

/**
 * Get all limits and usage for dashboard display
 * @param {Object} subscription - The subscription object
 * @returns {Object} - Complete quota summary
 */
export const getQuotaSummary = (subscription) => {
    if (!subscription || !subscription.usage) {
        return {
            valid: false,
            message: "No subscription"
        };
    }

    const usage = subscription.usage;
    const total = usage.employeesUsed || 0;
    const sales = usage.no_of_sales_person_employeesUsed || 0;
    const proSales = usage.no_of_pro_sales_person_employeesUsed || 0;
    const nonSales = Math.max(0, total - sales - proSales);

    const salesLimit = usage.no_of_sales_person_maxEmployees || 0;
    const proSalesLimit = usage.no_of_pro_sales_person_maxEmployees || 0;
    const nonSalesLimit = usage.maxEmployees || 0;

    return {
        valid: subscription.status === "ACTIVE" && subscription.endDate >= new Date(),
        total: {
            used: total,
            limit: total,
            remaining: 0 // total is derived, always 0 remaining
        },
        sales: {
            used: sales,
            limit: salesLimit,
            remaining: Math.max(0, salesLimit - sales),
            percentage: salesLimit > 0 ? Math.round((sales / salesLimit) * 100) : 0
        },
        proSales: {
            used: proSales,
            limit: proSalesLimit,
            remaining: Math.max(0, proSalesLimit - proSales),
            percentage: proSalesLimit > 0 ? Math.round((proSales / proSalesLimit) * 100) : 0
        },
        nonSales: {
            used: nonSales,
            limit: nonSalesLimit,
            remaining: Math.max(0, nonSalesLimit - nonSales),
            percentage: nonSalesLimit > 0 ? Math.round((nonSales / nonSalesLimit) * 100) : 0
        },
        warnings: {
            salesNearing: (sales / salesLimit) * 100 >= 80 && salesLimit > 0,
            proSalesNearing: (proSales / proSalesLimit) * 100 >= 80 && proSalesLimit > 0,
            nonSalesNearing: (nonSales / nonSalesLimit) * 100 >= 80 && nonSalesLimit > 0
        }
    };
};

/**
 * Validate subscription for API access (generic)
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
        daysRemaining,
        planName: subscription.planSnapshot?.name,
        features: {
            dataSee: subscription.usage?.DATA_SEE || false,
            dataExport: subscription.usage?.DATA_EXPORT || false
        }
    };
};



/**
 * Get upgrade history for specific type
 * @param {Object} subscription - The subscription object
 * @param {string} employeeType - "sales", "pro_sales", or "non_sales"
 * @returns {Array} - Upgrade history
 */
export const getUpgradeHistory = (subscription, employeeType = null) => {
    if (!subscription || !subscription.usage?.upgradeHistory) return [];

    const history = subscription.usage.upgradeHistory || [];

    if (!employeeType) return history;

    return history.filter(h => h.employeeType === employeeType);
};

/**
 * Calculate remaining days in subscription
 * @param {Object} subscription - The subscription object
 * @returns {number} - Days remaining
 */
export const getDaysRemaining = (subscription) => {
    if (!subscription) return 0;

    const now = new Date();
    const remaining = Math.ceil((subscription.endDate - now) / (1000 * 60 * 60 * 24));

    return Math.max(0, remaining);
};

/**
 * Get expiry warning for subscription
 * @param {Object} subscription - The subscription object
 * @param {number} warningDays - Days before expiry to warn (default: 7)
 * @returns {Object} - Warning information
 */
export const getExpiryWarning = (subscription, warningDays = 7) => {
    const daysRemaining = getDaysRemaining(subscription);
    const showWarning = daysRemaining <= warningDays && daysRemaining > 0;

    return {
        showWarning,
        daysRemaining,
        message: showWarning
            ? `Your subscription will expire in ${daysRemaining} days. Please renew.`
            : null,
        isExpiring: showWarning
    };
};

/**
 * Check if can downgrade employee type
 * Used during employee deletion to ensure consistency
 * @param {Object} subscription - The subscription object
 * @param {string} employeeType - "sales", "pro_sales", or "non_sales"
 * @returns {boolean} - Can decrement safely
 */
export const canDecrementEmployeeCount = (subscription, employeeType = "non_sales") => {
    if (!subscription || !subscription.usage) return false;

    const usage = subscription.usage;

    switch (employeeType) {
        case "sales":
            return (usage.no_of_sales_person_employeesUsed || 0) > 0;
        case "pro_sales":
            return (usage.no_of_pro_sales_person_employeesUsed || 0) > 0;
        default: // non_sales
            return (usage.employeesUsed || 0) > 0;
    }
};