// controllers/todayAttendanceController.js

import mongoose from "mongoose";
import ExcelJS from "exceljs";
import Attendance from '../../models/Attandance/Attendance.js';
import Employee from '../../models/Attandance/Employee.js';
import User from '../../models/userModel.js';
import { formatTime } from './Export/attendanceController.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Roles that may export another company's data by passing ?companyId= */
const GLOBAL_VIEWER_TYPES = ["super_admin", "partner"];

/**
 * Resolve the company a tenant-scoped export should use.
 * Regular users are always locked to their own companyId.
 */
const resolveExportCompanyId = (req) => {
    if (GLOBAL_VIEWER_TYPES.includes(req.user?.type)) {
        return req.query.companyId || req.user?.companyId || req.user?._id || req.user?.id;
    }
    return req.user?.companyId;
};

/**
 * Build the [midnight, next-midnight) UTC window for one IST calendar day.
 * Accepts YYYY-MM-DD or defaults to "today" in IST.
 */
const resolveISTDayRange = (dateStr) => {
    let y, m, d, dateKey;

    if (dateStr) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
        [y, m, d] = dateStr.split("-").map(Number);
        dateKey = dateStr;
    } else {
        const nowIST = new Date(Date.now() + IST_OFFSET_MS);
        y = nowIST.getUTCFullYear();
        m = nowIST.getUTCMonth() + 1;
        d = nowIST.getUTCDate();
        dateKey = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }

    const start = new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
    return { start, end: new Date(start.getTime() + DAY_MS), dateKey };
};

/** Map a stored attendance record to a display status. */
const resolveTodayStatus = (attendance) => {
    if (!attendance) return { code: "absent", label: "Absent" };

    switch (attendance.status) {
        case "present":
            return (attendance.lateByMinutes || 0) > 0
                ? { code: "late", label: "Late" }
                : { code: "present", label: "Present" };
        case "half_day": return { code: "half_day", label: "Half Day" };
        case "leave": return { code: "leave", label: "Leave" };
        case "holiday": return { code: "holiday", label: "Holiday" };
        case "week_off": return { code: "week_off", label: "Week Off" };
        case "week_off_half": return { code: "week_off_half", label: "Half Day Off" };
        case "comp_off": return { code: "comp_off", label: "Comp Off" };
        case "absent": return { code: "absent", label: "Absent" };
        case "present autocheckout": return { code: "absent", label: "Absent (Auto Checkout)" };
        case "pending_approval": return { code: "pending_approval", label: "Pending Approval" };
        case "rejected": return { code: "rejected", label: "Rejected" };
        case "system_auto": return { code: "system_auto", label: "System Auto" };
        default: return { code: attendance.status || "unknown", label: attendance.status || "Unknown" };
    }
};

/** Worked minutes from workSummary, falling back to punch times. */
const resolveWorkedMinutes = (attendance) => {
    if (!attendance) return 0;

    const payable = attendance.workSummary?.payableMinutes;
    if (Number.isFinite(payable) && payable > 0) return payable;

    const total = attendance.workSummary?.totalMinutes;
    if (Number.isFinite(total) && total > 0) return total;

    const hours = Number(attendance.totalWorkingHours);
    if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60);

    if (attendance.punchIn && attendance.punchOut) {
        return Math.max(0, Math.round((new Date(attendance.punchOut) - new Date(attendance.punchIn)) / 60000));
    }
    return 0;
};

/** minutes → "HH:MM" */
const formatHoursMinutes = (minutes = 0) => {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const STATUS_FILL = {
    present: "FFD9EAD3",
    late: "FFFFF2CC",
    half_day: "FFFFE599",
    absent: "FFFFC7CE",
    leave: "FFD9D2E9",
    holiday: "FFB7E1CD",
    week_off: "FFD0E4F7",
    week_off_half: "FFD0E4F7",
    comp_off: "FFD6B4D8",
    pending_approval: "FFFFF2CC",
    rejected: "FFFFC7CE",
    system_auto: "FFF2F2F2",
};

const EXPORT_HEADERS = [
    { key: "sno", label: "S.No", width: 6 },
    { key: "empCode", label: "Emp Code", width: 13 },
    { key: "name", label: "Employee Name", width: 24 },
    { key: "department", label: "Department", width: 18 },
    { key: "designation", label: "Designation", width: 18 },
    { key: "shift", label: "Shift", width: 26 },
    { key: "status", label: "Status", width: 20 },
    { key: "punchIn", label: "Punch In", width: 13 },
    { key: "punchOut", label: "Punch Out", width: 13 },
    { key: "workingHours", label: "Working Hours", width: 13 },
    { key: "lateBy", label: "Late By (min)", width: 13 },
    { key: "overtime", label: "Overtime (min)", width: 14 },
    { key: "locationVerified", label: "Location Verified", width: 15 },
    { key: "remarks", label: "Remarks", width: 32 },
];

const EXPORT_STATUS_FONT = {
    absent: "FF9C0006",
    rejected: "FF9C0006",
    leave: "FF6A0DAD",
    week_off: "FF1155CC",
    week_off_half: "FF1155CC",
    holiday: "FF137333",
    comp_off: "FF7D3C98",
    late: "FF7D6608",
};

/**
 * Build the XLSX workbook for a single day's attendance.
 */
const buildTodayAttendanceWorkbook = ({
    companyName,
    department,
    dateKey,
    rows,
    summary,
    departmentStats,
    generatedBy,
}) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "HR System";
    wb.created = new Date();

    const HEADER_BG = "FF1F3864";
    const SUBHEAD_BG = "FF2F5496";
    const ALT_ROW_BG = "FFF2F6FC";

    /* ── Sheet 1: Today Attendance ─────────────────────────────── */
    const ws = wb.addWorksheet("Today Attendance", {
        views: [{ state: "frozen", ySplit: 4 }],
    });

    const columnCount = EXPORT_HEADERS.length;
    const title = `DAILY ATTENDANCE REPORT${department ? ` — ${department}` : ""}`;
    const subtitle =
        `${companyName || "Company"}  |  ${dateKey}  |  ` +
        `Employees: ${summary.totalEmployees}  |  Present: ${summary.present}  |  ` +
        `Absent: ${summary.absent}  |  Late: ${summary.late}  |  Present %: ${summary.presentRate}%`;

    ws.mergeCells(1, 1, 1, columnCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = { name: "Arial", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, columnCount);
    const subtitleCell = ws.getCell(2, 1);
    subtitleCell.value = subtitle;
    subtitleCell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FFFFFFFF" } };
    subtitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_BG } };
    subtitleCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(2).height = 20;

    const generatedCell = ws.getCell(3, 1);
    generatedCell.value = `Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}${generatedBy ? ` by ${generatedBy}` : ""}`;
    generatedCell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF555555" } };
    ws.getRow(3).height = 16;

    const headerRow = ws.getRow(4);
    EXPORT_HEADERS.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h.label;
        cell.font = { name: "Arial", bold: true, size: 9, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_BG } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        ws.getColumn(i + 1).width = h.width;
    });
    headerRow.height = 24;

    const statusIndex = EXPORT_HEADERS.findIndex((h) => h.key === "status");

    rows.forEach((row, idx) => {
        const excelRow = ws.getRow(5 + idx);
        excelRow.height = 16;
        const baseFill = idx % 2 === 0 ? "FFFFFFFF" : ALT_ROW_BG;

        EXPORT_HEADERS.forEach((h, i) => {
            const cell = excelRow.getCell(i + 1);
            cell.value = row[h.key];
            cell.font = { name: "Arial", size: 9, color: { argb: "FF000000" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: baseFill } };
            cell.alignment = { horizontal: i === 0 ? "center" : "left", vertical: "middle", wrapText: h.key === "remarks" };
        });

        const statusCell = excelRow.getCell(statusIndex + 1);
        statusCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: STATUS_FILL[row.statusCode] || baseFill },
        };
        statusCell.font = {
            name: "Arial", size: 9, bold: true,
            color: { argb: EXPORT_STATUS_FONT[row.statusCode] || "FF000000" },
        };
        statusCell.alignment = { horizontal: "center", vertical: "middle" };
    });

    if (rows.length > 0) {
        ws.autoFilter = {
            from: { row: 4, column: 1 },
            to: { row: 4, column: columnCount },
        };
    }

    /* ── Sheet 2: Summary ──────────────────────────────────────── */
    const wsSummary = wb.addWorksheet("Summary");
    wsSummary.getColumn(1).width = 30;
    wsSummary.getColumn(2).width = 18;

    const sumTitle = wsSummary.getCell(1, 1);
    sumTitle.value = `SUMMARY — ${dateKey}`;
    sumTitle.font = { name: "Arial", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    sumTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    sumTitle.alignment = { horizontal: "center", vertical: "middle" };
    wsSummary.mergeCells(1, 1, 1, 2);
    wsSummary.getRow(1).height = 24;

    const metrics = [
        ["Total Employees", summary.totalEmployees],
        ["Present", summary.present],
        ["Absent", summary.absent],
        ["Late", summary.late],
        ["On Time", summary.onTime],
        ["Half Day", summary.halfDay],
        ["On Leave", summary.leave],
        ["Week Off", summary.weekOff],
        ["Holiday", summary.holiday],
        ["Comp Off", summary.compOff],
        ["Present %", `${summary.presentRate}%`],
    ];

    metrics.forEach(([label, value], idx) => {
        const row = wsSummary.getRow(3 + idx);
        row.getCell(1).value = label;
        row.getCell(1).font = { name: "Arial", bold: true, size: 10 };
        row.getCell(2).value = value;
        row.getCell(2).font = { name: "Arial", size: 10 };
        row.getCell(2).alignment = { horizontal: "center" };
        row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FC" } };
    });

    const deptStartRow = 3 + metrics.length + 2;
    const deptHeaders = ["Department", "Total", "Present", "Absent", "Late", "On Time", "Present %"];

    wsSummary.getCell(deptStartRow, 1).value = "DEPARTMENT BREAKDOWN";
    wsSummary.getCell(deptStartRow, 1).font = { name: "Arial", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    wsSummary.getCell(deptStartRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_BG } };
    wsSummary.mergeCells(deptStartRow, 1, deptStartRow, deptHeaders.length);

    deptHeaders.forEach((label, i) => {
        wsSummary.getColumn(i + 1).width = i === 0 ? 30 : 12;
    });

    const deptHeaderRow = wsSummary.getRow(deptStartRow + 1);
    deptHeaders.forEach((label, i) => {
        const cell = deptHeaderRow.getCell(i + 1);
        cell.value = label;
        cell.font = { name: "Arial", bold: true, size: 9, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_BG } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    departmentStats.forEach((dept, idx) => {
        const row = wsSummary.getRow(deptStartRow + 2 + idx);
        const values = [dept.department, dept.total, dept.present, dept.absent, dept.late, dept.onTime, `${dept.presentRate}%`];
        values.forEach((value, i) => {
            const cell = row.getCell(i + 1);
            cell.value = value;
            cell.font = { name: "Arial", size: 9 };
            cell.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : ALT_ROW_BG } };
        });
    });

    if (departmentStats.length === 0) {
        const emptyRow = wsSummary.getRow(deptStartRow + 2);
        emptyRow.getCell(1).value = "No employees found for the selected filters.";
        emptyRow.getCell(1).font = { name: "Arial", size: 9, italic: true };
    }

    return wb;
};

class TodayAttendanceController {

    /**
     * Get today's attendance dashboard with pie chart and employee lists
     * GET /api/attendance/today/dashboard
     * Query params: 
     *   - companyId (required)
     *   - date (optional, format: YYYY-MM-DD, defaults to today)
     *   - department (optional)
     *   - employeeType (optional: non_sales, sales, pro_sales)
     */
    async getTodayDashboard(req, res) {
        try {
            const {
                companyId,
                date,
                department,
                employeeType
            } = req.query;

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    error: "companyId is required"
                });
            }

            // Set date (default to today)
            let targetDate;
            if (date) {
                targetDate = new Date(date);
                targetDate.setHours(0, 0, 0, 0);
            } else {
                targetDate = new Date();
                targetDate.setHours(0, 0, 0, 0);
            }

            const nextDate = new Date(targetDate);
            nextDate.setDate(nextDate.getDate() + 1);

            // Build employee filter
            const employeeFilter = {
                companyId: new mongoose.Types.ObjectId(companyId),
                employmentStatus: "active"
            };

            if (department) {
                employeeFilter["jobInfo.department"] = department;
            }

            if (employeeType) {
                employeeFilter.employeeType = employeeType;
            }

            // Get all active employees
            const employees = await Employee.find(employeeFilter)
                .populate("userId", "name email profileImage")
                .lean();

            if (employees.length === 0) {
                return res.status(200).json({
                    success: true,
                    data: {
                        date: targetDate,
                        summary: {
                            totalEmployees: 0,
                            present: 0,
                            absent: 0,
                            late: 0,
                            onTime: 0,
                            halfDay: 0,
                            presentRate: 0,
                            absentRate: 0,
                            lateRate: 0
                        },
                        pieChartData: [],
                        presentEmployees: [],
                        absentEmployees: [],
                        lateEmployees: [],
                        onTimeEmployees: []
                    }
                });
            }

            // Get attendance for target date
            const attendanceRecords = await Attendance.find({
                companyId: new mongoose.Types.ObjectId(companyId),
                employeeId: { $in: employees.map(e => e._id) },
                date: { $gte: targetDate, $lt: nextDate }
            }).lean();

            // Create attendance map
            const attendanceMap = new Map();
            attendanceRecords.forEach(record => {
                attendanceMap.set(record.employeeId.toString(), record);
            });

            // Categorize employees
            const presentEmployees = [];
            const absentEmployees = [];
            const lateEmployees = [];
            const onTimeEmployees = [];
            const halfDayEmployees = [];

            for (const employee of employees) {
                const attendance = attendanceMap.get(employee._id.toString());
                const employeeData = {
                    employeeId: employee._id,
                    employeeName: employee.user_name || employee.userId?.name || "N/A",
                    empCode: employee.empCode || "N/A",
                    department: employee.jobInfo?.department || "N/A",
                    designation: employee.jobInfo?.designation || "N/A",
                    profileImage: employee.userId?.profileImage || null,
                    punchIn: null,
                    punchOut: null,
                    lateByMinutes: 0,
                    workingHours: 0,
                    status: "absent"
                };

                if (attendance) {
                    employeeData.status = attendance.status;
                    employeeData.punchIn = attendance.punchIn;
                    employeeData.punchOut = attendance.punchOut;
                    employeeData.lateByMinutes = attendance.lateByMinutes || 0;
                    employeeData.workingHours = attendance.totalWorkingHours || 0;

                    if (attendance.status === "present") {
                        presentEmployees.push(employeeData);

                        if (attendance.lateByMinutes > 0) {
                            lateEmployees.push(employeeData);
                        } else {
                            onTimeEmployees.push(employeeData);
                        }
                    } else if (attendance.status === "half_day") {
                        halfDayEmployees.push(employeeData);
                        presentEmployees.push(employeeData); // half day counts as present for rate calculation
                    } else if (attendance.status === "week_off_half") {
                        halfDayEmployees.push(employeeData); // week_off_half counts as half-day for list
                        // Don't add to presentEmployees - it's a day off
                    } else if (attendance.status === "absent") {
                        absentEmployees.push(employeeData);
                    } else {
                        // For leave, holiday, week_off - treat as not present but not absent
                        absentEmployees.push(employeeData);
                    }
                } else {
                    absentEmployees.push(employeeData);
                }
            }

            // Calculate statistics
            const totalEmployees = employees.length;
            const presentCount = presentEmployees.length;
            const absentCount = absentEmployees.length;
            const lateCount = lateEmployees.length;
            const onTimeCount = onTimeEmployees.length;
            const halfDayCount = halfDayEmployees.length;

            const presentRate = totalEmployees > 0 ? ((presentCount / totalEmployees) * 100).toFixed(2) : 0;
            const absentRate = totalEmployees > 0 ? ((absentCount / totalEmployees) * 100).toFixed(2) : 0;
            const lateRate = totalEmployees > 0 ? ((lateCount / totalEmployees) * 100).toFixed(2) : 0;
            const onTimeRate = totalEmployees > 0 ? ((onTimeCount / totalEmployees) * 100).toFixed(2) : 0;

            // Prepare pie chart data
            const pieChartData = [
                { name: "Present", value: presentCount, color: "#4CAF50", rate: presentRate },
                { name: "Absent", value: absentCount, color: "#F44336", rate: absentRate },
                { name: "Late", value: lateCount, color: "#FFC107", rate: lateRate },
                { name: "On Time", value: onTimeCount, color: "#2196F3", rate: onTimeRate }
            ].filter(item => item.value > 0);

            // Sort employees by late minutes (highest first)
            lateEmployees.sort((a, b) => b.lateByMinutes - a.lateByMinutes);

            // Sort present employees by punch in time
            presentEmployees.sort((a, b) => {
                if (!a.punchIn) return 1;
                if (!b.punchIn) return -1;
                return new Date(a.punchIn) - new Date(b.punchIn);
            });

            // Sort absent employees by name
            absentEmployees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

            return res.status(200).json({
                success: true,
                data: {
                    date: targetDate,
                    dateFormatted: targetDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric"
                    }),
                    summary: {
                        totalEmployees,
                        presentCount,
                        absentCount,
                        lateCount,
                        onTimeCount,
                        halfDayCount,
                        presentRate: parseFloat(presentRate),
                        absentRate: parseFloat(absentRate),
                        lateRate: parseFloat(lateRate),
                        onTimeRate: parseFloat(onTimeRate)
                    },
                    pieChartData,
                    lists: {
                        present: presentEmployees,
                        absent: absentEmployees,
                        late: lateEmployees,
                        onTime: onTimeEmployees,
                        halfDay: halfDayEmployees
                    }
                }
            });

        } catch (error) {
            console.error("Error in today's attendance dashboard:", error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get single employee today's attendance
     * GET /api/attendance/today/employee/:employeeId
     */
    async getEmployeeTodayAttendance(req, res) {
        try {
            const { employeeId } = req.params;
            const { companyId, date, department } = req.query;

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    error: "companyId is required"
                });
            }

            // Build employee filter
            const employeeFilter = {
                companyId: new mongoose.Types.ObjectId(companyId),
                employmentStatus: "active"
            };

            if (department) {
                employeeFilter["jobInfo.department"] = department;
            }

            // Set date
            let targetDate;
            if (date) {
                targetDate = new Date(date);
                targetDate.setHours(0, 0, 0, 0);
            } else {
                targetDate = new Date();
                targetDate.setHours(0, 0, 0, 0);
            }

            const nextDate = new Date(targetDate);
            nextDate.setDate(nextDate.getDate() + 1);

            // Get employee details
            const employee = await Employee.findOne({
                _id: new mongoose.Types.ObjectId(employeeId),
                companyId: new mongoose.Types.ObjectId(companyId)
            }).populate("userId", "name email profileImage");

            if (!employee) {
                return res.status(404).json({
                    success: false,
                    error: "Employee not found"
                });
            }

            // Get attendance
            const attendance = await Attendance.findOne({
                companyId: new mongoose.Types.ObjectId(companyId),
                employeeId: new mongoose.Types.ObjectId(employeeId),
                date: { $gte: targetDate, $lt: nextDate }
            });

            const response = {
                success: true,
                data: {
                    employee: {
                        employeeId: employee._id,
                        employeeName: employee.user_name || employee.userId?.name,
                        empCode: employee.empCode,
                        department: employee.jobInfo?.department,
                        designation: employee.jobInfo?.designation,
                        profileImage: employee.userId?.profileImage,
                        shift: employee.shift
                    },
                    date: targetDate,
                    dateFormatted: targetDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric"
                    }),
                    attendance: attendance ? {
                        status: attendance.status,
                        punchIn: attendance.punchIn,
                        punchOut: attendance.punchOut,
                        lateByMinutes: attendance.lateByMinutes,
                        totalWorkingHours: attendance.totalWorkingHours,
                        breaks: attendance.breaks,
                        workSummary: attendance.workSummary,
                        geoLocation: attendance.geoLocation,
                        remarks: attendance.remarks
                    } : {
                        status: "absent",
                        punchIn: null,
                        punchOut: null,
                        lateByMinutes: 0,
                        totalWorkingHours: 0,
                        breaks: [],
                        workSummary: null,
                        geoLocation: null,
                        remarks: null
                    }
                }
            };

            res.status(200).json(response);

        } catch (error) {
            console.error("Error fetching employee today's attendance:", error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get attendance for specific date range with filters
     * GET /api/attendance/date-range/dashboard
     */
    async getDateRangeDashboard(req, res) {
        try {
            const {
                companyId,
                fromDate,
                toDate,
                department,
                employeeType
            } = req.query;

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    error: "companyId is required"
                });
            }

            if (!fromDate || !toDate) {
                return res.status(400).json({
                    success: false,
                    error: "fromDate and toDate are required"
                });
            }

            const startDate = new Date(fromDate);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(toDate);
            endDate.setHours(23, 59, 59, 999);

            // Build employee filter
            const employeeFilter = {
                companyId: new mongoose.Types.ObjectId(companyId),
                employmentStatus: "active"
            };

            if (department) {
                employeeFilter["jobInfo.department"] = department;
            }

            if (employeeType) {
                employeeFilter.employeeType = employeeType;
            }

            // Get all active employees
            const employees = await Employee.find(employeeFilter)
                .populate("userId", "name email")
                .lean();

            // Get attendance records for date range
            const attendanceRecords = await Attendance.aggregate([
                {
                    $match: {
                        companyId: new mongoose.Types.ObjectId(companyId),
                        employeeId: { $in: employees.map(e => e._id) },
                        date: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: "$employeeId",
                        presentCount: {
                            $sum: {
                                $cond: [
                                    { $in: ["$status", ["present", "half_day", "week_off_half"]] },
                                    1,
                                    0
                                ]
                            }
                        },
                        lateCount: {
                            $sum: {
                                $cond: [{ $gt: ["$lateByMinutes", 0] }, 1, 0]
                            }
                        },
                        totalWorkingMinutes: { $sum: "$workSummary.totalMinutes" },
                        totalLateMinutes: { $sum: "$lateByMinutes" },
                        attendanceRecords: { $push: "$$ROOT" }
                    }
                }
            ]);

            const attendanceMap = new Map();
            attendanceRecords.forEach(record => {
                attendanceMap.set(record._id.toString(), record);
            });

            // Calculate date range stats
            const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

            const employeeStats = [];
            let totalPresent = 0;
            let totalLate = 0;
            let totalPossibleAttendance = 0;

            for (const employee of employees) {
                const stats = attendanceMap.get(employee._id.toString()) || {
                    presentCount: 0,
                    lateCount: 0,
                    totalWorkingMinutes: 0,
                    totalLateMinutes: 0
                };

                const possibleDays = totalDays;
                const attendanceRate = possibleDays > 0
                    ? ((stats.presentCount / possibleDays) * 100).toFixed(2)
                    : 0;

                totalPresent += stats.presentCount;
                totalLate += stats.lateCount;
                totalPossibleAttendance += possibleDays;

                employeeStats.push({
                    employeeId: employee._id,
                    employeeName: employee.user_name || employee.userId?.name,
                    empCode: employee.empCode,
                    department: employee.jobInfo?.department,
                    presentDays: stats.presentCount,
                    lateDays: stats.lateCount,
                    absentDays: possibleDays - stats.presentCount,
                    attendanceRate: parseFloat(attendanceRate),
                    totalWorkingHours: (stats.totalWorkingMinutes / 60).toFixed(2),
                    totalLateHours: (stats.totalLateMinutes / 60).toFixed(2)
                });
            }

            const overallAttendanceRate = totalPossibleAttendance > 0
                ? ((totalPresent / totalPossibleAttendance) * 100).toFixed(2)
                : 0;

            // Prepare pie chart data
            const pieChartData = [
                {
                    name: "Present Days",
                    value: totalPresent,
                    color: "#4CAF50",
                    rate: ((totalPresent / totalPossibleAttendance) * 100).toFixed(2)
                },
                {
                    name: "Absent Days",
                    value: totalPossibleAttendance - totalPresent,
                    color: "#F44336",
                    rate: (((totalPossibleAttendance - totalPresent) / totalPossibleAttendance) * 100).toFixed(2)
                },
                {
                    name: "Late Days",
                    value: totalLate,
                    color: "#FFC107",
                    rate: ((totalLate / totalPossibleAttendance) * 100).toFixed(2)
                }
            ];

            res.status(200).json({
                success: true,
                data: {
                    dateRange: {
                        from: startDate,
                        to: endDate,
                        totalDays
                    },
                    summary: {
                        totalEmployees: employees.length,
                        totalPresentDays: totalPresent,
                        totalAbsentDays: totalPossibleAttendance - totalPresent,
                        totalLateDays: totalLate,
                        overallAttendanceRate: parseFloat(overallAttendanceRate),
                        totalPossibleAttendance
                    },
                    pieChartData,
                    employeeStats: employeeStats.sort((a, b) => b.attendanceRate - a.attendanceRate)
                }
            });

        } catch (error) {
            console.error("Error fetching date range dashboard:", error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get attendance summary by department
     * GET /api/attendance/today/by-department
     */
    async getAttendanceByDepartment(req, res) {
        try {
            const { companyId, date } = req.query;

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    error: "companyId is required"
                });
            }

            // Set date
            let targetDate;
            if (date) {
                targetDate = new Date(date);
                targetDate.setHours(0, 0, 0, 0);
            } else {
                targetDate = new Date();
                targetDate.setHours(0, 0, 0, 0);
            }

            const nextDate = new Date(targetDate);
            nextDate.setDate(nextDate.getDate() + 1);

            // Get all employees grouped by department
            const employeesByDepartment = await Employee.aggregate([
                {
                    $match: {
                        companyId: new mongoose.Types.ObjectId(companyId),
                        employmentStatus: "active"
                    }
                },
                {
                    $group: {
                        _id: "$jobInfo.department",
                        employees: { $push: "$$ROOT" },
                        totalEmployees: { $sum: 1 }
                    }
                }
            ]);

            // Get attendance for target date
            const allEmployeeIds = employeesByDepartment.flatMap(dept =>
                dept.employees.map(emp => emp._id)
            );

            const attendanceRecords = await Attendance.find({
                companyId: new mongoose.Types.ObjectId(companyId),
                employeeId: { $in: allEmployeeIds },
                date: { $gte: targetDate, $lt: nextDate }
            }).lean();

            const attendanceMap = new Map();
            attendanceRecords.forEach(record => {
                attendanceMap.set(record.employeeId.toString(), record);
            });

            // Calculate department-wise stats
            const departmentStats = [];

            for (const dept of employeesByDepartment) {
                const departmentName = dept._id || "Unassigned";
                let present = 0;
                let late = 0;
                let onTime = 0;

                for (const employee of dept.employees) {
                    const attendance = attendanceMap.get(employee._id.toString());
                    if (attendance && (attendance.status === "present" || attendance.status === "half_day" || attendance.status === "week_off_half")) {
                        present++;
                        if (attendance.lateByMinutes > 0) {
                            late++;
                        } else {
                            onTime++;
                        }
                    }
                }

                const attendanceRate = dept.totalEmployees > 0
                    ? ((present / dept.totalEmployees) * 100).toFixed(2)
                    : 0;

                departmentStats.push({
                    department: departmentName,
                    totalEmployees: dept.totalEmployees,
                    present,
                    absent: dept.totalEmployees - present,
                    late,
                    onTime,
                    attendanceRate: parseFloat(attendanceRate)
                });
            }

            // Sort by attendance rate descending
            departmentStats.sort((a, b) => b.attendanceRate - a.attendanceRate);

            res.status(200).json({
                success: true,
                data: {
                    date: targetDate,
                    dateFormatted: targetDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric"
                    }),
                    departments: departmentStats,
                    totalDepartments: departmentStats.length
                }
            });

        } catch (error) {
            console.error("Error fetching attendance by department:", error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Export today's attendance for every active employee, optionally
     * narrowed to one department or employee type.
     * GET /api/today/pi/today/export
     *
     * Query params:
     *   - department (optional)
     *   - date (optional, YYYY-MM-DD, defaults to today in IST)
     *   - employeeType (optional: non_sales, sales, pro_sales)
     *   - companyId (optional, honored only for super_admin / partner)
     */
    async exportTodayAttendance(req, res) {
        try {
            const { department, date, employeeType } = req.query;
            const companyId = resolveExportCompanyId(req);

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    error: "companyId is required"
                });
            }

            if (!mongoose.Types.ObjectId.isValid(companyId)) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid companyId"
                });
            }

            const dayRange = resolveISTDayRange(date);
            if (!dayRange) {
                return res.status(400).json({
                    success: false,
                    error: "date must be in YYYY-MM-DD format"
                });
            }

            const companyObjectId = new mongoose.Types.ObjectId(companyId);

            const employeeFilter = {
                companyId: companyObjectId,
                employmentStatus: "active"
            };

            if (department) {
                employeeFilter["jobInfo.department"] = department;
            }

            if (employeeType) {
                employeeFilter.employeeType = employeeType;
            }

            const [employees, company] = await Promise.all([
                Employee.find(employeeFilter)
                    .populate("userId", "name email")
                    .populate("shift", "shiftName startTime endTime shiftType")
                    .lean(),
                User.findById(companyObjectId).select("name").lean()
            ]);

            if (employees.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "No employees found for the selected filters"
                });
            }

            employees.sort((a, b) => {
                const deptCompare = (a.jobInfo?.department || "").localeCompare(b.jobInfo?.department || "");
                if (deptCompare !== 0) return deptCompare;
                return (a.user_name || a.userId?.name || "").localeCompare(b.user_name || b.userId?.name || "");
            });

            const attendanceRecords = await Attendance.find({
                companyId: companyObjectId,
                employeeId: { $in: employees.map((e) => e._id) },
                date: { $gte: dayRange.start, $lt: dayRange.end }
            }).lean();

            const attendanceMap = new Map();
            attendanceRecords.forEach((record) => {
                attendanceMap.set(String(record.employeeId), record);
            });

            const rows = employees.map((employee, index) => {
                const attendance = attendanceMap.get(String(employee._id));
                const status = resolveTodayStatus(attendance);
                const isWorkingStatus = ["present", "half_day"].includes(attendance?.status);
                const shift = employee.shift;

                return {
                    sno: index + 1,
                    empCode: employee.empCode || "—",
                    name: employee.user_name || employee.userId?.name || "N/A",
                    department: employee.jobInfo?.department || "Unassigned",
                    designation: employee.jobInfo?.designation || "—",
                    shift: shift
                        ? `${shift.shiftName || "Shift"}${shift.startTime && shift.endTime ? ` (${shift.startTime}–${shift.endTime})` : ""}`
                        : "—",
                    status: status.label,
                    statusCode: status.code,
                    punchIn: attendance?.punchIn ? formatTime(attendance.punchIn) : "—",
                    punchOut: attendance?.punchOut ? formatTime(attendance.punchOut) : "—",
                    workingHours: isWorkingStatus ? formatHoursMinutes(resolveWorkedMinutes(attendance)) : "00:00",
                    lateBy: isWorkingStatus ? (attendance?.lateByMinutes || attendance?.workSummary?.lateMinutes || 0) : 0,
                    overtime: isWorkingStatus ? (attendance?.workSummary?.overtimeMinutes || 0) : 0,
                    locationVerified: attendance?.geoLocation?.verified ? "Yes" : "No",
                    remarks: attendance?.remarks || ""
                };
            });

            const summary = rows.reduce(
                (acc, row) => {
                    acc.totalEmployees += 1;

                    switch (row.statusCode) {
                        case "present":
                            acc.present += 1;
                            acc.onTime += 1;
                            break;
                        case "late":
                            acc.present += 1;
                            acc.late += 1;
                            break;
                        case "half_day":
                            acc.present += 1;
                            acc.halfDay += 1;
                            break;
                        case "leave":
                            acc.leave += 1;
                            break;
                        case "holiday":
                            acc.holiday += 1;
                            break;
                        case "week_off":
                        case "week_off_half":
                            acc.weekOff += 1;
                            break;
                        case "comp_off":
                            acc.compOff += 1;
                            break;
                        default:
                            acc.absent += 1;
                    }

                    return acc;
                },
                {
                    totalEmployees: 0,
                    present: 0,
                    absent: 0,
                    late: 0,
                    onTime: 0,
                    halfDay: 0,
                    leave: 0,
                    weekOff: 0,
                    holiday: 0,
                    compOff: 0
                }
            );

            summary.presentRate = summary.totalEmployees > 0
                ? ((summary.present / summary.totalEmployees) * 100).toFixed(2)
                : "0.00";

            const departmentBuckets = new Map();
            rows.forEach((row) => {
                if (!departmentBuckets.has(row.department)) {
                    departmentBuckets.set(row.department, {
                        department: row.department,
                        total: 0,
                        present: 0,
                        absent: 0,
                        late: 0,
                        onTime: 0
                    });
                }

                const bucket = departmentBuckets.get(row.department);
                bucket.total += 1;

                if (["present", "late", "half_day"].includes(row.statusCode)) {
                    bucket.present += 1;
                    if (row.lateBy > 0) bucket.late += 1;
                    else bucket.onTime += 1;
                } else {
                    bucket.absent += 1;
                }
            });

            const departmentStats = [...departmentBuckets.values()]
                .map((bucket) => ({
                    ...bucket,
                    presentRate: bucket.total > 0
                        ? Number(((bucket.present / bucket.total) * 100).toFixed(2))
                        : 0
                }))
                .sort((a, b) => a.department.localeCompare(b.department));

            const workbook = buildTodayAttendanceWorkbook({
                companyName: company?.name || "Company",
                department: department || "",
                dateKey: dayRange.dateKey,
                rows,
                summary,
                departmentStats,
                generatedBy: req.user?.name || req.user?.email || ""
            });

            const safeDepartment = department
                ? `_${String(department).replace(/[^a-z0-9]+/gi, "_")}`
                : "";
            const filename = `attendance_today${safeDepartment}_${dayRange.dateKey}.xlsx`;

            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
            await workbook.xlsx.write(res);
            return res.end();

        } catch (error) {
            console.error("Error exporting today's attendance:", error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get list of departments for filter dropdown
     * GET /api/attendance/today/departments
     */
    async getDepartmentList(req, res) {
        try {
            const { companyId } = req.query;

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    error: "companyId is required"
                });
            }

            // Get distinct departments for the company
            const departments = await Employee.distinct("jobInfo.department", {
                companyId: new mongoose.Types.ObjectId(companyId),
                employmentStatus: "active"
            });

            // Format for dropdown - filter out empty/undefined and sort
            const formattedDepartments = departments
                .filter(dept => dept && dept.trim())
                .sort();

            res.status(200).json({
                success: true,
                data: formattedDepartments
            });

        } catch (error) {
            console.error("Error fetching department list:", error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

export default new TodayAttendanceController();