import { Parser } from "json2csv";
import XLSX from "xlsx";
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

    const now = new Date();

    const pipeline = buildReportPipeline({
        search,
        fromDate,
        toDate,
        hasActiveSubscription: subscriptionFilter,
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
        "Active Subscription": subscription.hasActiveSubscription
            ? "YES"
            : "NO",
        "Plan Name": subscription.planName || "",
        "Plan Price": subscription.planPrice ?? "",
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

        const worksheet = XLSX.utils.json_to_sheet(rows);

        worksheet["!cols"] = [
            { wch: 28 },
            { wch: 26 },
            { wch: 28 },
            { wch: 18 },
            { wch: 16 },
            { wch: 16 },
            { wch: 24 },
            { wch: 16 },
            { wch: 18 },
            { wch: 22 },
            { wch: 12 },
            { wch: 18 },
            { wch: 18 },
            { wch: 14 },
            { wch: 16 },
            { wch: 16 },
            { wch: 16 },
            { wch: 18 },
            { wch: 16 },
            { wch: 22 },
            { wch: 22 },
            { wch: 22 }
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
            workbook,
            worksheet,
            "Companies Report"
        );

        const buffer = XLSX.write(workbook, {
            type: "buffer",
            bookType: "xlsx"
        });

        const fileName = `companies_report_${Date.now()}.xlsx`;

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        );

        return res.send(buffer);
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
