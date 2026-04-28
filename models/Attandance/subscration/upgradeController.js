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

// Pricing constants
const SALES_PERSON_PRICE = 50;      // ₹50 per sales person
const PRO_SALES_PRICE = 2000;       // ₹2000 per pro sales person

// @desc    Create order for employee upgrade (handles both conversions and additions)
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

        const currentDate = new Date();
        const endDate = new Date(subscription.endDate);
        const remainingDays = Math.max(
            0,
            Math.ceil((endDate - currentDate) / (1000 * 60 * 60 * 24))
        );

        if (remainingDays <= 0) {
            return res.status(400).json({
                success: false,
                message: "Subscription has expired. Please renew first.",
            });
        }

        const plan = subscription.plan;
        const planPrice = plan.finalPrice;
        const planValidityDays = plan.validityDays;
        const planBaseMaxEmployees = plan.Max_Employees;

        // Current usage
        const currentMaxEmployees = subscription.usage.maxEmployees;
        const currentSalesMax = subscription.usage.no_of_sales_person_maxEmployees || 0;
        const currentProSalesMax = subscription.usage.no_of_pro_sales_person_maxEmployees || 0;
        const currentEmployeesUsed = subscription.usage.employeesUsed || 0;
        const currentSalesUsed = subscription.usage.no_of_sales_person_employeesUsed || 0;
        const currentProSalesUsed = subscription.usage.no_of_pro_sales_person_employeesUsed || 0;

        // Calculate prorated cost per day for each type
        const pricePerEmployeePerDay = (planPrice / planBaseMaxEmployees) / planValidityDays;
        const salesPricePerDay = SALES_PERSON_PRICE / planValidityDays;
        const proSalesPricePerDay = PRO_SALES_PRICE / planValidityDays;

        let totalUpgradeCost = 0;
        let newMaxEmployees = currentMaxEmployees;
        let newSalesMax = currentSalesMax;
        let newProSalesMax = currentProSalesMax;

        const upgradeDetails = {
            additionalEmployeesAdded: 0,
            salesConverted: 0,
            proSalesConverted: 0,
            salesAdded: 0,
            proSalesAdded: 0,
        };

        // SCENARIO 1: Convert existing regular employees to Sales
        if (convertToSales > 0) {
            const regularEmployeesAvailable = currentEmployeesUsed - (currentSalesUsed + currentProSalesUsed);
            if (convertToSales > regularEmployeesAvailable) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot convert ${convertToSales} employees to Sales. Only ${regularEmployeesAvailable} regular employees available.`,
                });
            }
            
            // Cost: Difference between Sales and Regular employee cost
            // Regular employee cost is already included in base plan
            // Only charge the additional premium for Sales role
            const conversionCost = convertToSales * salesPricePerDay * remainingDays;
            totalUpgradeCost += conversionCost;
            upgradeDetails.salesConverted = convertToSales;
            newSalesMax += convertToSales;
        }

        // SCENARIO 2: Convert existing regular employees to Pro Sales
        if (convertToProSales > 0) {
            const regularEmployeesAvailable = currentEmployeesUsed - (currentSalesUsed + currentProSalesUsed) - upgradeDetails.salesConverted;
            if (convertToProSales > regularEmployeesAvailable) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot convert ${convertToProSales} employees to Pro Sales. Only ${regularEmployeesAvailable} regular employees available.`,
                });
            }
            
            const conversionCost = convertToProSales * proSalesPricePerDay * remainingDays;
            totalUpgradeCost += conversionCost;
            upgradeDetails.proSalesConverted = convertToProSales;
            newProSalesMax += convertToProSales;
        }

        // SCENARIO 3: Add new Sales employees (increases total employee count)
        if (addSales > 0) {
            const newTotalEmployees = currentEmployeesUsed + upgradeDetails.additionalEmployeesAdded + addSales;
            const newTotalAllowed = currentMaxEmployees + additionalEmployees;
            
            if (newTotalEmployees > newTotalAllowed) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot add ${addSales} Sales employees. Would exceed max employee limit of ${newTotalAllowed}.`,
                });
            }
            
            // Cost: Base employee cost + Sales premium
            const baseCost = addSales * pricePerEmployeePerDay * remainingDays;
            const premiumCost = addSales * salesPricePerDay * remainingDays;
            const totalCost = baseCost + premiumCost;
            
            totalUpgradeCost += totalCost;
            upgradeDetails.salesAdded = addSales;
            upgradeDetails.additionalEmployeesAdded += addSales;
            newMaxEmployees += addSales;
            newSalesMax += addSales;
        }

        // SCENARIO 4: Add new Pro Sales employees (increases total employee count)
        if (addProSales > 0) {
            const newTotalEmployees = currentEmployeesUsed + upgradeDetails.additionalEmployeesAdded + addProSales;
            const newTotalAllowed = currentMaxEmployees + additionalEmployees;
            
            if (newTotalEmployees > newTotalAllowed) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot add ${addProSales} Pro Sales employees. Would exceed max employee limit of ${newTotalAllowed}.`,
                });
            }
            
            // Cost: Base employee cost + Pro Sales premium
            const baseCost = addProSales * pricePerEmployeePerDay * remainingDays;
            const premiumCost = addProSales * proSalesPricePerDay * remainingDays;
            const totalCost = baseCost + premiumCost;
            
            totalUpgradeCost += totalCost;
            upgradeDetails.proSalesAdded = addProSales;
            upgradeDetails.additionalEmployeesAdded += addProSales;
            newMaxEmployees += addProSales;
            newProSalesMax += addProSales;
        }

        // SCENARIO 5: Add regular employees (no special role)
        if (additionalEmployees > 0) {
            const newTotalEmployees = currentEmployeesUsed + upgradeDetails.additionalEmployeesAdded + additionalEmployees;
            const effectiveMaxEmployees = currentMaxEmployees + additionalEmployees;
            
            if (newTotalEmployees > effectiveMaxEmployees) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot add ${additionalEmployees} employees. Would exceed max employee limit.`,
                });
            }
            
            const baseCost = additionalEmployees * pricePerEmployeePerDay * remainingDays;
            totalUpgradeCost += baseCost;
            upgradeDetails.additionalEmployeesAdded += additionalEmployees;
            newMaxEmployees += additionalEmployees;
        }

        console.log("Upgrade calculation:", {
            companyId,
            subscriptionId: subscription._id,
            current: {
                maxEmployees: currentMaxEmployees,
                salesMax: currentSalesMax,
                proSalesMax: currentProSalesMax,
                employeesUsed: currentEmployeesUsed,
                salesUsed: currentSalesUsed,
                proSalesUsed: currentProSalesUsed,
            },
            requested: upgradeDetails,
            newLimits: {
                maxEmployees: newMaxEmployees,
                salesMax: newSalesMax,
                proSalesMax: newProSalesMax,
            },
            remainingDays,
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
                remainingDays
            );

            return res.status(200).json({
                success: true,
                isFreeUpgrade: true,
                message: "Employee upgrade processed successfully",
                data: {
                    upgradeDetails: {
                        ...upgradeDetails,
                        oldMaxEmployees: currentMaxEmployees,
                        newMaxEmployees: upgradedSubscription.usage.maxEmployees,
                        oldSalesMax: currentSalesMax,
                        newSalesMax: upgradedSubscription.usage.no_of_sales_person_maxEmployees,
                        oldProSalesMax: currentProSalesMax,
                        newProSalesMax: upgradedSubscription.usage.no_of_pro_sales_person_maxEmployees,
                    },
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
                upgradeDetails: JSON.stringify(upgradeDetails),
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
                totalUpgradeCost,
                currentState: {
                    maxEmployees: currentMaxEmployees,
                    salesMax: currentSalesMax,
                    proSalesMax: currentProSalesMax,
                    employeesUsed: currentEmployeesUsed,
                    salesUsed: currentSalesUsed,
                    proSalesUsed: currentProSalesUsed,
                },
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
                keyId: process.env.RAZORPAY_API_KEY,
                upgradeDetails: {
                    ...upgradeDetails,
                    oldMaxEmployees: currentMaxEmployees,
                    newMaxEmployees,
                    remainingDays,
                    totalUpgradeCost: Math.round(totalUpgradeCost),
                    breakdown: {
                        conversionCost: {
                            sales: upgradeDetails.salesConverted * salesPricePerDay * remainingDays,
                            proSales: upgradeDetails.proSalesConverted * proSalesPricePerDay * remainingDays,
                        },
                        additionCost: {
                            sales: upgradeDetails.salesAdded * (pricePerEmployeePerDay + salesPricePerDay) * remainingDays,
                            proSales: upgradeDetails.proSalesAdded * (pricePerEmployeePerDay + proSalesPricePerDay) * remainingDays,
                            regular: additionalEmployees * pricePerEmployeePerDay * remainingDays,
                        },
                    },
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

        const upgradeDetails = paymentLog.metadata?.upgradeDetails;
        const newMaxEmployees = paymentLog.metadata?.newMaxEmployees;
        const newSalesMax = paymentLog.metadata?.newSalesMax;
        const newProSalesMax = paymentLog.metadata?.newProSalesMax;
        const lockedRemainingDays = paymentLog.metadata?.remainingDays;

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
                lockedRemainingDays
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
                    additionalEmployeesAdded: upgradeDetails.additionalEmployeesAdded,
                    salesConverted: upgradeDetails.salesConverted,
                    proSalesConverted: upgradeDetails.proSalesConverted,
                    salesAdded: upgradeDetails.salesAdded,
                    proSalesAdded: upgradeDetails.proSalesAdded,
                    newMaxEmployees: subscription.usage.maxEmployees,
                    newSalesMax: subscription.usage.no_of_sales_person_maxEmployees,
                    newProSalesMax: subscription.usage.no_of_pro_sales_person_maxEmployees,
                    employeesUsed: subscription.usage.employeesUsed,
                },
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

// Helper - Atomic update for employee upgrades
async function processEmployeeUpgrade(
    subscriptionId,
    upgradeDetails,
    newMaxEmployees,
    newSalesMax,
    newProSalesMax,
    transactionId,
    cost,
    remainingDays
) {
    const subscription = await Subscription.findById(subscriptionId);
    
    if (!subscription) {
        throw new Error("Subscription not found");
    }

    // Calculate new values
    const currentSalesMax = subscription.usage.no_of_sales_person_maxEmployees || 0;
    const currentProSalesMax = subscription.usage.no_of_pro_sales_person_maxEmployees || 0;
    
    // Update the subscription
    subscription.usage.maxEmployees = newMaxEmployees;
    subscription.usage.no_of_sales_person_maxEmployees = newSalesMax;
    subscription.usage.no_of_pro_sales_person_maxEmployees = newProSalesMax;
    
    // Add to upgrade history
    subscription.usage.upgradeHistory.push({
        upgradedAt: new Date(),
        extraEmployees: upgradeDetails.additionalEmployeesAdded,
        salesConverted: upgradeDetails.salesConverted,
        proSalesConverted: upgradeDetails.proSalesConverted,
        salesAdded: upgradeDetails.salesAdded,
        proSalesAdded: upgradeDetails.proSalesAdded,
        cost: cost || 0,
        transactionId,
        remainingDays: remainingDays || 0,
        oldEmployeeCount: {
            maxEmployees: subscription.usage.maxEmployees - upgradeDetails.additionalEmployeesAdded,
            salesMax: currentSalesMax,
            proSalesMax: currentProSalesMax,
        },
        newEmployeeCount: {
            maxEmployees: newMaxEmployees,
            salesMax: newSalesMax,
            proSalesMax: newProSalesMax,
        },
    });
    
    await subscription.save();

    console.log("Employee upgrade processed:", {
        subscriptionId: subscription._id,
        companyId: subscription.company,
        upgradeDetails,
        newMaxEmployees,
        newSalesMax,
        newProSalesMax,
        transactionId,
    });

    return subscription;
}

// @desc    Get upgrade history
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

        res.status(200).json({
            success: true,
            data: {
                current: {
                    employeesUsed: subscription.usage.employeesUsed,
                    maxEmployees: subscription.usage.maxEmployees,
                    salesMax: subscription.usage.no_of_sales_person_maxEmployees,
                    proSalesMax: subscription.usage.no_of_pro_sales_person_maxEmployees,
                    salesUsed: subscription.usage.no_of_sales_person_employeesUsed,
                    proSalesUsed: subscription.usage.no_of_pro_sales_person_employeesUsed,
                },
                upgradeHistory: subscription.usage.upgradeHistory,
                summary: {
                    totalUpgrades: subscription.usage.upgradeHistory.length,
                    totalAdditionalEmployees: subscription.usage.upgradeHistory.reduce(
                        (sum, upgrade) => sum + (upgrade.extraEmployees || 0),
                        0
                    ),
                    totalSalesConverted: subscription.usage.upgradeHistory.reduce(
                        (sum, upgrade) => sum + (upgrade.salesConverted || 0),
                        0
                    ),
                    totalProSalesConverted: subscription.usage.upgradeHistory.reduce(
                        (sum, upgrade) => sum + (upgrade.proSalesConverted || 0),
                        0
                    ),
                    totalCost: subscription.usage.upgradeHistory.reduce(
                        (sum, upgrade) => sum + (upgrade.cost || 0),
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
