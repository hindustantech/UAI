// controllers/payment/upgradeController.js

import mongoose from "mongoose";
import PaymentLog from "../../../models/Attandance/subscration/PaymentLog.js";
import Plan from "../../../models/Attandance/subscration/plan.js";
import { Subscription } from "../../../models/Attandance/subscration/Subscription.js";
import Razorpay from "razorpay";
import crypto from "crypto";

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_API_KEY,
    key_secret: process.env.RAZORPAY_API_SECRET,
});

/**
 * PRICING CONSTANTS (Per Month)
 * ₹500 per Sales person per month
 * ₹2000 per Pro Sales person per month
 */
const SALES_PERSON_RATE = 10;          // ₹500 per month
const PRO_SALES_PERSON_RATE = 100;     // ₹2000 per month

/**
 * Calculate prorated cost based on remaining days in subscription
 * @param {number} monthlyRate - Monthly rate (e.g., 500 for sales)
 * @param {number} remainingDays - Days remaining in current subscription
 * @returns {number} - Daily rate
 */
const calculateDailyRate = (monthlyRate, remainingDays) => {
    const daysInMonth = 30;
    return (monthlyRate / daysInMonth);
};

/**
 * Calculate prorated cost for given days
 * @param {number} monthlyRate - Monthly rate
 * @param {number} count - Number of employees
 * @param {number} remainingDays - Days remaining
 * @returns {number} - Total cost
 */
const calculateProratedCost = (monthlyRate, count, remainingDays) => {
    const dailyRate = calculateDailyRate(monthlyRate, remainingDays);
    return count * dailyRate * remainingDays;
};

// @desc    Create order for employee upgrade (handles conversions and additions)
// @route   POST /api/payment/create-upgrade-order
// @access  Private
export const createUpgradeOrder = async (req, res) => {
    try {
        const {
            additionalEmployees = 0,
            convertToSales = 0,
            convertToProSales = 0,
            addSales = 0,
            addProSales = 0
        } = req.body;

        const companyId = req.user._id;

        // Validate at least one operation
        if (additionalEmployees === 0 && convertToSales === 0 && convertToProSales === 0 && addSales === 0 && addProSales === 0) {
            return res.status(400).json({
                success: false,
                message: "Please specify upgrade details",
            });
        }

        // Get active subscription
        const subscription = await Subscription.findOne({
            company: companyId,
            status: "ACTIVE",
            isActive: true,
        }).populate("plan");

        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: "No active subscription found",
            });
        }

        // Calculate remaining days
        const currentDate = new Date();
        const endDate = new Date(subscription.endDate);
        const remainingMs = endDate - currentDate;
        const remainingDays = Math.max(
            0,
            Math.ceil(remainingMs / (1000 * 60 * 60 * 24))
        );

        if (remainingDays <= 0) {
            return res.status(400).json({
                success: false,
                message: "Subscription has expired. Please renew first.",
            });
        }

        // Current plan and usage details
        const plan = subscription.plan;
        const planBaseMaxEmployees = plan.Max_Employees;
        const planValidityDays = plan.validityDays;
        const planFinalPrice = plan.finalPrice;

        // Current usage state
        const currentMaxEmployees = subscription.usage.maxEmployees;
        const currentSalesMax = subscription.usage.no_of_sales_person_maxEmployees || 0;
        const currentProSalesMax = subscription.usage.no_of_pro_sales_person_maxEmployees || 0;
        const currentEmployeesUsed = subscription.usage.employeesUsed || 0;
        const currentSalesUsed = subscription.usage.no_of_sales_person_employeesUsed || 0;
        const currentProSalesUsed = subscription.usage.no_of_pro_sales_person_employeesUsed || 0;

        // Calculate base employee cost (daily rate)
        const baseEmployeeMonthlyRate = planFinalPrice / planBaseMaxEmployees;
        const baseEmployeeDailyRate = calculateDailyRate(baseEmployeeMonthlyRate, remainingDays);

        // Initialize tracking
        let totalUpgradeCost = 0;
        let newMaxEmployees = currentMaxEmployees;
        let newSalesMax = currentSalesMax;
        let newProSalesMax = currentProSalesMax;

        const costBreakdown = {
            conversions: {
                salesConversionCost: 0,
                proSalesConversionCost: 0
            },
            additions: {
                salesAdditionCost: 0,
                proSalesAdditionCost: 0,
                regularEmployeesCost: 0
            }
        };

        const upgradeDetails = {
            additionalEmployeesAdded: 0,
            convertToSales: 0,
            convertToProSales: 0,
            addSales: 0,
            addProSales: 0,
        };
        const checkconersionsum = convertToSales + convertToProSales;
        // ============================================
        // SCENARIO 1: Convert regular employees to Sales
        // ============================================
        if (checkconersionsum > 0) {
            const regularEmployeesAvailable = currentMaxEmployees - currentProSalesMax - currentSalesMax - currentEmployeesUsed;
            console.log("148 {} Regular employees available for Sales conversion:", regularEmployeesAvailable);
            if (checkconersionsum >= regularEmployeesAvailable) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot convert ${checkconersionsum} to Sales. Only ${regularEmployeesAvailable} regular employees available. Need to purchase ${convertToSales - regularEmployeesAvailable} additional base employees first.`,
                });
            }

            // Conversion cost: Premium from regular to sales
            // Already paying for base employee, only charge the premium
            const conversionCost = calculateProratedCost(SALES_PERSON_RATE, convertToSales, remainingDays);

            costBreakdown.conversions.salesConversionCost = conversionCost;
            totalUpgradeCost += conversionCost;
            upgradeDetails.convertToSales = convertToSales;
            newSalesMax += convertToSales;

            console.log(`Converting ${convertToSales} employees to Sales:`, {
                dailyRate: calculateDailyRate(SALES_PERSON_RATE, remainingDays),
                remainingDays,
                conversionCost
            });
        }

        // ============================================
        // SCENARIO 2: Convert regular employees to Pro Sales
        // ============================================
        if (checkconersionsum > 0) {
            // Available regular employees after sales conversions
            const regularEmployeesAvailable = currentMaxEmployees - currentProSalesMax - currentSalesMax - currentEmployeesUsed;
            console.log(`Regular employees available for Pro Sales conversion: ${regularEmployeesAvailable}`);
            if (checkconersionsum >= regularEmployeesAvailable) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot convert ${checkconersionsum} to Pro Sales. Only ${regularEmployeesAvailable} regular employees available. Need to purchase ${convertToProSales - regularEmployeesAvailable} additional base employees first.`,
                });
            }

            // Conversion cost: Premium from regular to pro sales
            const conversionCost = calculateProratedCost(PRO_SALES_PERSON_RATE, convertToProSales, remainingDays);

            costBreakdown.conversions.proSalesConversionCost = conversionCost;
            totalUpgradeCost += conversionCost;
            upgradeDetails.convertToProSales = convertToProSales;
            newProSalesMax += convertToProSales;

            console.log(`Converting ${convertToProSales} employees to Pro Sales:`, {
                dailyRate: calculateDailyRate(PRO_SALES_PERSON_RATE, remainingDays),
                remainingDays,
                conversionCost
            });
        }

        // ============================================
        // SCENARIO 3: Add new Sales employees
        // ============================================
        if (addSales > 0) {
            const newTotalEmployees = currentEmployeesUsed + upgradeDetails.additionalEmployeesAdded + addSales;
            const newTotalAllowed = currentMaxEmployees + additionalEmployees;

            if (newTotalEmployees > newTotalAllowed) {
                const shortfall = newTotalEmployees - newTotalAllowed;
                return res.status(400).json({
                    success: false,
                    message: `Cannot add ${addSales} Sales employees. Would exceed max limit. Need to purchase ${shortfall} additional base employees.`,
                });
            }

            // Cost = Base employee cost + Sales premium cost
            const baseCost = calculateProratedCost(baseEmployeeMonthlyRate, addSales, remainingDays);
            const premiumCost = calculateProratedCost(SALES_PERSON_RATE, addSales, remainingDays);
            const totalCost = baseCost + premiumCost;

            costBreakdown.additions.salesAdditionCost = totalCost;
            totalUpgradeCost += totalCost;
            upgradeDetails.addSales = addSales;
            upgradeDetails.additionalEmployeesAdded += addSales;
            newMaxEmployees += addSales;
            newSalesMax += addSales;

            console.log(`Adding ${addSales} Sales employees:`, {
                baseEmployeeMonthlyCost: baseEmployeeMonthlyRate,
                baseCost,
                premiumCost,
                totalCost
            });
        }

        // ============================================
        // SCENARIO 4: Add new Pro Sales employees
        // ============================================
        if (addProSales > 0) {
            const newTotalEmployees = currentEmployeesUsed + upgradeDetails.additionalEmployeesAdded + addProSales;
            const newTotalAllowed = currentMaxEmployees + additionalEmployees;

            if (newTotalEmployees > newTotalAllowed) {
                const shortfall = newTotalEmployees - newTotalAllowed;
                return res.status(400).json({
                    success: false,
                    message: `Cannot add ${addProSales} Pro Sales employees. Would exceed max limit. Need to purchase ${shortfall} additional base employees.`,
                });
            }

            // Cost = Base employee cost + Pro Sales premium cost
            const baseCost = calculateProratedCost(baseEmployeeMonthlyRate, addProSales, remainingDays);
            const premiumCost = calculateProratedCost(PRO_SALES_PERSON_RATE, addProSales, remainingDays);
            const totalCost = baseCost + premiumCost;

            costBreakdown.additions.proSalesAdditionCost = totalCost;
            totalUpgradeCost += totalCost;
            upgradeDetails.addProSales = addProSales;
            upgradeDetails.additionalEmployeesAdded += addProSales;
            newMaxEmployees += addProSales;
            newProSalesMax += addProSales;

            console.log(`Adding ${addProSales} Pro Sales employees:`, {
                baseEmployeeMonthlyCost: baseEmployeeMonthlyRate,
                baseCost,
                premiumCost,
                totalCost
            });
        }

        // ============================================
        // SCENARIO 5: Add regular employees
        // ============================================
        if (additionalEmployees > 0) {
            const newTotalEmployees = currentEmployeesUsed + upgradeDetails.additionalEmployeesAdded + additionalEmployees;
            const effectiveMaxEmployees = currentMaxEmployees + additionalEmployees;

            if (newTotalEmployees > effectiveMaxEmployees) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot add ${additionalEmployees} base employees. Exceeds limit.`,
                });
            }

            // Only base employee cost
            const baseCost = calculateProratedCost(baseEmployeeMonthlyRate, additionalEmployees, remainingDays);

            costBreakdown.additions.regularEmployeesCost = baseCost;
            totalUpgradeCost += baseCost;
            upgradeDetails.additionalEmployeesAdded += additionalEmployees;
            newMaxEmployees += additionalEmployees;

            console.log(`Adding ${additionalEmployees} base employees:`, {
                baseEmployeeMonthlyCost: baseEmployeeMonthlyRate,
                baseCost
            });
        }

        console.log("=== UPGRADE ORDER SUMMARY ===", {
            companyId,
            subscriptionId: subscription._id,
            subscriptionEndDate: subscription.endDate,
            remainingDays,
            currentUsage: {
                maxEmployees: currentMaxEmployees,
                salesMax: currentSalesMax,
                proSalesMax: currentProSalesMax,
                employeesUsed: currentEmployeesUsed,
                salesUsed: currentSalesUsed,
                proSalesUsed: currentProSalesUsed,
            },
            requestedUpgrades: upgradeDetails,
            newLimits: {
                maxEmployees: newMaxEmployees,
                salesMax: newSalesMax,
                proSalesMax: newProSalesMax,
            },
            pricingRates: {
                baseEmployeeMonthlyRate,
                salesPersonRate: SALES_PERSON_RATE,
                proSalesPersonRate: PRO_SALES_PERSON_RATE,
                dailyRates: {
                    base: baseEmployeeDailyRate,
                    sales: calculateDailyRate(SALES_PERSON_RATE, remainingDays),
                    proSales: calculateDailyRate(PRO_SALES_PERSON_RATE, remainingDays)
                }
            },
            costBreakdown,
            totalUpgradeCost: Math.round(totalUpgradeCost),
        });

        // Free upgrade if cost rounds to zero
        if (Math.round(totalUpgradeCost) <= 0) {
            const upgradedSubscription = await processEmployeeUpgrade(
                subscription._id,
                upgradeDetails,
                newMaxEmployees,
                newSalesMax,
                newProSalesMax,
                `FREE_UPGRADE_${Date.now()}`,
                0,
                remainingDays,
                costBreakdown
            );

            return res.status(200).json({
                success: true,
                isFreeUpgrade: true,
                message: "Employee upgrade processed successfully",
                data: {
                    upgradeDetails: {
                        conversions: {
                            salesConverted: upgradeDetails.convertToSales,
                            proSalesConverted: upgradeDetails.convertToProSales,
                        },
                        additions: {
                            salesAdded: upgradeDetails.addSales,
                            proSalesAdded: upgradeDetails.addProSales,
                            regularAdded: additionalEmployees,
                        },
                        oldLimits: {
                            maxEmployees: currentMaxEmployees,
                            salesMax: currentSalesMax,
                            proSalesMax: currentProSalesMax,
                        },
                        newLimits: {
                            maxEmployees: upgradedSubscription.usage.maxEmployees,
                            salesMax: upgradedSubscription.usage.no_of_sales_person_maxEmployees,
                            proSalesMax: upgradedSubscription.usage.no_of_pro_sales_person_maxEmployees,
                        },
                    },
                    totalCost: 0,
                },
            });
        }

        // Create Razorpay order for paid upgrade
        const amountInPaise = Math.round(totalUpgradeCost * 100);

        const options = {
            amount: amountInPaise,
            currency: "INR",
            receipt: `upg_${subscription._id.toString().slice(-8)}_${Date.now().toString().slice(-8)}`,
            notes: {
                subscriptionId: subscription._id.toString(),
                companyId: companyId.toString(),
                upgradeType: "EMPLOYEE_UPGRADE",
                remainingDays: remainingDays.toString(),
            },
        };

        const order = await razorpay.orders.create(options);

        const paymentLog = await PaymentLog.create({
            companyId,
            subscriptionId: subscription._id,
            amount: totalUpgradeCost,
            status: "PENDING",
            razorpayOrderId: order.id,
            upgradeType: "EMPLOYEE_UPGRADE",
            metadata: {
                upgradeDetails,
                newMaxEmployees,
                newSalesMax,
                newProSalesMax,
                remainingDays,
                totalUpgradeCost: Math.round(totalUpgradeCost),
                costBreakdown,
                currentState: {
                    maxEmployees: currentMaxEmployees,
                    salesMax: currentSalesMax,
                    proSalesMax: currentProSalesMax,
                    employeesUsed: currentEmployeesUsed,
                    salesUsed: currentSalesUsed,
                    proSalesUsed: currentProSalesUsed,
                },
                pricingInfo: {
                    baseEmployeeMonthlyRate,
                    salesPersonRate: SALES_PERSON_RATE,
                    proSalesPersonRate: PRO_SALES_PERSON_RATE,
                    planValidityDays: planValidityDays,
                    planFinalPrice: planFinalPrice,
                }
            },
            rawPayload: {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
            },
        });

        res.status(200).json({
            success: true,
            isFreeUpgrade: false,
            data: {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                keyId: process.env.RAZORPAY_KEY_ID,
                subscriptionInfo: {
                    endDate: subscription.endDate,
                    remainingDays,
                },
                upgradeDetails: {
                    conversions: {
                        salesConverted: upgradeDetails.convertToSales,
                        proSalesConverted: upgradeDetails.convertToProSales,
                    },
                    additions: {
                        salesAdded: upgradeDetails.addSales,
                        proSalesAdded: upgradeDetails.addProSales,
                        regularAdded: additionalEmployees,
                    },
                    oldLimits: {
                        maxEmployees: currentMaxEmployees,
                        salesMax: currentSalesMax,
                        proSalesMax: currentProSalesMax,
                    },
                    newLimits: {
                        maxEmployees: newMaxEmployees,
                        salesMax: newSalesMax,
                        proSalesMax: newProSalesMax,
                    },
                },
                costBreakdown: {
                    conversions: {
                        salesConversion: Math.round(costBreakdown.conversions.salesConversionCost),
                        proSalesConversion: Math.round(costBreakdown.conversions.proSalesConversionCost),
                        subtotal: Math.round(costBreakdown.conversions.salesConversionCost + costBreakdown.conversions.proSalesConversionCost),
                    },
                    additions: {
                        salesAddition: Math.round(costBreakdown.additions.salesAdditionCost),
                        proSalesAddition: Math.round(costBreakdown.additions.proSalesAdditionCost),
                        regularEmployees: Math.round(costBreakdown.additions.regularEmployeesCost),
                        subtotal: Math.round(costBreakdown.additions.salesAdditionCost + costBreakdown.additions.proSalesAdditionCost + costBreakdown.additions.regularEmployeesCost),
                    },
                    total: Math.round(totalUpgradeCost),
                },
                pricingInfo: {
                    baseEmployeeMonthlyRate: Math.round(baseEmployeeMonthlyRate * 100) / 100,
                    salesPersonRate: SALES_PERSON_RATE,
                    proSalesPersonRate: PRO_SALES_PERSON_RATE,
                    remainingDays,
                    proratedBasis: "Calculated based on remaining subscription days",
                },
            },
        });
    } catch (error) {
        console.error("Upgrade order creation error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to create upgrade order",
            error: error.message,
        });
    }
};

// @desc    Verify upgrade payment and process upgrade
// @route   POST /api/payment/verify-upgrade
// @access  Private
export const verifyUpgradePayment = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
        } = req.body;

        const companyId = req.user._id;

        // Find payment log
        const paymentLog = await PaymentLog.findOne({
            razorpayOrderId: razorpay_order_id,
            companyId,
        });

        if (!paymentLog) {
            return res.status(404).json({
                success: false,
                message: "Payment record not found",
            });
        }

        if (paymentLog.status === "SUCCESS") {
            return res.status(400).json({
                success: false,
                message: "Payment already processed",
            });
        }

        // Verify Razorpay signature
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_API_SECRET)
            .update(body.toString())
            .digest("hex");

        const isAuthentic = expectedSignature === razorpay_signature;

        if (!isAuthentic) {
            await PaymentLog.findByIdAndUpdate(paymentLog._id, {
                status: "FAILED",
                razorpayPaymentId: razorpay_payment_id,
            });

            return res.status(400).json({
                success: false,
                message: "Invalid payment signature",
            });
        }

        // Extract upgrade details from payment log
        const upgradeDetails = paymentLog.metadata?.upgradeDetails;
        const newMaxEmployees = paymentLog.metadata?.newMaxEmployees;
        const newSalesMax = paymentLog.metadata?.newSalesMax;
        const newProSalesMax = paymentLog.metadata?.newProSalesMax;
        const lockedRemainingDays = paymentLog.metadata?.remainingDays;
        const costBreakdown = paymentLog.metadata?.costBreakdown;

        if (!upgradeDetails) {
            return res.status(400).json({
                success: false,
                message: "Invalid upgrade data in payment record",
            });
        }

        let subscription;
        try {
            subscription = await processEmployeeUpgrade(
                paymentLog.subscriptionId,
                upgradeDetails,
                newMaxEmployees,
                newSalesMax,
                newProSalesMax,
                razorpay_payment_id,
                paymentLog.amount,
                lockedRemainingDays,
                costBreakdown
            );
        } catch (upgradeError) {
            console.error("CRITICAL: Payment verified but upgrade failed", {
                razorpayPaymentId: razorpay_payment_id,
                paymentLogId: paymentLog._id,
                error: upgradeError.message,
            });

            await PaymentLog.findByIdAndUpdate(paymentLog._id, {
                status: "NEEDS_RETRY",
                razorpayPaymentId: razorpay_payment_id,
                failureReason: upgradeError.message,
            });

            return res.status(500).json({
                success: false,
                message: "Payment received but upgrade failed. Our team has been notified.",
            });
        }

        // Update payment log to success
        await PaymentLog.findByIdAndUpdate(paymentLog._id, {
            status: "SUCCESS",
            razorpayPaymentId: razorpay_payment_id,
            paymentCompletedAt: new Date(),
        });

        res.status(200).json({
            success: true,
            message: "Employee upgrade completed successfully",
            data: {
                paymentId: razorpay_payment_id,
                upgradeDetails: {
                    conversions: {
                        salesConverted: upgradeDetails.convertToSales,
                        proSalesConverted: upgradeDetails.convertToProSales,
                    },
                    additions: {
                        salesAdded: upgradeDetails.addSales,
                        proSalesAdded: upgradeDetails.addProSales,
                        regularAdded: upgradeDetails.additionalEmployeesAdded - upgradeDetails.addSales - upgradeDetails.addProSales,
                    },
                    newLimits: {
                        maxEmployees: subscription.usage.maxEmployees,
                        salesMax: subscription.usage.no_of_sales_person_maxEmployees,
                        proSalesMax: subscription.usage.no_of_pro_sales_person_maxEmployees,
                    },
                    employeesUsed: subscription.usage.employeesUsed,
                },
                totalCostPaid: Math.round(paymentLog.amount),
            },
        });
    } catch (error) {
        console.error("Upgrade verification error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to verify upgrade payment",
            error: error.message,
        });
    }
};

/**
 * Helper - Process employee upgrade (atomic update)
 * @param {ObjectId} subscriptionId - Subscription ID
 * @param {Object} upgradeDetails - Details of upgrade
 * @param {number} newMaxEmployees - New max employees
 * @param {number} newSalesMax - New sales max
 * @param {number} newProSalesMax - New pro sales max
 * @param {string} transactionId - Payment transaction ID
 * @param {number} cost - Cost paid
 * @param {number} remainingDays - Remaining days used for proration
 * @param {Object} costBreakdown - Cost breakdown details
 */
async function processEmployeeUpgrade(
    subscriptionId,
    upgradeDetails,
    newMaxEmployees,
    newSalesMax,
    newProSalesMax,
    transactionId,
    cost,
    remainingDays,
    costBreakdown = {}
) {
    const subscription = await Subscription.findById(subscriptionId);

    if (!subscription) {
        throw new Error("Subscription not found");
    }

    // Store old values
    const oldMaxEmployees = subscription.usage.maxEmployees;
    const oldSalesMax = subscription.usage.no_of_sales_person_maxEmployees || 0;
    const oldProSalesMax = subscription.usage.no_of_pro_sales_person_maxEmployees || 0;

    // Update usage limits
    subscription.usage.maxEmployees = newMaxEmployees;
    subscription.usage.no_of_sales_person_maxEmployees = newSalesMax;
    subscription.usage.no_of_pro_sales_person_maxEmployees = newProSalesMax;

    // Add to upgrade history
    subscription.usage.upgradeHistory.push({
        upgradedAt: new Date(),
        conversions: {
            toSales: upgradeDetails.convertToSales || 0,
            toProSales: upgradeDetails.convertToProSales || 0,
        },
        additions: {
            salesAdded: upgradeDetails.addSales || 0,
            proSalesAdded: upgradeDetails.addProSales || 0,
            regularAdded: upgradeDetails.additionalEmployeesAdded || 0,
        },
        cost: Math.round(cost || 0),
        transactionId,
        remainingDays: remainingDays || 0,
        costBreakdown: costBreakdown || {},
        oldLimits: {
            maxEmployees: oldMaxEmployees,
            salesMax: oldSalesMax,
            proSalesMax: oldProSalesMax,
        },
        newLimits: {
            maxEmployees: newMaxEmployees,
            salesMax: newSalesMax,
            proSalesMax: newProSalesMax,
        },
    });

    await subscription.save();

    console.log("✅ Employee upgrade processed successfully:", {
        subscriptionId: subscription._id,
        companyId: subscription.company,
        upgradeDetails,
        oldLimits: {
            maxEmployees: oldMaxEmployees,
            salesMax: oldSalesMax,
            proSalesMax: oldProSalesMax,
        },
        newLimits: {
            maxEmployees: newMaxEmployees,
            salesMax: newSalesMax,
            proSalesMax: newProSalesMax,
        },
        transactionId,
        cost: Math.round(cost || 0),
    });

    return subscription;
}

// @desc    Get upgrade history and current employee allocation
// @route   GET /api/payment/upgrade-history
// @access  Private
export const getUpgradeHistory = async (req, res) => {
    try {
        const companyId = req.user._id;

        const subscription = await Subscription.findOne({
            company: companyId,
            status: "ACTIVE",
            isActive: true,
        });

        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: "No active subscription found",
            });
        }

        // Calculate remaining days
        const currentDate = new Date();
        const endDate = new Date(subscription.endDate);
        const remainingMs = endDate - currentDate;
        const remainingDays = Math.max(
            0,
            Math.ceil(remainingMs / (1000 * 60 * 60 * 24))
        );

        res.status(200).json({
            success: true,
            data: {
                currentAllocation: {
                    employeesUsed: subscription.usage.employeesUsed || 0,
                    maxEmployees: subscription.usage.maxEmployees,
                    availableEmployees: subscription.usage.maxEmployees - (subscription.usage.employeesUsed || 0),
                    salesUsed: subscription.usage.no_of_sales_person_employeesUsed || 0,
                    salesMax: subscription.usage.no_of_sales_person_maxEmployees || 0,
                    salesAvailable: (subscription.usage.no_of_sales_person_maxEmployees || 0) - (subscription.usage.no_of_sales_person_employeesUsed || 0),
                    proSalesUsed: subscription.usage.no_of_pro_sales_person_employeesUsed || 0,
                    proSalesMax: subscription.usage.no_of_pro_sales_person_maxEmployees || 0,
                    proSalesAvailable: (subscription.usage.no_of_pro_sales_person_maxEmployees || 0) - (subscription.usage.no_of_pro_sales_person_employeesUsed || 0),
                },
                subscriptionInfo: {
                    endDate: subscription.endDate,
                    remainingDays,
                },
                upgradeHistory: subscription.usage.upgradeHistory.map((upgrade) => ({
                    upgradedAt: upgrade.upgradedAt,
                    conversions: upgrade.conversions || {
                        toSales: 0,
                        toProSales: 0,
                    },
                    additions: upgrade.additions || {
                        salesAdded: 0,
                        proSalesAdded: 0,
                        regularAdded: 0,
                    },
                    cost: upgrade.cost || 0,
                    transactionId: upgrade.transactionId,
                    remainingDays: upgrade.remainingDays,
                    oldLimits: upgrade.oldLimits,
                    newLimits: upgrade.newLimits,
                })),
                summary: {
                    totalUpgrades: subscription.usage.upgradeHistory.length,
                    totalCostOnUpgrades: subscription.usage.upgradeHistory.reduce(
                        (sum, upgrade) => sum + (upgrade.cost || 0),
                        0
                    ),
                    totalEmployeesAdded: subscription.usage.upgradeHistory.reduce(
                        (sum, upgrade) => sum + (upgrade.additions?.regularAdded || 0) + (upgrade.additions?.salesAdded || 0) + (upgrade.additions?.proSalesAdded || 0),
                        0
                    ),
                    totalSalesConverted: subscription.usage.upgradeHistory.reduce(
                        (sum, upgrade) => sum + (upgrade.conversions?.toSales || 0),
                        0
                    ),
                    totalProSalesConverted: subscription.usage.upgradeHistory.reduce(
                        (sum, upgrade) => sum + (upgrade.conversions?.toProSales || 0),
                        0
                    ),
                },
            },
        });
    } catch (error) {
        console.error("Get upgrade history error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch upgrade history",
            error: error.message,
        });
    }
};