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

        if (!additionalEmployees || additionalEmployees <= 0) {
            return res.status(400).json({
                success: false,
                message: "Additional employees must be greater than 0",
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
        const remainingDays = Math.max(0, Math.ceil((endDate - currentDate) / (1000 * 60 * 60 * 24)));

        if (remainingDays <= 0) {
            return res.status(400).json({
                success: false,
                message: "Subscription has expired. Please renew first.",
            });
        }

        const plan = subscription.plan;
        const currentMaxEmployees = subscription.usage.maxEmployees;
        const newMaxEmployees = currentMaxEmployees + parseInt(additionalEmployees);

        // Calculate upgrade cost based on expanding the max limit
        const planPrice = plan.finalPrice;
        const planValidityDays = plan.validityDays;

        const pricePerEmployeeForFullPeriod = planPrice / currentMaxEmployees;
        const pricePerEmployeePerDay = pricePerEmployeeForFullPeriod / planValidityDays;
        const upgradeCost = Math.round(pricePerEmployeePerDay * additionalEmployees * remainingDays);

        // Handle free upgrade (cost rounds to zero)
        if (upgradeCost <= 0) {
            const upgradedSubscription = await processEmployeeUpgrade(
                subscription._id,
                parseInt(additionalEmployees),
                `FREE_UPGRADE_${Date.now()}`
            );

            return res.status(200).json({
                success: true,
                isFreeUpgrade: true,
                message: "Employee slots upgraded successfully",
                data: {
                    subscription: upgradedSubscription,
                    upgradeDetails: {
                        additionalEmployees: parseInt(additionalEmployees),
                        oldMaxEmployees: currentMaxEmployees,
                        newMaxEmployees,
                    },
                },
            });
        }

        // Create Razorpay order
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

        // Create payment log
        await PaymentLog.create({
            companyId,
            subscriptionId: subscription._id,
            amount: upgradeCost,
            status: "PENDING",
            razorpayOrderId: order.id,
            upgradeType: "EMPLOYEE_UPGRADE",
            metadata: {
                additionalEmployees: parseInt(additionalEmployees),
                remainingDays,
                currentMaxEmployees,
                newMaxEmployees,
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
                    additionalEmployees: parseInt(additionalEmployees),
                    oldMaxEmployees: currentMaxEmployees,
                    newMaxEmployees,
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

        // Prevent duplicate processing
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

        // Process the upgrade using additionalEmployees from payment log metadata
        const additionalEmployees = paymentLog.metadata?.additionalEmployees;

        if (!additionalEmployees || additionalEmployees <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid upgrade data in payment record",
            });
        }

        const subscription = await processEmployeeUpgrade(
            paymentLog.subscriptionId,
            parseInt(additionalEmployees),
            razorpay_payment_id
        );

        // Update payment log to SUCCESS
        await PaymentLog.findByIdAndUpdate(paymentLog._id, {
            status: "SUCCESS",
            razorpayPaymentId: razorpay_payment_id,
            paymentCompletedAt: new Date(),
        });

        res.status(200).json({
            success: true,
            message: "Employee slots upgraded successfully",
            data: {
                subscription,
                paymentId: razorpay_payment_id,
                upgradeDetails: {
                    additionalEmployees: parseInt(additionalEmployees),
                    newMaxEmployees: subscription.usage.maxEmployees,
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

// Helper function to process employee upgrade
async function processEmployeeUpgrade(subscriptionId, additionalEmployees, transactionId) {
    const subscription = await Subscription.findById(subscriptionId).populate("plan");

    if (!subscription) {
        throw new Error("Subscription not found");
    }

    const oldMaxEmployees = subscription.usage.maxEmployees;
    const currentEmployeesUsed = subscription.usage.employeesUsed || 0;
    const newMaxEmployees = oldMaxEmployees + parseInt(additionalEmployees);

    // Calculate remaining days for cost record
    const currentDate = new Date();
    const endDate = new Date(subscription.endDate);
    const remainingDays = Math.max(0, Math.ceil((endDate - currentDate) / (1000 * 60 * 60 * 24)));

    // Calculate prorated cost for history record
    let upgradeCost = 0;
    const plan = subscription.plan;

    if (plan && remainingDays > 0) {
        const planPrice = plan.finalPrice;
        const planValidityDays = plan.validityDays;
        const pricePerEmployeeForFullPeriod = planPrice / oldMaxEmployees;
        const pricePerEmployeePerDay = pricePerEmployeeForFullPeriod / planValidityDays;
        upgradeCost = Math.round(pricePerEmployeePerDay * additionalEmployees * remainingDays);
    }

    // ✅ Update maxEmployees (expand the slot limit)
    subscription.usage.maxEmployees = newMaxEmployees;

    // ✅ employeesUsed stays untouched — it reflects actual active employees

    // Add to upgrade history
    subscription.usage.upgradeHistory.push({
        upgradedAt: new Date(),
        extraEmployees: parseInt(additionalEmployees),
        cost: upgradeCost,
        transactionId,
        remainingDays,
        oldMaxEmployees,
        newMaxEmployees,
        employeesUsedAtUpgrade: currentEmployeesUsed,
    });

    await subscription.save();

    console.log("Employee slot upgrade processed:", {
        subscriptionId: subscription._id,
        companyId: subscription.company,
        oldMaxEmployees,
        newMaxEmployees,
        additionalSlots: additionalEmployees,
        employeesUsed: currentEmployeesUsed,
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