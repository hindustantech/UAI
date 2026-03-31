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

// @desc    Calculate upgrade cost for additional employees
// @route   POST /api/payment/calculate-upgrade
// @access  Private
export const calculateUpgradeCost = async (req, res) => {
    try {
        const { additionalEmployees } = req.body;
        const companyId = req.user._id;

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
        const remainingDays = Math.max(0, Math.ceil((endDate - currentDate) / (1000 * 60 * 60 * 24)));
        
        if (remainingDays <= 0) {
            return res.status(400).json({
                success: false,
                message: "Subscription has expired. Please renew first.",
            });
        }

        // Calculate total employees after upgrade
        const currentEmployees = subscription.usage.employeesUsed || 0;
        const maxEmployeesAllowed = subscription.usage.maxEmployees;
        const newTotalEmployees = currentEmployees + additionalEmployees;

        // Validate upgrade limits
        if (newTotalEmployees > maxEmployeesAllowed) {
            return res.status(400).json({
                success: false,
                message: `Cannot exceed maximum allowed employees (${maxEmployeesAllowed})`,
                data: {
                    currentEmployees,
                    maxAllowed: maxEmployeesAllowed,
                    requestedAdditional: additionalEmployees,
                    wouldExceedBy: newTotalEmployees - maxEmployeesAllowed,
                },
            });
        }

        // Get plan price per employee per day
        const plan = subscription.plan;
        const planPrice = plan.finalPrice;
        const planValidityDays = plan.validityDays;
        
        // Calculate price per employee for the entire plan period
        const pricePerEmployeeForFullPeriod = planPrice / maxEmployeesAllowed;
        
        // Calculate prorated cost for remaining days
        const pricePerEmployeePerDay = pricePerEmployeeForFullPeriod / planValidityDays;
        const upgradeCost = Math.round(pricePerEmployeePerDay * additionalEmployees * remainingDays);

        res.status(200).json({
            success: true,
            data: {
                currentEmployees,
                additionalEmployees,
                newTotalEmployees,
                remainingDays,
                upgradeCost,
                maxEmployeesAllowed,
                pricePerEmployeePerDay: Math.round(pricePerEmployeePerDay * 100) / 100,
                planDetails: {
                    name: plan.name,
                    totalPrice: planPrice,
                    validityDays: planValidityDays,
                },
            },
        });
    } catch (error) {
        console.error("Upgrade calculation error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to calculate upgrade cost",
            error: error.message,
        });
    }
};

// @desc    Create order for employee upgrade
// @route   POST /api/payment/create-upgrade-order
// @access  Private
export const createUpgradeOrder = async (req, res) => {
    try {
        const { additionalEmployees } = req.body;
        const companyId = req.user._id;

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
        const remainingDays = Math.max(0, Math.ceil((endDate - currentDate) / (1000 * 60 * 60 * 24)));
        
        if (remainingDays <= 0) {
            return res.status(400).json({
                success: false,
                message: "Subscription has expired. Please renew first.",
            });
        }

        // Calculate upgrade cost
        const currentEmployees = subscription.usage.employeesUsed || 0;
        const maxEmployeesAllowed = subscription.usage.maxEmployees;
        const newTotalEmployees = currentEmployees + additionalEmployees;

        if (newTotalEmployees > maxEmployeesAllowed) {
            return res.status(400).json({
                success: false,
                message: `Cannot exceed maximum allowed employees (${maxEmployeesAllowed})`,
            });
        }

        const plan = subscription.plan;
        const planPrice = plan.finalPrice;
        const planValidityDays = plan.validityDays;
        
        const pricePerEmployeeForFullPeriod = planPrice / maxEmployeesAllowed;
        const pricePerEmployeePerDay = pricePerEmployeeForFullPeriod / planValidityDays;
        const upgradeCost = Math.round(pricePerEmployeePerDay * additionalEmployees * remainingDays);

        // Check if upgrade cost is zero (should not happen, but handle gracefully)
        if (upgradeCost <= 0) {
            // Directly upgrade without payment
            const upgradedSubscription = await processEmployeeUpgrade(
                subscription._id,
                additionalEmployees,
                `FREE_UPGRADE_${Date.now()}`
            );

            return res.status(200).json({
                success: true,
                isFreeUpgrade: true,
                message: "Employees upgraded successfully",
                data: {
                    subscription: upgradedSubscription,
                    additionalEmployees,
                    newTotalEmployees,
                },
            });
        }

        // Create Razorpay order for upgrade payment
        const amountInPaise = Math.round(upgradeCost * 100);
        
        const options = {
            amount: amountInPaise,
            currency: "INR",
            receipt: `upgrade_${subscription._id}_${Date.now()}`,
            notes: {
                subscriptionId: subscription._id.toString(),
                companyId: companyId.toString(),
                additionalEmployees: additionalEmployees.toString(),
                remainingDays: remainingDays.toString(),
                upgradeType: "EMPLOYEE_UPGRADE",
            },
        };

        const order = await razorpay.orders.create(options);

        // Create payment log for upgrade
        await PaymentLog.create({
            companyId,
            subscriptionId: subscription._id,
            amount: upgradeCost,
            status: "PENDING",
            razorpayOrderId: order.id,
            upgradeType: "EMPLOYEE_UPGRADE",
            metadata: {
                additionalEmployees,
                remainingDays,
                currentEmployees,
                newTotalEmployees,
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
                upgradeDetails: {
                    currentEmployees,
                    additionalEmployees,
                    newTotalEmployees,
                    remainingDays,
                    upgradeCost,
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
            additionalEmployees,
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

        // Verify signature
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

        // Process the upgrade
        const subscription = await processEmployeeUpgrade(
            paymentLog.subscriptionId,
            additionalEmployees || paymentLog.metadata?.additionalEmployees,
            razorpay_payment_id
        );

        // Update payment log
        await PaymentLog.findByIdAndUpdate(paymentLog._id, {
            status: "SUCCESS",
            razorpayPaymentId: razorpay_payment_id,
            paymentCompletedAt: new Date(),
        });

        res.status(200).json({
            success: true,
            message: "Employees upgraded successfully",
            data: {
                subscription,
                paymentId: razorpay_payment_id,
                upgradeDetails: {
                    additionalEmployees: additionalEmployees || paymentLog.metadata?.additionalEmployees,
                    newTotalEmployees: subscription.usage.employeesUsed,
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

// Helper function to process employee upgrade
async function processEmployeeUpgrade(subscriptionId, additionalEmployees, transactionId) {
    const subscription = await Subscription.findById(subscriptionId);
    
    if (!subscription) {
        throw new Error("Subscription not found");
    }

    const currentEmployees = subscription.usage.employeesUsed || 0;
    const newTotalEmployees = currentEmployees + additionalEmployees;
    const maxEmployeesAllowed = subscription.usage.maxEmployees;

    if (newTotalEmployees > maxEmployeesAllowed) {
        throw new Error(`Cannot exceed maximum allowed employees (${maxEmployeesAllowed})`);
    }

    // Calculate remaining days for record keeping
    const currentDate = new Date();
    const endDate = new Date(subscription.endDate);
    const remainingDays = Math.max(0, Math.ceil((endDate - currentDate) / (1000 * 60 * 60 * 24)));

    // Calculate prorated cost (for reference)
    const plan = await Plan.findById(subscription.plan);
    let upgradeCost = 0;
    
    if (plan && remainingDays > 0) {
        const planPrice = plan.finalPrice;
        const planValidityDays = plan.validityDays;
        const pricePerEmployeeForFullPeriod = planPrice / maxEmployeesAllowed;
        const pricePerEmployeePerDay = pricePerEmployeeForFullPeriod / planValidityDays;
        upgradeCost = Math.round(pricePerEmployeePerDay * additionalEmployees * remainingDays);
    }

    // Update subscription with new employee count
    subscription.usage.employeesUsed = newTotalEmployees;
    
    // Add to upgrade history
    subscription.usage.upgradeHistory.push({
        upgradedAt: new Date(),
        extraEmployees: additionalEmployees,
        cost: upgradeCost,
        transactionId: transactionId,
        remainingDays: remainingDays,
        oldEmployeeCount: currentEmployees,
        newEmployeeCount: newTotalEmployees,
    });

    await subscription.save();

    // Optional: Create audit log entry
    console.log("Employee upgrade processed:", {
        subscriptionId: subscription._id,
        companyId: subscription.company,
        oldCount: currentEmployees,
        newCount: newTotalEmployees,
        additional: additionalEmployees,
        transactionId,
        remainingDays,
        cost: upgradeCost,
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
                currentEmployees: subscription.usage.employeesUsed,
                maxEmployees: subscription.usage.maxEmployees,
                upgradeHistory: subscription.usage.upgradeHistory,
                totalUpgrades: subscription.usage.upgradeHistory.length,
                totalAdditionalEmployees: subscription.usage.upgradeHistory.reduce(
                    (sum, upgrade) => sum + upgrade.extraEmployees,
                    0
                ),
                totalCost: subscription.usage.upgradeHistory.reduce(
                    (sum, upgrade) => sum + (upgrade.cost || 0),
                    0
                ),
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