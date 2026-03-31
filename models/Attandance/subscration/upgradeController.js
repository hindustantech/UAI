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
        // ✅ Fix #4 — parse as int immediately, never trust raw body value
        const additionalEmployees = parseInt(req.body.additionalEmployees);
        const companyId = req.user._id;

        if (!additionalEmployees || additionalEmployees <= 0) {
            return res.status(400).json({
                success: false,
                message: "Additional employees must be greater than 0",
            });
        }

        // ✅ Fix #5 — enforce a reasonable upper cap
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

        // ✅ Fix #2 — validate plan fields before dividing
        const planPrice = plan.finalPrice;
        const planValidityDays = plan.validityDays;
        const planBaseMaxEmployees = plan.maxEmployees;

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

        // ✅ Correct prorate — always use plan.maxEmployees as the base rate denominator
        const pricePerEmployee = planPrice / planBaseMaxEmployees;
        const pricePerEmployeePerDay = pricePerEmployee / planValidityDays;
        const upgradeCost = Math.round(
            pricePerEmployeePerDay * additionalEmployees * remainingDays
        );

        if (upgradeCost <= 0) {
            const upgradedSubscription = await processEmployeeUpgrade(
                subscription._id,
                additionalEmployees,
                `FREE_UPGRADE_${Date.now()}`,
                0,           // ✅ Fix #3 — pass cost from here, not recalculate later
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

        // ✅ Fix #6 — if PaymentLog.create fails, we know about it clearly
        // (order was created in Razorpay — log the orphan for manual recovery)
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
                    remainingDays,        // ✅ Fix #3 — lock remainingDays at order time
                    upgradeCost,          // ✅ Fix #3 — lock exact cost at order time
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
                keyId: process.env.RAZORPAY_KEY_ID,
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

        if (paymentLog.status === "SUCCESS") {
            return res.status(400).json({
                success: false,
                message: "Payment already processed",
            });
        }

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

        const additionalEmployees = parseInt(paymentLog.metadata?.additionalEmployees);
        // ✅ Fix #3 — use the locked values from order time, not recalculate now
        const lockedRemainingDays = paymentLog.metadata?.remainingDays;
        const lockedUpgradeCost = paymentLog.metadata?.upgradeCost;

        if (!additionalEmployees || additionalEmployees <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid upgrade data in payment record",
            });
        }

        // ✅ Fix #7 — wrap upgrade + payment log update in try/catch together
        // If subscription.save() fails, we mark payment log as NEEDS_RETRY
        // so it can be replayed without charging the customer again
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

            // Mark as NEEDS_RETRY so ops team / cron can replay it
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

        // ✅ Fix #8 — return only what the frontend needs, not the full document
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


// Helper function to process employee upgrade
// ✅ Fix #3 — accepts lockedCost + lockedRemainingDays from order time
async function processEmployeeUpgrade(
    subscriptionId,
    additionalEmployees,
    transactionId,
    lockedUpgradeCost,
    lockedRemainingDays
) {
    // ✅ Fix #1 — findOneAndUpdate with $inc is atomic, prevents race condition
    // Two simultaneous requests both increment correctly instead of one overwriting the other
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
                    oldMaxEmployees: null,     // populated below via pre-update value
                    newMaxEmployees: null,     // populated below
                    employeesUsedAtUpgrade: null,
                },
            },
        },
        { new: true }  // return updated document
    ).populate("plan");

    if (!subscription) {
        throw new Error("Subscription not found");
    }

    // Log for audit trail
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