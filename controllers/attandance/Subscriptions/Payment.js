import Plan from "../../../models/Attandance/subscration/plan.js";
import { Subscription } from "../../../models/Attandance/subscration/Subscription.js";
import PaymentLog from "../../../models/Attandance/subscration/PaymentLog.js";
import User from "../../../models/userModel.js";
import mongoose from "mongoose";
import Razorpay from "razorpay";
import crypto from "crypto";

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_API_KEY,
    key_secret: process.env.RAZORPAY_API_SECRET,
});


// @desc    Create Razorpay order (or handle free plan)
// @route   POST /api/payment/create-order
// @access  Private
export const createOrder = async (req, res) => {
    try {
        const { planId } = req.body;
        const companyId = req.user._id;

        // Validate plan
        const plan = await Plan.findById(planId);
        if (!plan) {
            return res.status(404).json({
                success: false,
                message: "Plan not found",
            });
        }

        if (!plan.isActive) {
            return res.status(400).json({
                success: false,
                message: "This plan is currently not available",
            });
        }

        // Handle FREE plan - no payment required
        if (plan.isfree === true || plan.finalPrice === 0) {
            // Directly activate free subscription
            const subscription = await activateFreeSubscription(companyId, plan);

            return res.status(200).json({
                success: true,
                isFreePlan: true,
                message: "Free plan activated successfully",
                data: {
                    subscription,
                    planDetails: {
                        name: plan.name,
                        validityDays: plan.validityDays,
                        maxEmployees: plan.Max_Employees,
                        dataSee: plan.data_see,
                        dataExport: plan.data_export,
                    },
                },
            });
        }

        // For paid plans - continue with Razorpay order creation
        // Calculate amount (convert to smallest currency unit - paise for INR)
        const amountInPaise = Math.round(plan.finalPrice * 100);

        // Create order options
        const options = {
            amount: amountInPaise,
            currency: "INR",
            receipt: `receipt_${Date.now()}`,
            notes: {
                planId: plan._id.toString(),
                planName: plan.name,
                companyId: companyId.toString(),
                maxEmployees: plan.Max_Employees.toString(),
                dataSee: plan.data_see.toString(),
                dataExport: plan.data_export.toString(),
            },
        };

        // Create order in Razorpay
        const order = await razorpay.orders.create(options);

        // Create payment log
        await PaymentLog.create({
            companyId,
            subscriptionId: null,
            amount: plan.finalPrice,
            status: "PENDING",
            razorpayOrderId: order.id,
            rawPayload: {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
            },
        });

        console.log("Created Razorpay order:", {
            companyId,
            planId,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
        });

        res.status(200).json({
            success: true,
            isFreePlan: false,
            data: {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                keyId: process.env.RAZORPAY_KEY_ID,
                planDetails: {
                    name: plan.name,
                    finalPrice: plan.finalPrice,
                    validityDays: plan.validityDays,
                    maxEmployees: plan.Max_Employees,
                    dataSee: plan.data_see,
                    dataExport: plan.data_export,
                },
            },
        });
    } catch (error) {
        console.error("Order creation error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to create order",
            error: error.message,
        });
    }
};

// Helper function to activate free subscription
async function activateFreeSubscription(companyId, plan) {
    // Calculate subscription dates
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.validityDays);

    // Check for existing active subscription
    const existingSubscription = await Subscription.findOne({
        company: companyId,
        status: "ACTIVE",
    });

    // If there's an existing active subscription, update it
    if (existingSubscription) {
        const oldEndDate = existingSubscription.endDate;
        existingSubscription.endDate = endDate;
        existingSubscription.status = "ACTIVE";
        existingSubscription.renewalHistory.push({
            renewedAt: new Date(),
            oldEndDate: oldEndDate,
            newEndDate: endDate,
            transactionId: `FREE_${Date.now()}`,
        });

        // Update usage limits based on new plan
        existingSubscription.usage.maxEmployees = plan.Max_Employees;
        existingSubscription.usage.DATA_SEE = plan.data_see;
        existingSubscription.usage.DATA_EXPORT = plan.data_export;

        await existingSubscription.save();
        return existingSubscription;
    }

    // Create new free subscription
    const subscription = await Subscription.create({
        company: companyId,
        plan: plan._id,
        planSnapshot: {
            name: plan.name,
            price: plan.price,
            discount: plan.discount,
            finalPrice: plan.finalPrice,
            validityDays: plan.validityDays,
            features: plan.features.map((feature) => ({
                key: feature.key,
                value: feature.value,
            })),
        },
        startDate,
        endDate,
        status: "ACTIVE",
        payment: {
            transactionId: `FREE_${Date.now()}`,
            paymentGateway: "FREE_PLAN",
            paymentStatus: "SUCCESS",
            amountPaid: 0,
            currency: "INR",
            paidAt: new Date(),
        },
        autoRenew: false,
        usage: {
            employeesUsed: 0,
            maxEmployees: plan.Max_Employees,
            DATA_SEE: plan.data_see,
            DATA_EXPORT: plan.data_export,
            upgradeHistory: [],
        },
        isActive: true,
    });

    return subscription;
}

// @desc    Verify payment and activate subscription
// @route   POST /api/payment/verify
// @access  Private
export const verifyPayment = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            planId,
        } = req.body;

        const companyId = req.user._id || req.user.id;

        // Get plan details first
        const plan = await Plan.findById(planId);
        if (!plan) {
            return res.status(404).json({
                success: false,
                message: "Plan not found",
            });
        }

        // If it's a free plan, don't verify payment
        if (plan.isfree === true || plan.finalPrice === 0) {
            const subscription = await activateFreeSubscription(companyId, plan);

            return res.status(200).json({
                success: true,
                message: "Free plan activated successfully",
                data: {
                    subscription,
                    isFreePlan: true,
                },
            });
        }

        // For paid plans - verify signature
        console.log("Verifying payment for company:", {
            companyId,
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            planId,
        });

        // Generate signature for verification
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_API_SECRET)
            .update(body.toString())
            .digest("hex");

        // Verify signature
        const isAuthentic = expectedSignature === razorpay_signature;

        if (!isAuthentic) {
            await PaymentLog.findOneAndUpdate(
                { razorpayOrderId: razorpay_order_id },
                {
                    status: "FAILED",
                    razorpayPaymentId: razorpay_payment_id,
                }
            );

            return res.status(400).json({
                success: false,
                message: "Invalid payment signature",
            });
        }

        // Calculate subscription dates
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + plan.validityDays);

        // Check for existing active subscription
        const existingSubscription = await Subscription.findOne({
            company: companyId,
            status: "ACTIVE",
        });

        // If there's an existing active subscription, update it
        if (existingSubscription) {
            const oldEndDate = existingSubscription.endDate;
            existingSubscription.endDate = endDate;
            existingSubscription.status = "ACTIVE";
            existingSubscription.renewalHistory.push({
                renewedAt: new Date(),
                oldEndDate: oldEndDate,
                newEndDate: endDate,
                transactionId: razorpay_payment_id,
            });

            // Update usage limits based on new plan
            existingSubscription.usage.maxEmployees = plan.Max_Employees;
            existingSubscription.usage.DATA_SEE = plan.data_see;
            existingSubscription.usage.DATA_EXPORT = plan.data_export;

            await existingSubscription.save();

            await PaymentLog.findOneAndUpdate(
                { razorpayOrderId: razorpay_order_id },
                {
                    status: "SUCCESS",
                    razorpayPaymentId: razorpay_payment_id,
                    subscriptionId: existingSubscription._id,
                }
            );

            return res.status(200).json({
                success: true,
                message: "Subscription renewed successfully",
                data: {
                    subscription: existingSubscription,
                    paymentId: razorpay_payment_id,
                },
            });
        }

        // Create new subscription
        const subscription = await Subscription.create({
            company: companyId,
            plan: plan._id,
            planSnapshot: {
                name: plan.name,
                price: plan.price,
                discount: plan.discount,
                finalPrice: plan.finalPrice,
                validityDays: plan.validityDays,
                features: plan.features.map((feature) => ({
                    key: feature.key,
                    value: feature.value,
                })),
            },
            startDate,
            endDate,
            status: "ACTIVE",
            payment: {
                transactionId: razorpay_payment_id,
                orderId: razorpay_order_id,
                paymentGateway: "RAZORPAY",
                paymentStatus: "SUCCESS",
                amountPaid: plan.finalPrice,
                currency: "INR",
                paidAt: new Date(),
            },
            autoRenew: false,
            usage: {
                employeesUsed: 0,
                maxEmployees: plan.Max_Employees,
                DATA_SEE: plan.data_see,
                DATA_EXPORT: plan.data_export,
                upgradeHistory: [],
            },
            isActive: true,
        });

        // Update payment log with subscription ID
        await PaymentLog.findOneAndUpdate(
            { razorpayOrderId: razorpay_order_id },
            {
                status: "SUCCESS",
                razorpayPaymentId: razorpay_payment_id,
                subscriptionId: subscription._id,
            }
        );

        res.status(200).json({
            success: true,
            message: "Payment verified and subscription activated successfully",
            data: {
                subscription,
                paymentId: razorpay_payment_id,
            },
        });
    } catch (error) {
        console.error("Payment verification error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to verify payment",
            error: error.message,
        });
    }
};




// @desc    Initialize free plan for new company
// @route   POST /api/payment/init-free-plan
// @access  Private
export const initializeFreePlan = async (req, res) => {
    try {
        const companyId = req.user._id;

        // Find the FREE plan
        const freePlan = await Plan.findOne({ isfree: true, isActive: true });

        if (!freePlan) {
            return res.status(404).json({
                success: false,
                message: "Free plan not configured",
            });
        }

        // Check if company already has a subscription
        const existingSubscription = await Subscription.findOne({
            company: companyId,
        });

        if (existingSubscription) {
            return res.status(400).json({
                success: false,
                message: "Company already has a subscription",
            });
        }

        // Activate free subscription
        const subscription = await activateFreeSubscription(companyId, freePlan);

        res.status(200).json({
            success: true,
            message: "Free plan activated successfully",
            data: {
                subscription,
                plan: freePlan,
            },
        });
    } catch (error) {
        console.error("Free plan initialization error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to initialize free plan",
            error: error.message,
        });
    }
};

// @desc    Get payment history
// @route   GET /api/payment/history
// @access  Private
export const getPaymentHistory = async (req, res) => {
    try {
        const companyId = req.user._id;
        const { page = 1, limit = 10 } = req.query;

        const payments = await PaymentLog.find({ companyId })
            .populate("subscriptionId", "planSnapshot.name startDate endDate")
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await PaymentLog.countDocuments({ companyId });

        res.status(200).json({
            success: true,
            data: {
                payments,
                totalPages: Math.ceil(total / limit),
                currentPage: page,
                total,
            },
        });
    } catch (error) {
        console.error("Get payment history error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch payment history",
            error: error.message,
        });
    }
};

// @desc    Cancel subscription
// @route   POST /api/payment/cancel-subscription
// @access  Private
export const cancelSubscription = async (req, res) => {
    try {
        const { subscriptionId } = req.body;
        const companyId = req.user._id;

        const subscription = await Subscription.findOne({
            _id: subscriptionId,
            company: companyId,
            status: "ACTIVE",
        });

        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: "Active subscription not found",
            });
        }

        subscription.status = "CANCELLED";
        subscription.isActive = false;
        await subscription.save();

        res.status(200).json({
            success: true,
            message: "Subscription cancelled successfully",
            data: subscription,
        });
    } catch (error) {
        console.error("Cancel subscription error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to cancel subscription",
            error: error.message,
        });
    }
};



export const getActiveSubscription = async (req, res) => {
    try {
        const companyId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid company ID",
            });
        }

        /**
         * STEP 1: Get latest active subscription
         * Priority:
         * ACTIVE > PAST_DUE > PENDING
         */
        let subscription = await Subscription.findOne({
            company: companyId,
            isActive: true,
            status: { $in: ["ACTIVE", "PAST_DUE", "PENDING"] },
        })
            .sort({ createdAt: -1 })
            .lean();

        /**
         * STEP 2: If not found → fallback to last subscription
         */
        if (!subscription) {
            subscription = await Subscription.findOne({
                company: companyId,
            })
                .sort({ createdAt: -1 })
                .lean();

            if (!subscription) {
                return res.status(200).json({
                    success: true,
                    data: null,
                    message: "No subscription found",
                });
            }
        }

        /**
         * STEP 3: Auto-expire check (runtime safety)
         */
        const now = new Date();
        let computedStatus = subscription.status;

        if (subscription.endDate < now && subscription.status === "ACTIVE") {
            computedStatus = "EXPIRED";

            // Update DB asynchronously (non-blocking)
            Subscription.updateOne(
                { _id: subscription._id },
                { status: "EXPIRED" }
            ).catch(() => { });
        }

        /**
         * STEP 4: Feature Map (O(1) access)
         */
        const featureMap = {};
        if (subscription.planSnapshot?.features?.length) {
            subscription.planSnapshot.features.forEach((f) => {
                featureMap[f.key] = f.value;
            });
        }

        /**
         * STEP 5: Remaining days calculation
         */
        const remainingMs = new Date(subscription.endDate) - now;
        const remainingDays = Math.max(
            0,
            Math.ceil(remainingMs / (1000 * 60 * 60 * 24))
        );

        /**
         * STEP 6: Usage metrics
         */
        const usage = {
            employeesUsed: subscription.usage?.employeesUsed || 0,
            maxEmployees: featureMap["MAX_EMPLOYEES"] || null,
            employeesRemaining:
                featureMap["MAX_EMPLOYEES"] != null
                    ? featureMap["MAX_EMPLOYEES"] -
                    (subscription.usage?.employeesUsed || 0)
                    : null,
        };

        /**
         * STEP 7: Final Response (Frontend Optimized)
         */
        return res.status(200).json({
            success: true,
            data: {
                subscriptionId: subscription._id,

                status: computedStatus,
                isActive: computedStatus === "ACTIVE",

                plan: {
                    id: subscription.plan,
                    name: subscription.planSnapshot?.name,
                    price: subscription.planSnapshot?.price,
                    finalPrice: subscription.planSnapshot?.finalPrice,
                    validityDays: subscription.planSnapshot?.validityDays,
                },

                billing: {
                    startDate: subscription.startDate,
                    endDate: subscription.endDate,
                    remainingDays,
                    autoRenew: subscription.autoRenew,
                },

                payment: {
                    status: subscription.payment?.paymentStatus,
                    amountPaid: subscription.payment?.amountPaid,
                    transactionId: subscription.payment?.transactionId,
                    paidAt: subscription.payment?.paidAt,
                },

                usage,

                features: featureMap,
            },
        });
    } catch (error) {
        console.error("getActiveSubscription error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch subscription",
            error: error.message,
        });
    }
};