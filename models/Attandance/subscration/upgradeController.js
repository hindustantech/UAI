// controllers/payment/upgradeController.js

import mongoose from "mongoose";
import PaymentLog from "../../../models/Attandance/subscration/PaymentLog.js";
import Plan from "../../../models/Attandance/subscration/plan.js";
import { Subscription } from "../../../models/Attandance/subscration/Subscription.js";
import Razorpay from "razorpay";
import crypto from "crypto";

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_API_KEY,       // ✅ matches your env
    key_secret: process.env.RAZORPAY_API_SECRET,
});


// @desc    Create order for employee upgrade
// @route   POST /api/payment/create-upgrade-order
// @access  Private
export const createUpgradeOrder = async (req, res) => {
    try {
        const additionalEmployees = parseInt(req.body.additionalEmployees);
        const companyId = req.user._id;

        if (!additionalEmployees || additionalEmployees <= 0) {
            return res.status(400).json({
                success: false,
                message: "Additional employees must be greater than 0",
            });
        }

        const MAX_EMPLOYEES_PER_UPGRADE = 500;
        if (additionalEmployees > MAX_EMPLOYEES_PER_UPGRADE) {
            return res.status(400).json({
                success: false,
                message: `Cannot add more than ${MAX_EMPLOYEES_PER_UPGRADE} employees at once`,
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
        const currentMaxEmployees = subscription.usage.maxEmployees;
        const newMaxEmployees = currentMaxEmployees + additionalEmployees;

        const planPrice = plan.finalPrice;
        const planValidityDays = plan.validityDays;
        const planBaseMaxEmployees = plan.Max_Employees; // ✅ exact field name from Plan model

        if (!planBaseMaxEmployees || planBaseMaxEmployees <= 0) {
            return res.status(500).json({
                success: false,
                message: "Invalid plan configuration. Please contact support.",
            });
        }

        if (!planValidityDays || planValidityDays <= 0) {
            return res.status(500).json({
                success: false,
                message: "Invalid plan validity. Please contact support.",
            });
        }

        // Prorated cost — always divide by plan.Max_Employees (base rate, never changes)
        const pricePerEmployee = planPrice / planBaseMaxEmployees;
        const pricePerEmployeePerDay = pricePerEmployee / planValidityDays;
        const upgradeCost = Math.round(
            pricePerEmployeePerDay * additionalEmployees * remainingDays
        );

        // Free upgrade (cost rounds to zero)
        if (upgradeCost <= 0) {
            const upgradedSubscription = await processEmployeeUpgrade(
                subscription._id,
                additionalEmployees,
                `FREE_UPGRADE_${Date.now()}`,
                0,
                remainingDays
            );

            return res.status(200).json({
                success: true,
                isFreeUpgrade: true,
                message: "Employee slots upgraded successfully",
                data: {
                    upgradeDetails: {
                        additionalEmployees,
                        oldMaxEmployees: currentMaxEmployees,
                        newMaxEmployees: upgradedSubscription.usage.maxEmployees,
                    },
                },
            });
        }

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

        // If PaymentLog.create fails after Razorpay order is created — log for manual recovery
        let paymentLog;
        try {
            paymentLog = await PaymentLog.create({
                companyId,
                subscriptionId: subscription._id,
                amount: upgradeCost,
                status: "PENDING",
                razorpayOrderId: order.id,
                upgradeType: "EMPLOYEE_UPGRADE",
                metadata: {
                    additionalEmployees,
                    remainingDays,      // locked at order time
                    upgradeCost,        // locked at order time
                    currentMaxEmployees,
                    newMaxEmployees,
                    planBaseMaxEmployees,
                    pricePerEmployee: Math.round(pricePerEmployee),
                },
                rawPayload: {
                    orderId: order.id,
                    amount: order.amount,
                    currency: order.currency,
                },
            });
        } catch (logError) {
            console.error("CRITICAL: Razorpay order created but PaymentLog.create failed", {
                razorpayOrderId: order.id,
                companyId,
                subscriptionId: subscription._id,
                error: logError.message,
            });
            return res.status(500).json({
                success: false,
                message: "Order created but failed to record payment. Please contact support.",
            });
        }

        res.status(200).json({
            success: true,
            isFreeUpgrade: false,
            data: {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                keyId: process.env.RAZORPAY_API_KEY, // ✅ matches your env var
                upgradeDetails: {
                    additionalEmployees,
                    oldMaxEmployees: currentMaxEmployees,
                    newMaxEmployees,
                    remainingDays,
                    upgradeCost,
                    pricePerEmployee: Math.round(pricePerEmployee),
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

        // Always read from payment log — never trust client for these values
        const additionalEmployees = parseInt(paymentLog.metadata?.additionalEmployees);
        const lockedRemainingDays = paymentLog.metadata?.remainingDays;
        const lockedUpgradeCost = paymentLog.metadata?.upgradeCost;

        if (!additionalEmployees || additionalEmployees <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid upgrade data in payment record",
            });
        }

        // If subscription.save() fails — mark NEEDS_RETRY so ops can replay
        // without charging the customer again
        let subscription;
        try {
            subscription = await processEmployeeUpgrade(
                paymentLog.subscriptionId,
                additionalEmployees,
                razorpay_payment_id,
                lockedUpgradeCost,
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
                message: "Payment received but upgrade failed. Our team has been notified and will resolve this shortly.",
            });
        }

        await PaymentLog.findByIdAndUpdate(paymentLog._id, {
            status: "SUCCESS",
            razorpayPaymentId: razorpay_payment_id,
            paymentCompletedAt: new Date(),
        });

        // Return only what frontend needs — not the full Mongoose document
        res.status(200).json({
            success: true,
            message: "Employee slots upgraded successfully",
            data: {
                paymentId: razorpay_payment_id,
                upgradeDetails: {
                    additionalEmployees,
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


// Helper — atomic update prevents race condition
async function processEmployeeUpgrade(
    subscriptionId,
    additionalEmployees,
    transactionId,
    lockedUpgradeCost,
    lockedRemainingDays
) {
    // $inc is atomic — two simultaneous requests both increment correctly
    const subscription = await Subscription.findOneAndUpdate(
        { _id: subscriptionId },
        {
            $inc: { "usage.maxEmployees": additionalEmployees },
            $push: {
                "usage.upgradeHistory": {
                    upgradedAt: new Date(),
                    extraEmployees: additionalEmployees,
                    cost: lockedUpgradeCost ?? 0,
                    transactionId,
                    remainingDays: lockedRemainingDays ?? 0,
                    oldEmployeeCount: null, // ✅ exact field name from Subscription model
                    newEmployeeCount: null, // ✅ exact field name from Subscription model
                },
            },
        },
        { new: true }
    );

    if (!subscription) {
        throw new Error("Subscription not found");
    }

    console.log("Employee slot upgrade processed:", {
        subscriptionId: subscription._id,
        companyId: subscription.company,
        newMaxEmployees: subscription.usage.maxEmployees,
        additionalSlots: additionalEmployees,
        transactionId,
        remainingDays: lockedRemainingDays,
        cost: lockedUpgradeCost,
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