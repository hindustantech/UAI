import mongoose from "mongoose";
import Employee from '../../models/Attandance/Employee.js';
import Attendance from '../../models/Attandance/Attendance.js';
import { Subscription } from '../../models/Attandance/subscration/Subscription.js';
import { SalesSession } from '../../models/Attandance/Salses/Salses.js';

const VALID_ATTENDANCE_STATUSES = [
    "present",
    "absent",
    "leave",
    "holiday",
    "half_day",
    "week_off",
    "comp_off",
    "pending_approval",
    "rejected",
    "system_auto"
];

const CUSTOMER_TYPES = ["retail", "wholesale", "corporate", "customer", "agent"];

const toFiniteNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
};

const buildDayArray = (daysInMonth) => Array(daysInMonth).fill(0);

const fillDaily = (dayArray, entries, valueKey) => {
    for (const entry of entries || []) {
        const day = Number(entry._id);
        if (Number.isInteger(day) && day >= 1 && day <= dayArray.length) {
            const value = toFiniteNumber(entry[valueKey]);
            dayArray[day - 1] = value;
        }
    }
    return dayArray;
};

export const getDashboardCompanyMonthlyAttendance = async (req, res) => {
    try {
        const { companyId, month, year } = req.query;

        /* ============================
           0. PARAMETER CHECK
        ============================ */


        // ===============
        //    1. VALIDATION
        // ============================ */

        if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid request parameters"
            });
        }

        const m = Number(month);
        const y = Number(year);

        if (
            !Number.isInteger(m) || m < 1 || m > 12 ||
            !Number.isInteger(y) || y < 1970 || y > 9999
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid request parameters"
            });
        }

        /* ============================
           2. DATE RANGE (UTC, half-open)
        ============================ */

        const companyObjectId = new mongoose.Types.ObjectId(companyId);
        const start = new Date(Date.UTC(y, m - 1, 1));
        const next = new Date(Date.UTC(y, m, 1));
        const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

        /* ============================
           3. SUBSCRIPTION GATE
        ============================ */

        const subscription = await Subscription.findOne({
            company: companyObjectId,
            status: "ACTIVE",
            isActive: true,
            endDate: { $gte: new Date() }
        }).lean();

        if (!subscription) {
            return res.status(400).json({
                success: false,
                message: "Subscription not active or missing"
            });
        }

        const usage = (subscription.usage && typeof subscription.usage === "object")
            ? subscription.usage
            : {};

        const salesMax = toFiniteNumber(usage.no_of_sales_person_maxEmployees);
        const proSalesMax = toFiniteNumber(usage.no_of_pro_sales_person_maxEmployees);
        const hasSalesAccess = salesMax > 0 || proSalesMax > 0;

        /* ============================
           4. EMPLOYEE KPI
        ============================ */

        const totalEmployees = await Employee.countDocuments({
            companyId: companyObjectId,
            employmentStatus: "active"
        });

        /* ============================
           5. ATTENDANCE (daily + total)
        ============================ */

        const attendanceAgg = await Attendance.aggregate([
            {
                $match: {
                    companyId: companyObjectId,
                    date: { $gte: start, $lt: next }
                }
            },
            {
                $group: {
                    _id: {
                        $dayOfMonth: "$date"
                    },
                    count: {
                        $sum: {
                            $cond: [
                                { $in: [{ $ifNull: ["$status", null] }, VALID_ATTENDANCE_STATUSES] },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const attendanceDaily = fillDaily(buildDayArray(daysInMonth), attendanceAgg, "count");
        const attendanceTotal = attendanceDaily.reduce((sum, count) => sum + count, 0);

        /* ============================
           6. SALES ANALYTICS
        ============================ */

        let revenueDaily = buildDayArray(daysInMonth);
        let salesCount = 0;
        let customersInMonth = [];
        let firstVisitMap = new Map();

        if (hasSalesAccess) {
            const salesAgg = await SalesSession.aggregate([
                {
                    $match: {
                        companyId: companyObjectId,
                        createdAt: { $gte: start, $lt: next }
                    }
                },
                {
                    $facet: {
                        sessionStats: [
                            {
                                $group: {
                                    _id: null,
                                    completed: {
                                        $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
                                    }
                                }
                            }
                        ],
                        revenueByDay: [
                            {
                                $match: {
                                    "salesLogs.createdAt": { $type: "date" }
                                }
                            },
                            { $unwind: "$salesLogs" },
                            {
                                $group: {
                                    _id: {
                                        $dayOfMonth: "$salesLogs.createdAt"
                                    },
                                    total: {
                                        $sum: {
                                            $cond: [
                                                {
                                                    $and: [
                                                        { $eq: ["$salesLogs.paymentCollected", true] },
                                                        { $isNumber: "$salesLogs.amount" }
                                                    ]
                                                },
                                                "$salesLogs.amount",
                                                0
                                            ]
                                        }
                                    }
                                }
                            }
                        ],
                        customersInMonth: [
                            {
                                $match: {
                                    "customer.customerId": { $exists: true, $ne: null, $ne: "" }
                                }
                            },
                            {
                                $group: {
                                    _id: "$customer.customerId",
                                    sessionIds: {
                                        $addToSet: { $ifNull: ["$sessionId", "$_id"] }
                                    },
                                    type: { $first: { $ifNull: ["$customer.type", "customer"] } },
                                    firstVisit: { $min: "$createdAt" },
                                    lastVisit: { $max: "$createdAt" }
                                }
                            },
                            {
                                $project: {
                                    customerId: "$_id",
                                    type: 1,
                                    visits: { $size: "$sessionIds" },
                                    firstVisit: 1,
                                    lastVisit: 1,
                                    _id: 0
                                }
                            }
                        ]
                    }
                }
            ]);

            const facet = salesAgg[0] || {};
            const sessionStats = facet.sessionStats?.[0] || {};
            salesCount = toFiniteNumber(sessionStats.completed);

            revenueDaily = fillDaily(buildDayArray(daysInMonth), facet.revenueByDay || [], "total");
            customersInMonth = facet.customersInMonth || [];

            /* ---------- First-ever visit per customer ---------- */
            const firstVisitAgg = await SalesSession.aggregate([
                {
                    $match: {
                        companyId: companyObjectId,
                        "customer.customerId": { $exists: true, $ne: null, $ne: "" },
                        createdAt: { $lt: next }
                    }
                },
                {
                    $group: {
                        _id: "$customer.customerId",
                        firstVisit: { $min: "$createdAt" }
                    }
                }
            ]);

            firstVisitMap = new Map(
                firstVisitAgg
                    .filter((c) => c.firstVisit instanceof Date)
                    .map((c) => [c._id, c.firstVisit])
            );
        }

        const revenueTotal = revenueDaily.reduce((sum, value) => sum + value, 0);

        /* ============================
           7. CUSTOMER CLASSIFICATION
        ============================ */

        const newCustomers = [];
        const activeCustomers = [];

        for (const customer of customersInMonth) {
            const type = CUSTOMER_TYPES.includes(customer.type) ? customer.type : "customer";
            const normalized = {
                customerId: customer.customerId,
                type,
                visits: toFiniteNumber(customer.visits)
            };

            if (customer.lastVisit instanceof Date) {
                normalized.lastVisit = customer.lastVisit;
            }
            if (customer.firstVisit instanceof Date) {
                normalized.firstVisit = customer.firstVisit;
            }

            if (normalized.visits >= 2) {
                activeCustomers.push(normalized);
            }

            const firstVisit = firstVisitMap.get(customer.customerId);
            if (firstVisit instanceof Date && firstVisit >= start && firstVisit < next) {
                newCustomers.push(normalized);
            }
        }

        activeCustomers.sort((a, b) => (b.lastVisit || 0) - (a.lastVisit || 0));
        newCustomers.sort((a, b) => (b.firstVisit || 0) - (a.firstVisit || 0));

        const byType = {};
        for (const type of CUSTOMER_TYPES) {
            byType[type] = 0;
        }
        for (const customer of customersInMonth) {
            const type = CUSTOMER_TYPES.includes(customer.type) ? customer.type : "customer";
            byType[type] += 1;
        }

        /* ============================
           8. RESPONSE (frontend-safe)
        ============================ */

        return res.status(200).json({
            success: true,
            message: "Monthly dashboard fetched successfully",
            data: {
                summary: {
                    revenue: revenueTotal,
                    sales: salesCount,
                    attendance: attendanceTotal,
                    totalEmployees
                },
                customerActivity: {
                    new: newCustomers,
                    active: activeCustomers,
                    byType
                },
                attendanceDaily,
                revenueDaily
            }
        });
    }
    catch (error) {
        console.error("Error fetching dashboard data:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch dashboard data"
        });
    }
};