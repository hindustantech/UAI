// controllers/salesController.js

import mongoose from "mongoose";
import { SalesSession } from '../../../models/Attandance/Salses/Salses.js';
import Employee from "../../../models/Attandance/Employee.js";
import User from '../../../models/userModel.js'


/**
 * Get all sales records for a particular company with advanced filtering
 * @route GET /api/sales/company/:companyId
 * Query params:
 * - startDate: ISO date string (from date)
 * - endDate: ISO date string (to date)
 * - customerId: filter by specific customer
 * - salesPersonId: filter by assigned sales person
 * - assignedToMe: boolean - filter sessions assigned to specific person
 * - status: filter by session status (in_progress/completed)
 * - salesStatus: filter by sales status (open/closed/follow_up)
 * - dealStatus: filter by deal status (Negotiation/Closed Won/Closed Lost/Follow Up)
 * - minAmount: minimum deal amount
 * - maxAmount: maximum deal amount
 * - paymentCollected: boolean
 * - search: search in customer name, phone, company name
 */
export const getCompanySalesRecords = async (req, res) => {
    try {
        const { companyId } = req.params;
        const {
            startDate,
            endDate,
            customerId,
            salesPersonId,
            assignedToMe,
            status,
            salesStatus,
            dealStatus,
            minAmount,
            maxAmount,
            paymentCollected,
            search,
            page = 1,
            limit = 50
        } = req.query;

        // Validate companyId
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid company ID"
            });
        }

        // Build match conditions
        const matchConditions = {
            companyId: new mongoose.Types.ObjectId(companyId)
        };

        // Date range filter (using createdAt or punchInTime)
        if (startDate || endDate) {
            matchConditions.$or = [
                { createdAt: {} },
                { punchInTime: {} }
            ];

            if (startDate && endDate) {
                matchConditions.$or[0].createdAt = {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                };
                matchConditions.$or[1].punchInTime = {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                };
            } else if (startDate) {
                matchConditions.$or[0].createdAt = { $gte: new Date(startDate) };
                matchConditions.$or[1].punchInTime = { $gte: new Date(startDate) };
            } else if (endDate) {
                matchConditions.$or[0].createdAt = { $lte: new Date(endDate) };
                matchConditions.$or[1].punchInTime = { $lte: new Date(endDate) };
            }
        }

        // Filter by specific customer
        if (customerId && mongoose.Types.ObjectId.isValid(customerId)) {
            matchConditions['customer.customerId'] = new mongoose.Types.ObjectId(customerId);
        }

        // Filter by sales person (assignedTo)
        if (assignedToMe === 'true' && req.user?._id) {
            matchConditions.assignedTo = new mongoose.Types.ObjectId(req.user._id);
        } else if (salesPersonId && mongoose.Types.ObjectId.isValid(salesPersonId)) {
            matchConditions.assignedTo = new mongoose.Types.ObjectId(salesPersonId);
        }

        // Filter by status
        if (status) {
            matchConditions.status = status;
        }

        // Filter by sales status
        if (salesStatus) {
            matchConditions.SalesStatus = salesStatus;
        }

        // Search in customer fields
        if (search) {
            matchConditions.$or = [
                { 'customer.companyName': { $regex: search, $options: 'i' } },
                { 'customer.contactName': { $regex: search, $options: 'i' } },
                { 'customer.phoneNumber': { $regex: search, $options: 'i' } },
                { 'customer.address': { $regex: search, $options: 'i' } }
            ];
        }

        // Pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const limitNum = parseInt(limit);

        // Build salesLogs filter conditions for $elemMatch
        const salesLogsFilter = {};
        if (dealStatus) salesLogsFilter.dealStatus = dealStatus;
        if (minAmount || maxAmount) {
            salesLogsFilter.amount = {};
            if (minAmount) salesLogsFilter.amount.$gte = parseFloat(minAmount);
            if (maxAmount) salesLogsFilter.amount.$lte = parseFloat(maxAmount);
        }
        if (paymentCollected !== undefined) {
            salesLogsFilter.paymentCollected = paymentCollected === 'true';
        }

        // Main aggregation pipeline
        const pipeline = [
            // Initial match
            { $match: matchConditions },

            // Only include documents that have at least one salesLog
            { $match: { "salesLogs.0": { $exists: true } } },
        ];

        // Add salesLogs filtering if any filters are present
        if (Object.keys(salesLogsFilter).length > 0) {
            pipeline.push({
                $match: {
                    "salesLogs": {
                        $elemMatch: salesLogsFilter
                    }
                }
            });
        }

        // Add remaining stages
        pipeline.push(
            // Lookup assigned users (sales persons)
            {
                $lookup: {
                    from: "users",
                    localField: "assignedTo",
                    foreignField: "_id",
                    as: "assignedUsers"
                }
            },
            // Lookup created by user
            {
                $lookup: {
                    from: "users",
                    localField: "createdBy",
                    foreignField: "_id",
                    as: "createdByUser"
                }
            },
            // Lookup employee
            {
                $lookup: {
                    from: "users",
                    localField: "employeeId",
                    foreignField: "_id",
                    as: "employeeUser"
                }
            },
            // Add computed fields
            {
                $addFields: {
                    customerInfo: {
                        customerId: "$customer.customerId",
                        companyName: "$customer.companyName",
                        contactName: "$customer.contactName",
                        phoneNumber: "$customer.phoneNumber",
                        address: "$customer.address",
                        landmark: "$customer.landmark",
                        location: "$customer.location"
                    },
                    salesPersons: {
                        $map: {
                            input: "$assignedUsers",
                            as: "user",
                            in: {
                                userId: "$$user._id",
                                name: "$$user.name",
                                email: "$$user.email",
                                phone: "$$user.phone"
                            }
                        }
                    },
                    createdByInfo: {
                        $map: {
                            input: "$createdByUser",
                            as: "user",
                            in: {
                                userId: "$$user._id",
                                name: "$$user.name",
                                email: "$$user.email"
                            }
                        }
                    },
                    totalSalesAmount: {
                        $sum: "$salesLogs.amount"
                    },
                    totalPaymentCollected: {
                        $sum: {
                            $cond: ["$salesLogs.paymentCollected", "$salesLogs.amount", 0]
                        }
                    },
                    salesCount: {
                        $size: "$salesLogs"
                    }
                }
            },
            // Sort by createdAt descending
            { $sort: { createdAt: -1 } },
            // Pagination
            { $skip: skip },
            { $limit: limitNum }
        );

        // Count pipeline for pagination
        const countPipeline = [
            { $match: matchConditions },
            { $match: { "salesLogs.0": { $exists: true } } }
        ];

        if (Object.keys(salesLogsFilter).length > 0) {
            countPipeline.push({
                $match: {
                    "salesLogs": {
                        $elemMatch: salesLogsFilter
                    }
                }
            });
        }

        countPipeline.push({ $count: "total" });

        // Execute both aggregations
        const [salesRecords, totalCountResult] = await Promise.all([
            SalesSession.aggregate(pipeline),
            SalesSession.aggregate(countPipeline)
        ]);

        const total = totalCountResult[0]?.total || 0;

        // Calculate summary statistics
        const summary = salesRecords.reduce((acc, record) => {
            acc.totalSalesAmount += record.totalSalesAmount || 0;
            acc.totalPaymentCollected += record.totalPaymentCollected || 0;
            acc.totalSalesCount += record.salesCount || 0;
            return acc;
        }, {
            totalSalesAmount: 0,
            totalPaymentCollected: 0,
            totalSalesCount: 0
        });

        res.status(200).json({
            success: true,
            data: salesRecords,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limitNum),
                totalRecords: total,
                recordsPerPage: limitNum
            },
            summary
        });

    } catch (error) {
        console.error("Error in getCompanySalesRecords:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching sales records",
            error: error.message
        });
    }
};
/**
 * Simplified version - Get sales records with basic filtering
 * @route GET /api/sales/company/:companyId/summary
 */
export const getCompanySalesSummary = async (req, res) => {
    try {
        const { companyId } = req.params;
        const { startDate, endDate, salesPersonId, customerId } = req.query;

        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid company ID"
            });
        }

        const matchConditions = {
            companyId: new mongoose.Types.ObjectId(companyId),
            'salesLogs.0': { $exists: true } // Has at least one sales log
        };

        // Date filter
        if (startDate || endDate) {
            matchConditions.createdAt = {};
            if (startDate) matchConditions.createdAt.$gte = new Date(startDate);
            if (endDate) matchConditions.createdAt.$lte = new Date(endDate);
        }

        // Sales person filter
        if (salesPersonId && mongoose.Types.ObjectId.isValid(salesPersonId)) {
            matchConditions.assignedTo = new mongoose.Types.ObjectId(salesPersonId);
        }

        // Customer filter
        if (customerId) {
            matchConditions['customer.customerId'] = customerId;
        }

        const records = await SalesSession.find(matchConditions)
            .select({
                sessionId: 1,
                customer: 1,
                salesLogs: 1,
                assignedTo: 1,
                createdAt: 1,
                status: 1,
                SalesStatus: 1
            })
            .populate('assignedTo', 'name email phone')
            .sort({ createdAt: -1 });

        // Format response
        const formattedRecords = records.map(record => ({
            sessionId: record.sessionId,
            customer: {
                customerId: record.customer?.customerId,
                companyName: record.customer?.companyName,
                contactName: record.customer?.contactName,
                phoneNumber: record.customer?.phoneNumber,
                address: record.customer?.address,
                landmark: record.customer?.landmark
            },
            salesPerson: record.assignedTo?.map(user => ({
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone
            })),
            salesRecords: record.salesLogs,
            totalAmount: record.salesLogs?.reduce((sum, log) => sum + (log.amount || 0), 0) || 0,
            createdAt: record.createdAt,
            status: record.status,
            salesStatus: record.SalesStatus
        }));

        res.status(200).json({
            success: true,
            count: formattedRecords.length,
            data: formattedRecords
        });

    } catch (error) {
        console.error("Error in getCompanySalesSummary:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching sales summary",
            error: error.message
        });
    }
};

/**
 * Get sales records assigned to a specific sales person
 * @route GET /api/sales/assigned-to/:userId
 */
export const getSalesBySalesPerson = async (req, res) => {
    try {
        const { userId } = req.params;
        const { startDate, endDate, companyId, status } = req.query;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID"
            });
        }

        const matchConditions = {
            assignedTo: new mongoose.Types.ObjectId(userId),
            'salesLogs.0': { $exists: true }
        };

        if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
            matchConditions.companyId = new mongoose.Types.ObjectId(companyId);
        }

        if (status) {
            matchConditions.status = status;
        }

        if (startDate || endDate) {
            matchConditions.createdAt = {};
            if (startDate) matchConditions.createdAt.$gte = new Date(startDate);
            if (endDate) matchConditions.createdAt.$lte = new Date(endDate);
        }

        const salesRecords = await SalesSession.find(matchConditions)
            .populate('companyId', 'name email')
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 });

        const formattedResponse = salesRecords.map(record => ({
            sessionId: record.sessionId,
            company: record.companyId,
            customer: record.customer,
            salesLogs: record.salesLogs,
            totalAmount: record.salesLogs.reduce((sum, log) => sum + (log.amount || 0), 0),
            createdAt: record.createdAt,
            meetingLogs: record.meetingLogs,
            nextMeeting: record.nextMeeting
        }));

        res.status(200).json({
            success: true,
            count: formattedResponse.length,
            data: formattedResponse
        });

    } catch (error) {
        console.error("Error in getSalesBySalesPerson:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching sales by sales person",
            error: error.message
        });
    }
};


/* ============================================================
BULK ASSIGN SALES SESSIONS TO A SALESPERSON
============================================================ */

/**
 * Bulk assign multiple sales sessions (by sessionId or _id) to one salesperson
 * Body: { ids: [String], salespersonId: String, mode: "replace" | "append" }
 *  - ids: array of SalesSession _id or sessionId values
 *  - salespersonId: User _id of the salesperson to assign
 *  - mode: "replace" (default) overwrites assignedTo, "append" adds without duplicating
 */
export const BulkAssignSales = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const { ids, salespersonId, mode = "replace" } = req.body;
        const companyId = req.user._id || req.user.id || req.user.companyId;

        /* ---------------- INPUT VALIDATION ---------------- */
        if (!companyId) {
            return res.status(400).json({
                success: false,
                message: "Could not determine company for this user"
            });
        }

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: "`ids` must be a non-empty array of session IDs"
            });
        }

        if (ids.length > 1000) {
            return res.status(400).json({
                success: false,
                message: "Cannot assign more than 1000 sessions in a single request"
            });
        }

        if (!salespersonId || !mongoose.Types.ObjectId.isValid(salespersonId)) {
            return res.status(400).json({
                success: false,
                message: "Valid `salespersonId` is required"
            });
        }

        if (!["replace", "append"].includes(mode)) {
            return res.status(400).json({
                success: false,
                message: "`mode` must be either 'replace' or 'append'"
            });
        }

        /* ---------------- VALIDATE SALESPERSON ---------------- */
        const salesperson = await User.findOne({
            _id: salespersonId,
            accountStatus: "ACTIVE",
            suspend: false
        }).select("_id name email uid referalCode type");

        if (!salesperson) {
            return res.status(404).json({
                success: false,
                message: "Salesperson not found or is inactive/suspended"
            });
        }

        const employee = await Employee.findOne({
            userId: salesperson._id,
            companyId: companyId,
            employmentStatus: "active"
        });

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Salesperson is not an active employee of this company"
            });
        }

        if (!["sales", "pro_sales"].includes(employee.employeeType)) {
            return res.status(400).json({
                success: false,
                message: "Selected user is not a sales employee"
            });
        }

        /* ---------------- SPLIT IDS: ObjectId vs sessionId string ---------------- */
        const objectIdList = [];
        const sessionIdList = [];

        for (const rawId of ids) {
            const id = String(rawId).trim();
            if (!id) continue;

            if (mongoose.Types.ObjectId.isValid(id)) {
                objectIdList.push(new mongoose.Types.ObjectId(id));
            } else {
                sessionIdList.push(id);
            }
        }

        if (objectIdList.length === 0 && sessionIdList.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid session identifiers provided"
            });
        }

        /* ---------------- FETCH MATCHING SESSIONS (scoped to company) ---------------- */
        const matchQuery = {
            companyId: companyId,
            $or: [
                ...(objectIdList.length ? [{ _id: { $in: objectIdList } }] : []),
                ...(sessionIdList.length ? [{ sessionId: { $in: sessionIdList } }] : [])
            ]
        };

        const existingSessions = await SalesSession.find(matchQuery)
            .select("_id sessionId assignedTo employeeId");

        if (existingSessions.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No matching sales sessions found for this company"
            });
        }

        const foundIdsSet = new Set([
            ...existingSessions.map(s => s._id.toString()),
            ...existingSessions.map(s => s.sessionId)
        ]);

        const notFound = ids.filter(rawId => {
            const id = String(rawId).trim();
            return !foundIdsSet.has(id);
        });

        /* ---------------- BUILD BULK OPERATIONS ---------------- */
        const bulkOps = existingSessions.map(s => {
            const update = mode === "append"
                ? {
                    $addToSet: { assignedTo: salesperson._id },
                    $set: { employeeId: salesperson._id }
                }
                : {
                    $set: {
                        assignedTo: [salesperson._id],
                        employeeId: salesperson._id
                    }
                };

            return {
                updateOne: {
                    filter: { _id: s._id, companyId: companyId },
                    update
                }
            };
        });

        /* ---------------- EXECUTE BATCH WRITE (transactional) ---------------- */
        let bulkResult;
        await session.withTransaction(async () => {
            bulkResult = await SalesSession.bulkWrite(bulkOps, { session, ordered: false });
        });

        return res.status(200).json({
            success: true,
            message: "Bulk assignment completed",
            data: {
                assignedTo: {
                    id: salesperson._id,
                    name: salesperson.name,
                    uid: salesperson.uid,
                    referralCode: salesperson.referalCode
                },
                mode,
                summary: {
                    requested: ids.length,
                    matched: bulkResult.matchedCount,
                    modified: bulkResult.modifiedCount,
                    notFound: notFound.length
                },
                notFoundIds: notFound
            }
        });

    } catch (error) {
        console.error("Bulk assign error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error during bulk assignment",
            error: error.message
        });
    } finally {
        session.endSession();
    }
};