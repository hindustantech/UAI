import mongoose from "mongoose";
import Attendance from "../../models/Attandance/Attendance.js";
import AttendanceRequest from '../../models/Attandance/Request.js'
import Employee from "../../models/Attandance/Employee.js";

/*
====================================
1. CREATE ATTENDANCE REQUEST
====================================
*/
import AttendanceRequest from "../../models/AttendanceRequest.js";
import Employee from "../../models/Employee.js";

/*
    UTIL: Normalize date (remove time part)
*/
const normalizeDate = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

/*
    UTIL: Validate punch payload based on type
*/
const validatePunchByType = (type, punchDetails) => {
    if (!punchDetails?.date) {
        throw new Error("punchDetails.date is required");
    }

    if (type === "punch_in") {
        if (!punchDetails.punchInTime) {
            throw new Error("punchInTime is required for punch_in");
        }
    }

    if (type === "punch_in_out") {
        if (!punchDetails.punchOutTime) {
            throw new Error("punchOutTime is required for punch_out");
        }
    }

    if (type === "punch_in_and_out") {
        if (!punchDetails.punchInTime || !punchDetails.punchOutTime) {
            throw new Error("Both punchInTime and punchOutTime are required");
        }

        if (new Date(punchDetails.punchInTime) > new Date(punchDetails.punchOutTime)) {
            throw new Error("punchInTime cannot be after punchOutTime");
        }
    }
};

/*
    MAIN CONTROLLER
*/
export const createAttendanceRequest = async (req, res) => {
    try {
        const {
            requestType,
            reason,
            leaveDetails,
            punchDetails
        } = req.body;

        const userId = req.user._id;

        /*
            STEP 1: GET EMPLOYEE
        */
        const employee = await Employee.findOne({ userId });

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }

        /*
            STEP 2: COMMON VALIDATION
        */
        if (!requestType) {
            return res.status(400).json({
                success: false,
                message: "requestType is required"
            });
        }

        /*
            ===============================
            LEAVE FLOW
            ===============================
        */
        if (requestType === "leave") {

            if (!leaveDetails?.startDate || !leaveDetails?.endDate) {
                return res.status(400).json({
                    success: false,
                    message: "startDate and endDate are required"
                });
            }

            const startDate = normalizeDate(leaveDetails.startDate);
            const endDate = normalizeDate(leaveDetails.endDate);

            if (startDate > endDate) {
                return res.status(400).json({
                    success: false,
                    message: "Start date cannot be after end date"
                });
            }

            /*
                OVERLAP CHECK (CRITICAL)
            */
            const overlapping = await AttendanceRequest.findOne({
                employeeId: employee._id,
                requestType: "leave",
                status: { $in: ["pending", "approved"] },
                $or: [
                    {
                        "leaveDetails.startDate": { $lte: endDate },
                        "leaveDetails.endDate": { $gte: startDate }
                    }
                ]
            });

            if (overlapping) {
                return res.status(400).json({
                    success: false,
                    message: "Leave request overlaps existing request"
                });
            }
        }

        /*
            ===============================
            PUNCH FLOW
            ===============================
        */
        if (
            ["punch_in", "punch_in_out", "punch_in_and_out"]
                .includes(requestType)
        ) {
            try {
                validatePunchByType(requestType, punchDetails);
            } catch (err) {
                return res.status(400).json({
                    success: false,
                    message: err.message
                });
            }

            const requestDate = normalizeDate(punchDetails.date);
            const today = normalizeDate(new Date());

            if (requestDate > today) {
                return res.status(400).json({
                    success: false,
                    message: "Future date not allowed"
                });
            }

            /*
                DUPLICATE CHECK
                (Same date + same type pending)
            */
            const existing = await AttendanceRequest.findOne({
                employeeId: employee._id,
                requestType,
                "punchDetails.date": requestDate,
                status: "pending"
            });

            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: "Request already exists for this date"
                });
            }
        }

        /*
            STEP 3: CLEAN PAYLOAD (IMPORTANT)
            Avoid storing unnecessary fields
        */
        let payload = {
            companyId: employee.companyId,
            employeeId: employee._id,
            requestType,
            reason: reason || ""
        };

        if (requestType === "leave") {
            payload.leaveDetails = {
                startDate: normalizeDate(leaveDetails.startDate),
                endDate: normalizeDate(leaveDetails.endDate)
            };
        }

        if (
            ["punch_in", "punch_in_out", "punch_in_and_out"]
                .includes(requestType)
        ) {
            payload.punchDetails = {
                date: normalizeDate(punchDetails.date),
                punchInTime: punchDetails.punchInTime || null,
                punchOutTime: punchDetails.punchOutTime || null
            };
        }

        /*
            STEP 4: CREATE
        */
        const request = await AttendanceRequest.create(payload);

        /*
            STEP 5: POPULATE (FOR UI)
        */
        await request.populate({
            path: "employeeId",
            populate: {
                path: "userId",
                select: "name email profileImage"
            }
        });

        /*
            STEP 6: RESPONSE
        */
        return res.status(201).json({
            success: true,
            message: "Request created successfully",
            data: request
        });

    } catch (error) {
        console.error("createAttendanceRequest ERROR:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error"
        });
    }
};
/*
====================================
2. GET ALL REQUESTS (with filters)
====================================
*/
export const getAttendanceRequests = async (req, res) => {
    try {
        const {
            status,
            requestType,
            startDate,
            endDate,
            page = 1,
            limit = 10,
            companyId,
        } = req.query;

        const userId = req.user._id;
        const userRole = req.user.role || req.user.type;


        // Build query based on user role
        let query = { companyId };

        if (userRole === "partner" || userRole === "manager") {
            // Admins can see all requests for their company
            // No need to filter by employee
        } else {
            // Regular users - get their employee record first
            const employee = await Employee.findOne({ companyId, userId });
            if (!employee) {
                return res.status(404).json({
                    success: false,
                    message: "Employee record not found"
                });
            }
            query.employeeId = employee._id;
        }

        // Apply filters
        if (status) {
            query.status = status;
        }

        if (requestType) {
            query.requestType = requestType;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                query.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                query.createdAt.$lte = new Date(endDate);
            }
        }

        // Pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const requests = await AttendanceRequest.find(query)
            .populate({
                path: "employeeId",
                populate: {
                    path: "userId",
                    select: "name email profileImage"
                }
            })
            .populate("approvedBy", "name email")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await AttendanceRequest.countDocuments(query);

        return res.json({
            success: true,
            data: requests,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / parseInt(limit))
            }
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/*
====================================
3. GET SINGLE REQUEST
====================================
*/
export const getAttendanceRequestById = async (req, res) => {
    try {
        const { requestId } = req.params;
        const userId = req.user._id;
        const userRole = req.user.role;
        const companyId = req.user.companyId;

        if (!mongoose.Types.ObjectId.isValid(requestId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid request ID"
            });
        }

        const request = await AttendanceRequest.findById(requestId)
            .populate({
                path: "employeeId",
                populate: {
                    path: "userId",
                    select: "name email profileImage"
                }
            })
            .populate("approvedBy", "name email");

        if (!request) {
            return res.status(404).json({
                success: false,
                message: "Request not found"
            });
        }

        // Check authorization
        if (userRole !== "admin") {
            // Get employee record for current user
            const employee = await Employee.findOne({ companyId, userId });
            if (!employee || request.employeeId._id.toString() !== employee._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to view this request"
                });
            }
        }

        return res.json({
            success: true,
            data: request
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/*
====================================
4. APPROVE REQUEST
====================================
*/


export const approveAttendanceRequest = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { requestId } = req.params;
        const adminId = req.user._id;

        // ───────────────────────── VALIDATION ─────────────────────────
        if (!mongoose.Types.ObjectId.isValid(requestId)) {
            throw new Error("Invalid request ID");
        }

        const request = await AttendanceRequest.findById(requestId).session(session);

        if (!request) throw new Error("Request not found");
        if (request.status !== "pending") {
            throw new Error(`Request already ${request.status}`);
        }

        // ============================================================
        // 🔹 LEAVE FLOW
        // ============================================================
        if (request.requestType === "leave") {
            const startDate = parseValidDate(request?.leaveDetails?.startDate);
            const endDate = parseValidDate(request?.leaveDetails?.endDate);

            if (!startDate || !endDate) {
                throw new Error("Invalid leave dates");
            }

            for (
                let d = new Date(startDate.getTime());
                d <= endDate;
                d = new Date(d.getTime() + 86400000)
            ) {
                const { start, end } = getDayBounds(d);

                await Attendance.findOneAndUpdate(
                    {
                        companyId: request.companyId,
                        employeeId: request.employeeId,
                        date: { $gte: start, $lt: end }
                    },
                    {
                        $set: {
                            date: start,
                            status: "leave",
                            approvalStatus: "approved",
                            remarks: `Leave approved via request ${requestId}`,
                            geoLocation: {
                                type: "Point",
                                coordinates: [0, 0],
                                verified: false,
                                source: "manual"
                            }
                        }
                    },
                    { upsert: true, new: true, session }
                );
            }
        }

        // ============================================================
        // 🔹 PUNCH FLOW (FIXED CORE ISSUE)
        // ============================================================
        if (
            ["punch_in_out", "punch_in_and_out", "punch_in"].includes(
                request.requestType
            )
        ) {
            // ✅ SAFE DATE RESOLUTION (NO CRASH)
            const baseDate = resolvePunchBaseDate(request?.punchDetails);

            if (!baseDate) {
                await session.abortTransaction();
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid punch request: date, punchInTime, or punchOutTime required"
                });
            }

            const { start, end } = getDayBounds(baseDate);

            const updateFields = {
                status: "present",
                approvalStatus: "approved",
                remarks: `Punch corrected via request ${requestId}`
            };

            // Safe time parsing
            const punchIn = parseValidDate(request?.punchDetails?.punchInTime);
            const punchOut = parseValidDate(request?.punchDetails?.punchOutTime);

            if (punchIn) updateFields.punchIn = punchIn;
            if (punchOut) updateFields.punchOut = punchOut;

            const existingAttendance = await Attendance.findOne({
                companyId: request.companyId,
                employeeId: request.employeeId,
                date: { $gte: start, $lt: end }
            }).session(session);

            // ───────── GEO RESOLUTION ─────────
            let geoLocation = {
                type: "Point",
                coordinates: [0, 0],
                verified: false,
                source: "manual"
            };

            if (!existingAttendance) {
                const employee = await Employee.findById(
                    request.employeeId
                ).session(session);

                const prevStart = new Date(start.getTime() - 86400000);
                const prevEnd = start;

                const prev = await Attendance.findOne({
                    companyId: request.companyId,
                    employeeId: request.employeeId,
                    date: { $gte: prevStart, $lt: prevEnd }
                }).session(session);

                if (prev?.geoLocation?.coordinates?.length) {
                    geoLocation = {
                        ...prev.geoLocation.toObject?.() ?? prev.geoLocation,
                        verified: false,
                        source: "manual"
                    };
                } else if (employee?.officeLocation?.coordinates?.length) {
                    geoLocation = {
                        type: employee.officeLocation.type || "Point",
                        coordinates: employee.officeLocation.coordinates,
                        verified: false,
                        source: "manual"
                    };
                }
            }

            // ───────── AUDIT LOG ─────────
            const editLog = {
                editedBy: adminId,
                reason: request.reason,
                oldValue: {
                    punchIn: existingAttendance?.punchIn || null,
                    punchOut: existingAttendance?.punchOut || null
                },
                newValue: {
                    punchIn:
                        updateFields.punchIn ||
                        existingAttendance?.punchIn ||
                        null,
                    punchOut:
                        updateFields.punchOut ||
                        existingAttendance?.punchOut ||
                        null
                },
                editedAt: new Date()
            };

            // ───────── UPSERT ─────────
            await Attendance.findOneAndUpdate(
                {
                    companyId: request.companyId,
                    employeeId: request.employeeId,
                    date: { $gte: start, $lt: end }
                },
                {
                    $set: {
                        ...updateFields,
                        ...(existingAttendance
                            ? {}
                            : { geoLocation, date: start })
                    },
                    $push: { editLogs: editLog }
                },
                { upsert: true, new: true, session }
            );
        }

        // ============================================================
        // 🔹 FINALIZE
        // ============================================================
        request.status = "approved";
        request.approvedBy = adminId;
        request.approvedAt = new Date();

        await request.save({ session });

        await session.commitTransaction();

        return res.status(200).json({
            success: true,
            message: "Request approved successfully",
            data: request
        });

    } catch (error) {
        await session.abortTransaction();

        console.error("approveAttendanceRequest ERROR:", {
            message: error.message,
            stack: error.stack
        });

        return res.status(500).json({
            success: false,
            message: error.message
        });
    } finally {
        session.endSession();
    }
};


export const parseValidDate = (value, fieldName = "date") => {
    if (!value) return null;

    const parsed = new Date(value);

    if (isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
};

export const resolvePunchBaseDate = (punchDetails = {}) => {
    // Priority order
    let baseDate =
        parseValidDate(punchDetails.date) ||
        parseValidDate(punchDetails.punchInTime) ||
        parseValidDate(punchDetails.punchOutTime);

    return baseDate;
};

export const getDayBounds = (date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start.getTime() + 86400000);

    return { start, end };
};
/*
====================================
5. REJECT REQUEST
====================================
*/
export const rejectAttendanceRequest = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { requestId } = req.params;
        const { reason } = req.body;
        const adminId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(requestId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid request ID"
            });
        }

        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Rejection reason is required"
            });
        }

        const request = await AttendanceRequest.findById(requestId).session(session);

        if (!request) {
            return res.status(404).json({
                success: false,
                message: "Request not found"
            });
        }

        if (request.status !== "pending") {
            return res.status(400).json({
                success: false,
                message: `Request already ${request.status}`
            });
        }

        // Update request status
        request.status = "rejected";
        request.approvedBy = adminId;
        request.rejectionReason = reason;
        request.approvedAt = new Date();
        await request.save({ session });

        // If it was a leave request, mark any auto-created attendance as rejected
        if (request.requestType === "leave") {
            const start = new Date(request.leaveDetails.startDate);
            const end = new Date(request.leaveDetails.endDate);

            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);

            await Attendance.updateMany(
                {
                    companyId: request.companyId,
                    employeeId: request.employeeId,
                    date: {
                        $gte: start,
                        $lte: end
                    },
                    isAutoMarked: true
                },
                {
                    $set: {
                        status: "absent",
                        approvalStatus: "rejected",
                        remarks: `Leave request rejected: ${reason}`
                    }
                },
                { session }
            );
        }

        await session.commitTransaction();

        return res.json({
            success: true,
            message: "Request rejected successfully",
            data: request
        });

    } catch (error) {
        await session.abortTransaction();
        return res.status(500).json({
            success: false,
            message: error.message
        });
    } finally {
        session.endSession();
    }
};

/*
====================================
6. CANCEL REQUEST (USER)
====================================
*/
export const cancelAttendanceRequest = async (req, res) => {
    try {
        const { requestId, companyId } = req.params;
        const userId = req.user._id;


        if (!mongoose.Types.ObjectId.isValid(requestId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid request ID"
            });
        }

        // Get employee record
        const employee = await Employee.findOne({ companyId, userId });
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee record not found"
            });
        }

        const request = await AttendanceRequest.findOne({
            _id: requestId,
            employeeId: employee._id
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: "Request not found or you don't have permission to cancel it"
            });
        }

        if (request.status !== "pending") {
            return res.status(400).json({
                success: false,
                message: `Only pending requests can be cancelled. Current status: ${request.status}`
            });
        }

        // Check if request is too old to cancel (optional - e.g., 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        if (request.createdAt < sevenDaysAgo) {
            return res.status(400).json({
                success: false,
                message: "Cannot cancel requests older than 7 days. Please contact admin."
            });
        }

        request.status = "cancelled";
        await request.save();

        return res.json({
            success: true,
            message: "Request cancelled successfully",
            data: request
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/*
====================================
7. UPDATE REQUEST (User - only pending)
====================================
*/
export const updateAttendanceRequest = async (req, res) => {
    try {
        const { requestId, companyId } = req.params;
        const userId = req.user._id;

        const updates = req.body;

        if (!mongoose.Types.ObjectId.isValid(requestId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid request ID"
            });
        }

        // Get employee record
        const employee = await Employee.findOne({ companyId, userId });
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee record not found"
            });
        }

        const request = await AttendanceRequest.findOne({
            _id: requestId,
            employeeId: employee._id
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: "Request not found or you don't have permission to update it"
            });
        }

        if (request.status !== "pending") {
            return res.status(400).json({
                success: false,
                message: `Cannot update ${request.status} requests`
            });
        }

        // Validate updates based on request type
        if (updates.requestType && updates.requestType !== request.requestType) {
            return res.status(400).json({
                success: false,
                message: "Cannot change request type"
            });
        }

        // Update allowed fields
        if (updates.reason) {
            request.reason = updates.reason;
        }

        if (updates.leaveDetails && request.requestType === "leave") {
            // Validate dates
            const startDate = new Date(updates.leaveDetails.startDate || request.leaveDetails.startDate);
            const endDate = new Date(updates.leaveDetails.endDate || request.leaveDetails.endDate);

            if (startDate > endDate) {
                return res.status(400).json({
                    success: false,
                    message: "Start date cannot be after end date"
                });
            }

            request.leaveDetails = {
                ...request.leaveDetails,
                ...updates.leaveDetails
            };
        }

        if (updates.punchDetails && (request.requestType === "punch_in_out" || request.requestType === "punch_in_and_out")) {
            request.punchDetails = {
                ...request.punchDetails,
                ...updates.punchDetails
            };
        }

        await request.save();

        return res.json({
            success: true,
            message: "Request updated successfully",
            data: request
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/*
====================================
8. BULK APPROVE REQUESTS (Admin)
====================================
*/
export const bulkApproveRequests = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { requestIds } = req.body;
        const adminId = req.user._id;

        if (!Array.isArray(requestIds) || requestIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide an array of request IDs"
            });
        }

        const results = {
            approved: [],
            failed: []
        };

        for (const requestId of requestIds) {
            try {
                if (!mongoose.Types.ObjectId.isValid(requestId)) {
                    results.failed.push({ id: requestId, reason: "Invalid ID format" });
                    continue;
                }

                const request = await AttendanceRequest.findById(requestId).session(session);

                if (!request) {
                    results.failed.push({ id: requestId, reason: "Request not found" });
                    continue;
                }

                if (request.status !== "pending") {
                    results.failed.push({
                        id: requestId,
                        reason: `Request already ${request.status}`
                    });
                    continue;
                }

                // Process approval based on type
                if (request.requestType === "leave") {
                    const start = new Date(request.leaveDetails.startDate);
                    const end = new Date(request.leaveDetails.endDate);

                    start.setHours(0, 0, 0, 0);
                    end.setHours(23, 59, 59, 999);

                    for (
                        let d = new Date(start);
                        d <= end;
                        d.setDate(d.getDate() + 1)
                    ) {
                        await Attendance.findOneAndUpdate(
                            {
                                companyId: request.companyId,
                                employeeId: request.employeeId,
                                date: d
                            },
                            {
                                $set: {
                                    status: "leave",
                                    approvalStatus: "approved",
                                    remarks: `Leave approved via bulk action`
                                }
                            },
                            { upsert: true, session }
                        );
                    }
                }

                request.status = "approved";
                request.approvedBy = adminId;
                request.approvedAt = new Date();
                await request.save({ session });

                results.approved.push(requestId);
            } catch (error) {
                results.failed.push({ id: requestId, reason: error.message });
            }
        }

        await session.commitTransaction();

        return res.json({
            success: true,
            message: `Bulk approval completed. ${results.approved.length} approved, ${results.failed.length} failed`,
            data: results
        });

    } catch (error) {
        await session.abortTransaction();
        return res.status(500).json({
            success: false,
            message: error.message
        });
    } finally {
        session.endSession();
    }
};

/*
====================================
9. GET REQUEST STATISTICS
====================================
*/
export const getRequestStatistics = async (req, res) => {
    try {
        const userRole = req.user.role;
        const userId = req.user._id;
        const companyId = req.user.companyId;

        let matchQuery = { companyId };

        if (userRole !== "admin") {
            // Get employee record for non-admin users
            const employee = await Employee.findOne({ companyId, userId });
            if (!employee) {
                return res.status(404).json({
                    success: false,
                    message: "Employee record not found"
                });
            }
            matchQuery.employeeId = employee._id;
        }

        const stats = await AttendanceRequest.aggregate([
            { $match: matchQuery },
            {
                $facet: {
                    byStatus: [
                        {
                            $group: {
                                _id: "$status",
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    byType: [
                        {
                            $group: {
                                _id: "$requestType",
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    byMonth: [
                        {
                            $group: {
                                _id: {
                                    year: { $year: "$createdAt" },
                                    month: { $month: "$createdAt" }
                                },
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { "_id.year": -1, "_id.month": -1 } },
                        { $limit: 6 }
                    ],
                    pendingCount: [
                        { $match: { status: "pending" } },
                        { $count: "count" }
                    ]
                }
            }
        ]);

        return res.json({
            success: true,
            data: {
                byStatus: stats[0].byStatus,
                byType: stats[0].byType,
                byMonth: stats[0].byMonth,
                pending: stats[0].pendingCount[0]?.count || 0,
                total: stats[0].byStatus.reduce((acc, curr) => acc + curr.count, 0)
            }
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};