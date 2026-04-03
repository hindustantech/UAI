// controllers/subscription.controller.js

import mongoose from "mongoose";
import { Subscription } from "../../../models/Attandance/subscration/Subscription.js";

export const getAllSubscriptions = async (req, res) => {
    try {
        /* ------------------------------------------
           1. Query Params (Pagination + Filters)
        ------------------------------------------ */
        let {
            page = 1,
            limit = 10,
            status,
            company,
            search,
            sortBy = "createdAt",
            sortOrder = "desc",
            startDate,
            endDate,
        } = req.query;

        page = parseInt(page);
        limit = parseInt(limit);
        const skip = (page - 1) * limit;

        /* ------------------------------------------
           2. Build Filter Query
        ------------------------------------------ */
        const filter = {};

        if (status) filter.status = status;
        if (company && mongoose.Types.ObjectId.isValid(company)) {
            filter.company = company;
        }

        // Date range filter
        if (startDate || endDate) {
            filter.startDate = {};
            if (startDate) filter.startDate.$gte = new Date(startDate);
            if (endDate) filter.startDate.$lte = new Date(endDate);
        }

        // Search (Plan name / transactionId)
        if (search) {
            filter.$or = [
                { "planSnapshot.name": { $regex: search, $options: "i" } },
                { "payment.transactionId": { $regex: search, $options: "i" } }
            ];
        }

        /* ------------------------------------------
           3. Sorting
        ------------------------------------------ */
        const sort = {
            [sortBy]: sortOrder === "asc" ? 1 : -1
        };

        /* ------------------------------------------
           4. Query Execution
        ------------------------------------------ */
        const [subscriptions, total] = await Promise.all([
            Subscription.find(filter)
                .populate("company", "name email")
                .populate("plan", "name price validityDays")
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean(),

            Subscription.countDocuments(filter)
        ]);

        /* ------------------------------------------
           5. Pagination Meta (IMPORTANT for UI)
        ------------------------------------------ */
        const totalPages = Math.ceil(total / limit);

        const pagination = {
            totalRecords: total,
            totalPages,
            currentPage: page,
            perPage: limit,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
        };

        /* ------------------------------------------
           6. Aggregated Stats (Admin Dashboard)
        ------------------------------------------ */
        const stats = await Subscription.aggregate([
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 },
                    revenue: { $sum: "$payment.amountPaid" }
                }
            }
        ]);

        /* ------------------------------------------
           7. Response (Admin Panel Ready)
        ------------------------------------------ */
        return res.status(200).json({
            success: true,
            message: "Subscriptions fetched successfully",
            data: subscriptions,
            pagination,
            stats
        });

    } catch (error) {
        console.error("GET SUBSCRIPTIONS ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch subscriptions",
            error: error.message
        });
    }
};



export const getCurrentActiveSubscription = async (req, res) => {
    try {
        const companyId = req.user.id; // logged-in company

        // =========================
        // VALIDATION
        // =========================
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid company ID"
            });
        }

        const now = new Date();

        // =========================
        // QUERY (CRITICAL)
        // =========================
        const subscription = await Subscription.findOne({
            company: companyId,
            status: "ACTIVE",
            isActive: true,
            "payment.paymentStatus": "SUCCESS",
            endDate: { $gte: now }
        })
            .populate("plan", "name price validityDays")
            .sort({ endDate: -1 }) // latest valid subscription
            .lean();

        // =========================
        // RESPONSE
        // =========================
        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: "No active subscription found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Active subscription fetched",
            data: subscription
        });

    } catch (error) {
        console.error("GET CURRENT SUBSCRIPTION ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch active subscription",
            error: error.message
        });
    }
};


export const getSubscriptionHistory = async (req, res) => {
    try {
        const companyId = req.user.id; // logged-in company
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid company ID"
            });
        }

        const subscriptions = await Subscription.find({
            company: companyId,
            "payment.paymentStatus": "SUCCESS"
        })
            .populate("plan", "name price validityDays")
            .sort({ startDate: -1 })
            .lean();
        return res.status(200).json({
            success: true,
            message: "Subscription history fetched",
            data: subscriptions
        });
    } catch (error) {
        console.error("GET SUBSCRIPTION HISTORY ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch subscription history",
            error: error.message
        });
    }
};


