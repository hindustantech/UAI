import { Parser } from "json2csv";
import ExcelJS from "exceljs";
import User from "../../models/userModel.js";
import PatnerProfile from "../../models/PatnerProfile.js";
import Employee from "../../models/Attandance/Employee.js";
import Attendance from "../../models/Attandance/Attendance.js";
import { Subscription } from "../../models/Attandance/subscration/Subscription.js";

/* =========================================================
   CONSTANTS
========================================================= */

const COMPANY_TYPES = ["partner"];

const COLLECTIONS = {
    partnerProfiles: PatnerProfile.collection.name,
    subscriptions: Subscription.collection.name,
    employees: Employee.collection.name,
    attendances: Attendance.collection.name
};

const ALLOWED_SORT_FIELDS = {
    createdAt: "companyCreatedAt",
    companyCreatedAt: "companyCreatedAt",
    companyName: "companyName",
    employeeCreatedAt: "employeeCreatedAt",
    firstEmployeeCreatedAt: "employeeCreatedAt",
    lastEmployeeCreatedAt: "lastEmployeeCreatedAt",
    totalEmployees: "employees.totalEmployees",
    activeEmployees: "employees.activeEmployees",
    punchInToday: "punchInToday"
};

const SECONDS_IN_DAY = 1000 * 60 * 60 * 24;

const EXPIRING_SOON_DAYS = 7;

const SUBSCRIPTION_TYPES = ["PAID", "FREE", "NONE"];

const SUBSCRIPTION_TYPE_LABELS = {
    PAID: "PAID ACTIVE",
    FREE: "FREE PLAN",
    NONE: "NO ACTIVE SUBSCRIPTION"
};

/* =========================================================
   HELPERS
========================================================= */

const escapeRegex = (value = "") =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const formatDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
};

const formatDateTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().replace("T", " ").slice(0, 19);
};

const formatLocalDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

const resolveReportDay = (date) => {
    const base = date ? new Date(`${date}T00:00:00`) : new Date();

    if (isNaN(base.getTime())) {
        throw new Error("INVALID_DATE");
    }

    const startOfDay = new Date(base);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(base);
    endOfDay.setHours(23, 59, 59, 999);

    return { startOfDay, endOfDay, reportDate: formatLocalDate(startOfDay) };
};

const resolveSort = (sortBy, sortOrder, secondarySortBy, secondarySortOrder) => {
    const primaryField =
        ALLOWED_SORT_FIELDS[sortBy] || ALLOWED_SORT_FIELDS.createdAt;

    const primaryDirection = sortOrder === "asc" ? 1 : -1;

    const secondaryField =
        ALLOWED_SORT_FIELDS[secondarySortBy] ||
        ALLOWED_SORT_FIELDS.employeeCreatedAt;

    const secondaryDirection = secondarySortOrder === "desc" ? -1 : 1;

    return {
        sortStage:
            primaryField === secondaryField
                ? { [primaryField]: primaryDirection }
                : {
                    [primaryField]: primaryDirection,
                    [secondaryField]: secondaryDirection
                },
        primaryField,
        primaryDirection,
        secondaryField,
        secondaryDirection
    };
};

/* =========================================================
   AGGREGATION
========================================================= */

const buildReportPipeline = ({
    search,
    fromDate,
    toDate,
    hasActiveSubscription,
    subscriptionType,
    expiringSoon,
    startOfDay,
    endOfDay,
    sortStage,
    skip,
    limit,
    paginate,
    now
}) => {
    const pipeline = [];

    /* ---------- Company base filter ---------- */

    const companyMatch = {
        type: { $in: COMPANY_TYPES }
    };

    if (fromDate || toDate) {
        companyMatch.createdAt = {};

        if (fromDate) {
            const start = new Date(fromDate);
            if (!isNaN(start.getTime())) {
                start.setHours(0, 0, 0, 0);
                companyMatch.createdAt.$gte = start;
            }
        }

        if (toDate) {
            const end = new Date(toDate);
            if (!isNaN(end.getTime())) {
                end.setHours(23, 59, 59, 999);
                companyMatch.createdAt.$lte = end;
            }
        }

        if (Object.keys(companyMatch.createdAt).length === 0) {
            delete companyMatch.createdAt;
        }
    }

    pipeline.push({ $match: companyMatch });

    /* ---------- Partner profile ---------- */

    pipeline.push({
        $lookup: {
            from: COLLECTIONS.partnerProfiles,
            localField: "_id",
            foreignField: "User_id",
            as: "profile",
            pipeline: [
                {
                    $project: {
                        firm_name: 1,
                        email: 1,
                        logo: 1,
                        idType: 1,
                        idNumber: 1,
                        address: 1
                    }
                }
            ]
        }
    });

    pipeline.push({
        $unwind: {
            path: "$profile",
            preserveNullAndEmptyArrays: true
        }
    });

    /* ---------- Search ---------- */

    if (search) {
        const regex = { $regex: escapeRegex(search), $options: "i" };

        pipeline.push({
            $match: {
                $or: [
                    { name: regex },
                    { email: regex },
                    { phone: regex },
                    { "profile.firm_name": regex },
                    { "profile.email": regex }
                ]
            }
        });
    }

    /* ---------- Active subscription ---------- */

    pipeline.push({
        $lookup: {
            from: COLLECTIONS.subscriptions,
            let: { companyId: "$_id" },
            pipeline: [
                {
                    $match: {
                        $expr: {
                            $and: [
                                { $eq: ["$company", "$$companyId"] },
                                { $eq: ["$status", "ACTIVE"] },
                                { $eq: ["$isActive", true] },
                                {
                                    $eq: [
                                        "$payment.paymentStatus",
                                        "SUCCESS"
                                    ]
                                },
                                { $gte: ["$endDate", now] }
                            ]
                        }
                    }
                },
                { $sort: { endDate: -1 } },
                { $limit: 1 },
                {
                    $project: {
                        planSnapshot: 1,
                        startDate: 1,
                        endDate: 1,
                        status: 1,
                        payment: 1,
                        usage: 1
                    }
                }
            ],
            as: "activeSubscription"
        }
    });

    pipeline.push({
        $addFields: {
            hasActiveSubscription: {
                $gt: [
                    {
                        $size: {
                            $ifNull: ["$activeSubscription", []]
                        }
                    },
                    0
                ]
            }
        }
    });

    pipeline.push({
        $addFields: {
            activeSubscription: {
                $arrayElemAt: ["$activeSubscription", 0]
            }
        }
    });

    if (typeof hasActiveSubscription !== "undefined") {
        pipeline.push({
            $match: { hasActiveSubscription }
        });
    }

    /* ---------- Subscription classification ---------- */

    pipeline.push({
        $addFields: {
            isFreeSubscription: {
                $and: [
                    "$hasActiveSubscription",
                    {
                        $or: [
                            {
                                $eq: [
                                    "$activeSubscription.payment.paymentGateway",
                                    "FREE_PLAN"
                                ]
                            },
                            {
                                $eq: [
                                    "$activeSubscription.payment.amountPaid",
                                    0
                                ]
                            },
                            {
                                $eq: [
                                    "$activeSubscription.planSnapshot.finalPrice",
                                    0
                                ]
                            },
                            {
                                $eq: [
                                    "$activeSubscription.planSnapshot.price",
                                    0
                                ]
                            }
                        ]
                    }
                ]
            }
        }
    });

    pipeline.push({
        $addFields: {
            subscriptionType: {
                $cond: [
                    "$hasActiveSubscription",
                    {
                        $cond: [
                            "$isFreeSubscription",
                            "FREE",
                            "PAID"
                        ]
                    },
                    "NONE"
                ]
            },
            subscriptionDaysRemaining: {
                $cond: [
                    "$hasActiveSubscription",
                    {
                        $ceil: {
                            $divide: [
                                {
                                    $subtract: [
                                        "$activeSubscription.endDate",
                                        now
                                    ]
                                },
                                SECONDS_IN_DAY
                            ]
                        }
                    },
                    null
                ]
            }
        }
    });

    if (subscriptionType) {
        pipeline.push({
            $match: { subscriptionType }
        });
    }

    if (expiringSoon) {
        pipeline.push({
            $match: {
                subscriptionType: { $ne: "NONE" },
                subscriptionDaysRemaining: {
                    $gte: 0,
                    $lte: EXPIRING_SOON_DAYS
                }
            }
        });
    }

    /* ---------- Employee statistics ---------- */

    pipeline.push({
        $lookup: {
            from: COLLECTIONS.employees,
            let: { companyId: "$_id" },
            pipeline: [
                {
                    $match: {
                        $expr: { $eq: ["$companyId", "$$companyId"] }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalEmployees: { $sum: 1 },
                        activeEmployees: {
                            $sum: {
                                $cond: [
                                    { $eq: ["$employmentStatus", "active"] },
                                    1,
                                    0
                                ]
                            }
                        },
                        inactiveEmployees: {
                            $sum: {
                                $cond: [
                                    { $eq: ["$employmentStatus", "inactive"] },
                                    1,
                                    0
                                ]
                            }
                        },
                        firstEmployeeCreatedAt: { $min: "$createdAt" },
                        lastEmployeeCreatedAt: { $max: "$createdAt" }
                    }
                }
            ],
            as: "employeeStats"
        }
    });

    pipeline.push({
        $addFields: {
            employeeStats: {
                $ifNull: [
                    { $arrayElemAt: ["$employeeStats", 0] },
                    {
                        totalEmployees: 0,
                        activeEmployees: 0,
                        inactiveEmployees: 0,
                        firstEmployeeCreatedAt: null,
                        lastEmployeeCreatedAt: null
                    }
                ]
            }
        }
    });

    /* ---------- Today's punch in ---------- */

    pipeline.push({
        $lookup: {
            from: COLLECTIONS.attendances,
            let: { companyId: "$_id" },
            pipeline: [
                {
                    $match: {
                        $expr: {
                            $and: [
                                { $eq: ["$companyId", "$$companyId"] },
                                { $gte: ["$date", startOfDay] },
                                { $lte: ["$date", endOfDay] },
                                { $ne: ["$punchIn", null] }
                            ]
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        punchInToday: { $sum: 1 }
                    }
                }
            ],
            as: "attendanceStats"
        }
    });

    /* ---------- Final projection ---------- */

    pipeline.push({
        $project: {
            _id: 0,
            companyId: "$_id",
            companyName: {
                $ifNull: ["$profile.firm_name", "$name"]
            },
            email: {
                $ifNull: ["$email", "$profile.email"]
            },
            phone: "$phone",
            address: {
                city: {
                    $ifNull: ["$profile.address.city", ""]
                },
                state: {
                    $ifNull: ["$profile.address.state", ""]
                },
                manual: {
                    $ifNull: ["$manul_address", ""]
                }
            },
            logo: "$profile.logo",
            accountStatus: "$accountStatus",
            companyType: "$type",
            subscriptionType: "$subscriptionType",
            isFreeSubscription: "$isFreeSubscription",
            subscriptionDaysRemaining: "$subscriptionDaysRemaining",
            companyCreatedAt: "$createdAt",
            employeeCreatedAt: "$employeeStats.firstEmployeeCreatedAt",
            lastEmployeeCreatedAt: "$employeeStats.lastEmployeeCreatedAt",
            subscription: {
                hasActiveSubscription: "$hasActiveSubscription",
                planName: "$activeSubscription.planSnapshot.name",
                planPrice: {
                    $ifNull: [
                        "$activeSubscription.planSnapshot.finalPrice",
                        "$activeSubscription.planSnapshot.price"
                    ]
                },
                startDate: "$activeSubscription.startDate",
                endDate: "$activeSubscription.endDate",
                status: "$activeSubscription.status",
                paymentStatus: "$activeSubscription.payment.paymentStatus",
                transactionId: "$activeSubscription.payment.transactionId",
                paymentGateway: "$activeSubscription.payment.paymentGateway",
                amountPaid: "$activeSubscription.payment.amountPaid",
                maxEmployees: {
                    $ifNull: ["$activeSubscription.usage.maxEmployees", 0]
                },
                employeesUsed: {
                    $ifNull: ["$activeSubscription.usage.employeesUsed", 0]
                }
            },
            employees: {
                totalEmployees: "$employeeStats.totalEmployees",
                activeEmployees: "$employeeStats.activeEmployees",
                inactiveEmployees: "$employeeStats.inactiveEmployees",
                firstEmployeeCreatedAt:
                    "$employeeStats.firstEmployeeCreatedAt",
                lastEmployeeCreatedAt: "$employeeStats.lastEmployeeCreatedAt"
            },
            attendance: {
                punchInToday: {
                    $ifNull: [
                        { $arrayElemAt: ["$attendanceStats.punchInToday", 0] },
                        0
                    ]
                }
            },
            punchInToday: {
                $ifNull: [
                    { $arrayElemAt: ["$attendanceStats.punchInToday", 0] },
                    0
                ]
            }
        }
    });

    /* ---------- Pagination + summary ---------- */

    const facet = {
        metadata: [{ $count: "total" }],
        summary: [
            {
                $group: {
                    _id: null,
                    totalCompanies: { $sum: 1 },
                    companiesWithActiveSubscription: {
                        $sum: {
                            $cond: [
                                {
                                    $eq: [
                                        "$subscription.hasActiveSubscription",
                                        true
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    paidActiveCompanies: {
                        $sum: {
                            $cond: [
                                { $eq: ["$subscriptionType", "PAID"] },
                                1,
                                0
                            ]
                        }
                    },
                    freeCompanies: {
                        $sum: {
                            $cond: [
                                { $eq: ["$subscriptionType", "FREE"] },
                                1,
                                0
                            ]
                        }
                    },
                    noActiveSubscriptionCompanies: {
                        $sum: {
                            $cond: [
                                { $eq: ["$subscriptionType", "NONE"] },
                                1,
                                0
                            ]
                        }
                    },
                    expiringSoonCompanies: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $ne: ["$subscriptionType", "NONE"] },
                                        {
                                            $gte: [
                                                "$subscriptionDaysRemaining",
                                                0
                                            ]
                                        },
                                        {
                                            $lte: [
                                                "$subscriptionDaysRemaining",
                                                EXPIRING_SOON_DAYS
                                            ]
                                        }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    totalEmployees: {
                        $sum: "$employees.totalEmployees"
                    },
                    totalActiveEmployees: {
                        $sum: "$employees.activeEmployees"
                    },
                    totalPunchInToday: {
                        $sum: "$punchInToday"
                    }
                }
            }
        ],
        data: [{ $sort: sortStage }]
    };

    if (paginate) {
        facet.data.push({ $skip: skip });
        facet.data.push({ $limit: limit });
    }

    pipeline.push({ $facet: facet });

    pipeline.push({
        $project: {
            data: 1,
            summary: { $arrayElemAt: ["$summary", 0] },
            totalDocuments: {
                $ifNull: [
                    { $arrayElemAt: ["$metadata.total", 0] },
                    0
                ]
            }
        }
    });

    return pipeline;
};

export const buildCompanyReport = async ({
    query,
    paginate = true
}) => {
    const {
        search = "",
        fromDate,
        toDate,
        hasActiveSubscription,
        subscriptionType,
        expiringSoon,
        date
    } = query;

    let {
        page = 1,
        limit = 10,
        sortBy = "createdAt",
        sortOrder = "desc",
        secondarySortBy = "employeeCreatedAt",
        secondarySortOrder = "asc"
    } = query;

    page = Math.max(parseInt(page) || 1, 1);
    limit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);

    const skip = (page - 1) * limit;

    const { startOfDay, endOfDay, reportDate } =
        resolveReportDay(date);

    const {
        sortStage,
        primaryField,
        primaryDirection,
        secondaryField,
        secondaryDirection
    } = resolveSort(
        sortBy,
        sortOrder,
        secondarySortBy,
        secondarySortOrder
    );

    let subscriptionFilter;

    if (
        typeof hasActiveSubscription !== "undefined" &&
        hasActiveSubscription !== ""
    ) {
        subscriptionFilter =
            hasActiveSubscription === true ||
            hasActiveSubscription === "true";
    }

    const normalizedSubscriptionType = SUBSCRIPTION_TYPES.includes(
        String(subscriptionType || "").toUpperCase()
    )
        ? String(subscriptionType).toUpperCase()
        : undefined;

    const expiringSoonFilter =
        expiringSoon === true || expiringSoon === "true";

    const now = new Date();

    const pipeline = buildReportPipeline({
        search,
        fromDate,
        toDate,
        hasActiveSubscription: subscriptionFilter,
        subscriptionType: normalizedSubscriptionType,
        expiringSoon: expiringSoonFilter,
        startOfDay,
        endOfDay,
        sortStage,
        skip,
        limit,
        paginate,
        now
    });

    const result = await User.aggregate(pipeline);

    const data = result[0]?.data || [];
    const rawSummary = result[0]?.summary || {};

    const summary = {
        totalCompanies: rawSummary.totalCompanies || 0,
        companiesWithActiveSubscription:
            rawSummary.companiesWithActiveSubscription || 0,
        paidActiveCompanies: rawSummary.paidActiveCompanies || 0,
        freeCompanies: rawSummary.freeCompanies || 0,
        noActiveSubscriptionCompanies:
            rawSummary.noActiveSubscriptionCompanies || 0,
        expiringSoonCompanies: rawSummary.expiringSoonCompanies || 0,
        totalEmployees: rawSummary.totalEmployees || 0,
        totalActiveEmployees: rawSummary.totalActiveEmployees || 0,
        totalPunchInToday: rawSummary.totalPunchInToday || 0
    };

    const totalDocuments = result[0]?.totalDocuments || 0;
    const totalPages = Math.ceil(totalDocuments / limit) || 0;

    return {
        data: data.map((row) => ({
            ...row,
            subscription: {
                ...row.subscription,
                daysRemaining: row.subscription?.endDate
                    ? Math.max(
                        0,
                        Math.ceil(
                            (new Date(row.subscription.endDate) - now) /
                            SECONDS_IN_DAY
                        )
                    )
                    : null
            }
        })),
        summary,
        totalDocuments,
        pagination: paginate
            ? {
                currentPage: page,
                limit,
                totalDocuments,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
            : null,
        filters: {
            search,
            fromDate: fromDate || null,
            toDate: toDate || null,
            hasActiveSubscription: subscriptionFilter ?? null,
            subscriptionType: normalizedSubscriptionType ?? null,
            expiringSoon: expiringSoonFilter,
            date: reportDate
        },
        sorting: {
            primary: { field: primaryField, direction: primaryDirection },
            secondary: {
                field: secondaryField,
                direction: secondaryDirection
            }
        }
    };
};

/* =========================================================
   EXPORT MAPPING
========================================================= */

export const mapRowForExport = (row) => {
    const subscription = row.subscription || {};
    const employees = row.employees || {};
    const address = row.address || {};
    const attendance = row.attendance || {};

    return {
        "Company Name": row.companyName || "",
        "Company ID": row.companyId ? String(row.companyId) : "",
        Email: row.email || "",
        Phone: row.phone || "",
        City: address.city || "",
        State: address.state || "",
        Address: address.manual || "",
        "Account Status": row.accountStatus || "",
        "Subscription Type":
            SUBSCRIPTION_TYPE_LABELS[row.subscriptionType] ||
            SUBSCRIPTION_TYPE_LABELS.NONE,
        "Active Subscription": subscription.hasActiveSubscription
            ? "YES"
            : "NO",
        "Free Plan": row.isFreeSubscription ? "YES" : "NO",
        "Plan Name": subscription.planName || "",
        "Plan Price": subscription.planPrice ?? "",
        "Payment Gateway": subscription.paymentGateway || "",
        "Amount Paid": subscription.amountPaid ?? "",
        "Subscription Start": formatDate(subscription.startDate),
        "Subscription End": formatDate(subscription.endDate),
        "Days Remaining": subscription.daysRemaining ?? "",
        "Payment Status": subscription.paymentStatus || "",
        "Total Employees": employees.totalEmployees || 0,
        "Active Employees": employees.activeEmployees || 0,
        "Inactive Employees": employees.inactiveEmployees || 0,
        "Punch In Today": attendance.punchInToday || 0,
        "First Employee Created": formatDateTime(
            employees.firstEmployeeCreatedAt
        ),
        "Last Employee Created": formatDateTime(
            employees.lastEmployeeCreatedAt
        ),
        "Company Created At": formatDateTime(row.companyCreatedAt)
    };
};

/* =========================================================
   CONTROLLERS
========================================================= */

export const getCompaniesReport = async (req, res) => {
    try {
        const report = await buildCompanyReport({
            query: req.query,
            paginate: true
        });

        return res.status(200).json({
            success: true,
            message: "Companies report fetched successfully",
            reportDate: report.filters.date,
            filters: report.filters,
            sorting: report.sorting,
            overallSummary: report.summary,
            pagination: report.pagination,
            data: report.data
        });
    } catch (error) {
        console.error("GET COMPANIES REPORT ERROR:", error);

        if (error.message === "INVALID_DATE") {
            return res.status(400).json({
                success: false,
                message: "Invalid date"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined
        });
    }
};

export const exportCompaniesReportCSV = async (req, res) => {
    try {
        const report = await buildCompanyReport({
            query: req.query,
            paginate: false
        });

        if (!report.data.length) {
            return res.status(404).json({
                success: false,
                message: "No data found"
            });
        }

        const rows = report.data.map(mapRowForExport);
        const fields = Object.keys(rows[0]);
        const parser = new Parser({ fields });
        const csv = parser.parse(rows);

        const fileName = `companies_report_${Date.now()}.csv`;

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        );

        return res.status(200).send(csv);
    } catch (error) {
        console.error("EXPORT COMPANIES REPORT CSV ERROR:", error);

        if (error.message === "INVALID_DATE") {
            return res.status(400).json({
                success: false,
                message: "Invalid date"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined
        });
    }
};

const EXCEL_COLORS = {
    header: "FF1E3A5F",
    headerText: "FFFFFFFF",
    paid: "FFDCFCE7",
    paidRow: "FFF0FDF4",
    paidText: "FF166534",
    free: "FFDBEAFE",
    freeRow: "FFEFF6FF",
    freeText: "FF1D4ED8",
    none: "FFFEE2E2",
    noneRow: "FFFEF2F2",
    noneText: "FFB91C1C",
    expiring: "FFFEF3C7",
    expiringText: "FFB45309",
    punch: "FFDCFCE7",
    punchText: "FF166534",
    muted: "FFF3F4F6",
    border: "FFE5E7EB"
};

const EXCEL_COLUMN_WIDTHS = {
    "Company Name": 30,
    "Company ID": 26,
    Email: 30,
    Phone: 18,
    City: 16,
    State: 16,
    Address: 28,
    "Account Status": 16,
    "Subscription Type": 24,
    "Active Subscription": 18,
    "Free Plan": 12,
    "Plan Name": 22,
    "Plan Price": 14,
    "Payment Gateway": 18,
    "Amount Paid": 14,
    "Subscription Start": 18,
    "Subscription End": 18,
    "Days Remaining": 14,
    "Payment Status": 16,
    "Total Employees": 16,
    "Active Employees": 16,
    "Inactive Employees": 18,
    "Punch In Today": 16,
    "First Employee Created": 22,
    "Last Employee Created": 22,
    "Company Created At": 22
};

const fillExcelCell = (cell, color) => {
    cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: color }
    };
};

const applyExcelBorder = (cell) => {
    cell.border = {
        top: { style: "thin", color: { argb: EXCEL_COLORS.border } },
        left: { style: "thin", color: { argb: EXCEL_COLORS.border } },
        bottom: { style: "thin", color: { argb: EXCEL_COLORS.border } },
        right: { style: "thin", color: { argb: EXCEL_COLORS.border } }
    };
};

export const exportCompaniesReportExcel = async (req, res) => {
    try {
        const report = await buildCompanyReport({
            query: req.query,
            paginate: false
        });

        if (!report.data.length) {
            return res.status(404).json({
                success: false,
                message: "No data found"
            });
        }

        const rows = report.data.map(mapRowForExport);
        const headers = Object.keys(rows[0]);
        const summary = report.summary || {};

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "UAI Admin";
        workbook.created = new Date();

        const sheet = workbook.addWorksheet("Companies Report", {
            views: [{ state: "frozen", ySplit: 4 }]
        });

        const titleRow = sheet.getRow(1);
        sheet.mergeCells(1, 1, 1, headers.length);
        titleRow.getCell(1).value = "COMPANIES REPORT";
        titleRow.getCell(1).font = {
            bold: true,
            size: 16,
            color: { argb: EXCEL_COLORS.headerText }
        };
        titleRow.getCell(1).alignment = {
            vertical: "middle",
            horizontal: "center"
        };
        fillExcelCell(titleRow.getCell(1), EXCEL_COLORS.header);
        titleRow.height = 28;

        const summaryRow = sheet.getRow(2);
        sheet.mergeCells(2, 1, 2, headers.length);
        summaryRow.getCell(1).value =
            `Total Companies: ${summary.totalCompanies || 0}` +
            `   |   Paid Active: ${summary.paidActiveCompanies || 0}` +
            `   |   Free: ${summary.freeCompanies || 0}` +
            `   |   No Active Subscription: ${summary.noActiveSubscriptionCompanies || 0}` +
            `   |   Expiring Soon: ${summary.expiringSoonCompanies || 0}` +
            `   |   Punch In Today: ${summary.totalPunchInToday || 0}`;
        summaryRow.getCell(1).font = {
            bold: true,
            size: 11,
            color: { argb: EXCEL_COLORS.header }
        };
        summaryRow.getCell(1).alignment = { horizontal: "center" };
        summaryRow.height = 20;

        const legendRow = sheet.getRow(3);
        sheet.mergeCells(3, 1, 3, headers.length);
        legendRow.getCell(1).value =
            "Colour guide: Green = Paid active subscription | Blue = Free plan | Red = No active subscription | Amber = Expiring within 7 days";
        legendRow.getCell(1).font = {
            italic: true,
            size: 10,
            color: { argb: "FF475569" }
        };
        legendRow.getCell(1).alignment = { horizontal: "center" };

        const headerRow = sheet.getRow(4);
        headers.forEach((header, index) => {
            const cell = headerRow.getCell(index + 1);
            cell.value = header;
            cell.font = {
                bold: true,
                color: { argb: EXCEL_COLORS.headerText }
            };
            cell.alignment = {
                vertical: "middle",
                horizontal: "center",
                wrapText: true
            };
            fillExcelCell(cell, EXCEL_COLORS.header);
            applyExcelBorder(cell);
            sheet.getColumn(index + 1).width =
                EXCEL_COLUMN_WIDTHS[header] || 18;
        });
        headerRow.height = 30;

        const typeColumn = headers.indexOf("Subscription Type") + 1;
        const punchColumn = headers.indexOf("Punch In Today") + 1;

        rows.forEach((row, rowIndex) => {
            const excelRow = sheet.getRow(5 + rowIndex);
            const subscriptionType = row["Subscription Type"];
            const rowColor =
                subscriptionType === "PAID ACTIVE"
                    ? EXCEL_COLORS.paidRow
                    : subscriptionType === "FREE PLAN"
                        ? EXCEL_COLORS.freeRow
                        : EXCEL_COLORS.noneRow;

            headers.forEach((header, columnIndex) => {
                const cell = excelRow.getCell(columnIndex + 1);
                cell.value = row[header];
                cell.font = { size: 10 };
                cell.alignment = {
                    vertical: "middle",
                    horizontal:
                        columnIndex === typeColumn - 1 ||
                        columnIndex === punchColumn - 1
                            ? "center"
                            : "left"
                };
                applyExcelBorder(cell);
                fillExcelCell(cell, rowColor);
            });

            const typeCell = excelRow.getCell(typeColumn);
            const isExpiringSoon =
                row["Active Subscription"] === "YES" &&
                Number(row["Days Remaining"]) >= 0 &&
                Number(row["Days Remaining"]) <= EXPIRING_SOON_DAYS;

            if (subscriptionType === "PAID ACTIVE") {
                fillExcelCell(typeCell, EXCEL_COLORS.paid);
                typeCell.font = {
                    bold: true,
                    color: { argb: EXCEL_COLORS.paidText }
                };
            } else if (subscriptionType === "FREE PLAN") {
                fillExcelCell(typeCell, EXCEL_COLORS.free);
                typeCell.font = {
                    bold: true,
                    color: { argb: EXCEL_COLORS.freeText }
                };
            } else {
                fillExcelCell(typeCell, EXCEL_COLORS.none);
                typeCell.font = {
                    bold: true,
                    color: { argb: EXCEL_COLORS.noneText }
                };
            }

            if (isExpiringSoon) {
                fillExcelCell(typeCell, EXCEL_COLORS.expiring);
                typeCell.font = {
                    bold: true,
                    color: { argb: EXCEL_COLORS.expiringText }
                };
            }

            const punchCell = excelRow.getCell(punchColumn);
            if (Number(row["Punch In Today"]) > 0) {
                fillExcelCell(punchCell, EXCEL_COLORS.punch);
                punchCell.font = {
                    bold: true,
                    color: { argb: EXCEL_COLORS.punchText }
                };
            }
        });

        sheet.autoFilter = {
            from: { row: 4, column: 1 },
            to: { row: 4 + rows.length, column: headers.length }
        };

        const buffer = await workbook.xlsx.writeBuffer();

        const fileName = `companies_report_${Date.now()}.xlsx`;

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        );

        return res.send(Buffer.from(buffer));
    } catch (error) {
        console.error("EXPORT COMPANIES REPORT EXCEL ERROR:", error);

        if (error.message === "INVALID_DATE") {
            return res.status(400).json({
                success: false,
                message: "Invalid date"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined
        });
    }
};
