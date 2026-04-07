import Employee from "../../models/Attandance/Employee.js";
// import Employee from "../../models/Attandance/Employee.js";
import Attendance from "../../models/Attandance/Attendance.js";
import Holiday from "../../models/Attandance/Holiday.js";
import Payroll from "../../models/Attandance/Payroll.js";
import mongoose from "mongoose";
import { normalizeToUTCDate, buildDateRange } from "./utils/date.utils.js";
import { Parser } from "json2csv";
import XLSX from "xlsx";
// import moment from "moment";
import moment from "moment-timezone";
import jwt from "jsonwebtoken";
import User from "../../models/userModel.js";
import { resolveDateRange } from "../../utils/dateRangeResolver.js";
// utils/dateRange.js

export const buildMonthRange = (year, month) => {
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
    return { start, end };
};


export const getAttendanceSummary = async (req, res) => {
    try {

        let companyId;
        companyId = req.params.companyId || req.user._id;
        const role = req.user?.role || req.user?.type;
        if (role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }

        const { date, month, year } = req.query;

        // Validate companyId
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid company ID"
            });
        }

        let startDate, endDate;

        // If specific date is provided (YYYY-MM-DD)
        if (date) {
            startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);

            endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);
        }
        // If month and year are provided
        else if (month && year) {
            startDate = new Date(year, month - 1, 1); // month is 0-indexed in JS
            startDate.setHours(0, 0, 0, 0);

            endDate = new Date(year, month, 0); // Last day of the month
            endDate.setHours(23, 59, 59, 999);
        }
        // Default to today
        else {
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);

            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        }

        // Get total active employees count for the company
        const totalEmployees = await Employee.countDocuments({
            companyId: companyId,
            isActive: true // Assuming you have an isActive field
        });

        // Get attendance summary using aggregation
        const attendanceSummary = await Attendance.aggregate([
            {
                $match: {
                    companyId: new mongoose.Types.ObjectId(companyId),
                    date: {
                        $gte: startDate,
                        $lte: endDate
                    }
                }
            },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 },
                    employees: { $addToSet: "$employeeId" } // Get unique employees
                }
            }
        ]);

        // Format the results
        const summary = {
            present: 0,
            absent: 0,
            leave: 0,
            holiday: 0,
            half_day: 0,
            week_off: 0,
            pending_approval: 0,
            rejected: 0,
            totalEmployees,
            uniqueEmployees: 0
        };

        let uniqueEmployeeIds = new Set();

        attendanceSummary.forEach(item => {
            if (summary.hasOwnProperty(item._id)) {
                summary[item._id] = item.count;
            }

            // Add employee IDs to the set
            item.employees.forEach(empId => uniqueEmployeeIds.add(empId.toString()));
        });

        summary.uniqueEmployees = uniqueEmployeeIds.size;

        // Calculate absent employees
        // Absent = total active employees - employees who have any attendance record
        const presentEmployees = uniqueEmployeeIds.size;
        summary.absent = Math.max(0, totalEmployees - presentEmployees);

        // Add date range info
        summary.dateRange = {
            from: startDate,
            to: endDate,
            type: date ? "daily" : (month && year ? "monthly" : "today")
        };

        res.status(200).json({
            success: true,
            data: summary
        });

    } catch (error) {
        console.error("Error in getAttendanceSummary:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching attendance summary",
            error: error.message
        });
    }
};


export const getUTCDayRange = (inputDate = new Date()) => {
    const start = new Date(Date.UTC(
        inputDate.getUTCFullYear(),
        inputDate.getUTCMonth(),
        inputDate.getUTCDate(),
        0, 0, 0, 0
    ));

    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    return { start, end };
};




export const getTodayPunchStatus = async (req, res) => {
    try {
        const userId = req.user._id;

        /* ==============================
           STEP 1: Resolve Employee
        ============================== */

        const employee = await Employee.findOne({
            userId,
            employmentStatus: "active"
        })
            .select("_id companyId")
            .lean();

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee profile not found"
            });
        }

        const { _id: employeeId, companyId } = employee;

        /* ==============================
           STEP 2: Get Today Range
        ============================== */

        const { start, end } = getUTCDayRange();

        /* ==============================
           STEP 3: Query Attendance
        ============================== */

        const attendance = await Attendance.findOne({
            companyId,
            employeeId,
            date: { $gte: start, $lt: end }
        })
            .select("punchIn punchOut")
            .lean();

        return res.status(200).json({
            success: true,
            isPunchedIn: Boolean(attendance?.punchIn),
            isPunchedOut: Boolean(attendance?.punchOut)
        });

    } catch (error) {
        console.error("Punch Status Error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

/* =====================================================
   Utility Functions
===================================================== */

// Distance in meters (Haversine)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // meters
    const toRad = (x) => (x * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Minutes between two dates
function diffMinutes(start, end) {
    return Math.max(0, Math.floor((end - start) / 60000));
}

// Normalize date (00:00:00)
function normalizeDate(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date;
}

/* =====================================================
   MARK ATTENDANCE CONTROLLER
===================================================== */
// controllers/attendanceController.js




// services/attendance.company.export.service.js


export const exportCompanyAttendanceSummary = async ({
    companyId,
    fromDate,
    toDate
}) => {

    /* =====================================
       Resolve Date Range (Auto or Manual)
    ====================================== */
    const { start, end } = resolveDateRange(fromDate, toDate);

    const pipeline = [

        {
            $match: {
                companyId: new mongoose.Types.ObjectId(companyId),
                date: { $gte: start, $lte: end }
            }
        },

        /* =====================================
           JOIN EMPLOYEE MASTER
        ====================================== */
        {
            $lookup: {
                from: "employees",
                localField: "employeeId",
                foreignField: "_id",
                as: "employee"
            }
        },
        { $unwind: "$employee" },

        /* =====================================
           BREAK CALCULATION
        ====================================== */
        {
            $addFields: {
                breakMinutes: {
                    $sum: {
                        $map: {
                            input: "$breaks",
                            as: "b",
                            in: {
                                $cond: [
                                    { $and: ["$$b.start", "$$b.end"] },
                                    {
                                        $divide: [
                                            { $subtract: ["$$b.end", "$$b.start"] },
                                            1000 * 60
                                        ]
                                    },
                                    0
                                ]
                            }
                        }
                    }
                }
            }
        },

        {
            $addFields: {
                netWorkMinutes: {
                    $max: [
                        { $subtract: ["$workSummary.totalMinutes", "$breakMinutes"] },
                        0
                    ]
                }
            }
        },

        /* =====================================
           GROUP PER EMPLOYEE
        ====================================== */
        {
            $group: {
                _id: "$employeeId",

                employeeName: { $first: "$employee.user_name" },
                empCode: { $first: "$employee.empCode" },
                department: { $first: "$employee.jobInfo.department" },
                designation: { $first: "$employee.jobInfo.designation" },

                totalDays: { $sum: 1 },

                absentDays: {
                    $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] }
                },

                validWorkingDays: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $ne: ["$status", "absent"] },
                                    { $eq: ["$isAutoMarked", false] },
                                    { $eq: ["$approvalStatus", "approved"] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                },

                totalWorkedMinutes: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $ne: ["$status", "absent"] },
                                    { $eq: ["$isAutoMarked", false] },
                                    { $eq: ["$approvalStatus", "approved"] }
                                ]
                            },
                            "$netWorkMinutes",
                            0
                        ]
                    }
                }
            }
        },

        /* =====================================
           FINAL EXPORT STRUCTURE
        ====================================== */
        {
            $project: {
                _id: 0,
                empCode: 1,
                employeeName: 1,
                department: 1,
                designation: 1,

                totalDays: 1,
                absentDays: 1,
                presentDays: "$validWorkingDays",

                totalWorkedHours: {
                    $round: [{ $divide: ["$totalWorkedMinutes", 60] }, 2]
                },

                averageWorkingHours: {
                    $cond: [
                        { $eq: ["$validWorkingDays", 0] },
                        0,
                        {
                            $round: [
                                {
                                    $divide: [
                                        { $divide: ["$totalWorkedMinutes", 60] },
                                        "$validWorkingDays"
                                    ]
                                },
                                2
                            ]
                        }
                    ]
                }
            }
        },

        { $sort: { empCode: 1 } }
    ];

    return await Attendance.aggregate(pipeline, { allowDiskUse: true });
};
export const AttendanceSummaryFields = [
    "empCode",
    "employeeName",
    "department",
    "designation",
    "totalDays",
    "presentDays",
    "absentDays",
    "totalWorkedHours",
    "averageWorkingHours"
];

export const mapAttendanceSummary = (record) => ({
    empCode: record.empCode ?? "",
    employeeName: record.employeeName ?? "",
    department: record.department ?? "",
    designation: record.designation ?? "",
    totalDays: record.totalDays ?? 0,
    presentDays: record.presentDays ?? 0,
    absentDays: record.absentDays ?? 0,
    totalWorkedHours: record.totalWorkedHours ?? 0,
    averageWorkingHours: record.averageWorkingHours ?? 0
});
// Export as CSV
export const exportAttendanceAsCSV = async (req, res) => {
    try {
        const raw = await exportCompanyAttendanceSummary({
            companyId: req.user._id,
            fromDate: req.query.fromDate,
            toDate: req.query.toDate
        });

        if (!raw.length) {
            return res.status(404).json({ success: false, message: "No data found" });
        }

        const data = raw.map(mapAttendanceSummary);

        const fields = [
            "empCode",
            "employeeName",
            "department",
            "designation",
            "totalDays",
            "presentDays",
            "absentDays",
            "totalWorkedHours",
            "averageWorkingHours"
        ];

        const parser = new Parser({ fields });
        const csv = parser.parse(data);

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=attendance_summary.csv`
        );

        res.status(200).send(csv);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
// Export as Excel
export const exportAttendanceAsExcel = async (req, res) => {
    try {
        const raw = await exportCompanyAttendanceSummary({
            companyId: req.user._id,
            fromDate: req.query.fromDate,
            toDate: req.query.toDate
        });

        if (!raw.length) {
            return res.status(404).json({ success: false, message: "No data found" });
        }

        const data = raw.map(mapAttendanceSummary);

        const wb = XLSX.utils.book_new();

        const worksheetData = data.map(r => ({
            "Employee Code": r.empCode,
            "Employee Name": r.employeeName,
            "Department": r.department,
            "Designation": r.designation,
            "Total Days": r.totalDays,
            "Present Days": r.presentDays,
            "Absent Days": r.absentDays,
            "Total Worked (Hours)": r.totalWorkedHours,
            "Average Working (Hours)": r.averageWorkingHours
        }));

        const ws = XLSX.utils.json_to_sheet(worksheetData);

        ws["!cols"] = [
            { wch: 15 },
            { wch: 25 },
            { wch: 20 },
            { wch: 20 },
            { wch: 10 },
            { wch: 12 },
            { wch: 12 },
            { wch: 18 },
            { wch: 20 }
        ];

        XLSX.utils.book_append_sheet(wb, ws, "Attendance Summary");

        const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=attendance_summary.xlsx`
        );

        res.send(buffer);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Unified export endpoint
export const getAttendanceExport = async (req, res) => {
    try {
        const { format = 'json' } = req.query;

        if (format === 'csv') {
            return await exportAttendanceAsCSV(req, res);
        } else if (format === 'excel') {
            return await exportAttendanceAsExcel(req, res);
        } else {
            // Return JSON as before
            const data = await exportCompanyAttendanceSummary({
                companyId: req.user._id,
                fromDate: req.query.fromDate,
                toDate: req.query.toDate
            });

            res.json({
                success: true,
                data,
                meta: {
                    totalRecords: data.length,
                    dateRange: {
                        fromDate: req.query.fromDate || 'Last 31 days',
                        toDate: req.query.toDate || 'Today'
                    }
                }
            });
        }

    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message
        });
    }
};


/* ======================================================
   MARK ATTENDANCE (Punch In + Multi Punch Out)
====================================================== */

export const markAttendance = async (req, res) => {

    const session = await mongoose.startSession();
    session.startTransaction();

    try {

        /* --------------------------------
           1. Auth + Body
        -------------------------------- */

        const u_id = req.user._id;

        const {
            date,
            punchIn,
            punchOut,
            breaks,
            geoLocation,
            deviceInfo,
            shift,
            remarks,
            token
        } = req.body;


        if (!token) {
            return res.status(401).json({
                message: "Attendance token required"
            });
        }

        if (!date || !geoLocation?.coordinates) {
            return res.status(400).json({
                message: "date and geoLocation required"
            });
        }


        /* --------------------------------
           2. Verify JWT
        -------------------------------- */

        let decoded;

        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                message: "Invalid or expired token"
            });
        }

        if (!decoded?.userId) {
            return res.status(401).json({
                message: "Invalid token payload"
            });
        }


        const user = await User
            .findById(decoded.userId)
            .select("-password -otp -__v");

        if (!user) {
            return res.status(401).json({
                message: "User not found"
            });
        }


        const companyId = user._id;


        /* --------------------------------
           3. Employee Validation
        -------------------------------- */

        const employee = await Employee.findOne({
            userId: u_id,
            employmentStatus: "active"
        }).session(session);

        if (!employee) {
            return res.status(404).json({
                message: "Active employee not found"
            });
        }

        if (employee.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({
                message: "Unauthorized company"
            });
        }


        const attendanceDate = normalizeDate(date);


        /* --------------------------------
           4. Check Holiday
        -------------------------------- */

        const holiday = await Holiday.findOne({
            companyId,
            date: attendanceDate
        }).session(session);

        let status = holiday ? "holiday" : "present";


        /* --------------------------------
           5. Geo Fence Validation
        -------------------------------- */

        let geoVerified = false;
        let suspicious = false;

        if (employee.officeLocation?.coordinates?.length === 2) {

            const [officeLng, officeLat] =
                employee.officeLocation.coordinates;

            const [userLng, userLat] =
                geoLocation.coordinates;

            const distance = getDistance(
                officeLat,
                officeLng,
                userLat,
                userLng
            );


            // Outside allowed radius
            if (distance > employee.officeLocation.radius) {

                return res.status(403).json({
                    success: false,
                    errorCode: "OUTSIDE_OFFICE_RADIUS",
                    message: "You are not within the allowed office location range.",
                    data: {
                        allowedRadius: employee.officeLocation.radius,
                        currentDistance: Math.round(distance),
                        unit: "meters"
                    }
                });

            } else {
                geoVerified = true;
            }
        }


        /* --------------------------------
           6. Find Existing Attendance
        -------------------------------- */

        let attendance = await Attendance.findOne({
            companyId,
            employeeId: employee._id,
            date: attendanceDate
        }).session(session);


        /* --------------------------------
           7. FIRST TIME → PUNCH IN
        -------------------------------- */

        if (!attendance) {

            if (!punchIn) {
                return res.status(400).json({
                    message: "Punch In required"
                });
            }

            const inTime = new Date(punchIn);
            const outTime = punchOut ? new Date(punchOut) : null;


            let totalMinutes = 0;

            if (outTime) {
                totalMinutes = diffMinutes(inTime, outTime);
            }


            /* Break Deduction */

            if (breaks?.length) {
                for (const b of breaks) {
                    if (b.start && b.end) {
                        totalMinutes -= diffMinutes(
                            new Date(b.start),
                            new Date(b.end)
                        );
                    }
                }
            }


            let overtimeMinutes = 0;
            let lateMinutes = 0;
            let earlyLeaveMinutes = 0;


            /* Shift Calculation */

            if (shift?.startTime && shift?.endTime) {

                const shiftStart = new Date(
                    `${attendanceDate
                        .toISOString()
                        .split("T")[0]}T${shift.startTime}:00`
                );

                const shiftEnd = new Date(
                    `${attendanceDate
                        .toISOString()
                        .split("T")[0]}T${shift.endTime}:00`
                );

                if (inTime > shiftStart) {
                    lateMinutes = diffMinutes(shiftStart, inTime);
                }

                if (outTime && outTime < shiftEnd) {
                    earlyLeaveMinutes = diffMinutes(outTime, shiftEnd);
                }

                if (outTime && outTime > shiftEnd) {
                    overtimeMinutes = diffMinutes(shiftEnd, outTime);
                }
            }


            if (totalMinutes < 240 && status === "present") {
                status = "half_day";
            }

            if (!outTime) {
                suspicious = true;
            }


            /* Create Attendance */

            attendance = new Attendance({

                companyId,
                employeeId: employee._id,

                date: attendanceDate,

                punchIn: inTime,
                punchOut: outTime,

                breaks,
                shift,

                status,

                geoLocation: {
                    ...geoLocation,
                    verified: geoVerified
                },

                deviceInfo,

                workSummary: {
                    totalMinutes,
                    overtimeMinutes,
                    lateMinutes,
                    earlyLeaveMinutes
                },

                remarks,

                isSuspicious: suspicious,

                punchHistory: outTime ? [{
                    punchOut: outTime,
                    deviceInfo,
                    geoLocation
                }] : []
            });

        }


        /* --------------------------------
           8. ALREADY EXISTS → PUNCH OUT
        -------------------------------- */

        else {

            if (!punchOut) {
                return res.status(400).json({
                    message: "Punch Out required"
                });
            }

            const outTime = new Date(punchOut);


            /* Anti-Spam */

            const last = attendance.punchHistory?.at(-1);

            if (last) {

                const gap = diffMinutes(
                    new Date(last.punchOut),
                    outTime
                );

                if (gap < 3) {
                    return res.status(429).json({
                        message: "Too frequent punch"
                    });
                }
            }


            /* Save History */

            attendance.punchHistory.push({
                punchOut: outTime,
                deviceInfo,
                geoLocation
            });


            /* Update Latest */

            attendance.punchOut = outTime;


            /* Recalculate */

            const inTime = new Date(attendance.punchIn);

            let totalMinutes =
                diffMinutes(inTime, outTime);


            if (attendance.breaks?.length) {
                for (const b of attendance.breaks) {
                    if (b.start && b.end) {
                        totalMinutes -= diffMinutes(
                            new Date(b.start),
                            new Date(b.end)
                        );
                    }
                }
            }


            let overtimeMinutes = 0;
            let lateMinutes = 0;
            let earlyLeaveMinutes = 0;


            if (
                attendance.shift?.startTime &&
                attendance.shift?.endTime
            ) {

                const shiftStart = new Date(
                    `${attendanceDate
                        .toISOString()
                        .split("T")[0]}T${attendance.shift.startTime}:00`
                );

                const shiftEnd = new Date(
                    `${attendanceDate
                        .toISOString()
                        .split("T")[0]}T${attendance.shift.endTime}:00`
                );

                if (inTime > shiftStart) {
                    lateMinutes =
                        diffMinutes(shiftStart, inTime);
                }

                if (outTime < shiftEnd) {
                    earlyLeaveMinutes =
                        diffMinutes(outTime, shiftEnd);
                }

                if (outTime > shiftEnd) {
                    overtimeMinutes =
                        diffMinutes(shiftEnd, outTime);
                }
            }


            attendance.workSummary = {
                totalMinutes,
                overtimeMinutes,
                lateMinutes,
                earlyLeaveMinutes
            };


            attendance.status =
                totalMinutes < 240
                    ? "half_day"
                    : "present";


            /* Device Fraud */

            if (
                attendance.deviceInfo?.deviceId &&
                attendance.deviceInfo.deviceId !==
                deviceInfo?.deviceId
            ) {
                attendance.isSuspicious = true;
            }

        }


        /* --------------------------------
           9. Save + Commit
        -------------------------------- */

        await attendance.save({ session });

        await session.commitTransaction();
        session.endSession();


        return res.status(201).json({
            message: "Attendance processed successfully",
            attendance
        });


    } catch (error) {

        await session.abortTransaction();
        session.endSession();

        console.error("Attendance Error:", error);

        return res.status(500).json({
            message: "Attendance failed",
            error: error.message
        });
    }
};





// utils/date.util.js

export const getISTDayRange = () => {

    const now = new Date();

    // Convert to IST first
    const istNow = new Date(
        now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    );

    const start = new Date(istNow);
    start.setHours(0, 0, 0, 0);

    const end = new Date(istNow);
    end.setHours(23, 59, 59, 999);

    return { start, end };
};
export const toIST = (date) => {
    if (!date) return null;

    const d = new Date(date);

    if (isNaN(d.getTime())) return null;

    return d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false
    });
};

// utils/date.util.js
export const convertUTCtoIST = (date) => {
    if (!date) return null;
    return new Date(new Date(date).getTime() + (5.5 * 60 * 60 * 1000));
};


export const getCompanyTodayAttendance = async (req, res) => {

    try {

        /* ===========================
           Auth Context
        ============================ */
        let companyId;
        companyId = req.user._id || req.user.id;
        const role = req.user?.role || req.user?.type;
        if (role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid company id"
            });
        }


        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        /* ===========================
           Date
        ============================ */

        const today = normalizeToUTCDate();

        /* ===========================
           Active Employees
        ============================ */

        const employees = await Employee.find({
            companyId,
            employmentStatus: "active"
        })
            .select("_id empCode user_name ")
            .lean();

        if (!employees.length) {
            return res.status(404).json({
                success: false,
                message: "No active employees found"
            });
        }

        const employeeIds = employees.map(e => e._id);

        /* ===========================
           Attendance Records
        ============================ */

        const { start, end } = getISTDayRange();

        const attendanceList = await Attendance.find({
            companyId,
            employeeId: { $in: employeeIds },
            date: { $gte: start, $lte: end }
        })
            .select(`
                employeeId
                status
                punchIn
                punchOut
                workSummary
                isSuspicious
                geoLocation.verified
            `)
            .lean();

        /* ===========================
           Map Attendance
        ============================ */

        const attendanceMap = new Map();

        attendanceList.forEach(record => {
            attendanceMap.set(
                record.employeeId.toString(),
                record
            );
        });

        /* ===========================
           Merge (Employee + Attendance)
        ============================ */

        const result = employees
            .slice(skip, skip + limit)
            .map(emp => {

                const record =
                    attendanceMap.get(emp._id.toString());

                return {

                    employeeId: emp._id,
                    empCode: emp.empCode,
                    name: emp.user_name,
                    phone: emp.phone,
                    email: emp.email,

                    date: today,

                    status: record?.status || "absent",

                    punchIn: convertUTCtoIST(record?.punchIn),
                    punchOut: convertUTCtoIST(record?.punchOut),
                    flags: {

                        isLate:
                            (record?.workSummary?.lateMinutes || 0) > 0,

                        isEarlyLeave:
                            (record?.workSummary?.earlyLeaveMinutes || 0) > 0,

                        isOvertime:
                            (record?.workSummary?.overtimeMinutes || 0) > 0,

                        isSuspicious:
                            record?.isSuspicious || false,

                        geoVerified:
                            record?.geoLocation?.verified || false
                    },

                    workSummary: record?.workSummary || {
                        totalMinutes: 0,
                        payableMinutes: 0,
                        overtimeMinutes: 0,
                        lateMinutes: 0,
                        earlyLeaveMinutes: 0
                    }
                };
            });

        /* ===========================
           Response
        ============================ */

        return res.status(200).json({

            success: true,

            companyId,

            date: today,

            pagination: {
                page,
                limit,
                totalEmployees: employees.length,
                totalPages: Math.ceil(employees.length / limit)
            },

            data: result
        });

    } catch (error) {

        console.error("Company Today Attendance Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch company attendance"
        });
    }
};





/* ======================================================
   GET: Monthly Employee Card Summary (IST Based)
====================================================== */



export const getEmployeeSimpleMonthlySummary = async (req, res) => {
    try {

        /* =====================================
           1. AUTH
        ===================================== */
        let companyId;
        companyId = req.user?._id || req.user?.id;
        const role = req.user?.role || req.user?.type;
        if (role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }

        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid company id"
            });
        }


        /* =====================================
           2. DATE RANGE
        ===================================== */

        const { startDate, endDate } = req.query;

        const today = new Date();

        const start = startDate
            ? new Date(startDate)
            : new Date(today.getFullYear(), today.getMonth(), 1);

        const end = endDate
            ? new Date(endDate)
            : new Date();

        end.setHours(23, 59, 59, 999);


        /* =====================================
           3. EMPLOYEE → ATTENDANCE AGGREGATION
        ===================================== */

        const report = await Employee.aggregate([


            /* ---------- COMPANY EMPLOYEES ---------- */
            {
                $match: {
                    companyId: new mongoose.Types.ObjectId(companyId),
                    employmentStatus: "active"
                }
            },


            /* ---------- USER JOIN ---------- */
            {
                $lookup: {
                    from: "users",
                    localField: "userId",
                    foreignField: "_id",
                    as: "user"
                }
            },
            {
                $unwind: {
                    path: "$user",
                    preserveNullAndEmptyArrays: true
                }
            },


            /* ---------- ATTENDANCE JOIN ---------- */
            {
                $lookup: {
                    from: "attendances",
                    let: { empId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$employeeId", "$$empId"] },
                                        { $gte: ["$date", start] },
                                        { $lte: ["$date", end] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "attendance"
                }
            },


            /* ---------- COUNTS ---------- */
            {
                $addFields: {
                    presentDays: {
                        $size: {
                            $filter: {
                                input: "$attendance",
                                as: "a",
                                cond: {
                                    $and: [
                                        { $eq: ["$$a.status", "present"] },
                                        { $eq: ["$$a.approvalStatus", "approved"] }
                                    ]
                                }
                            }
                        }
                    },

                    halfDays: {
                        $size: {
                            $filter: {
                                input: "$attendance",
                                as: "a",
                                cond: { $eq: ["$$a.status", "half_day"] }
                            }
                        }
                    },

                    leaveDays: {
                        $size: {
                            $filter: {
                                input: "$attendance",
                                as: "a",
                                cond: { $eq: ["$$a.status", "leave"] }
                            }
                        }
                    },

                    totalMinutes: {
                        $sum: "$attendance.workSummary.totalMinutes"
                    },

                    overtimeMinutes: {
                        $sum: "$attendance.workSummary.overtimeMinutes"
                    }
                }
            },


            /* ---------- DERIVED ---------- */
            {
                $addFields: {
                    workingDays: {
                        $add: ["$presentDays", "$halfDays"]
                    },

                    totalHours: {
                        $round: [
                            { $divide: ["$totalMinutes", 60] },
                            2
                        ]
                    },

                    overtimeHours: {
                        $round: [
                            { $divide: ["$overtimeMinutes", 60] },
                            2
                        ]
                    }
                }
            },


            /* ---------- FINAL FORMAT ---------- */
            {
                $project: {
                    _id: 0,
                    userId: "$user._id",

                    /* FROM EMPLOYEE TABLE - CORRECTED FIELD REFERENCES */
                    name: {
                        $ifNull: ["$user_name", "$user.name", "Unknown"]
                    }, // First try user_name from employee, then user.name, fallback

                    empCode: 1,

                    email: "$user.email",
                    phone: "$user.phone",

                    department: "$jobInfo.department",
                    designation: "$jobInfo.designation",

                    joiningDate: {
                        $dateToString: {
                            format: "%Y-%m-%d",
                            date: "$jobInfo.joiningDate",
                            onNull: null
                        }
                    },

                    summary: {
                        presentDays: "$presentDays",
                        halfDays: "$halfDays",
                        leaveDays: "$leaveDays",
                        workingDays: "$workingDays",
                        // absentDays: 0 // temporary placeholder
                    },

                    timeSummary: {
                        totalHours: "$totalHours",
                        overtimeHours: "$overtimeHours"
                    }
                }
            },

            { $sort: { name: 1 } }

        ]);


        /* =====================================
           4. SIMPLE AUTO-ABSENT LOGIC
        ===================================== */

        const totalDays =
            Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;


        report.forEach(emp => {

            const s = emp.summary;

            const marked =
                (s.presentDays || 0) +
                (s.halfDays || 0) +
                (s.leaveDays || 0);

            let absent = totalDays - marked;

            if (absent < 0) absent = 0;

            // override
            s.absentDays = absent;

        });


        /* =====================================
           5. COMPANY SUMMARY
        ===================================== */

        const companySummary = {
            totalEmployees: report.length,
            totalPresent: 0,
            // totalAbsent: 0,
            totalLeave: 0,
            totalWorkingDays: 0,
            totalHours: 0,
            totalOvertime: 0
        };


        report.forEach(emp => {
            const s = emp.summary;
            const t = emp.timeSummary;

            companySummary.totalPresent += s.presentDays || 0;
            // companySummary.totalAbsent += s.absentDays || 0;
            companySummary.totalLeave += s.leaveDays || 0;
            companySummary.totalWorkingDays += s.workingDays || 0;
            companySummary.totalHours += t.totalHours || 0;
            companySummary.totalOvertime += t.overtimeHours || 0;
        });


        companySummary.totalHours =
            Math.round(companySummary.totalHours * 100) / 100;

        companySummary.totalOvertime =
            Math.round(companySummary.totalOvertime * 100) / 100;


        /* =====================================
           6. RESPONSE
        ===================================== */

        return res.status(200).json({
            success: true,
            data: {
                period: {
                    start: start.toISOString().split("T")[0],
                    end: end.toISOString().split("T")[0]
                },
                summary: companySummary,
                report
            }
        });


    } catch (error) {
        console.error("Monthly Summary Error:", error);
        return res.status(500).json({
            success: false,
            message: "Monthly report failed",
            error: error.message
        });
    }
};






export const debugAttendanceData = async (req, res) => {
    try {
        const companyId = req.user._id;

        // 1. Check raw attendance records
        const attendanceRecords = await Attendance.find({
            companyId: new mongoose.Types.ObjectId(companyId)
        })
            .limit(5)
            .lean();

        console.log('Sample Attendance Records:', JSON.stringify(attendanceRecords, null, 2));

        // 2. Check employees
        const employees = await Employee.find({
            companyId: new mongoose.Types.ObjectId(companyId)
        })
            .limit(5)
            .lean();

        console.log('Sample Employees:', JSON.stringify(employees, null, 2));

        // 3. Check users
        const employeeIds = employees.map(e => e.userId);
        const users = await User.find({
            _id: { $in: employeeIds }
        })
            .limit(5)
            .lean();

        console.log('Sample Users:', JSON.stringify(users, null, 2));

        // 4. Count documents
        const counts = {
            totalAttendance: await Attendance.countDocuments({ companyId }),
            totalEmployees: await Employee.countDocuments({ companyId }),
            attendanceWithEmployeeId: await Attendance.countDocuments({
                companyId,
                employeeId: { $exists: true, $ne: null }
            })
        };

        console.log('Document Counts:', counts);

        res.json({
            success: true,
            data: {
                counts,
                sampleAttendance: attendanceRecords,
                sampleEmployees: employees,
                sampleUsers: users
            }
        });

    } catch (error) {
        console.error('Debug Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
/**
 * @desc   Get Employee Monthly Attendance
 * @route  GET /api/attendance/monthly
 * @access Employee
 */
export const getAttendance = async (req, res) => {

    try {

        /* ============================
           1. Auth Context
        ============================ */

        const companyId = req.user.companyId;
        const userId = req.user._id;

        if (!companyId || !userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized access"
            });
        }

        /* ============================
           2. Validate Params
        ============================ */

        const month = Number(req.query.month);
        const year = Number(req.query.year);

        if (
            !month || !year ||
            month < 1 || month > 12 ||
            year < 2000
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid month/year"
            });
        }

        /* ============================
           3. Employee Mapping
        ============================ */

        const employee = await Employee
            .findOne({
                companyId,
                userId,
                employmentStatus: "active"
            })
            .select("_id empCode role")
            .lean();

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Active employee not found"
            });
        }

        /* ============================
           4. Date Range
        ============================ */

        const { start, end } = buildMonthRange(year, month);

        /* ============================
           5. Fetch Attendance
        ============================ */

        const attendance = await Attendance
            .find({
                companyId,
                employeeId: employee._id,
                date: { $gte: start, $lte: end }
            })
            .select(`
                date
                punchIn
                punchOut
                breaks
                status
                workSummary
                geoLocation.verified
                isSuspicious
            `)
            .sort({ date: 1 })
            .lean();

        /* ============================
           6. Response
        ============================ */

        return res.status(200).json({
            success: true,
            meta: {
                employeeId: employee._id,
                empCode: employee.empCode,
                month,
                year,
                totalDays: attendance.length
            },
            data: attendance
        });

    } catch (error) {

        console.error("Attendance Fetch Error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to fetch attendance"
        });
    }
};




/* ================================
   Helper: Format Time (IST)
================================ */
const formatTime = (date) => {
    if (!date) return "-";

    try {
        return new Date(date).toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",   // Force IST
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        });
    } catch (err) {
        console.error("formatTime error:", err);
        return "-";
    }
};


/* ================================
   Helper: Minutes → Hr Min
================================ */
const formatMinutes = (minutes) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return "-";

    const h = Math.floor(minutes / 60);
    const m = minutes % 60;

    return `${h}h ${m}m`;
};


/* =================================================
   GET: Employee Monthly Attendance (Dashboard)
================================================= */


/* =================================================
   GET: Employee Attendance Summary + CSV
================================================= */

export const getEmployeeAttendanceSummary = async (req, res) => {

    try {

        /* ============================
           1. Auth
        ============================ */

        const userId = req.query.userId;

        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }


        /* ============================
           2. Params
        ============================ */

        const month = Number(req.query.month);
        const year = Number(req.query.year);
        const format = req.query.format; // csv | json

        if (!month || !year || month < 1 || month > 12 || year < 2000) {
            return res.status(400).json({
                success: false,
                message: "Invalid month/year"
            });
        }


        /* ============================
           3. Block Future Months
        ============================ */

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (
            year > today.getFullYear() ||
            (year === today.getFullYear() && month > today.getMonth() + 1)
        ) {
            return res.status(400).json({
                success: false,
                message: "Future month not allowed"
            });
        }


        /* ============================
           4. Employee
        ============================ */

        const employee = await Employee.findOne({
            userId,
            employmentStatus: "active"
        })
            .select("_id empCode")
            .lean();

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }


        /* ============================
           5. Date Range
        ============================ */

        const { start, end } = buildMonthRange(year, month);


        /* ============================
           6. Attendance
        ============================ */

        const records = await Attendance.find({
            employeeId: employee._id,
            date: { $gte: start, $lte: end }
        })
            .sort({ date: -1 })
            .lean();


        /* ============================
           7. Build Lookup Map
        ============================ */

        const map = new Map();

        records.forEach(r => {
            const key = r.date.toISOString().split("T")[0];
            map.set(key, r);
        });


        /* ============================
           8. Calculate Loop Range
        ============================ */

        const isCurrentMonth =
            today.getFullYear() === year &&
            today.getMonth() + 1 === month;

        const lastDay = isCurrentMonth
            ? today.getDate() // till today
            : new Date(year, month, 0).getDate(); // full month


        const todayKey = today.toISOString().split("T")[0];
        const yesterdayKey = new Date(today.getTime() - 86400000)
            .toISOString()
            .split("T")[0];


        /* ============================
           9. Build Report
        ============================ */

        let presentDays = 0;
        let absentDays = 0;
        let totalMinutes = 0;

        const report = [];


        for (let i = lastDay; i >= 1; i--) {

            const date = new Date(year, month - 1, i);
            date.setHours(0, 0, 0, 0);

            const key = date.toISOString().split("T")[0];

            let label = date.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short"
            });

            if (key === todayKey) label = "Today";
            if (key === yesterdayKey) label = "Yesterday";

            const rec = map.get(key);


            /* ---------- No Record ---------- */
            if (!rec) {

                // Today without punch → Pending
                if (key === todayKey) {

                    report.push({
                        Date: "Today",
                        TimeIn: "Pending",
                        TimeOut: "-",
                        TotalHours: "-"
                    });

                    continue;
                }

                // Past day → Absent
                absentDays++;

                report.push({
                    Date: label,
                    TimeIn: "Absent",
                    TimeOut: "-",
                    TotalHours: "-"
                });

                continue;
            }


            /* ---------- Holiday / Week Off ---------- */

            if (
                rec.status === "holiday" ||
                rec.status === "week_off"
            ) {

                report.push({
                    Date: label,
                    TimeIn: rec.status === "holiday" ? "Holiday" : "Week Off",
                    TimeOut: "-",
                    TotalHours: "-"
                });

                continue;
            }


            /* ---------- Present ---------- */

            if (rec.status === "present") presentDays++;

            const minutes = rec.workSummary?.totalMinutes || 0;

            totalMinutes += minutes;

            report.push({
                Date: label,
                TimeIn: formatTime(rec.punchIn),
                TimeOut: rec.punchOut
                    ? formatTime(rec.punchOut)
                    : "-",
                TotalHours: formatMinutes(minutes)
            });
        }


        /* ============================
           10. CSV Export
        ============================ */

        if (format === "csv") {

            const parser = new Parser({
                fields: ["Date", "TimeIn", "TimeOut", "TotalHours"]
            });

            const csv = parser.parse(report);

            const fileName =
                `attendance_${employee.empCode}_${month}_${year}.csv`;


            res.setHeader("Content-Type", "text/csv");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${fileName}"`
            );

            return res.status(200).send(csv);
        }


        /* ============================
           11. Summary
        ============================ */

        const avgMinutes = presentDays
            ? Math.round(totalMinutes / presentDays)
            : 0;


        /* ============================
           12. JSON Response
        ============================ */

        return res.status(200).json({

            success: true,

            meta: {
                employeeId: employee._id,
                empCode: employee.empCode,
                month,
                year
            },

            summary: {
                avgPerDay: formatMinutes(avgMinutes),
                presentDays,
                absentDays,
                totalShownDays: lastDay
            },

            records: report
        });

    } catch (error) {

        console.error("Attendance Summary Error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};


/**
 * @desc   Get Monthly Attendance Summary (Payroll)
 * @route  GET /api/attendance/summary
 * @access Employee
 */
export const getMonthlySummary = async (req, res) => {

    try {

        /* ============================
           1. Auth Context
        ============================ */

        const companyId = req.user.companyId;
        const userId = req.user._id;

        /* ============================
           2. Validate Params
        ============================ */

        const month = Number(req.query.month);
        const year = Number(req.query.year);

        if (
            !month || !year ||
            month < 1 || month > 12
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid month/year"
            });
        }

        /* ============================
           3. Employee
        ============================ */

        const employee = await Employee
            .findOne({
                companyId,
                userId,
                employmentStatus: "active"
            })
            .select("_id salaryStructure")
            .lean();

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }

        /* ============================
           4. Date Range
        ============================ */

        const { start, end } = buildMonthRange(year, month);

        /* ============================
           5. Aggregation (Index Aware)
        ============================ */

        const summary = await Attendance.aggregate([

            {
                $match: {
                    companyId: new mongoose.Types.ObjectId(companyId),
                    employeeId: employee._id,
                    date: { $gte: start, $lte: end }
                }
            },

            {
                $group: {

                    _id: "$status",

                    days: { $sum: 1 },

                    totalMinutes: {
                        $sum: "$workSummary.totalMinutes"
                    },

                    overtimeMinutes: {
                        $sum: "$workSummary.overtimeMinutes"
                    },

                    lateMinutes: {
                        $sum: "$workSummary.lateMinutes"
                    },

                    earlyLeaveMinutes: {
                        $sum: "$workSummary.earlyLeaveMinutes"
                    }
                }
            }
        ]);

        /* ============================
           6. Normalize Output
        ============================ */

        const stats = {
            present: 0,
            absent: 0,
            leave: 0,
            holiday: 0,
            half_day: 0,
            week_off: 0
        };

        let payrollMinutes = 0;
        let overtimeMinutes = 0;

        summary.forEach(item => {

            stats[item._id] = item.days;

            payrollMinutes += item.totalMinutes || 0;

            overtimeMinutes += item.overtimeMinutes || 0;
        });

        /* ============================
           7. Salary Estimation
        ============================ */

        const perHour = employee.salaryStructure?.perHour || 0;
        const overtimeRate = employee.salaryStructure?.overtimeRate || 0;

        const payableHours = payrollMinutes / 60;
        const overtimeHours = overtimeMinutes / 60;

        const basePay = payableHours * perHour;
        const overtimePay = overtimeHours * overtimeRate;

        /* ============================
           8. Response
        ============================ */

        return res.status(200).json({

            success: true,

            period: { month, year },

            attendance: stats,

            work: {
                totalMinutes: payrollMinutes,
                overtimeMinutes,
                payableHours,
                overtimeHours
            },

            payroll: {
                perHour,
                overtimeRate,
                basePay,
                overtimePay,
                grossPay: basePay + overtimePay
            }
        });

    } catch (error) {

        console.error("Summary Error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to generate summary"
        });
    }
};



/**
 * @desc Employee Today Attendance
 */
export const getTodayAttendance = async (req, res) => {

    try {

        /* ======================
           Auth Context
        ====================== */

        const userId = req.user._id;
        const companyId = req.user.companyId;

        /* ======================
           Employee
        ====================== */

        const employee = await Employee.findOne({
            userId,
            companyId,
            employmentStatus: "active"
        })
            .select("_id empCode")
            .lean();

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }

        /* ======================
           Date
        ====================== */

        const today = normalizeToUTCDate();

        /* ======================
           Attendance
        ====================== */

        const record = await Attendance.findOne({
            companyId,
            employeeId: employee._id,
            date: today
        })
            .select(`
            status
            punchIn
            punchOut
            workSummary
            isSuspicious
            geoLocation.verified
        `)
            .lean();

        /* ======================
           Fallback
        ====================== */

        const status = record?.status || "absent";

        /* ======================
           Response
        ====================== */

        return res.status(200).json({

            success: true,

            date: today,

            status,

            punchIn: record?.punchIn || null,

            punchOut: record?.punchOut || null,

            flags: {
                isLate: (record?.workSummary?.lateMinutes || 0) > 0,
                isEarlyLeave: (record?.workSummary?.earlyLeaveMinutes || 0) > 0,
                isOvertime: (record?.workSummary?.overtimeMinutes || 0) > 0,
                isSuspicious: record?.isSuspicious || false,
                geoVerified: record?.geoLocation?.verified || false
            }
        });

    } catch (error) {

        console.error("Today Attendance Error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to fetch today attendance"
        });
    }
};


/**
 * @desc Get Attendance By Date
 */
export const getDailyAttendance = async (req, res) => {

    try {

        const { date } = req.query;

        if (!date) {
            return res.status(400).json({
                success: false,
                message: "date is required"
            });
        }

        const userId = req.user._id;
        const companyId = req.user.companyId;

        const employee = await Employee.findOne({
            userId,
            companyId,
            employmentStatus: "active"
        })
            .select("_id")
            .lean();

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }

        const normalized = normalizeToUTCDate(new Date(date));

        const record = await Attendance.findOne({
            companyId,
            employeeId: employee._id,
            date: normalized
        }).lean();

        return res.status(200).json({

            success: true,

            date: normalized,

            attendance: record || {
                status: "absent",
                punchIn: null,
                punchOut: null
            }
        });

    } catch (error) {

        console.error("Daily Attendance Error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to fetch daily attendance"
        });
    }
};



/**
 * @desc Attendance Range Summary
 */
export const getRangeSummary = async (req, res) => {

    try {

        const { from, to } = req.query;

        if (!from || !to) {
            return res.status(400).json({
                success: false,
                message: "from and to dates required"
            });
        }

        const userId = req.user._id;
        const companyId = req.user.companyId;

        const employee = await Employee.findOne({
            userId,
            companyId,
            employmentStatus: "active"
        })
            .select("_id salaryStructure")
            .lean();

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }

        const { start, end } = buildDateRange(from, to);

        const summary = await Attendance.aggregate([

            {
                $match: {
                    companyId: new mongoose.Types.ObjectId(companyId),
                    employeeId: employee._id,
                    date: { $gte: start, $lte: end }
                }
            },

            {
                $group: {

                    _id: "$status",

                    days: { $sum: 1 },

                    totalMinutes: { $sum: "$workSummary.totalMinutes" },

                    overtimeMinutes: { $sum: "$workSummary.overtimeMinutes" }
                }
            }
        ]);

        /* Normalize */

        const stats = {
            present: 0,
            absent: 0,
            leave: 0,
            holiday: 0,
            half_day: 0,
            week_off: 0
        };

        let workMinutes = 0;
        let overtimeMinutes = 0;

        summary.forEach(i => {

            stats[i._id] = i.days;

            workMinutes += i.totalMinutes || 0;

            overtimeMinutes += i.overtimeMinutes || 0;
        });

        return res.status(200).json({

            success: true,

            period: { from, to },

            attendance: stats,

            work: {
                totalMinutes: workMinutes,
                overtimeMinutes,
                totalHours: workMinutes / 60
            }
        });

    } catch (error) {

        console.error("Range Summary Error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to generate summary"
        });
    }
};








export const exportAttendanceCSV = async (req, res) => {
    try {
        const companyId = req.user._id;

        moment.tz.setDefault("Asia/Kolkata");

        const { startDate, endDate, month, year } = req.query;

        let fromDateIST;
        let toDateIST;

        /* --------------------------------------------------
           Date Filter (IST)
        -------------------------------------------------- */

        if (month) {
            fromDateIST = moment.tz(month, "YYYY-MM", "Asia/Kolkata").startOf("month");
            toDateIST = moment.tz(month, "YYYY-MM", "Asia/Kolkata").endOf("month");
        }
        else if (startDate && endDate) {
            fromDateIST = moment.tz(startDate, "YYYY-MM-DD", "Asia/Kolkata").startOf("day");
            toDateIST = moment.tz(endDate, "YYYY-MM-DD", "Asia/Kolkata").endOf("day");
        }
        else if (year) {
            fromDateIST = moment.tz(`${year}-01-01`, "Asia/Kolkata").startOf("year");
            toDateIST = moment.tz(`${year}-12-31`, "Asia/Kolkata").endOf("year");
        }
        else {
            return res.status(400).json({
                success: false,
                message: "Provide month OR startDate+endDate OR year"
            });
        }

        const fromUTC = fromDateIST.clone().utc().toDate();
        const toUTC = toDateIST.clone().utc().toDate();

        /* --------------------------------------------------
           Aggregation (Attendance → Employee → User)
        -------------------------------------------------- */

        const records = await Attendance.aggregate([
            {
                $match: {
                    companyId: new mongoose.Types.ObjectId(companyId),
                    date: { $gte: fromUTC, $lte: toUTC }
                }
            },

            /* Join Employee */
            {
                $lookup: {
                    from: "employees",
                    let: { empId: "$employeeId" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$empId"] } } },
                        {
                            $project: {
                                user_name: 1,
                                empCode: 1,
                                userId: 1
                            }
                        }
                    ],
                    as: "employee"
                }
            },
            { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } },

            /* Join User */
            {
                $lookup: {
                    from: "users",
                    let: { uid: "$employee.userId" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
                        {
                            $project: {
                                email: 1,
                                phone: 1,
                                name: 1
                            }
                        }
                    ],
                    as: "user"
                }
            },
            { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

            /* Flatten */
            {
                $addFields: {
                    employeeName: "$employee.user_name",
                    employeeCode: "$employee.empCode",
                    employeeEmail: "$user.email",
                    employeePhone: "$user.phone"
                }
            },

            {
                $project: {
                    employee: 0,
                    user: 0
                }
            }
        ], { allowDiskUse: true });

        if (!records.length) {
            return res.status(404).json({
                success: false,
                message: "No attendance data found"
            });
        }

        /* --------------------------------------------------
           Format CSV
        -------------------------------------------------- */

        const formattedData = records.map(row => {

            const totalBreakMinutes = row.breaks?.reduce((acc, b) => {
                if (b.start && b.end) {
                    const start = moment(b.start).tz("Asia/Kolkata");
                    const end = moment(b.end).tz("Asia/Kolkata");
                    return acc + end.diff(start, "minutes");
                }
                return acc;
            }, 0) || 0;

            return {
                EmployeeCode: row.employeeCode || "N/A",

                EmployeeName: row.employeeName || "N/A",
                EmployeeEmail: row.employeeEmail || "N/A",
                EmployeePhone: row.employeePhone || "N/A",


                Date: moment(row.date).tz("Asia/Kolkata").format("DD-MMM-YYYY"),
                Day: moment(row.date).tz("Asia/Kolkata").format("dddd"),
                Month: moment(row.date).tz("Asia/Kolkata").format("MMMM"),
                Year: moment(row.date).tz("Asia/Kolkata").format("YYYY"),

                ShiftName: row.shift?.name || "General",
                ShiftStart: row.shift?.startTime || "",
                ShiftEnd: row.shift?.endTime || "",

                PunchIn: row.punchIn ? moment(row.punchIn).tz("Asia/Kolkata").format("hh:mm A") : "",
                PunchOut: row.punchOut ? moment(row.punchOut).tz("Asia/Kolkata").format("hh:mm A") : "",

                TotalWorkMinutes: row.workSummary?.totalMinutes || 0,
                OvertimeMinutes: row.workSummary?.overtimeMinutes || 0,
                LateMinutes: row.workSummary?.lateMinutes || 0,
                EarlyLeaveMinutes: row.workSummary?.earlyLeaveMinutes || 0,

                BreakMinutes: totalBreakMinutes,

                Status: row.status,
                LocationVerified: row.geoLocation?.verified ? "Yes" : "No",

                Remarks: row.remarks || "",
                AutoMarked: row.isAutoMarked ? "Yes" : "No",
                Suspicious: row.isSuspicious ? "Yes" : "No"
            };
        });

        /* --------------------------------------------------
           Convert to CSV
        -------------------------------------------------- */

        const parser = new Parser();
        const csv = parser.parse(formattedData);

        const fileName =
            `attendance_${fromDateIST.format("YYYYMMDD")}_${toDateIST.format("YYYYMMDD")}.csv`;

        res.header("Content-Type", "text/csv");
        res.header("Content-Disposition", `attachment; filename=${fileName}`);

        return res.status(200).send(csv);

    } catch (error) {
        console.error("CSV Export Error:", error);
        return res.status(500).json({
            success: false,
            message: "CSV Export Failed",
            error: error.message
        });
    }
};




export const exportCompanyAttendanceToExcel = async (req, res) => {
    try {

        /* ===============================
           1. AUTH & VALIDATION
        =============================== */

        const companyId = req.user._id; // From JWT Middleware

        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Company ID"
            });
        }


        /* ===============================
           2. FILTER (Optional Date Range)
        =============================== */

        const { startDate, endDate } = req.query;

        let matchQuery = {
            companyId: new mongoose.Types.ObjectId(companyId)
        };

        if (startDate && endDate) {
            matchQuery.date = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }


        /* ===============================
           3. FETCH DATA (Optimized)
        =============================== */

        const records = await Attendance.aggregate([

            { $match: matchQuery },

            /* Join Employee */
            {
                $lookup: {
                    from: "employees",
                    localField: "employeeId",
                    foreignField: "_id",
                    as: "employee"
                }
            },

            { $unwind: "$employee" },

            /* Projection (Report Fields) */
            {
                $project: {

                    _id: 0,

                    employeeId: "$employee._id",
                    employeeName: "$employee.name",
                    employeeEmail: "$employee.email",

                    date: 1,

                    punchIn: 1,
                    punchOut: 1,

                    totalMinutes: "$workSummary.totalMinutes",
                    payableMinutes: "$workSummary.payableMinutes",
                    overtimeMinutes: "$workSummary.overtimeMinutes",

                    status: 1,
                    approvalStatus: 1,

                    deviceId: "$deviceInfo.deviceId",

                    createdAt: 1
                }
            },

            { $sort: { date: -1 } }

        ]);


        if (!records || records.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No attendance records found"
            });
        }


        /* ===============================
           4. FORMAT DATA
        =============================== */

        const formattedData = records.map((item) => {

            return {

                Employee_ID: item.employeeId,
                Employee_Name: item.employeeName || "-",
                Employee_Email: item.employeeEmail || "-",

                Date: formatDate(item.date),

                Punch_In: formatTime(item.punchIn),
                Punch_Out: formatTime(item.punchOut),

                Total_Minutes: item.totalMinutes || 0,
                Payable_Minutes: item.payableMinutes || 0,
                Overtime_Minutes: item.overtimeMinutes || 0,

                Status: item.status,
                Approval_Status: item.approvalStatus,

                Device_ID: item.deviceId || "-",

                Created_At: formatDateTime(item.createdAt)
            };
        });


        /* ===============================
           5. JSON → CSV
        =============================== */

        const fields = Object.keys(formattedData[0]);

        const json2csvParser = new Parser({ fields });

        const csv = json2csvParser.parse(formattedData);


        /* ===============================
           6. DOWNLOAD RESPONSE
        =============================== */

        const fileName = `attendance_report_${Date.now()}.csv`;

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        );

        return res.status(200).send(csv);

    }
    catch (error) {

        console.error("Attendance Export Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to export attendance",
            error: error.message
        });
    }
};



/* =====================================================
   HELPERS
===================================================== */

const formatDate = (date) => {
    if (!date) return "-";

    return new Date(date).toLocaleDateString("en-IN");
};




const formatDateTime = (date) => {
    if (!date) return "-";

    return new Date(date).toLocaleString("en-IN");
};






















// import Employee from "../../models/Attandance/Employee.js";
// // import Employee from "../../models/Attandance/Employee.js";
// import Attendance from "../../models/Attandance/Attendance.js";
// import Holiday from "../../models/Attandance/Holiday.js";
// import Payroll from "../../models/Attandance/Payroll.js";
// import mongoose from "mongoose";
// import { normalizeToUTCDate, buildDateRange } from "./utils/date.utils.js";
// import { Parser } from "json2csv";
// import XLSX from "xlsx";
// // import moment from "moment";
// import moment from "moment-timezone";
// import jwt from "jsonwebtoken";
// import User from "../../models/userModel.js";
// import { resolveDateRange } from "../../utils/dateRangeResolver.js";
// import Shift from "../../models/Attandance/Shift.js";
// import { getActiveSubscription } from "../../services/subscription.service.js";
// import { Subscription } from "../../models/Attandance/subscration/Subscription.js";
// // utils/dateRange.js

// export const buildMonthRange = (year, month) => {
//     const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
//     const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
//     return { start, end };
// };


// export const getAttendanceSummary = async (req, res) => {
//     try {
//         const { companyId } = req.params;
//         const { date, month, year } = req.query;

//         // Validate companyId
//         if (!mongoose.Types.ObjectId.isValid(companyId)) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Invalid company ID"
//             });
//         }

//         let startDate, endDate;

//         // If specific date is provided (YYYY-MM-DD)
//         if (date) {
//             startDate = new Date(date);
//             startDate.setHours(0, 0, 0, 0);

//             endDate = new Date(date);
//             endDate.setHours(23, 59, 59, 999);
//         }
//         // If month and year are provided
//         else if (month && year) {
//             startDate = new Date(year, month - 1, 1); // month is 0-indexed in JS
//             startDate.setHours(0, 0, 0, 0);

//             endDate = new Date(year, month, 0); // Last day of the month
//             endDate.setHours(23, 59, 59, 999);
//         }
//         // Default to today
//         else {
//             startDate = new Date();
//             startDate.setHours(0, 0, 0, 0);

//             endDate = new Date();
//             endDate.setHours(23, 59, 59, 999);
//         }

//         // Get total active employees count for the company
//         const totalEmployees = await Employee.countDocuments({
//             companyId: companyId,
//             isActive: true // Assuming you have an isActive field
//         });

//         // Get attendance summary using aggregation
//         const attendanceSummary = await Attendance.aggregate([
//             {
//                 $match: {
//                     companyId: new mongoose.Types.ObjectId(companyId),
//                     date: {
//                         $gte: startDate,
//                         $lte: endDate
//                     }
//                 }
//             },
//             {
//                 $group: {
//                     _id: "$status",
//                     count: { $sum: 1 },
//                     employees: { $addToSet: "$employeeId" } // Get unique employees
//                 }
//             }
//         ]);

//         // Format the results
//         const summary = {
//             present: 0,
//             absent: 0,
//             leave: 0,
//             holiday: 0,
//             half_day: 0,
//             week_off: 0,
//             pending_approval: 0,
//             rejected: 0,
//             totalEmployees,
//             uniqueEmployees: 0
//         };

//         let uniqueEmployeeIds = new Set();

//         attendanceSummary.forEach(item => {
//             if (summary.hasOwnProperty(item._id)) {
//                 summary[item._id] = item.count;
//             }

//             // Add employee IDs to the set
//             item.employees.forEach(empId => uniqueEmployeeIds.add(empId.toString()));
//         });

//         summary.uniqueEmployees = uniqueEmployeeIds.size;

//         // Calculate absent employees
//         // Absent = total active employees - employees who have any attendance record
//         const presentEmployees = uniqueEmployeeIds.size;
//         summary.absent = Math.max(0, totalEmployees - presentEmployees);

//         // Add date range info
//         summary.dateRange = {
//             from: startDate,
//             to: endDate,
//             type: date ? "daily" : (month && year ? "monthly" : "today")
//         };

//         res.status(200).json({
//             success: true,
//             data: summary
//         });

//     } catch (error) {
//         console.error("Error in getAttendanceSummary:", error);
//         res.status(500).json({
//             success: false,
//             message: "Error fetching attendance summary",
//             error: error.message
//         });
//     }
// };


// export const getUTCDayRange = (inputDate = new Date()) => {
//     const start = new Date(Date.UTC(
//         inputDate.getUTCFullYear(),
//         inputDate.getUTCMonth(),
//         inputDate.getUTCDate(),
//         0, 0, 0, 0
//     ));

//     const end = new Date(start);
//     end.setUTCDate(end.getUTCDate() + 1);

//     return { start, end };
// };




// export const getTodayPunchStatus = async (req, res) => {
//     try {
//         const userId = req.user._id;

//         /* ==============================
//            STEP 1: Resolve Employee
//         ============================== */

//         const employee = await Employee.findOne({
//             userId,
//             employmentStatus: "active"
//         })
//             .select("_id companyId")
//             .lean();

//         if (!employee) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Employee profile not found"
//             });
//         }

//         const { _id: employeeId, companyId } = employee;

//         /* ==============================
//            STEP 2: Get Today Range
//         ============================== */

//         const { start, end } = getUTCDayRange();

//         /* ==============================
//            STEP 3: Query Attendance
//         ============================== */

//         const attendance = await Attendance.findOne({
//             companyId,
//             employeeId,
//             date: { $gte: start, $lt: end }
//         })
//             .select("punchIn punchOut")
//             .lean();

//         return res.status(200).json({
//             success: true,
//             isPunchedIn: Boolean(attendance?.punchIn),
//             isPunchedOut: Boolean(attendance?.punchOut)
//         });

//     } catch (error) {
//         console.error("Punch Status Error:", error);

//         return res.status(500).json({
//             success: false,
//             message: "Internal server error"
//         });
//     }
// };

// /* =====================================================
//    Utility Functions
// ===================================================== */

// // Distance in meters (Haversine)
// function getDistance(lat1, lon1, lat2, lon2) {
//     const R = 6371000; // meters
//     const toRad = (x) => (x * Math.PI) / 180;

//     const dLat = toRad(lat2 - lat1);
//     const dLon = toRad(lon2 - lon1);

//     const a =
//         Math.sin(dLat / 2) ** 2 +
//         Math.cos(toRad(lat1)) *
//         Math.cos(toRad(lat2)) *
//         Math.sin(dLon / 2) ** 2;

//     return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
// }

// // Minutes between two dates
// function diffMinutes(start, end) {
//     return Math.max(0, Math.floor((end - start) / 60000));
// }

// // Normalize date (00:00:00)
// function normalizeDate(d) {
//     const date = new Date(d);
//     date.setHours(0, 0, 0, 0);
//     return date;
// }



// export const exportCompanyAttendanceSummary = async ({
//     companyId,
//     fromDate,
//     toDate
// }) => {

//     /* =====================================
//        Resolve Date Range (Auto or Manual)
//     ====================================== */
//     const { start, end } = resolveDateRange(fromDate, toDate);

//     const pipeline = [

//         {
//             $match: {
//                 companyId: new mongoose.Types.ObjectId(companyId),
//                 date: { $gte: start, $lte: end }
//             }
//         },

//         /* =====================================
//            JOIN EMPLOYEE MASTER
//         ====================================== */
//         {
//             $lookup: {
//                 from: "employees",
//                 localField: "employeeId",
//                 foreignField: "_id",
//                 as: "employee"
//             }
//         },
//         { $unwind: "$employee" },

//         /* =====================================
//            BREAK CALCULATION
//         ====================================== */
//         {
//             $addFields: {
//                 breakMinutes: {
//                     $sum: {
//                         $map: {
//                             input: "$breaks",
//                             as: "b",
//                             in: {
//                                 $cond: [
//                                     { $and: ["$$b.start", "$$b.end"] },
//                                     {
//                                         $divide: [
//                                             { $subtract: ["$$b.end", "$$b.start"] },
//                                             1000 * 60
//                                         ]
//                                     },
//                                     0
//                                 ]
//                             }
//                         }
//                     }
//                 }
//             }
//         },

//         {
//             $addFields: {
//                 netWorkMinutes: {
//                     $max: [
//                         { $subtract: ["$workSummary.totalMinutes", "$breakMinutes"] },
//                         0
//                     ]
//                 }
//             }
//         },

//         /* =====================================
//            GROUP PER EMPLOYEE
//         ====================================== */
//         {
//             $group: {
//                 _id: "$employeeId",

//                 employeeName: { $first: "$employee.user_name" },
//                 empCode: { $first: "$employee.empCode" },
//                 department: { $first: "$employee.jobInfo.department" },
//                 designation: { $first: "$employee.jobInfo.designation" },

//                 totalDays: { $sum: 1 },

//                 absentDays: {
//                     $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] }
//                 },

//                 validWorkingDays: {
//                     $sum: {
//                         $cond: [
//                             {
//                                 $and: [
//                                     { $ne: ["$status", "absent"] },
//                                     { $eq: ["$isAutoMarked", false] },
//                                     { $eq: ["$approvalStatus", "approved"] }
//                                 ]
//                             },
//                             1,
//                             0
//                         ]
//                     }
//                 },

//                 totalWorkedMinutes: {
//                     $sum: {
//                         $cond: [
//                             {
//                                 $and: [
//                                     { $ne: ["$status", "absent"] },
//                                     { $eq: ["$isAutoMarked", false] },
//                                     { $eq: ["$approvalStatus", "approved"] }
//                                 ]
//                             },
//                             "$netWorkMinutes",
//                             0
//                         ]
//                     }
//                 }
//             }
//         },

//         /* =====================================
//            FINAL EXPORT STRUCTURE
//         ====================================== */
//         {
//             $project: {
//                 _id: 0,
//                 empCode: 1,
//                 employeeName: 1,
//                 department: 1,
//                 designation: 1,

//                 totalDays: 1,
//                 absentDays: 1,
//                 presentDays: "$validWorkingDays",

//                 totalWorkedHours: {
//                     $round: [{ $divide: ["$totalWorkedMinutes", 60] }, 2]
//                 },

//                 averageWorkingHours: {
//                     $cond: [
//                         { $eq: ["$validWorkingDays", 0] },
//                         0,
//                         {
//                             $round: [
//                                 {
//                                     $divide: [
//                                         { $divide: ["$totalWorkedMinutes", 60] },
//                                         "$validWorkingDays"
//                                     ]
//                                 },
//                                 2
//                             ]
//                         }
//                     ]
//                 }
//             }
//         },

//         { $sort: { empCode: 1 } }
//     ];

//     return await Attendance.aggregate(pipeline, { allowDiskUse: true });
// };
// export const AttendanceSummaryFields = [
//     "empCode",
//     "employeeName",
//     "department",
//     "designation",
//     "totalDays",
//     "presentDays",
//     "absentDays",
//     "totalWorkedHours",
//     "averageWorkingHours"
// ];

// export const mapAttendanceSummary = (record) => ({
//     empCode: record.empCode ?? "",
//     employeeName: record.employeeName ?? "",
//     department: record.department ?? "",
//     designation: record.designation ?? "",
//     totalDays: record.totalDays ?? 0,
//     presentDays: record.presentDays ?? 0,
//     absentDays: record.absentDays ?? 0,
//     totalWorkedHours: record.totalWorkedHours ?? 0,
//     averageWorkingHours: record.averageWorkingHours ?? 0
// });
// // Export as CSV
// export const exportAttendanceAsCSV = async (req, res) => {
//     try {
//         const raw = await exportCompanyAttendanceSummary({
//             companyId: req.user._id,
//             fromDate: req.query.fromDate,
//             toDate: req.query.toDate
//         });

//         if (!raw.length) {
//             return res.status(404).json({ success: false, message: "No data found" });
//         }

//         const data = raw.map(mapAttendanceSummary);

//         const fields = [
//             "empCode",
//             "employeeName",
//             "department",
//             "designation",
//             "totalDays",
//             "presentDays",
//             "absentDays",
//             "totalWorkedHours",
//             "averageWorkingHours"
//         ];

//         const parser = new Parser({ fields });
//         const csv = parser.parse(data);

//         res.setHeader("Content-Type", "text/csv");
//         res.setHeader(
//             "Content-Disposition",
//             `attachment; filename=attendance_summary.csv`
//         );

//         res.status(200).send(csv);
//     } catch (err) {
//         res.status(500).json({ success: false, message: err.message });
//     }
// };
// // Export as Excel
// export const exportAttendanceAsExcel = async (req, res) => {
//     try {
//         const raw = await exportCompanyAttendanceSummary({
//             companyId: req.user._id,
//             fromDate: req.query.fromDate,
//             toDate: req.query.toDate
//         });

//         if (!raw.length) {
//             return res.status(404).json({ success: false, message: "No data found" });
//         }

//         const data = raw.map(mapAttendanceSummary);

//         const wb = XLSX.utils.book_new();

//         const worksheetData = data.map(r => ({
//             "Employee Code": r.empCode,
//             "Employee Name": r.employeeName,
//             "Department": r.department,
//             "Designation": r.designation,
//             "Total Days": r.totalDays,
//             "Present Days": r.presentDays,
//             "Absent Days": r.absentDays,
//             "Total Worked (Hours)": r.totalWorkedHours,
//             "Average Working (Hours)": r.averageWorkingHours
//         }));

//         const ws = XLSX.utils.json_to_sheet(worksheetData);

//         ws["!cols"] = [
//             { wch: 15 },
//             { wch: 25 },
//             { wch: 20 },
//             { wch: 20 },
//             { wch: 10 },
//             { wch: 12 },
//             { wch: 12 },
//             { wch: 18 },
//             { wch: 20 }
//         ];

//         XLSX.utils.book_append_sheet(wb, ws, "Attendance Summary");

//         const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

//         res.setHeader(
//             "Content-Type",
//             "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
//         );
//         res.setHeader(
//             "Content-Disposition",
//             `attachment; filename=attendance_summary.xlsx`
//         );

//         res.send(buffer);
//     } catch (err) {
//         res.status(500).json({ success: false, message: err.message });
//     }
// };

// // Unified export endpoint
// export const getAttendanceExport = async (req, res) => {
//     try {
//         const { format = 'json' } = req.query;

//         if (format === 'csv') {
//             return await exportAttendanceAsCSV(req, res);
//         } else if (format === 'excel') {
//             return await exportAttendanceAsExcel(req, res);
//         } else {
//             // Return JSON as before
//             const data = await exportCompanyAttendanceSummary({
//                 companyId: req.user._id,
//                 fromDate: req.query.fromDate,
//                 toDate: req.query.toDate
//             });

//             res.json({
//                 success: true,
//                 data,
//                 meta: {
//                     totalRecords: data.length,
//                     dateRange: {
//                         fromDate: req.query.fromDate || 'Last 31 days',
//                         toDate: req.query.toDate || 'Today'
//                     }
//                 }
//             });
//         }

//     } catch (err) {
//         res.status(400).json({
//             success: false,
//             message: err.message
//         });
//     }
// };


// /* ======================================================
//    MARK ATTENDANCE (Punch In + Multi Punch Out)
// ====================================================== */

// export const markAttendance = async (req, res) => {

//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {

//         /* --------------------------------
//            1. Auth + Body
//         -------------------------------- */

//         const u_id = req.user._id;

//         const {
//             date,
//             punchIn,
//             punchOut,
//             breaks,
//             geoLocation,
//             deviceInfo,
//             shift,
//             remarks,
//             token
//         } = req.body;


//         if (!token) {
//             return res.status(401).json({
//                 message: "Attendance token required"
//             });
//         }

//         if (!date || !geoLocation?.coordinates) {
//             return res.status(400).json({
//                 message: "date and geoLocation required"
//             });
//         }


//         /* --------------------------------
//            2. Verify JWT
//         -------------------------------- */

//         let decoded;

//         try {
//             decoded = jwt.verify(token, process.env.JWT_SECRET);
//         } catch (err) {
//             return res.status(401).json({
//                 message: "Invalid or expired token"
//             });
//         }

//         if (!decoded?.userId) {
//             return res.status(401).json({
//                 message: "Invalid token payload"
//             });
//         }


//         const user = await User
//             .findById(decoded.userId)
//             .select("-password -otp -__v");

//         if (!user) {
//             return res.status(401).json({
//                 message: "User not found"
//             });
//         }


//         const companyId = user._id;


//         /* --------------------------------
//            3. Employee Validation
//         -------------------------------- */

//         const employee = await Employee.findOne({
//             userId: u_id,
//             employmentStatus: "active"
//         }).session(session);

//         if (!employee) {
//             return res.status(404).json({
//                 message: "Active employee not found"
//             });
//         }

//         if (employee.companyId.toString() !== companyId.toString()) {
//             return res.status(403).json({
//                 message: "Unauthorized company"
//             });
//         }


//         const attendanceDate = normalizeDate(date);


//         /* --------------------------------
//            4. Check Holiday
//         -------------------------------- */

//         const holiday = await Holiday.findOne({
//             companyId,
//             date: attendanceDate
//         }).session(session);

//         let status = holiday ? "holiday" : "present";


//         /* --------------------------------
//            5. Geo Fence Validation
//         -------------------------------- */

//         let geoVerified = false;
//         let suspicious = false;

//         if (employee.officeLocation?.coordinates?.length === 2) {

//             const [officeLng, officeLat] =
//                 employee.officeLocation.coordinates;

//             const [userLng, userLat] =
//                 geoLocation.coordinates;

//             const distance = getDistance(
//                 officeLat,
//                 officeLng,
//                 userLat,
//                 userLng
//             );


//             // Outside allowed radius
//             if (distance > employee.officeLocation.radius) {

//                 return res.status(403).json({
//                     success: false,
//                     errorCode: "OUTSIDE_OFFICE_RADIUS",
//                     message: "You are not within the allowed office location range.",
//                     data: {
//                         allowedRadius: employee.officeLocation.radius,
//                         currentDistance: Math.round(distance),
//                         unit: "meters"
//                     }
//                 });

//             } else {
//                 geoVerified = true;
//             }
//         }


//         /* --------------------------------
//            6. Find Existing Attendance
//         -------------------------------- */

//         let attendance = await Attendance.findOne({
//             companyId,
//             employeeId: employee._id,
//             date: attendanceDate
//         }).session(session);


//         /* --------------------------------
//            7. FIRST TIME → PUNCH IN
//         -------------------------------- */

//         if (!attendance) {

//             if (!punchIn) {
//                 return res.status(400).json({
//                     message: "Punch In required"
//                 });
//             }

//             const inTime = new Date(punchIn);
//             const outTime = punchOut ? new Date(punchOut) : null;


//             let totalMinutes = 0;

//             if (outTime) {
//                 totalMinutes = diffMinutes(inTime, outTime);
//             }


//             /* Break Deduction */

//             if (breaks?.length) {
//                 for (const b of breaks) {
//                     if (b.start && b.end) {
//                         totalMinutes -= diffMinutes(
//                             new Date(b.start),
//                             new Date(b.end)
//                         );
//                     }
//                 }
//             }


//             let overtimeMinutes = 0;
//             let lateMinutes = 0;
//             let earlyLeaveMinutes = 0;


//             /* Shift Calculation */

//             if (shift?.startTime && shift?.endTime) {

//                 const shiftStart = new Date(
//                     `${attendanceDate
//                         .toISOString()
//                         .split("T")[0]}T${shift.startTime}:00`
//                 );

//                 const shiftEnd = new Date(
//                     `${attendanceDate
//                         .toISOString()
//                         .split("T")[0]}T${shift.endTime}:00`
//                 );

//                 if (inTime > shiftStart) {
//                     lateMinutes = diffMinutes(shiftStart, inTime);
//                 }

//                 if (outTime && outTime < shiftEnd) {
//                     earlyLeaveMinutes = diffMinutes(outTime, shiftEnd);
//                 }

//                 if (outTime && outTime > shiftEnd) {
//                     overtimeMinutes = diffMinutes(shiftEnd, outTime);
//                 }
//             }


//             if (totalMinutes < 240 && status === "present") {
//                 status = "half_day";
//             }

//             if (!outTime) {
//                 suspicious = true;
//             }


//             /* Create Attendance */

//             attendance = new Attendance({

//                 companyId,
//                 employeeId: employee._id,

//                 date: attendanceDate,

//                 punchIn: inTime,
//                 punchOut: outTime,

//                 breaks,
//                 shift,

//                 status,

//                 geoLocation: {
//                     ...geoLocation,
//                     verified: geoVerified
//                 },

//                 deviceInfo,

//                 workSummary: {
//                     totalMinutes,
//                     overtimeMinutes,
//                     lateMinutes,
//                     earlyLeaveMinutes
//                 },

//                 remarks,

//                 isSuspicious: suspicious,

//                 punchHistory: outTime ? [{
//                     punchOut: outTime,
//                     deviceInfo,
//                     geoLocation
//                 }] : []
//             });

//         }


//         /* --------------------------------
//            8. ALREADY EXISTS → PUNCH OUT
//         -------------------------------- */

//         else {

//             if (!punchOut) {
//                 return res.status(400).json({
//                     message: "Punch Out required"
//                 });
//             }

//             const outTime = new Date(punchOut);


//             /* Anti-Spam */

//             const last = attendance.punchHistory?.at(-1);

//             if (last) {

//                 const gap = diffMinutes(
//                     new Date(last.punchOut),
//                     outTime
//                 );

//                 if (gap < 3) {
//                     return res.status(429).json({
//                         message: "Too frequent punch"
//                     });
//                 }
//             }


//             /* Save History */

//             attendance.punchHistory.push({
//                 punchOut: outTime,
//                 deviceInfo,
//                 geoLocation
//             });


//             /* Update Latest */

//             attendance.punchOut = outTime;


//             /* Recalculate */

//             const inTime = new Date(attendance.punchIn);

//             let totalMinutes =
//                 diffMinutes(inTime, outTime);


//             if (attendance.breaks?.length) {
//                 for (const b of attendance.breaks) {
//                     if (b.start && b.end) {
//                         totalMinutes -= diffMinutes(
//                             new Date(b.start),
//                             new Date(b.end)
//                         );
//                     }
//                 }
//             }


//             let overtimeMinutes = 0;
//             let lateMinutes = 0;
//             let earlyLeaveMinutes = 0;


//             if (
//                 attendance.shift?.startTime &&
//                 attendance.shift?.endTime
//             ) {

//                 const shiftStart = new Date(
//                     `${attendanceDate
//                         .toISOString()
//                         .split("T")[0]}T${attendance.shift.startTime}:00`
//                 );

//                 const shiftEnd = new Date(
//                     `${attendanceDate
//                         .toISOString()
//                         .split("T")[0]}T${attendance.shift.endTime}:00`
//                 );

//                 if (inTime > shiftStart) {
//                     lateMinutes =
//                         diffMinutes(shiftStart, inTime);
//                 }

//                 if (outTime < shiftEnd) {
//                     earlyLeaveMinutes =
//                         diffMinutes(outTime, shiftEnd);
//                 }

//                 if (outTime > shiftEnd) {
//                     overtimeMinutes =
//                         diffMinutes(shiftEnd, outTime);
//                 }
//             }


//             attendance.workSummary = {
//                 totalMinutes,
//                 overtimeMinutes,
//                 lateMinutes,
//                 earlyLeaveMinutes
//             };


//             attendance.status =
//                 totalMinutes < 240
//                     ? "half_day"
//                     : "present";


//             /* Device Fraud */

//             if (
//                 attendance.deviceInfo?.deviceId &&
//                 attendance.deviceInfo.deviceId !==
//                 deviceInfo?.deviceId
//             ) {
//                 attendance.isSuspicious = true;
//             }

//         }


//         /* --------------------------------
//            9. Save + Commit
//         -------------------------------- */

//         await attendance.save({ session });

//         await session.commitTransaction();
//         session.endSession();


//         return res.status(201).json({
//             message: "Attendance processed successfully",
//             attendance
//         });


//     } catch (error) {

//         await session.abortTransaction();
//         session.endSession();

//         console.error("Attendance Error:", error);

//         return res.status(500).json({
//             message: "Attendance failed",
//             error: error.message
//         });
//     }
// };





// // utils/date.util.js

// export const getISTDayRange = () => {

//     const now = new Date();

//     // Convert to IST first
//     const istNow = new Date(
//         now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
//     );

//     const start = new Date(istNow);
//     start.setHours(0, 0, 0, 0);

//     const end = new Date(istNow);
//     end.setHours(23, 59, 59, 999);

//     return { start, end };
// };
// export const toIST = (date) => {
//     if (!date) return null;

//     const d = new Date(date);

//     if (isNaN(d.getTime())) return null;

//     return d.toLocaleString("en-IN", {
//         timeZone: "Asia/Kolkata",
//         hour12: false
//     });
// };

// // utils/date.util.js
// export const convertUTCtoIST = (date) => {
//     if (!date) return null;
//     return new Date(new Date(date).getTime() + (5.5 * 60 * 60 * 1000));
// };


// export const getCompanyTodayAttendance = async (req, res) => {

//     try {

//         /* ===========================
//            Auth Context
//         ============================ */

//         const companyId = req.user._id;

//         const page = Number(req.query.page) || 1;
//         const limit = Number(req.query.limit) || 50;
//         const skip = (page - 1) * limit;

//         /* ===========================
//            Date
//         ============================ */

//         const today = normalizeToUTCDate();

//         /* ===========================
//            Active Employees
//         ============================ */

//         const employees = await Employee.find({
//             companyId,
//             employmentStatus: "active"
//         })
//             .select("_id empCode user_name ")
//             .lean();

//         if (!employees.length) {
//             return res.status(404).json({
//                 success: false,
//                 message: "No active employees found"
//             });
//         }

//         const employeeIds = employees.map(e => e._id);

//         /* ===========================
//            Attendance Records
//         ============================ */

//         const { start, end } = getISTDayRange();

//         const attendanceList = await Attendance.find({
//             companyId,
//             employeeId: { $in: employeeIds },
//             date: { $gte: start, $lte: end }
//         })
//             .select(`
//                 employeeId
//                 status
//                 punchIn
//                 punchOut
//                 workSummary
//                 isSuspicious
//                 geoLocation.verified
//             `)
//             .lean();

//         /* ===========================
//            Map Attendance
//         ============================ */

//         const attendanceMap = new Map();

//         attendanceList.forEach(record => {
//             attendanceMap.set(
//                 record.employeeId.toString(),
//                 record
//             );
//         });

//         /* ===========================
//            Merge (Employee + Attendance)
//         ============================ */

//         const result = employees
//             .slice(skip, skip + limit)
//             .map(emp => {

//                 const record =
//                     attendanceMap.get(emp._id.toString());

//                 return {

//                     employeeId: emp._id,
//                     empCode: emp.empCode,
//                     name: emp.user_name,
//                     phone: emp.phone,
//                     email: emp.email,

//                     date: today,

//                     status: record?.status || "absent",

//                     punchIn: convertUTCtoIST(record?.punchIn),
//                     punchOut: convertUTCtoIST(record?.punchOut),
//                     flags: {

//                         isLate:
//                             (record?.workSummary?.lateMinutes || 0) > 0,

//                         isEarlyLeave:
//                             (record?.workSummary?.earlyLeaveMinutes || 0) > 0,

//                         isOvertime:
//                             (record?.workSummary?.overtimeMinutes || 0) > 0,

//                         isSuspicious:
//                             record?.isSuspicious || false,

//                         geoVerified:
//                             record?.geoLocation?.verified || false
//                     },

//                     workSummary: record?.workSummary || {
//                         totalMinutes: 0,
//                         payableMinutes: 0,
//                         overtimeMinutes: 0,
//                         lateMinutes: 0,
//                         earlyLeaveMinutes: 0
//                     }
//                 };
//             });

//         /* ===========================
//            Response
//         ============================ */

//         return res.status(200).json({

//             success: true,

//             companyId,

//             date: today,

//             pagination: {
//                 page,
//                 limit,
//                 totalEmployees: employees.length,
//                 totalPages: Math.ceil(employees.length / limit)
//             },

//             data: result
//         });

//     } catch (error) {

//         console.error("Company Today Attendance Error:", error);

//         return res.status(500).json({
//             success: false,
//             message: "Failed to fetch company attendance"
//         });
//     }
// };





// /* ======================================================
//    GET: Monthly Employee Card Summary (IST Based)
// ====================================================== */



// export const getEmployeeSimpleMonthlySummary = async (req, res) => {
//     try {

//         /* =====================================
//            1. AUTH
//         ===================================== */

//         const companyId = req.user._id;

//         if (!mongoose.Types.ObjectId.isValid(companyId)) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Invalid company id"
//             });
//         }


//         /* =====================================
//            2. DATE RANGE
//         ===================================== */

//         const { startDate, endDate } = req.query;

//         const today = new Date();

//         const start = startDate
//             ? new Date(startDate)
//             : new Date(today.getFullYear(), today.getMonth(), 1);

//         const end = endDate
//             ? new Date(endDate)
//             : new Date();

//         end.setHours(23, 59, 59, 999);


//         /* =====================================
//            3. EMPLOYEE → ATTENDANCE AGGREGATION
//         ===================================== */

//         const report = await Employee.aggregate([


//             /* ---------- COMPANY EMPLOYEES ---------- */
//             {
//                 $match: {
//                     companyId: new mongoose.Types.ObjectId(companyId),
//                     employmentStatus: "active"
//                 }
//             },


//             /* ---------- USER JOIN ---------- */
//             {
//                 $lookup: {
//                     from: "users",
//                     localField: "userId",
//                     foreignField: "_id",
//                     as: "user"
//                 }
//             },
//             {
//                 $unwind: {
//                     path: "$user",
//                     preserveNullAndEmptyArrays: true
//                 }
//             },


//             /* ---------- ATTENDANCE JOIN ---------- */
//             {
//                 $lookup: {
//                     from: "attendances",
//                     let: { empId: "$_id" },
//                     pipeline: [
//                         {
//                             $match: {
//                                 $expr: {
//                                     $and: [
//                                         { $eq: ["$employeeId", "$$empId"] },
//                                         { $gte: ["$date", start] },
//                                         { $lte: ["$date", end] }
//                                     ]
//                                 }
//                             }
//                         }
//                     ],
//                     as: "attendance"
//                 }
//             },


//             /* ---------- COUNTS ---------- */
//             {
//                 $addFields: {
//                     presentDays: {
//                         $size: {
//                             $filter: {
//                                 input: "$attendance",
//                                 as: "a",
//                                 cond: {
//                                     $and: [
//                                         { $eq: ["$$a.status", "present"] },
//                                         { $eq: ["$$a.approvalStatus", "approved"] }
//                                     ]
//                                 }
//                             }
//                         }
//                     },

//                     halfDays: {
//                         $size: {
//                             $filter: {
//                                 input: "$attendance",
//                                 as: "a",
//                                 cond: { $eq: ["$$a.status", "half_day"] }
//                             }
//                         }
//                     },

//                     leaveDays: {
//                         $size: {
//                             $filter: {
//                                 input: "$attendance",
//                                 as: "a",
//                                 cond: { $eq: ["$$a.status", "leave"] }
//                             }
//                         }
//                     },

//                     totalMinutes: {
//                         $sum: "$attendance.workSummary.totalMinutes"
//                     },

//                     overtimeMinutes: {
//                         $sum: "$attendance.workSummary.overtimeMinutes"
//                     }
//                 }
//             },


//             /* ---------- DERIVED ---------- */
//             {
//                 $addFields: {
//                     workingDays: {
//                         $add: ["$presentDays", "$halfDays"]
//                     },

//                     totalHours: {
//                         $round: [
//                             { $divide: ["$totalMinutes", 60] },
//                             2
//                         ]
//                     },

//                     overtimeHours: {
//                         $round: [
//                             { $divide: ["$overtimeMinutes", 60] },
//                             2
//                         ]
//                     }
//                 }
//             },


//             /* ---------- FINAL FORMAT ---------- */
//             {
//                 $project: {
//                     _id: 0,
//                     userId: "$user._id",

//                     /* FROM EMPLOYEE TABLE - CORRECTED FIELD REFERENCES */
//                     name: {
//                         $ifNull: ["$user_name", "$user.name", "Unknown"]
//                     }, // First try user_name from employee, then user.name, fallback

//                     empCode: 1,

//                     email: "$user.email",
//                     phone: "$user.phone",

//                     department: "$jobInfo.department",
//                     designation: "$jobInfo.designation",

//                     joiningDate: {
//                         $dateToString: {
//                             format: "%Y-%m-%d",
//                             date: "$jobInfo.joiningDate",
//                             onNull: null
//                         }
//                     },

//                     summary: {
//                         presentDays: "$presentDays",
//                         halfDays: "$halfDays",
//                         leaveDays: "$leaveDays",
//                         workingDays: "$workingDays",
//                         absentDays: 0 // temporary placeholder
//                     },

//                     timeSummary: {
//                         totalHours: "$totalHours",
//                         overtimeHours: "$overtimeHours"
//                     }
//                 }
//             },

//             { $sort: { name: 1 } }

//         ]);


//         /* =====================================
//            4. SIMPLE AUTO-ABSENT LOGIC
//         ===================================== */

//         const totalDays =
//             Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;


//         report.forEach(emp => {

//             const s = emp.summary;

//             const marked =
//                 (s.presentDays || 0) +
//                 (s.halfDays || 0) +
//                 (s.leaveDays || 0);

//             let absent = totalDays - marked;

//             if (absent < 0) absent = 0;

//             // override
//             s.absentDays = absent;

//         });


//         /* =====================================
//            5. COMPANY SUMMARY
//         ===================================== */

//         const companySummary = {
//             totalEmployees: report.length,
//             totalPresent: 0,
//             totalAbsent: 0,
//             totalLeave: 0,
//             totalWorkingDays: 0,
//             totalHours: 0,
//             totalOvertime: 0
//         };


//         report.forEach(emp => {
//             const s = emp.summary;
//             const t = emp.timeSummary;

//             companySummary.totalPresent += s.presentDays || 0;
//             companySummary.totalAbsent += s.absentDays || 0;
//             companySummary.totalLeave += s.leaveDays || 0;
//             companySummary.totalWorkingDays += s.workingDays || 0;
//             companySummary.totalHours += t.totalHours || 0;
//             companySummary.totalOvertime += t.overtimeHours || 0;
//         });


//         companySummary.totalHours =
//             Math.round(companySummary.totalHours * 100) / 100;

//         companySummary.totalOvertime =
//             Math.round(companySummary.totalOvertime * 100) / 100;


//         /* =====================================
//            6. RESPONSE
//         ===================================== */

//         return res.status(200).json({
//             success: true,
//             data: {
//                 period: {
//                     start: start.toISOString().split("T")[0],
//                     end: end.toISOString().split("T")[0]
//                 },
//                 summary: companySummary,
//                 report
//             }
//         });


//     } catch (error) {
//         console.error("Monthly Summary Error:", error);
//         return res.status(500).json({
//             success: false,
//             message: "Monthly report failed",
//             error: error.message
//         });
//     }
// };






// export const debugAttendanceData = async (req, res) => {
//     try {
//         const companyId = req.user._id;

//         // 1. Check raw attendance records
//         const attendanceRecords = await Attendance.find({
//             companyId: new mongoose.Types.ObjectId(companyId)
//         })
//             .limit(5)
//             .lean();

//         console.log('Sample Attendance Records:', JSON.stringify(attendanceRecords, null, 2));

//         // 2. Check employees
//         const employees = await Employee.find({
//             companyId: new mongoose.Types.ObjectId(companyId)
//         })
//             .limit(5)
//             .lean();

//         console.log('Sample Employees:', JSON.stringify(employees, null, 2));

//         // 3. Check users
//         const employeeIds = employees.map(e => e.userId);
//         const users = await User.find({
//             _id: { $in: employeeIds }
//         })
//             .limit(5)
//             .lean();

//         console.log('Sample Users:', JSON.stringify(users, null, 2));

//         // 4. Count documents
//         const counts = {
//             totalAttendance: await Attendance.countDocuments({ companyId }),
//             totalEmployees: await Employee.countDocuments({ companyId }),
//             attendanceWithEmployeeId: await Attendance.countDocuments({
//                 companyId,
//                 employeeId: { $exists: true, $ne: null }
//             })
//         };

//         console.log('Document Counts:', counts);

//         res.json({
//             success: true,
//             data: {
//                 counts,
//                 sampleAttendance: attendanceRecords,
//                 sampleEmployees: employees,
//                 sampleUsers: users
//             }
//         });

//     } catch (error) {
//         console.error('Debug Error:', error);
//         res.status(500).json({ success: false, error: error.message });
//     }
// };
// /**
//  * @desc   Get Employee Monthly Attendance
//  * @route  GET /api/attendance/monthly
//  * @access Employee
//  */
// export const getAttendance = async (req, res) => {

//     try {

//         /* ============================
//            1. Auth Context
//         ============================ */

//         const companyId = req.user.companyId;
//         const userId = req.user._id;

//         if (!companyId || !userId) {
//             return res.status(401).json({
//                 success: false,
//                 message: "Unauthorized access"
//             });
//         }

//         /* ============================
//            2. Validate Params
//         ============================ */

//         const month = Number(req.query.month);
//         const year = Number(req.query.year);

//         if (
//             !month || !year ||
//             month < 1 || month > 12 ||
//             year < 2000
//         ) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Invalid month/year"
//             });
//         }

//         /* ============================
//            3. Employee Mapping
//         ============================ */

//         const employee = await Employee
//             .findOne({
//                 companyId,
//                 userId,
//                 employmentStatus: "active"
//             })
//             .select("_id empCode role")
//             .lean();

//         if (!employee) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Active employee not found"
//             });
//         }

//         /* ============================
//            4. Date Range
//         ============================ */

//         const { start, end } = buildMonthRange(year, month);

//         /* ============================
//            5. Fetch Attendance
//         ============================ */

//         const attendance = await Attendance
//             .find({
//                 companyId,
//                 employeeId: employee._id,
//                 date: { $gte: start, $lte: end }
//             })
//             .select(`
//                 date
//                 punchIn
//                 punchOut
//                 breaks
//                 status
//                 workSummary
//                 geoLocation.verified
//                 isSuspicious
//             `)
//             .sort({ date: 1 })
//             .lean();

//         /* ============================
//            6. Response
//         ============================ */

//         return res.status(200).json({
//             success: true,
//             meta: {
//                 employeeId: employee._id,
//                 empCode: employee.empCode,
//                 month,
//                 year,
//                 totalDays: attendance.length
//             },
//             data: attendance
//         });

//     } catch (error) {

//         console.error("Attendance Fetch Error:", error);

//         return res.status(500).json({
//             success: false,
//             message: "Unable to fetch attendance"
//         });
//     }
// };




// /* ================================
//    Helper: Format Time (IST)
// ================================ */
// const formatTime = (date) => {
//     if (!date) return "-";

//     try {
//         return new Date(date).toLocaleTimeString("en-IN", {
//             timeZone: "Asia/Kolkata",   // Force IST
//             hour: "2-digit",
//             minute: "2-digit",
//             hour12: true
//         });
//     } catch (err) {
//         console.error("formatTime error:", err);
//         return "-";
//     }
// };


// /* ================================
//    Helper: Minutes → Hr Min
// ================================ */
// const formatMinutes = (minutes) => {
//     if (!Number.isFinite(minutes) || minutes <= 0) return "-";

//     const h = Math.floor(minutes / 60);
//     const m = minutes % 60;

//     return `${h}h ${m}m`;
// };


// /* =================================================
//    GET: Employee Monthly Attendance (Dashboard)
// ================================================= */


// /* =================================================
//    GET: Employee Attendance Summary + CSV
// ================================================= */

// export const getEmployeeAttendanceSummary = async (req, res) => {

//     try {

//         /* ============================
//            1. Auth
//         ============================ */

//         const userId = req.query.userId;

//         if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
//             return res.status(401).json({
//                 success: false,
//                 message: "Unauthorized"
//             });
//         }


//         /* ============================
//            2. Params
//         ============================ */

//         const month = Number(req.query.month);
//         const year = Number(req.query.year);
//         const format = req.query.format; // csv | json

//         if (!month || !year || month < 1 || month > 12 || year < 2000) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Invalid month/year"
//             });
//         }


//         /* ============================
//            3. Block Future Months
//         ============================ */

//         const today = new Date();
//         today.setHours(0, 0, 0, 0);

//         if (
//             year > today.getFullYear() ||
//             (year === today.getFullYear() && month > today.getMonth() + 1)
//         ) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Future month not allowed"
//             });
//         }


//         /* ============================
//            4. Employee
//         ============================ */

//         const employee = await Employee.findOne({
//             userId,
//             employmentStatus: "active"
//         })
//             .select("_id empCode")
//             .lean();

//         if (!employee) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Employee not found"
//             });
//         }


//         /* ============================
//            5. Date Range
//         ============================ */

//         const { start, end } = buildMonthRange(year, month);


//         /* ============================
//            6. Attendance
//         ============================ */

//         const records = await Attendance.find({
//             employeeId: employee._id,
//             date: { $gte: start, $lte: end }
//         })
//             .sort({ date: -1 })
//             .lean();


//         /* ============================
//            7. Build Lookup Map
//         ============================ */

//         const map = new Map();

//         records.forEach(r => {
//             const key = r.date.toISOString().split("T")[0];
//             map.set(key, r);
//         });


//         /* ============================
//            8. Calculate Loop Range
//         ============================ */

//         const isCurrentMonth =
//             today.getFullYear() === year &&
//             today.getMonth() + 1 === month;

//         const lastDay = isCurrentMonth
//             ? today.getDate() // till today
//             : new Date(year, month, 0).getDate(); // full month


//         const todayKey = today.toISOString().split("T")[0];
//         const yesterdayKey = new Date(today.getTime() - 86400000)
//             .toISOString()
//             .split("T")[0];


//         /* ============================
//            9. Build Report
//         ============================ */

//         let presentDays = 0;
//         let absentDays = 0;
//         let totalMinutes = 0;

//         const report = [];


//         for (let i = lastDay; i >= 1; i--) {

//             const date = new Date(year, month - 1, i);
//             date.setHours(0, 0, 0, 0);

//             const key = date.toISOString().split("T")[0];

//             let label = date.toLocaleDateString("en-IN", {
//                 day: "2-digit",
//                 month: "short"
//             });

//             if (key === todayKey) label = "Today";
//             if (key === yesterdayKey) label = "Yesterday";

//             const rec = map.get(key);


//             /* ---------- No Record ---------- */
//             if (!rec) {

//                 // Today without punch → Pending
//                 if (key === todayKey) {

//                     report.push({
//                         Date: "Today",
//                         TimeIn: "Pending",
//                         TimeOut: "-",
//                         TotalHours: "-"
//                     });

//                     continue;
//                 }

//                 // Past day → Absent
//                 absentDays++;

//                 report.push({
//                     Date: label,
//                     TimeIn: "Absent",
//                     TimeOut: "-",
//                     TotalHours: "-"
//                 });

//                 continue;
//             }


//             /* ---------- Holiday / Week Off ---------- */

//             if (
//                 rec.status === "holiday" ||
//                 rec.status === "week_off"
//             ) {

//                 report.push({
//                     Date: label,
//                     TimeIn: rec.status === "holiday" ? "Holiday" : "Week Off",
//                     TimeOut: "-",
//                     TotalHours: "-"
//                 });

//                 continue;
//             }


//             /* ---------- Present ---------- */

//             if (rec.status === "present") presentDays++;

//             const minutes = rec.workSummary?.totalMinutes || 0;

//             totalMinutes += minutes;

//             report.push({
//                 Date: label,
//                 TimeIn: formatTime(rec.punchIn),
//                 TimeOut: rec.punchOut
//                     ? formatTime(rec.punchOut)
//                     : "-",
//                 TotalHours: formatMinutes(minutes)
//             });
//         }


//         /* ============================
//            10. CSV Export
//         ============================ */

//         if (format === "csv") {

//             const parser = new Parser({
//                 fields: ["Date", "TimeIn", "TimeOut", "TotalHours"]
//             });

//             const csv = parser.parse(report);

//             const fileName =
//                 `attendance_${employee.empCode}_${month}_${year}.csv`;


//             res.setHeader("Content-Type", "text/csv");
//             res.setHeader(
//                 "Content-Disposition",
//                 `attachment; filename="${fileName}"`
//             );

//             return res.status(200).send(csv);
//         }


//         /* ============================
//            11. Summary
//         ============================ */

//         const avgMinutes = presentDays
//             ? Math.round(totalMinutes / presentDays)
//             : 0;


//         /* ============================
//            12. JSON Response
//         ============================ */

//         return res.status(200).json({

//             success: true,

//             meta: {
//                 employeeId: employee._id,
//                 empCode: employee.empCode,
//                 month,
//                 year
//             },

//             summary: {
//                 avgPerDay: formatMinutes(avgMinutes),
//                 presentDays,
//                 absentDays,
//                 totalShownDays: lastDay
//             },

//             records: report
//         });

//     } catch (error) {

//         console.error("Attendance Summary Error:", error);

//         return res.status(500).json({
//             success: false,
//             message: "Internal server error"
//         });
//     }
// };


// /**
//  * @desc   Get Monthly Attendance Summary (Payroll)
//  * @route  GET /api/attendance/summary
//  * @access Employee
//  */
// export const getMonthlySummary = async (req, res) => {

//     try {

//         /* ============================
//            1. Auth Context
//         ============================ */

//         const companyId = req.user.companyId;
//         const userId = req.user._id;

//         /* ============================
//            2. Validate Params
//         ============================ */

//         const month = Number(req.query.month);
//         const year = Number(req.query.year);

//         if (
//             !month || !year ||
//             month < 1 || month > 12
//         ) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Invalid month/year"
//             });
//         }

//         /* ============================
//            3. Employee
//         ============================ */

//         const employee = await Employee
//             .findOne({
//                 companyId,
//                 userId,
//                 employmentStatus: "active"
//             })
//             .select("_id salaryStructure")
//             .lean();

//         if (!employee) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Employee not found"
//             });
//         }

//         /* ============================
//            4. Date Range
//         ============================ */

//         const { start, end } = buildMonthRange(year, month);

//         /* ============================
//            5. Aggregation (Index Aware)
//         ============================ */

//         const summary = await Attendance.aggregate([

//             {
//                 $match: {
//                     companyId: new mongoose.Types.ObjectId(companyId),
//                     employeeId: employee._id,
//                     date: { $gte: start, $lte: end }
//                 }
//             },

//             {
//                 $group: {

//                     _id: "$status",

//                     days: { $sum: 1 },

//                     totalMinutes: {
//                         $sum: "$workSummary.totalMinutes"
//                     },

//                     overtimeMinutes: {
//                         $sum: "$workSummary.overtimeMinutes"
//                     },

//                     lateMinutes: {
//                         $sum: "$workSummary.lateMinutes"
//                     },

//                     earlyLeaveMinutes: {
//                         $sum: "$workSummary.earlyLeaveMinutes"
//                     }
//                 }
//             }
//         ]);

//         /* ============================
//            6. Normalize Output
//         ============================ */

//         const stats = {
//             present: 0,
//             absent: 0,
//             leave: 0,
//             holiday: 0,
//             half_day: 0,
//             week_off: 0
//         };

//         let payrollMinutes = 0;
//         let overtimeMinutes = 0;

//         summary.forEach(item => {

//             stats[item._id] = item.days;

//             payrollMinutes += item.totalMinutes || 0;

//             overtimeMinutes += item.overtimeMinutes || 0;
//         });

//         /* ============================
//            7. Salary Estimation
//         ============================ */

//         const perHour = employee.salaryStructure?.perHour || 0;
//         const overtimeRate = employee.salaryStructure?.overtimeRate || 0;

//         const payableHours = payrollMinutes / 60;
//         const overtimeHours = overtimeMinutes / 60;

//         const basePay = payableHours * perHour;
//         const overtimePay = overtimeHours * overtimeRate;

//         /* ============================
//            8. Response
//         ============================ */

//         return res.status(200).json({

//             success: true,

//             period: { month, year },

//             attendance: stats,

//             work: {
//                 totalMinutes: payrollMinutes,
//                 overtimeMinutes,
//                 payableHours,
//                 overtimeHours
//             },

//             payroll: {
//                 perHour,
//                 overtimeRate,
//                 basePay,
//                 overtimePay,
//                 grossPay: basePay + overtimePay
//             }
//         });

//     } catch (error) {

//         console.error("Summary Error:", error);

//         return res.status(500).json({
//             success: false,
//             message: "Unable to generate summary"
//         });
//     }
// };



// /**
//  * @desc Employee Today Attendance
//  */
// export const getTodayAttendance = async (req, res) => {

//     try {

//         /* ======================
//            Auth Context
//         ====================== */

//         const userId = req.user._id;
//         const companyId = req.user.companyId;

//         /* ======================
//            Employee
//         ====================== */

//         const employee = await Employee.findOne({
//             userId,
//             companyId,
//             employmentStatus: "active"
//         })
//             .select("_id empCode")
//             .lean();

//         if (!employee) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Employee not found"
//             });
//         }

//         /* ======================
//            Date
//         ====================== */

//         const today = normalizeToUTCDate();

//         /* ======================
//            Attendance
//         ====================== */

//         const record = await Attendance.findOne({
//             companyId,
//             employeeId: employee._id,
//             date: today
//         })
//             .select(`
//             status
//             punchIn
//             punchOut
//             workSummary
//             isSuspicious
//             geoLocation.verified
//         `)
//             .lean();

//         /* ======================
//            Fallback
//         ====================== */

//         const status = record?.status || "absent";

//         /* ======================
//            Response
//         ====================== */

//         return res.status(200).json({

//             success: true,

//             date: today,

//             status,

//             punchIn: record?.punchIn || null,

//             punchOut: record?.punchOut || null,

//             flags: {
//                 isLate: (record?.workSummary?.lateMinutes || 0) > 0,
//                 isEarlyLeave: (record?.workSummary?.earlyLeaveMinutes || 0) > 0,
//                 isOvertime: (record?.workSummary?.overtimeMinutes || 0) > 0,
//                 isSuspicious: record?.isSuspicious || false,
//                 geoVerified: record?.geoLocation?.verified || false
//             }
//         });

//     } catch (error) {

//         console.error("Today Attendance Error:", error);

//         res.status(500).json({
//             success: false,
//             message: "Unable to fetch today attendance"
//         });
//     }
// };


// /**
//  * @desc Get Attendance By Date
//  */
// export const getDailyAttendance = async (req, res) => {

//     try {

//         const { date } = req.query;

//         if (!date) {
//             return res.status(400).json({
//                 success: false,
//                 message: "date is required"
//             });
//         }

//         const userId = req.user._id;
//         const companyId = req.user.companyId;

//         const employee = await Employee.findOne({
//             userId,
//             companyId,
//             employmentStatus: "active"
//         })
//             .select("_id")
//             .lean();

//         if (!employee) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Employee not found"
//             });
//         }

//         const normalized = normalizeToUTCDate(new Date(date));

//         const record = await Attendance.findOne({
//             companyId,
//             employeeId: employee._id,
//             date: normalized
//         }).lean();

//         return res.status(200).json({

//             success: true,

//             date: normalized,

//             attendance: record || {
//                 status: "absent",
//                 punchIn: null,
//                 punchOut: null
//             }
//         });

//     } catch (error) {

//         console.error("Daily Attendance Error:", error);

//         res.status(500).json({
//             success: false,
//             message: "Unable to fetch daily attendance"
//         });
//     }
// };



// /**
//  * @desc Attendance Range Summary
//  */
// export const getRangeSummary = async (req, res) => {

//     try {

//         const { from, to } = req.query;

//         if (!from || !to) {
//             return res.status(400).json({
//                 success: false,
//                 message: "from and to dates required"
//             });
//         }

//         const userId = req.user._id;
//         const companyId = req.user.companyId;

//         const employee = await Employee.findOne({
//             userId,
//             companyId,
//             employmentStatus: "active"
//         })
//             .select("_id salaryStructure")
//             .lean();

//         if (!employee) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Employee not found"
//             });
//         }

//         const { start, end } = buildDateRange(from, to);

//         const summary = await Attendance.aggregate([

//             {
//                 $match: {
//                     companyId: new mongoose.Types.ObjectId(companyId),
//                     employeeId: employee._id,
//                     date: { $gte: start, $lte: end }
//                 }
//             },

//             {
//                 $group: {

//                     _id: "$status",

//                     days: { $sum: 1 },

//                     totalMinutes: { $sum: "$workSummary.totalMinutes" },

//                     overtimeMinutes: { $sum: "$workSummary.overtimeMinutes" }
//                 }
//             }
//         ]);

//         /* Normalize */

//         const stats = {
//             present: 0,
//             absent: 0,
//             leave: 0,
//             holiday: 0,
//             half_day: 0,
//             week_off: 0
//         };

//         let workMinutes = 0;
//         let overtimeMinutes = 0;

//         summary.forEach(i => {

//             stats[i._id] = i.days;

//             workMinutes += i.totalMinutes || 0;

//             overtimeMinutes += i.overtimeMinutes || 0;
//         });

//         return res.status(200).json({

//             success: true,

//             period: { from, to },

//             attendance: stats,

//             work: {
//                 totalMinutes: workMinutes,
//                 overtimeMinutes,
//                 totalHours: workMinutes / 60
//             }
//         });

//     } catch (error) {

//         console.error("Range Summary Error:", error);

//         res.status(500).json({
//             success: false,
//             message: "Unable to generate summary"
//         });
//     }
// };





// /* ======================================================
//    EXPORT: Attendance CSV (IST SAFE)
// ====================================================== */

// // export const exportAttendanceCSV = async (req, res) => {

// //     try {

// //         const companyId = req.user._id;

// //         /* ================================
// //            Force IST Timezone
// //         ================================= */

// //         moment.tz.setDefault("Asia/Kolkata");

// //         const {
// //             startDate,
// //             endDate,
// //             month,   // YYYY-MM
// //             year
// //         } = req.query;

// //         let fromDateIST;
// //         let toDateIST;

// //         /* ================================
// //            Date Filter (IST)
// //         ================================= */

// //         // Monthly
// //         if (month) {

// //             fromDateIST = moment
// //                 .tz(month, "YYYY-MM", "Asia/Kolkata")
// //                 .startOf("month");

// //             toDateIST = moment
// //                 .tz(month, "YYYY-MM", "Asia/Kolkata")
// //                 .endOf("month");
// //         }

// //         // Custom Range
// //         else if (startDate && endDate) {

// //             fromDateIST = moment
// //                 .tz(startDate, "YYYY-MM-DD", "Asia/Kolkata")
// //                 .startOf("day");

// //             toDateIST = moment
// //                 .tz(endDate, "YYYY-MM-DD", "Asia/Kolkata")
// //                 .endOf("day");
// //         }

// //         // Yearly
// //         else if (year) {

// //             fromDateIST = moment
// //                 .tz(`${year}-01-01`, "Asia/Kolkata")
// //                 .startOf("year");

// //             toDateIST = moment
// //                 .tz(`${year}-12-31`, "Asia/Kolkata")
// //                 .endOf("year");
// //         }

// //         else {
// //             return res.status(400).json({
// //                 success: false,
// //                 message: "Provide month OR startDate+endDate OR year"
// //             });
// //         }

// //         /* ================================
// //            Convert IST → UTC (DB Query)
// //         ================================= */

// //         const fromUTC = fromDateIST.clone().utc().toDate();
// //         const toUTC = toDateIST.clone().utc().toDate();

// //         /* ================================
// //            Fetch Attendance
// //         ================================= */

// //         const records = await Attendance.find({
// //             companyId,
// //             date: {
// //                 $gte: fromUTC,
// //                 $lte: toUTC
// //             }
// //         })
// //             .populate("employeeId", "user_name empCode userId ")
// //             .lean();

// //         if (!records.length) {
// //             return res.status(404).json({
// //                 success: false,
// //                 message: "No attendance data found"
// //             });
// //         }

// //         /* ================================
// //            Format CSV (IST Display)
// //         ================================= */

// //         const formattedData = records.map(row => {

// //             /* Break Calculation (IST Safe) */
// //             const totalBreakMinutes = row.breaks?.reduce((acc, b) => {

// //                 if (b.start && b.end) {

// //                     const start = moment(b.start).tz("Asia/Kolkata");
// //                     const end = moment(b.end).tz("Asia/Kolkata");

// //                     return acc + end.diff(start, "minutes");
// //                 }

// //                 return acc;

// //             }, 0) || 0;

// //             return {

// //                 /* Employee */
// //                 CompanyID: row.companyId,

// //                 EmployeeName: row.employeeId?.user_name || "N/A",
// //                 EmployeeEmail: row.employeeId?.userId?.email || "N/A",
// //                 EmployeePhone: row.employeeId?.userId?.email || "N/A",
// //                 EmployeeCode: row.employeeId?.empCode || "N/A",

// //                 /* Date (IST) */
// //                 Date: moment(row.date)
// //                     .tz("Asia/Kolkata")
// //                     .format("DD-MMM-YYYY"),

// //                 Day: moment(row.date)
// //                     .tz("Asia/Kolkata")
// //                     .format("dddd"),

// //                 Month: moment(row.date)
// //                     .tz("Asia/Kolkata")
// //                     .format("MMMM"),

// //                 Year: moment(row.date)
// //                     .tz("Asia/Kolkata")
// //                     .format("YYYY"),

// //                 /* Shift */
// //                 ShiftName: row.shift?.name || "General",
// //                 ShiftStart: row.shift?.startTime || "",
// //                 ShiftEnd: row.shift?.endTime || "",

// //                 /* Punch (IST) */
// //                 PunchIn: row.punchIn
// //                     ? moment(row.punchIn)
// //                         .tz("Asia/Kolkata")
// //                         .format("hh:mm A")
// //                     : "",

// //                 PunchOut: row.punchOut
// //                     ? moment(row.punchOut)
// //                         .tz("Asia/Kolkata")
// //                         .format("hh:mm A")
// //                     : "",

// //                 /* Work */
// //                 TotalWorkMinutes: row.workSummary?.totalMinutes || 0,
// //                 OvertimeMinutes: row.workSummary?.overtimeMinutes || 0,
// //                 LateMinutes: row.workSummary?.lateMinutes || 0,
// //                 EarlyLeaveMinutes: row.workSummary?.earlyLeaveMinutes || 0,

// //                 BreakMinutes: totalBreakMinutes,

// //                 /* Status */
// //                 Status: row.status,

// //                 /* Location */

// //                 LocationVerified: row.geoLocation?.verified ? "Yes" : "No",



// //                 /* Audit */
// //                 Remarks: row.remarks || "",
// //                 AutoMarked: row.isAutoMarked ? "Yes" : "No",
// //                 Suspicious: row.isSuspicious ? "Yes" : "No",


// //             };
// //         });

// //         /* ================================
// //            Convert to CSV
// //         ================================= */

// //         const parser = new Parser();
// //         const csv = parser.parse(formattedData);

// //         /* ================================
// //            Download
// //         ================================= */

// //         const fileName =
// //             `attendance_${fromDateIST.format("YYYYMMDD")}_${toDateIST.format("YYYYMMDD")}.csv`;

// //         res.header("Content-Type", "text/csv");
// //         res.header("Content-Disposition", `attachment; filename=${fileName}`);

// //         return res.status(200).send(csv);

// //     } catch (error) {

// //         console.error("CSV Export Error:", error);

// //         return res.status(500).json({
// //             success: false,
// //             message: "CSV Export Failed",
// //             error: error.message
// //         });
// //     }
// // };



// export const exportAttendanceCSV = async (req, res) => {
//     try {
//         const companyId = req.user._id;

//         moment.tz.setDefault("Asia/Kolkata");

//         const { startDate, endDate, month, year } = req.query;

//         let fromDateIST;
//         let toDateIST;

//         /* --------------------------------------------------
//            Date Filter (IST)
//         -------------------------------------------------- */

//         if (month) {
//             fromDateIST = moment.tz(month, "YYYY-MM", "Asia/Kolkata").startOf("month");
//             toDateIST = moment.tz(month, "YYYY-MM", "Asia/Kolkata").endOf("month");
//         }
//         else if (startDate && endDate) {
//             fromDateIST = moment.tz(startDate, "YYYY-MM-DD", "Asia/Kolkata").startOf("day");
//             toDateIST = moment.tz(endDate, "YYYY-MM-DD", "Asia/Kolkata").endOf("day");
//         }
//         else if (year) {
//             fromDateIST = moment.tz(`${year}-01-01`, "Asia/Kolkata").startOf("year");
//             toDateIST = moment.tz(`${year}-12-31`, "Asia/Kolkata").endOf("year");
//         }
//         else {
//             return res.status(400).json({
//                 success: false,
//                 message: "Provide month OR startDate+endDate OR year"
//             });
//         }

//         const fromUTC = fromDateIST.clone().utc().toDate();
//         const toUTC = toDateIST.clone().utc().toDate();

//         /* --------------------------------------------------
//            Aggregation (Attendance → Employee → User)
//         -------------------------------------------------- */

//         const records = await Attendance.aggregate([
//             {
//                 $match: {
//                     companyId: new mongoose.Types.ObjectId(companyId),
//                     date: { $gte: fromUTC, $lte: toUTC }
//                 }
//             },

//             /* Join Employee */
//             {
//                 $lookup: {
//                     from: "employees",
//                     let: { empId: "$employeeId" },
//                     pipeline: [
//                         { $match: { $expr: { $eq: ["$_id", "$$empId"] } } },
//                         {
//                             $project: {
//                                 user_name: 1,
//                                 empCode: 1,
//                                 userId: 1
//                             }
//                         }
//                     ],
//                     as: "employee"
//                 }
//             },
//             { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } },

//             /* Join User */
//             {
//                 $lookup: {
//                     from: "users",
//                     let: { uid: "$employee.userId" },
//                     pipeline: [
//                         { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
//                         {
//                             $project: {
//                                 email: 1,
//                                 phone: 1,
//                                 name: 1
//                             }
//                         }
//                     ],
//                     as: "user"
//                 }
//             },
//             { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

//             /* Flatten */
//             {
//                 $addFields: {
//                     employeeName: "$employee.user_name",
//                     employeeCode: "$employee.empCode",
//                     employeeEmail: "$user.email",
//                     employeePhone: "$user.phone"
//                 }
//             },

//             {
//                 $project: {
//                     employee: 0,
//                     user: 0
//                 }
//             }
//         ], { allowDiskUse: true });

//         if (!records.length) {
//             return res.status(404).json({
//                 success: false,
//                 message: "No attendance data found"
//             });
//         }

//         /* --------------------------------------------------
//            Format CSV
//         -------------------------------------------------- */

//         const formattedData = records.map(row => {

//             const totalBreakMinutes = row.breaks?.reduce((acc, b) => {
//                 if (b.start && b.end) {
//                     const start = moment(b.start).tz("Asia/Kolkata");
//                     const end = moment(b.end).tz("Asia/Kolkata");
//                     return acc + end.diff(start, "minutes");
//                 }
//                 return acc;
//             }, 0) || 0;

//             return {
//                 EmployeeCode: row.employeeCode || "N/A",

//                 EmployeeName: row.employeeName || "N/A",
//                 EmployeeEmail: row.employeeEmail || "N/A",
//                 EmployeePhone: row.employeePhone || "N/A",


//                 Date: moment(row.date).tz("Asia/Kolkata").format("DD-MMM-YYYY"),
//                 Day: moment(row.date).tz("Asia/Kolkata").format("dddd"),
//                 Month: moment(row.date).tz("Asia/Kolkata").format("MMMM"),
//                 Year: moment(row.date).tz("Asia/Kolkata").format("YYYY"),

//                 ShiftName: row.shift?.name || "General",
//                 ShiftStart: row.shift?.startTime || "",
//                 ShiftEnd: row.shift?.endTime || "",

//                 PunchIn: row.punchIn ? moment(row.punchIn).tz("Asia/Kolkata").format("hh:mm A") : "",
//                 PunchOut: row.punchOut ? moment(row.punchOut).tz("Asia/Kolkata").format("hh:mm A") : "",

//                 TotalWorkMinutes: row.workSummary?.totalMinutes || 0,
//                 OvertimeMinutes: row.workSummary?.overtimeMinutes || 0,
//                 LateMinutes: row.workSummary?.lateMinutes || 0,
//                 EarlyLeaveMinutes: row.workSummary?.earlyLeaveMinutes || 0,

//                 BreakMinutes: totalBreakMinutes,

//                 Status: row.status,
//                 LocationVerified: row.geoLocation?.verified ? "Yes" : "No",

//                 Remarks: row.remarks || "",
//                 AutoMarked: row.isAutoMarked ? "Yes" : "No",
//                 Suspicious: row.isSuspicious ? "Yes" : "No"
//             };
//         });

//         /* --------------------------------------------------
//            Convert to CSV
//         -------------------------------------------------- */

//         const parser = new Parser();
//         const csv = parser.parse(formattedData);

//         const fileName =
//             `attendance_${fromDateIST.format("YYYYMMDD")}_${toDateIST.format("YYYYMMDD")}.csv`;

//         res.header("Content-Type", "text/csv");
//         res.header("Content-Disposition", `attachment; filename=${fileName}`);

//         return res.status(200).send(csv);

//     } catch (error) {
//         console.error("CSV Export Error:", error);
//         return res.status(500).json({
//             success: false,
//             message: "CSV Export Failed",
//             error: error.message
//         });
//     }
// };




// export const exportCompanyAttendanceToExcel = async (req, res) => {
//     try {

//         /* ===============================
//            1. AUTH & VALIDATION
//         =============================== */

//         const companyId = req.user._id; // From JWT Middleware

//         if (!mongoose.Types.ObjectId.isValid(companyId)) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Invalid Company ID"
//             });
//         }


//         /* ===============================
//            2. FILTER (Optional Date Range)
//         =============================== */

//         const { startDate, endDate } = req.query;

//         let matchQuery = {
//             companyId: new mongoose.Types.ObjectId(companyId)
//         };

//         if (startDate && endDate) {
//             matchQuery.date = {
//                 $gte: new Date(startDate),
//                 $lte: new Date(endDate)
//             };
//         }


//         /* ===============================
//            3. FETCH DATA (Optimized)
//         =============================== */

//         const records = await Attendance.aggregate([

//             { $match: matchQuery },

//             /* Join Employee */
//             {
//                 $lookup: {
//                     from: "employees",
//                     localField: "employeeId",
//                     foreignField: "_id",
//                     as: "employee"
//                 }
//             },

//             { $unwind: "$employee" },

//             /* Projection (Report Fields) */
//             {
//                 $project: {

//                     _id: 0,

//                     employeeId: "$employee._id",
//                     employeeName: "$employee.name",
//                     employeeEmail: "$employee.email",

//                     date: 1,

//                     punchIn: 1,
//                     punchOut: 1,

//                     totalMinutes: "$workSummary.totalMinutes",
//                     payableMinutes: "$workSummary.payableMinutes",
//                     overtimeMinutes: "$workSummary.overtimeMinutes",

//                     status: 1,
//                     approvalStatus: 1,

//                     deviceId: "$deviceInfo.deviceId",

//                     createdAt: 1
//                 }
//             },

//             { $sort: { date: -1 } }

//         ]);


//         if (!records || records.length === 0) {
//             return res.status(404).json({
//                 success: false,
//                 message: "No attendance records found"
//             });
//         }


//         /* ===============================
//            4. FORMAT DATA
//         =============================== */

//         const formattedData = records.map((item) => {

//             return {

//                 Employee_ID: item.employeeId,
//                 Employee_Name: item.employeeName || "-",
//                 Employee_Email: item.employeeEmail || "-",

//                 Date: formatDate(item.date),

//                 Punch_In: formatTime(item.punchIn),
//                 Punch_Out: formatTime(item.punchOut),

//                 Total_Minutes: item.totalMinutes || 0,
//                 Payable_Minutes: item.payableMinutes || 0,
//                 Overtime_Minutes: item.overtimeMinutes || 0,

//                 Status: item.status,
//                 Approval_Status: item.approvalStatus,

//                 Device_ID: item.deviceId || "-",

//                 Created_At: formatDateTime(item.createdAt)
//             };
//         });


//         /* ===============================
//            5. JSON → CSV
//         =============================== */

//         const fields = Object.keys(formattedData[0]);

//         const json2csvParser = new Parser({ fields });

//         const csv = json2csvParser.parse(formattedData);


//         /* ===============================
//            6. DOWNLOAD RESPONSE
//         =============================== */

//         const fileName = `attendance_report_${Date.now()}.csv`;

//         res.setHeader("Content-Type", "text/csv");
//         res.setHeader(
//             "Content-Disposition",
//             `attachment; filename="${fileName}"`
//         );

//         return res.status(200).send(csv);

//     }
//     catch (error) {

//         console.error("Attendance Export Error:", error);

//         return res.status(500).json({
//             success: false,
//             message: "Failed to export attendance",
//             error: error.message
//         });
//     }
// };



// /* =====================================================
//    HELPERS
// ===================================================== */

// const formatDate = (date) => {
//     if (!date) return "-";

//     return new Date(date).toLocaleDateString("en-IN");
// };




// const formatDateTime = (date) => {
//     if (!date) return "-";

//     return new Date(date).toLocaleString("en-IN");
// };