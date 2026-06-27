import PricingRule from '../models/Slab/SlabRule.js'
/**
 * Calculate dynamic pricing based on employee counts
 * @param {Object} params - Calculation parameters
 * @param {number} params.attendanceEmployees - Number of attendance employees
 * @param {number} params.salesEmployees - Number of sales employees
 * @param {number} params.proSalesEmployees - Number of pro sales employees
 * @returns {Object} - Pricing breakdown
 */
export const calculateDynamicPricing = async ({
    attendanceEmployees = 0,
    salesEmployees = 0,
    proSalesEmployees = 0,
}) => {
    try {
        // Fetch active pricing rules
        const pricingRule = await PricingRule.findOne();

        if (!pricingRule) {
            throw new Error("No pricing rules found. Please configure pricing first.");
        }

        const pricingBreakdown = {
            attendance: { employees: 0, pricePerEmployee: 0, total: 0 },
            sales: { employees: 0, pricePerEmployee: 0, total: 0 },
            proSales: { employees: 0, pricePerEmployee: 0, total: 0 },
            grandTotal: 0,
            slabs: {},
        };

        // Calculate Attendance Pricing
        if (attendanceEmployees > 0) {
            const attendanceModule = pricingRule.modules.find(m => m.module === "ATTENDANCE");
            if (attendanceModule) {
                const slab = findApplicableSlab(attendanceModule.slabs, attendanceEmployees);
                if (slab) {
                    pricingBreakdown.attendance = {
                        employees: attendanceEmployees,
                        pricePerEmployee: slab.pricePerEmployeePerYear,
                        total: attendanceEmployees * slab.pricePerEmployeePerYear,
                    };
                    pricingBreakdown.slabs.attendance = {
                        min: slab.minEmployees,
                        max: slab.maxEmployees,
                    };
                }
            }
        }

        // Calculate Sales Pricing
        if (salesEmployees > 0) {
            const salesModule = pricingRule.modules.find(m => m.module === "SALES");
            if (salesModule) {
                const slab = findApplicableSlab(salesModule.slabs, salesEmployees);
                if (slab) {
                    pricingBreakdown.sales = {
                        employees: salesEmployees,
                        pricePerEmployee: slab.pricePerEmployeePerYear,
                        total: salesEmployees * slab.pricePerEmployeePerYear,
                    };
                    pricingBreakdown.slabs.sales = {
                        min: slab.minEmployees,
                        max: slab.maxEmployees,
                    };
                }
            }
        }

        // Calculate Pro Sales Pricing
        if (proSalesEmployees > 0) {
            const proSalesModule = pricingRule.modules.find(m => m.module === "PRO_SALES");
            if (proSalesModule) {
                const slab = findApplicableSlab(proSalesModule.slabs, proSalesEmployees);
                if (slab) {
                    pricingBreakdown.proSales = {
                        employees: proSalesEmployees,
                        pricePerEmployee: slab.pricePerEmployeePerYear,
                        total: proSalesEmployees * slab.pricePerEmployeePerYear,
                    };
                    pricingBreakdown.slabs.proSales = {
                        min: slab.minEmployees,
                        max: slab.maxEmployees,
                    };
                }
            }
        }

        // Calculate Grand Total (Yearly)
        pricingBreakdown.grandTotal =
            pricingBreakdown.attendance.total +
            pricingBreakdown.sales.total +
            pricingBreakdown.proSales.total;

        // Calculate Monthly Price
        pricingBreakdown.monthlyTotal = Math.round(pricingBreakdown.grandTotal / 12);

        return pricingBreakdown;
    } catch (error) {
        throw new Error(`Pricing calculation failed: ${error.message}`);
    }
};

/**
 * Find applicable slab for given employee count
 */
const findApplicableSlab = (slabs, employeeCount) => {
    const sortedSlabs = [...slabs].sort((a, b) => a.minEmployees - b.minEmployees);

    for (const slab of sortedSlabs) {
        if (slab.maxEmployees === null) {
            // Last slab (unlimited)
            if (employeeCount >= slab.minEmployees) {
                return slab;
            }
        } else {
            // Regular slab with range
            if (employeeCount >= slab.minEmployees && employeeCount <= slab.maxEmployees) {
                return slab;
            }
        }
    }

    return null;
};

/**
 * Calculate upgrade cost
 */
export const calculateUpgradeCost = async ({
    currentAttendance = 0,
    currentSales = 0,
    currentProSales = 0,
    newAttendance = 0,
    newSales = 0,
    newProSales = 0,
    remainingDays = 0,
}) => {
    try {
        const currentPricing = await calculateDynamicPricing({
            attendanceEmployees: currentAttendance,
            salesEmployees: currentSales,
            proSalesEmployees: currentProSales,
        });

        const newPricing = await calculateDynamicPricing({
            attendanceEmployees: newAttendance,
            salesEmployees: newSales,
            proSalesEmployees: newProSales,
        });

        const yearlyDifference = newPricing.grandTotal - currentPricing.grandTotal;
        const dailyRate = yearlyDifference / 365;
        const upgradeCost = Math.round(dailyRate * remainingDays);

        return {
            currentPricing,
            newPricing,
            yearlyDifference,
            dailyRate,
            remainingDays,
            upgradeCost,
            breakdown: {
                attendance: {
                    old: currentPricing.attendance.total,
                    new: newPricing.attendance.total,
                    difference: newPricing.attendance.total - currentPricing.attendance.total,
                },
                sales: {
                    old: currentPricing.sales.total,
                    new: newPricing.sales.total,
                    difference: newPricing.sales.total - currentPricing.sales.total,
                },
                proSales: {
                    old: currentPricing.proSales.total,
                    new: newPricing.proSales.total,
                    difference: newPricing.proSales.total - currentPricing.proSales.total,
                },
            },
        };
    } catch (error) {
        throw new Error(`Upgrade cost calculation failed: ${error.message}`);
    }
};