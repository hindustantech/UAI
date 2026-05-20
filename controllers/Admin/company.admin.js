import User from "../../models/userModel.js";
import Employee from '../../models/Attandance/Employee.js'
import Attendance from '../../models/Attandance/Attendance.js'
import PatnerProfile from "../../models/PatnerProfile.js";
import mongoose from "mongoose";

// get all partners with filters, pagination and sorting

export const getAllPartners = async (req, res) => {
    try {

        /* =========================================================
           QUERY PARAMS
        ========================================================= */

        let {
            page = 1,
            limit = 10,

            search = "",

            email = "",
            phone = "",
            name = "",

            referralCode = "",

            isIndependent,
            mallId,

            city = "",
            state = "",

            fromDate,
            toDate,

            sortBy = "createdAt",
            sortOrder = "desc",
        } = req.query;

        /* =========================================================
           SAFE PAGINATION
        ========================================================= */

        page = Math.max(parseInt(page) || 1, 1);
        limit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);

        const skip = (page - 1) * limit;

        /* =========================================================
           ALLOWED SORT FIELDS
        ========================================================= */

        const allowedSortFields = {
            createdAt: "createdAt",
            updatedAt: "updatedAt",
            firm_name: "firm_name",
        };

        const finalSortField =
            allowedSortFields[sortBy] || "createdAt";

        const finalSortOrder =
            sortOrder === "asc" ? 1 : -1;

        /* =========================================================
           MAIN MATCH FILTER
        ========================================================= */

        const partnerMatch = {};

        // Independent Filter
        if (typeof isIndependent !== "undefined") {
            partnerMatch.isIndependent =
                isIndependent === "true";
        }

        // Mall Filter
        if (
            mallId &&
            mongoose.Types.ObjectId.isValid(mallId)
        ) {
            partnerMatch.mallId =
                new mongoose.Types.ObjectId(mallId);
        }

        // City Filter
        if (city) {
            partnerMatch["address.city"] = {
                $regex: city,
                $options: "i",
            };
        }

        // State Filter
        if (state) {
            partnerMatch["address.state"] = {
                $regex: state,
                $options: "i",
            };
        }

        /* =========================================================
           DATE FILTER
        ========================================================= */

        if (fromDate || toDate) {

            partnerMatch.createdAt = {};

            if (fromDate) {
                const startDate = new Date(fromDate);

                if (!isNaN(startDate)) {
                    partnerMatch.createdAt.$gte = startDate;
                }
            }

            if (toDate) {
                const endDate = new Date(toDate);

                if (!isNaN(endDate)) {
                    endDate.setHours(23, 59, 59, 999);
                    partnerMatch.createdAt.$lte = endDate;
                }
            }

            // remove empty object
            if (
                Object.keys(partnerMatch.createdAt).length === 0
            ) {
                delete partnerMatch.createdAt;
            }
        }

        /* =========================================================
           USER FILTER MATCH
        ========================================================= */

        const userMatch = {
            "user.type": "partner",
        };

        // Global Search
        if (search) {

            userMatch.$or = [
                {
                    "user.name": {
                        $regex: search,
                        $options: "i",
                    },
                },
                {
                    "user.email": {
                        $regex: search,
                        $options: "i",
                    },
                },
                {
                    "user.phone": {
                        $regex: search,
                        $options: "i",
                    },
                },
                {
                    "user.referalCode": {
                        $regex: search,
                        $options: "i",
                    },
                },
                {
                    firm_name: {
                        $regex: search,
                        $options: "i",
                    },
                },
            ];
        }

        // Specific Filters

        if (email) {
            userMatch["user.email"] = {
                $regex: email,
                $options: "i",
            };
        }

        if (phone) {
            userMatch["user.phone"] = {
                $regex: phone,
                $options: "i",
            };
        }

        if (name) {
            userMatch["user.name"] = {
                $regex: name,
                $options: "i",
            };
        }

        if (referralCode) {
            userMatch["user.referalCode"] = {
                $regex: referralCode,
                $options: "i",
            };
        }

        /* =========================================================
           AGGREGATION PIPELINE
        ========================================================= */

        const pipeline = [

            // Partner Filters
            {
                $match: partnerMatch,
            },

            // JOIN USER
            {
                $lookup: {
                    from: "users",
                    localField: "User_id",
                    foreignField: "_id",
                    as: "user",
                    pipeline: [
                        {
                            $project: {
                                name: 1,
                                email: 1,
                                phone: 1,
                                referalCode: 1,
                                profileImage: 1,
                                type: 1,
                                suspend: 1,
                                isVerified: 1,
                                createdAt: 1,
                            },
                        },
                    ],
                },
            },

            // Convert array -> object
            {
                $unwind: {
                    path: "$user",
                    preserveNullAndEmptyArrays: false,
                },
            },

            // USER FILTER
            {
                $match: userMatch,
            },

            // JOIN MALL
            {
                $lookup: {
                    from: "malls",
                    localField: "mallId",
                    foreignField: "_id",
                    as: "mall",
                    pipeline: [
                        {
                            $project: {
                                name: 1,
                                logo: 1,
                                address: 1,
                            },
                        },
                    ],
                },
            },

            {
                $unwind: {
                    path: "$mall",
                    preserveNullAndEmptyArrays: true,
                },
            },

            /* =====================================================
               FACET
            ===================================================== */

            {
                $facet: {

                    metadata: [
                        {
                            $count: "totalDocuments",
                        },
                    ],

                    data: [

                        {
                            $sort: {
                                [finalSortField]:
                                    finalSortOrder,
                            },
                        },

                        {
                            $skip: skip,
                        },

                        {
                            $limit: limit,
                        },

                        {
                            $project: {

                                _id: 1,
                                logo: 1,

                                firm_name: 1,

                                email: 1,

                                idType: 1,
                                idNumber: 1,

                                isIndependent: 1,

                                address: 1,

                                detilsmall: 1,

                                createdAt: 1,
                                updatedAt: 1,

                                user: 1,

                                mall: 1,
                            },
                        },
                    ],
                },
            },

            /* =====================================================
               FINAL RESPONSE FORMAT
            ===================================================== */

            {
                $project: {

                    data: 1,

                    totalDocuments: {
                        $ifNull: [
                            {
                                $arrayElemAt: [
                                    "$metadata.totalDocuments",
                                    0,
                                ],
                            },
                            0,
                        ],
                    },
                },
            },
        ];

        /* =========================================================
           EXECUTE
        ========================================================= */

        const result =
            await PatnerProfile.aggregate(pipeline);

        const totalDocuments =
            result[0]?.totalDocuments || 0;

        const totalPages =
            Math.ceil(totalDocuments / limit);

        /* =========================================================
           RESPONSE
        ========================================================= */

        return res.status(200).json({
            success: true,
            message: "Partners fetched successfully",

            filters: {
                search,
                email,
                phone,
                name,
                referralCode,
                city,
                state,
                fromDate,
                toDate,
                isIndependent,
                mallId,
            },

            pagination: {
                currentPage: page,
                limit,
                totalDocuments,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },

            data: result[0]?.data || [],
        });

    } catch (error) {

        console.error(
            "GET ALL PARTNERS ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
};

// get All company employees with filters, pagination and sorting

export const getCompanyEmployees = async (req, res) => {
    try {

        /* =========================================================
           COMPANY ID
        ========================================================= */

        const companyId =
            req.query.companyId || req.user?._id;

        if (
            !companyId ||
            !mongoose.Types.ObjectId.isValid(companyId)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid company id"
            });
        }

        /* =========================================================
           QUERY PARAMS
        ========================================================= */

        let {
            page = 1,
            limit = 10,

            search = "",

            role,
            employeeType,
            employmentStatus,

            department,
            designation,

            fromDate,
            toDate,

            sortBy = "createdAt",
            sortOrder = "desc"
        } = req.query;

        /* =========================================================
           PAGINATION
        ========================================================= */

        page = Math.max(parseInt(page) || 1, 1);
        limit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);

        const skip = (page - 1) * limit;

        /* =========================================================
           FILTER
        ========================================================= */

        const matchFilter = {
            companyId: new mongoose.Types.ObjectId(companyId)
        };

        // Search
        if (search) {
            matchFilter.$or = [
                {
                    user_name: {
                        $regex: search,
                        $options: "i"
                    }
                },
                {
                    empCode: {
                        $regex: search,
                        $options: "i"
                    }
                },
                {
                    referalCode: {
                        $regex: search,
                        $options: "i"
                    }
                },
                {
                    "jobInfo.department": {
                        $regex: search,
                        $options: "i"
                    }
                },
                {
                    "jobInfo.designation": {
                        $regex: search,
                        $options: "i"
                    }
                }
            ];
        }

        // Role
        if (role) {
            matchFilter.role = role;
        }

        // Employee Type
        if (employeeType) {
            matchFilter.employeeType = employeeType;
        }

        // Employment Status
        if (employmentStatus) {
            matchFilter.employmentStatus =
                employmentStatus;
        }

        // Department
        if (department) {
            matchFilter["jobInfo.department"] = {
                $regex: department,
                $options: "i"
            };
        }

        // Designation
        if (designation) {
            matchFilter["jobInfo.designation"] = {
                $regex: designation,
                $options: "i"
            };
        }

        /* =========================================================
           DATE FILTER
        ========================================================= */

        if (fromDate || toDate) {

            matchFilter.createdAt = {};

            if (fromDate) {
                const startDate = new Date(fromDate);

                if (!isNaN(startDate)) {
                    matchFilter.createdAt.$gte =
                        startDate;
                }
            }

            if (toDate) {
                const endDate = new Date(toDate);

                if (!isNaN(endDate)) {
                    endDate.setHours(
                        23,
                        59,
                        59,
                        999
                    );

                    matchFilter.createdAt.$lte =
                        endDate;
                }
            }

            if (
                Object.keys(matchFilter.createdAt)
                    .length === 0
            ) {
                delete matchFilter.createdAt;
            }
        }

        /* =========================================================
           SORTING
        ========================================================= */

        const allowedSortFields = {
            createdAt: "createdAt",
            updatedAt: "updatedAt",
            user_name: "user_name",
            empCode: "empCode"
        };

        const finalSortField =
            allowedSortFields[sortBy] ||
            "createdAt";

        const finalSortOrder =
            sortOrder === "asc" ? 1 : -1;

        /* =========================================================
           AGGREGATION PIPELINE
        ========================================================= */

        const pipeline = [

            {
                $match: matchFilter
            },

            /* =====================================================
               USER DETAILS
            ===================================================== */

            {
                $lookup: {
                    from: "users",
                    localField: "userId",
                    foreignField: "_id",
                    as: "user",
                    pipeline: [
                        {
                            $project: {
                                name: 1,
                                email: 1,
                                phone: 1,
                                profileImage: 1,
                                isVerified: 1,
                                suspend: 1,
                                createdAt: 1
                            }
                        }
                    ]
                }
            },

            {
                $unwind: {
                    path: "$user",
                    preserveNullAndEmptyArrays: true
                }
            },

            /* =====================================================
               SHIFT DETAILS
            ===================================================== */

            {
                $lookup: {
                    from: "shifts",
                    localField: "shift",
                    foreignField: "_id",
                    as: "shift",
                    pipeline: [
                        {
                            $project: {
                                shiftName: 1,
                                startTime: 1,
                                endTime: 1,
                                graceTime: 1
                            }
                        }
                    ]
                }
            },

            {
                $unwind: {
                    path: "$shift",
                    preserveNullAndEmptyArrays: true
                }
            },

            /* =====================================================
               MANAGER DETAILS
            ===================================================== */

            {
                $lookup: {
                    from: "users",
                    localField:
                        "jobInfo.reportingManager",
                    foreignField: "_id",
                    as: "reportingManager",
                    pipeline: [
                        {
                            $project: {
                                name: 1,
                                email: 1,
                                phone: 1
                            }
                        }
                    ]
                }
            },

            {
                $unwind: {
                    path: "$reportingManager",
                    preserveNullAndEmptyArrays: true
                }
            },

            /* =====================================================
               FACET
            ===================================================== */

            {
                $facet: {

                    metadata: [
                        {
                            $count: "totalDocuments"
                        }
                    ],

                    data: [

                        {
                            $sort: {
                                [finalSortField]:
                                    finalSortOrder
                            }
                        },

                        {
                            $skip: skip
                        },

                        {
                            $limit: limit
                        },

                        {
                            $project: {

                                _id: 1,

                                user_name: 1,
                                empCode: 1,
                                referalCode: 1,

                                employeeType: 1,
                                role: 1,

                                weeklyOff: 1,

                                employmentStatus: 1,

                                jobInfo: 1,

                                salaryStructure: 1,

                                bankDetails: 1,

                                officeLocation: 1,

                                createdAt: 1,
                                updatedAt: 1,

                                user: 1,

                                shift: 1,

                                reportingManager: 1
                            }
                        }
                    ]
                }
            },

            /* =====================================================
               FINAL RESPONSE
            ===================================================== */

            {
                $project: {

                    data: 1,

                    totalDocuments: {
                        $ifNull: [
                            {
                                $arrayElemAt: [
                                    "$metadata.totalDocuments",
                                    0
                                ]
                            },
                            0
                        ]
                    }
                }
            }
        ];

        /* =========================================================
           EXECUTE
        ========================================================= */

        const result =
            await Employee.aggregate(pipeline);

        const employees =
            result[0]?.data || [];

        const totalDocuments =
            result[0]?.totalDocuments || 0;

        const totalPages =
            Math.ceil(totalDocuments / limit);

        /* =========================================================
           RESPONSE
        ========================================================= */

        return res.status(200).json({
            success: true,
            message:
                "Employees fetched successfully",

            pagination: {
                currentPage: page,
                limit,
                totalDocuments,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            },

            filters: {
                search,
                role,
                employeeType,
                employmentStatus,
                department,
                designation,
                fromDate,
                toDate
            },

            data: employees
        });

    } catch (error) {

        console.error(
            "GET COMPANY EMPLOYEES ERROR:",
            error
        );

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

// get ALL company employees  Attendance  with filters, pagination and sorting


export const getTodayAllCompaniesAttendance = async (req, res) => {
    try {

        /* =========================================================
           QUERY PARAMS
        ========================================================= */

        let {
            date,
            fromDate,
            toDate,

            page = 1,
            limit = 10,

            search = "",

            sortBy = "companyName",
            sortOrder = "asc"
        } = req.query;

        /* =========================================================
           PAGINATION
        ========================================================= */

        page = Math.max(parseInt(page) || 1, 1);

        limit = Math.min(
            Math.max(parseInt(limit) || 10, 1),
            100
        );

        const skip = (page - 1) * limit;

        /* =========================================================
           DATE FILTER
        ========================================================= */

        let startDate;
        let endDate;

        // Single Date
        if (date) {

            startDate = new Date(date);
            endDate = new Date(date);

            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
        }

        // Date Range
        else if (fromDate || toDate) {

            startDate = fromDate
                ? new Date(fromDate)
                : new Date();

            endDate = toDate
                ? new Date(toDate)
                : new Date();

            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
        }

        // Default Today
        else {

            startDate = new Date();
            endDate = new Date();

            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
        }

        /* =========================================================
           VALIDATE DATES
        ========================================================= */

        if (
            isNaN(startDate.getTime()) ||
            isNaN(endDate.getTime())
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid date"
            });
        }

        /* =========================================================
           COMPANY FILTER
        ========================================================= */

        const companyMatch = {
            type: "company"
        };

        if (search) {

            companyMatch.$or = [

                {
                    name: {
                        $regex: search,
                        $options: "i"
                    }
                },

                {
                    email: {
                        $regex: search,
                        $options: "i"
                    }
                },

                {
                    phone: {
                        $regex: search,
                        $options: "i"
                    }
                }
            ];
        }

        /* =========================================================
           SORTING
        ========================================================= */

        const allowedSortFields = {
            companyName: "name",
            createdAt: "createdAt"
        };

        const finalSortField =
            allowedSortFields[sortBy] || "name";

        const finalSortOrder =
            sortOrder === "desc" ? -1 : 1;

        /* =========================================================
           AGGREGATION PIPELINE
        ========================================================= */

        const pipeline = [

            /* =====================================================
               COMPANY FILTER
            ===================================================== */

            {
                $match: companyMatch
            },

            /* =====================================================
               EMPLOYEE COUNT
            ===================================================== */

            {
                $lookup: {
                    from: "employees",

                    let: {
                        companyId: "$_id"
                    },

                    pipeline: [

                        {
                            $match: {
                                $expr: {
                                    $and: [

                                        {
                                            $eq: [
                                                "$companyId",
                                                "$$companyId"
                                            ]
                                        },

                                        {
                                            $eq: [
                                                "$employmentStatus",
                                                "active"
                                            ]
                                        }
                                    ]
                                }
                            }
                        },

                        {
                            $count: "totalEmployees"
                        }
                    ],

                    as: "employeeStats"
                }
            },

            /* =====================================================
               ATTENDANCE STATS
            ===================================================== */

            {
                $lookup: {
                    from: "attendances",

                    let: {
                        companyId: "$_id"
                    },

                    pipeline: [

                        {
                            $match: {
                                $expr: {
                                    $eq: [
                                        "$companyId",
                                        "$$companyId"
                                    ]
                                },

                                date: {
                                    $gte: startDate,
                                    $lte: endDate
                                }
                            }
                        },

                        {
                            $group: {

                                _id: null,

                                totalAttendanceMarked: {
                                    $sum: 1
                                },

                                presentCount: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $eq: [
                                                    "$status",
                                                    "present"
                                                ]
                                            },
                                            1,
                                            0
                                        ]
                                    }
                                },

                                absentCount: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $eq: [
                                                    "$status",
                                                    "absent"
                                                ]
                                            },
                                            1,
                                            0
                                        ]
                                    }
                                },

                                punchInCount: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $ne: [
                                                    "$punchIn",
                                                    null
                                                ]
                                            },
                                            1,
                                            0
                                        ]
                                    }
                                }
                            }
                        }
                    ],

                    as: "attendanceStats"
                }
            },

            /* =====================================================
               FORMAT DATA
            ===================================================== */

            {
                $addFields: {

                    totalEmployees: {
                        $ifNull: [
                            {
                                $arrayElemAt: [
                                    "$employeeStats.totalEmployees",
                                    0
                                ]
                            },
                            0
                        ]
                    },

                    attendanceData: {
                        $ifNull: [
                            {
                                $arrayElemAt: [
                                    "$attendanceStats",
                                    0
                                ]
                            },
                            {}
                        ]
                    }
                }
            },

            /* =====================================================
               FINAL COUNTS
            ===================================================== */

            {
                $addFields: {

                    attendanceMarked: {
                        $ifNull: [
                            "$attendanceData.totalAttendanceMarked",
                            0
                        ]
                    },

                    presentCount: {
                        $ifNull: [
                            "$attendanceData.presentCount",
                            0
                        ]
                    },

                    absentCount: {
                        $ifNull: [
                            "$attendanceData.absentCount",
                            0
                        ]
                    },

                    punchInCount: {
                        $ifNull: [
                            "$attendanceData.punchInCount",
                            0
                        ]
                    }
                }
            },

            {
                $addFields: {

                    notMarkedAttendance: {
                        $subtract: [
                            "$totalEmployees",
                            "$attendanceMarked"
                        ]
                    }
                }
            },

            /* =====================================================
               CLEAN RESPONSE
            ===================================================== */

            {
                $project: {

                    _id: 1,

                    companyName: "$name",

                    companyEmail: "$email",

                    companyPhone: "$phone",

                    profileImage: 1,

                    totalEmployees: 1,

                    attendanceMarked: 1,

                    presentCount: 1,

                    absentCount: 1,

                    notMarkedAttendance: 1,

                    punchInCount: 1,

                    createdAt: 1
                }
            },

            /* =====================================================
               FACET
            ===================================================== */

            {
                $facet: {

                    metadata: [
                        {
                            $count: "totalDocuments"
                        }
                    ],

                    data: [

                        {
                            $sort: {
                                [finalSortField]:
                                    finalSortOrder
                            }
                        },

                        {
                            $skip: skip
                        },

                        {
                            $limit: limit
                        }
                    ]
                }
            },

            /* =====================================================
               FINAL FORMAT
            ===================================================== */

            {
                $project: {

                    data: 1,

                    totalDocuments: {
                        $ifNull: [
                            {
                                $arrayElemAt: [
                                    "$metadata.totalDocuments",
                                    0
                                ]
                            },
                            0
                        ]
                    }
                }
            }
        ];

        /* =========================================================
           EXECUTE
        ========================================================= */

        const result =
            await User.aggregate(pipeline);

        const companies =
            result[0]?.data || [];

        const totalDocuments =
            result[0]?.totalDocuments || 0;

        const totalPages =
            Math.ceil(totalDocuments / limit);

        /* =========================================================
           RESPONSE
        ========================================================= */

        return res.status(200).json({
            success: true,
            message:
                "All companies attendance fetched successfully",

            dateFilter: {
                startDate,
                endDate
            },

            pagination: {
                currentPage: page,
                limit,
                totalDocuments,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            },

            data: companies
        });

    } catch (error) {

        console.error(
            "GET ALL COMPANY ATTENDANCE ERROR:",
            error
        );

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


// GET COMPANY ATTENDANCE DASHBOARD

export const getCompanyAttendanceDashboard = async (req, res) => {
    try {

        /* =========================================================
           COMPANY ID
        ========================================================= */

        const companyId =
            req.query.companyId || req.user?._id;

        if (
            !companyId ||
            !mongoose.Types.ObjectId.isValid(companyId)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid company id"
            });
        }

        /* =========================================================
           QUERY PARAMS
        ========================================================= */

        let {
            date,
            fromDate,
            toDate,

            page = 1,
            limit = 10,

            status, // present | absent

            search = ""
        } = req.query;

        /* =========================================================
           PAGINATION
        ========================================================= */

        page = Math.max(parseInt(page) || 1, 1);

        limit = Math.min(
            Math.max(parseInt(limit) || 10, 1),
            100
        );

        const skip = (page - 1) * limit;

        /* =========================================================
           DATE RANGE
        ========================================================= */

        let startDate;
        let endDate;

        // Single Date
        if (date) {

            startDate = new Date(date);
            endDate = new Date(date);

            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);

        }

        // Date Range
        else if (fromDate || toDate) {

            startDate = fromDate
                ? new Date(fromDate)
                : new Date();

            endDate = toDate
                ? new Date(toDate)
                : new Date();

            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
        }

        // Default Today
        else {

            startDate = new Date();
            endDate = new Date();

            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
        }

        /* =========================================================
           VALIDATE DATES
        ========================================================= */

        if (
            isNaN(startDate.getTime()) ||
            isNaN(endDate.getTime())
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid date format"
            });
        }

        /* =========================================================
           COMPANY OBJECT ID
        ========================================================= */

        const companyObjectId =
            new mongoose.Types.ObjectId(companyId);

        /* =========================================================
           COMPANY DETAILS
        ========================================================= */

        const company = await User.findById(companyId)
            .select("name email")
            .lean();

        if (!company) {
            return res.status(404).json({
                success: false,
                message: "Company not found"
            });
        }

        /* =========================================================
           EMPLOYEE FILTER
        ========================================================= */

        const employeeMatch = {
            companyId: companyObjectId,
            employmentStatus: "active"
        };

        if (search) {

            employeeMatch.$or = [

                {
                    user_name: {
                        $regex: search,
                        $options: "i"
                    }
                },

                {
                    empCode: {
                        $regex: search,
                        $options: "i"
                    }
                },

                {
                    referalCode: {
                        $regex: search,
                        $options: "i"
                    }
                }
            ];
        }

        /* =========================================================
           GET TOTAL EMPLOYEE COUNT
        ========================================================= */

        const totalEmployees =
            await Employee.countDocuments(
                employeeMatch
            );

        /* =========================================================
           ATTENDANCE SUMMARY
        ========================================================= */

        const attendanceSummary =
            await Attendance.aggregate([

                {
                    $match: {
                        companyId: companyObjectId,

                        date: {
                            $gte: startDate,
                            $lte: endDate
                        }
                    }
                },

                {
                    $group: {

                        _id: null,

                        totalAttendanceMarked: {
                            $sum: 1
                        },

                        presentCount: {
                            $sum: {
                                $cond: [
                                    {
                                        $eq: [
                                            "$status",
                                            "present"
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        },

                        absentCount: {
                            $sum: {
                                $cond: [
                                    {
                                        $eq: [
                                            "$status",
                                            "absent"
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ]);

        const summary =
            attendanceSummary[0] || {};

        const presentCount =
            summary.presentCount || 0;

        const absentCount =
            summary.absentCount || 0;

        const attendanceMarked =
            summary.totalAttendanceMarked || 0;

        const notMarkedAttendance =
            totalEmployees -
            attendanceMarked;

        /* =========================================================
           EMPLOYEE ATTENDANCE LIST
        ========================================================= */

        const attendancePipeline = [

            {
                $match: employeeMatch
            },

            /* =====================================================
               USER DETAILS
            ===================================================== */

            {
                $lookup: {
                    from: "users",
                    localField: "userId",
                    foreignField: "_id",
                    as: "user",
                    pipeline: [
                        {
                            $project: {
                                name: 1,
                                email: 1,
                                phone: 1,
                                profileImage: 1
                            }
                        }
                    ]
                }
            },

            {
                $unwind: {
                    path: "$user",
                    preserveNullAndEmptyArrays: true
                }
            },

            /* =====================================================
               TODAY ATTENDANCE
            ===================================================== */

            {
                $lookup: {
                    from: "attendances",

                    let: {
                        employeeId: "$_id"
                    },

                    pipeline: [

                        {
                            $match: {

                                $expr: {
                                    $eq: [
                                        "$employeeId",
                                        "$$employeeId"
                                    ]
                                },

                                date: {
                                    $gte: startDate,
                                    $lte: endDate
                                }
                            }
                        },

                        {
                            $project: {

                                status: 1,

                                punchIn: 1,

                                punchOut: 1,

                                totalWorkingHours: 1,

                                createdAt: 1
                            }
                        }
                    ],

                    as: "attendance"
                }
            },

            {
                $unwind: {
                    path: "$attendance",
                    preserveNullAndEmptyArrays: true
                }
            },

            /* =====================================================
               ATTENDANCE STATUS
            ===================================================== */

            {
                $addFields: {

                    attendanceStatus: {
                        $ifNull: [
                            "$attendance.status",
                            "not_marked"
                        ]
                    }
                }
            },

            /* =====================================================
               STATUS FILTER
            ===================================================== */

            ...(status
                ? [
                    {
                        $match: {
                            attendanceStatus: status
                        }
                    }
                ]
                : []),

            /* =====================================================
               RESPONSE
            ===================================================== */

            {
                $project: {

                    _id: 1,

                    user_name: 1,

                    empCode: 1,

                    referalCode: 1,

                    employeeType: 1,

                    role: 1,

                    employmentStatus: 1,

                    department:
                        "$jobInfo.department",

                    designation:
                        "$jobInfo.designation",

                    user: 1,

                    attendance: {

                        status:
                            "$attendanceStatus",

                        punchIn:
                            "$attendance.punchIn",

                        punchOut:
                            "$attendance.punchOut",

                        totalWorkingHours:
                            "$attendance.totalWorkingHours"
                    }
                }
            },

            {
                $sort: {
                    user_name: 1
                }
            },

            {
                $skip: skip
            },

            {
                $limit: limit
            }
        ];

        const employeeAttendance =
            await Employee.aggregate(
                attendancePipeline
            );

        /* =========================================================
           RESPONSE
        ========================================================= */

        return res.status(200).json({

            success: true,

            message:
                "Company attendance dashboard fetched successfully",

            company: {

                companyId: company._id,

                companyName: company.name
            },

            dateFilter: {

                startDate,

                endDate
            },

            summary: {

                totalEmployees,

                attendanceMarked,

                notMarkedAttendance,

                presentCount,

                absentCount
            },

            employees: employeeAttendance
        });

    } catch (error) {

        console.error(
            "GET COMPANY ATTENDANCE DASHBOARD ERROR:",
            error
        );

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