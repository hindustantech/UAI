import Plan from "../../../models/Attandance/subscration/plan.js";
import { Subscription } from "../../../models/Attandance/subscration/Subscription.js";
import { calculateDynamicPricing, calculateUpgradeCost } from "../../../services/pricingCalculator.js";
import crypto from "crypto";
import Razorpay from "razorpay";

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_API_KEY,
    key_secret: process.env.RAZORPAY_API_SECRET,
}); 

// @desc    Create custom plan order with dynamic pricing
// @route   POST /api/orders/create-custom-plan
// @access  Private
export const createCustomPlanOrder = async (req, res) => {
    try {
        const {
            basePlanId,
            attendanceEmployees = 0,
            salesEmployees = 0,
            proSalesEmployees = 0,
            validityDays = 365,
            discount = 0,
        } = req.body;

        const companyId = req.user.id; // Assuming authenticated user

        // Validate inputs
        if (attendanceEmployees < 0 || salesEmployees < 0 || proSalesEmployees < 0) {
            return res.status(400).json({
                success: false,
                message: "Employee counts cannot be negative",
            });
        }

        if (attendanceEmployees === 0 && salesEmployees === 0 && proSalesEmployees === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one employee type must be selected",
            });
        }

        // Get base plan (zero rupee plan)
        let basePlan;
        if (basePlanId) {
            basePlan = await Plan.findById(basePlanId);
        } else {
            // Find the free/zero rupee plan
            basePlan = await Plan.findOne({
                isfree: true,
                price: 0,
                isActive: true
            });
        }

        if (!basePlan) {
            return res.status(404).json({
                success: false,
                message: "Base plan not found. Please create a zero rupee plan first.",
            });
        }

        // Calculate dynamic pricing based on employee counts
        const pricing = await calculateDynamicPricing({
            attendanceEmployees,
            salesEmployees,
            proSalesEmployees,
        });

        // Apply discount if any
        const finalAmount = discount > 0
            ? Math.round(pricing.grandTotal * (1 - discount / 100))
            : pricing.grandTotal;

        // Convert to paise for Razorpay (1 INR = 100 paise)
        const amountInPaise = finalAmount * 100;

        // If total is 0, create free subscription directly
        if (finalAmount === 0) {
            const subscription = await createFreeSubscription({
                companyId,
                basePlan,
                attendanceEmployees,
                salesEmployees,
                proSalesEmployees,
                pricing,
                validityDays,
            });

            return res.status(200).json({
                success: true,
                message: "Free subscription activated successfully",
                data: {
                    subscription,
                    pricing,
                    isFree: true,
                },
            });
        }

        // Create Razorpay order for paid plans
        const orderOptions = {
            amount: amountInPaise,
            currency: "INR",
            receipt: `rcpt_${Date.now()}_${companyId.toString().slice(-6)}`,
            notes: {
                companyId: companyId.toString(),
                basePlanId: basePlan._id.toString(),
                attendanceEmployees: attendanceEmployees.toString(),
                salesEmployees: salesEmployees.toString(),
                proSalesEmployees: proSalesEmployees.toString(),
                pricing: JSON.stringify(pricing),
                type: "CUSTOM_PLAN",
            },
        };

        const razorpayOrder = await razorpay.orders.create(orderOptions);

        res.status(200).json({
            success: true,
            message: "Order created successfully",
            data: {
                order: {
                    id: razorpayOrder.id,
                    amount: razorpayOrder.amount,
                    currency: razorpayOrder.currency,
                    receipt: razorpayOrder.receipt,
                },
                pricing: {
                    breakdown: {
                        attendance: pricing.attendance,
                        sales: pricing.sales,
                        proSales: pricing.proSales,
                    },
                    totalAmount: pricing.grandTotal,
                    discount,
                    discountAmount: pricing.grandTotal - finalAmount,
                    finalAmount,
                    monthlyAmount: Math.round(finalAmount / 12),
                },
                employeeDetails: {
                    attendance: attendanceEmployees,
                    sales: salesEmployees,
                    proSales: proSalesEmployees,
                    total: attendanceEmployees + salesEmployees + proSalesEmployees,
                },
                basePlan: {
                    id: basePlan._id,
                    name: basePlan.name,
                },
                razorpayKeyId: process.env.RAZORPAY_KEY_ID,
            },
        });
    } catch (error) {
        console.error("Order creation error:", error);
        res.status(500).json({
            success: false,
            message: "Error creating order",
            error: error.message,
        });
    }
};

// @desc    Verify payment and activate subscription
// @route   POST /api/orders/verify-payment
// @access  Private
export const verifyPayment = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
        } = req.body;

        // Verify signature
        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac("sha256", process.env.RAZORPAY_API_SECRET)
            .update(sign.toString())
            .digest("hex");

        if (razorpay_signature !== expectedSign) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment signature",
            });
        }

        // Get order details from Razorpay
        const order = await razorpay.orders.fetch(razorpay_order_id);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        const { notes } = order;
        const companyId = notes.companyId;
        const basePlanId = notes.basePlanId;
        const attendanceEmployees = parseInt(notes.attendanceEmployees);
        const salesEmployees = parseInt(notes.salesEmployees);
        const proSalesEmployees = parseInt(notes.proSalesEmployees);
        const pricing = JSON.parse(notes.pricing);

        // Get base plan
        const basePlan = await Plan.findById(basePlanId);
        if (!basePlan) {
            return res.status(404).json({
                success: false,
                message: "Base plan not found",
            });
        }

        // Create subscription
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + (basePlan.validityDays || 365));

        const subscription = await Subscription.create({
            company: companyId,
            plan: basePlanId,
            planSnapshot: {
                name: `Custom Plan - ${attendanceEmployees}A/${salesEmployees}S/${proSalesEmployees}PS`,
                price: pricing.grandTotal,
                discount: 0,
                finalPrice: order.amount / 100,
                validityDays: basePlan.validityDays || 365,
                features: [
                    {
                        key: "ATTENDANCE_EMPLOYEES",
                        value: attendanceEmployees,
                        description: "Attendance module employees"
                    },
                    {
                        key: "SALES_EMPLOYEES",
                        value: salesEmployees,
                        description: "Sales module employees"
                    },
                    {
                        key: "PRO_SALES_EMPLOYEES",
                        value: proSalesEmployees,
                        description: "Pro Sales module employees"
                    },
                    {
                        key: "PRICING_BREAKDOWN",
                        value: pricing,
                        description: "Dynamic pricing details"
                    }
                ],
            },
            startDate,
            endDate,
            status: "ACTIVE",
            payment: {
                transactionId: razorpay_payment_id,
                orderId: razorpay_order_id,
                paymentGateway: "RAZORPAY",
                paymentStatus: "SUCCESS",
                amountPaid: order.amount / 100,
                currency: "INR",
                paidAt: new Date(),
            },
            usage: {
                // employeesUsed: attendanceEmployees,
                // no_of_sales_person_employeesUsed: salesEmployees,
                // no_of_pro_sales_person_employeesUsed: proSalesEmployees,
                maxEmployees: attendanceEmployees,
                no_of_sales_person_maxEmployees: salesEmployees,
                no_of_pro_sales_person_maxEmployees: proSalesEmployees,
                DATA_SEE: basePlan.data_see || false,
                DATA_EXPORT: basePlan.data_export || false,
            },
            autoRenew: false,
        });

        res.status(200).json({
            success: true,
            message: "Payment verified and subscription activated",
            data: {
                subscription,
                pricing,
            },
        });
    } catch (error) {
        console.error("Payment verification error:", error);
        res.status(500).json({
            success: false,
            message: "Error verifying payment",
            error: error.message,
        });
    }
};

// @desc    Preview custom plan pricing
// @route   POST /api/orders/preview-custom-plan
// @access  Public
export const previewCustomPlan = async (req, res) => {
    try {
        const {
            attendanceEmployees = 0,
            salesEmployees = 0,
            proSalesEmployees = 0,
            discount = 0,
        } = req.body;

        // Calculate dynamic pricing
        const pricing = await calculateDynamicPricing({
            attendanceEmployees,
            salesEmployees,
            proSalesEmployees,
        });

        const finalPrice = discount > 0
            ? Math.round(pricing.grandTotal * (1 - discount / 100))
            : pricing.grandTotal;

        // Get base plan info
        const basePlan = await Plan.findOne({
            isfree: true,
            price: 0,
            isActive: true
        });

        res.status(200).json({
            success: true,
            data: {
                basePlan: basePlan ? {
                    id: basePlan._id,
                    name: basePlan.name,
                    validityDays: basePlan.validityDays,
                } : null,
                employeeAllocation: {
                    attendance: attendanceEmployees,
                    sales: salesEmployees,
                    proSales: proSalesEmployees,
                    total: attendanceEmployees + salesEmployees + proSalesEmployees,
                },
                pricing: {
                    attendance: {
                        employees: pricing.attendance.employees,
                        pricePerEmployee: pricing.attendance.pricePerEmployee,
                        total: pricing.attendance.total,
                        slab: pricing.slabs.attendance,
                    },
                    sales: {
                        employees: pricing.sales.employees,
                        pricePerEmployee: pricing.sales.pricePerEmployee,
                        total: pricing.sales.total,
                        slab: pricing.slabs.sales,
                    },
                    proSales: {
                        employees: pricing.proSales.employees,
                        pricePerEmployee: pricing.proSales.pricePerEmployee,
                        total: pricing.proSales.total,
                        slab: pricing.slabs.proSales,
                    },
                    summary: {
                        totalYearly: pricing.grandTotal,
                        discount,
                        discountAmount: pricing.grandTotal - finalPrice,
                        finalYearlyPrice: finalPrice,
                        monthlyPrice: Math.round(finalPrice / 12),
                        perDayPrice: Math.round(finalPrice / 365),
                    },
                },
            },
        });
    } catch (error) {
        console.error("Preview error:", error);
        res.status(500).json({
            success: false,
            message: "Error previewing pricing",
            error: error.message,
        });
    }
};

// Helper function to create free subscription
const createFreeSubscription = async ({
    companyId,
    basePlan,
    attendanceEmployees,
    salesEmployees,
    proSalesEmployees,
    pricing,
    validityDays,
}) => {
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (validityDays || basePlan.validityDays || 365));

    return await Subscription.create({
        company: companyId,
        plan: basePlan._id,
        planSnapshot: {
            name: `Free Custom Plan - ${attendanceEmployees}A/${salesEmployees}S/${proSalesEmployees}PS`,
            price: 0,
            discount: 0,
            finalPrice: 0,
            validityDays: validityDays || basePlan.validityDays || 365,
            features: [
                {
                    key: "ATTENDANCE_EMPLOYEES",
                    value: attendanceEmployees,
                },
                {
                    key: "SALES_EMPLOYEES",
                    value: salesEmployees,
                },
                {
                    key: "PRO_SALES_EMPLOYEES",
                    value: proSalesEmployees,
                },
            ],
        },
        startDate,
        endDate,
        status: "ACTIVE",
        payment: {
            paymentGateway: "FREE_PLAN",
            paymentStatus: "SUCCESS",
            amountPaid: 0,
        },
        usage: {
            employeesUsed: attendanceEmployees,
            no_of_sales_person_employeesUsed: salesEmployees,
            no_of_pro_sales_person_employeesUsed: proSalesEmployees,
            maxEmployees: attendanceEmployees,
            no_of_sales_person_maxEmployees: salesEmployees,
            no_of_pro_sales_person_maxEmployees: proSalesEmployees,
        },
    });
};