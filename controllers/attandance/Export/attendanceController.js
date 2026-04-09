import Attendance from "../../../models/Attandance/Attendance.js";
import Employee from "../../../models/Attandance/Employee.js";
import mongoose from "mongoose";
import { Parser } from "json2csv";
import ExcelJS from "exceljs";


/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */

/** "HH:MM" string → total minutes since midnight */
const timeStrToMinutes = (timeStr = "00:00") => {
    const [h, m] = timeStr.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
};

// /** Date object → "HH:MM" */
// const formatTime = (date) => {
//     if (!date) return "N/A";
//     return new Date(date).toLocaleTimeString("en-IN", {
//         hour: "2-digit",
//         minute: "2-digit",
//         hour12: false,
//     });
// };

/** minutes → "H:MM" */
const formatMinutes = (mins = 0) => {
    const h = Math.floor(Math.abs(mins) / 60);
    const m = Math.abs(mins) % 60;
    return `${h}:${String(m).padStart(2, "0")}`;
};

/** minutes → decimal hours rounded to 2dp  e.g. 90 → "1.50" */
const minutesToHours = (mins = 0) =>
    (Math.abs(mins) / 60).toFixed(2);

/**
 * Determine Late / Early-leave status given shift & punch times.
 * Returns array of status tags that will be appended to the main status.
 */
const getLateEarlyTags = (shiftStart, shiftEnd, punchIn, punchOut, graceIn = 10, graceOut = 10) => {
    const tags = [];
    if (punchIn) {
        const inMins = timeStrToMinutes(formatTime(punchIn));
        const shiftInMins = timeStrToMinutes(shiftStart);
        if (inMins - shiftInMins > graceIn) tags.push("Late");
    }
    if (punchOut) {
        const outMins = timeStrToMinutes(formatTime(punchOut));
        const shiftOutMins = timeStrToMinutes(shiftEnd);
        if (shiftOutMins - outMins > graceOut) tags.push("Early Leave");
    }
    return tags;
};

/** Sum all break durations in minutes */
const totalBreakMinutes = (breaks = []) =>
    breaks.reduce((acc, b) => {
        if (b.start && b.end)
            acc += Math.round((new Date(b.end) - new Date(b.start)) / 60000);
        return acc;
    }, 0);


/* ─────────────────────────────────────────────
   MAIN EXPORT HANDLER
───────────────────────────────────────────── */

export const generateAttendanceCSV = async (req, res) => {
    try {
        const { startDate, endDate, department, employeeCode, format = "xlsx" } = req.query;

        // ── Resolve companyId ──────────────────────────────────────────
        let companyId = req.user._id || req.user?.id;
        const role = req.user?.role || req.user?.type;
        if (role === "user") companyId = req.user?.companyId;

        if (!companyId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: "companyId, startDate, and endDate are required",
            });
        }

        // ── Date range ─────────────────────────────────────────────────
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // ── Employee filter ────────────────────────────────────────────
        const empFilter = { companyId, employmentStatus: "active" };
        if (department) empFilter["jobInfo.department"] = department;
        if (employeeCode) empFilter.empCode = employeeCode;

        const employees = await Employee.find(empFilter).populate("shift").lean();
        if (!employees.length) {
            return res.status(404).json({ success: false, message: "No employees found" });
        }

        // ── Attendance records ─────────────────────────────────────────
        const attendanceRecords = await Attendance.find({
            companyId,
            employeeId: { $in: employees.map((e) => e._id) },
            date: { $gte: start, $lte: end },
        }).lean();

        const attendanceMap = new Map();
        attendanceRecords.forEach((r) => {
            const key = `${r.employeeId}_${r.date.toISOString().split("T")[0]}`;
            attendanceMap.set(key, r);
        });

        // ── Build date list ────────────────────────────────────────────
        const dateRange = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            dateRange.push(new Date(d));
        }

        // ── Build rows ─────────────────────────────────────────────────
        const rows = [];

        for (const emp of employees) {
            const weeklyOffDays = emp.weeklyOff?.length ? emp.weeklyOff : ["Sunday"];

            // Shift — fallback to 09:00 – 18:00
            const shiftStart = emp.shift?.startTime || "09:00";
            const shiftEnd = emp.shift?.endTime || "18:00";
            const shiftName = emp.shift?.shiftName || "Default (09:00–18:00)";
            const graceIn = emp.shift?.gracePeriod?.lateEntry ?? 10;
            const graceOut = emp.shift?.gracePeriod?.earlyExit ?? 10;

            for (const date of dateRange) {
                const dateKey = date.toISOString().split("T")[0];
                const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long" });
                const attendance = attendanceMap.get(`${emp._id}_${dateKey}`);
                const isWeeklyOff = weeklyOffDays.includes(dayOfWeek);

                // ── Defaults ───────────────────────────────────────────
                let punchInTime = "";
                let punchOutTime = "";
                let totalHours = "0.00";
                let overtimeMinutes = 0;
                let lateMinutes = 0;
                let earlyLeaveMinutes = 0;
                let breakMinutes = 0;
                let statusLabel = "";
                let locationVerified = "No";
                let remarks = "";
                let autoMarked = "No";
                let suspicious = "No";

                if (isWeeklyOff) {
                    // ── Weekly Off ─────────────────────────────────────
                    punchInTime = "—";
                    punchOutTime = "—";
                    statusLabel = "Week Off";

                } else if (!attendance) {
                    // ── Absent (no record) ─────────────────────────────
                    punchInTime = "—";
                    punchOutTime = "—";
                    statusLabel = "Absent";

                } else {
                    // ── Record exists ──────────────────────────────────
                    punchInTime = attendance.punchIn ? formatTime(attendance.punchIn) : "—";
                    punchOutTime = attendance.punchOut ? formatTime(attendance.punchOut) : "—";
                    totalHours = minutesToHours(attendance.workSummary?.totalMinutes || 0);
                    overtimeMinutes = attendance.workSummary?.overtimeMinutes || 0;
                    lateMinutes = attendance.workSummary?.lateMinutes || 0;
                    earlyLeaveMinutes = attendance.workSummary?.earlyLeaveMinutes || 0;
                    breakMinutes = totalBreakMinutes(attendance.breaks);
                    locationVerified = attendance.geoLocation?.verified ? "Yes" : "No";
                    remarks = attendance.remarks || "";
                    autoMarked = attendance.isAutoMarked ? "Yes" : "No";
                    suspicious = attendance.isSuspicious ? "Yes" : "No";

                    // ── Recalculate late/early if workSummary is 0 ─────
                    if (lateMinutes === 0 && earlyLeaveMinutes === 0 && attendance.punchIn) {
                        const inMins = timeStrToMinutes(formatTime(attendance.punchIn));
                        const shiftInMins = timeStrToMinutes(shiftStart);
                        if (inMins - shiftInMins > graceIn) lateMinutes = inMins - shiftInMins;

                        if (attendance.punchOut) {
                            const outMins = timeStrToMinutes(formatTime(attendance.punchOut));
                            const shiftOutMins = timeStrToMinutes(shiftEnd);
                            if (shiftOutMins - outMins > graceOut) earlyLeaveMinutes = shiftOutMins - outMins;
                        }
                    }

                    // ── Status label ───────────────────────────────────
                    switch (attendance.status) {
                        case "leave":
                            statusLabel = "Leave";
                            punchInTime = "—";
                            punchOutTime = "—";
                            totalHours = "0.00";
                            break;
                        case "half_day":
                            statusLabel = "Half Day";
                            break;
                        case "holiday":
                            statusLabel = "Holiday";
                            punchInTime = "—";
                            punchOutTime = "—";
                            totalHours = "0.00";
                            break;
                        case "week_off":
                            statusLabel = "Week Off";
                            break;
                        case "absent":
                            statusLabel = "Absent";
                            break;
                        case "present":
                        default: {
                            const tags = getLateEarlyTags(
                                shiftStart, shiftEnd,
                                attendance.punchIn, attendance.punchOut,
                                graceIn, graceOut
                            );
                            statusLabel = tags.length ? tags.join(" + ") : "Present";
                            break;
                        }
                    }
                }

                rows.push({
                    "Emp Code": emp.empCode || "—",
                    "Emp Name": emp.user_name || "N/A",
                    "Department": emp.jobInfo?.department || "N/A",
                    "Shift": shiftName,
                    "Date": dateKey,
                    "Day": dayOfWeek,
                    "Punch In": punchInTime,
                    "Punch Out": punchOutTime,
                    "Total Hours": totalHours,
                    "Overtime (min)": overtimeMinutes,
                    "Late (min)": lateMinutes,
                    "Early Leave (min)": earlyLeaveMinutes,
                    "Break (min)": breakMinutes,
                    "Status": statusLabel,
                    "Location Verified": locationVerified,
                    "Remarks": remarks,
                    "Auto Marked": autoMarked,
                    "Suspicious": suspicious,
                });
            }
        }

        /* ─────────────────────────────────────────────
           OUTPUT: XLSX  (default)
        ───────────────────────────────────────────── */
        if (format !== "csv") {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = "HR System";
            workbook.created = new Date();

            const sheet = workbook.addWorksheet("Attendance Report", {
                views: [{ state: "frozen", ySplit: 1 }],
            });

            // ── Column definitions ────────────────────────────────────
            sheet.columns = [
                { header: "Emp Code", key: "Emp Code", width: 12 },
                { header: "Emp Name", key: "Emp Name", width: 22 },
                { header: "Department", key: "Department", width: 18 },
                { header: "Shift", key: "Shift", width: 22 },
                { header: "Date", key: "Date", width: 14 },
                { header: "Day", key: "Day", width: 12 },
                { header: "Punch In", key: "Punch In", width: 12 },
                { header: "Punch Out", key: "Punch Out", width: 12 },
                { header: "Total Hours", key: "Total Hours", width: 14 },
                { header: "Overtime (min)", key: "Overtime (min)", width: 15 },
                { header: "Late (min)", key: "Late (min)", width: 12 },
                { header: "Early Leave (min)", key: "Early Leave (min)", width: 18 },
                { header: "Break (min)", key: "Break (min)", width: 13 },
                { header: "Status", key: "Status", width: 16 },
                { header: "Location Verified", key: "Location Verified", width: 18 },
                { header: "Remarks", key: "Remarks", width: 25 },
                { header: "Auto Marked", key: "Auto Marked", width: 13 },
                { header: "Suspicious", key: "Suspicious", width: 13 },
            ];

            // ── Header row styling ────────────────────────────────────
            const headerRow = sheet.getRow(1);
            headerRow.eachCell((cell) => {
                cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
                cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
                cell.border = {
                    bottom: { style: "thin", color: { argb: "FFAAAAAA" } },
                };
            });
            headerRow.height = 20;

            // ── Status colour map ─────────────────────────────────────
            const STATUS_COLORS = {
                "Present": "FFD9EAD3",   // light green
                "Late": "FFFFF2CC",   // light yellow
                "Late + Early Leave": "FFFCE5CD", // orange-ish
                "Early Leave": "FFFCE5CD",
                "Half Day": "FFFFE599",
                "Absent": "FFFFC7CE",   // light red
                "Leave": "FFD9D2E9",   // lavender
                "Week Off": "FFD0E4F7",   // light blue
                "Holiday": "FFD9EAD3",
            };

            // ── Data rows ─────────────────────────────────────────────
            rows.forEach((r, idx) => {
                const row = sheet.addRow(r);
                row.height = 16;
                row.font = { name: "Arial", size: 9 };

                // Alternating row background
                const baseFill = idx % 2 === 0 ? "FFF9FAFB" : "FFFFFFFF";

                row.eachCell({ includeEmpty: true }, (cell) => {
                    cell.alignment = { horizontal: "center", vertical: "middle" };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: baseFill } };
                });

                // Status cell colour override
                const statusCell = row.getCell("Status");
                const bgColor = STATUS_COLORS[r["Status"]] || baseFill;
                statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
                statusCell.font = { name: "Arial", size: 9, bold: true };

                // Highlight suspicious rows in red font
                if (r["Suspicious"] === "Yes") {
                    row.eachCell((cell) => {
                        cell.font = { ...cell.font, color: { argb: "FF9C0006" } };
                    });
                }
            });

            // ── Auto-filter ───────────────────────────────────────────
            sheet.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: sheet.columns.length },
            };

            // ── Summary sheet ─────────────────────────────────────────
            const summary = workbook.addWorksheet("Summary");
            summary.columns = [
                { header: "Status", key: "status", width: 20 },
                { header: "Count", key: "count", width: 10 },
                { header: "% of Total", key: "pct", width: 14 },
            ];

            const summaryHeaderRow = summary.getRow(1);
            summaryHeaderRow.eachCell((cell) => {
                cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
                cell.alignment = { horizontal: "center" };
            });

            const statusCounts = rows.reduce((acc, r) => {
                const s = r["Status"] || "Unknown";
                acc[s] = (acc[s] || 0) + 1;
                return acc;
            }, {});
            const total = rows.length;
            Object.entries(statusCounts).forEach(([status, count]) => {
                summary.addRow({
                    status,
                    count,
                    pct: `${((count / total) * 100).toFixed(1)}%`,
                });
            });
            summary.addRow({});
            summary.addRow({ status: "Total Records", count: total, pct: "100%" });

            // ── Send response ─────────────────────────────────────────
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename=attendance_${startDate}_to_${endDate}.xlsx`
            );
            await workbook.xlsx.write(res);
            return res.end();
        }

        /* ─────────────────────────────────────────────
           OUTPUT: CSV  (format=csv)
        ───────────────────────────────────────────── */
        const fields = [
            "Emp Code", "Emp Name", "Department", "Shift",
            "Date", "Day", "Punch In", "Punch Out",
            "Total Hours", "Overtime (min)", "Late (min)", "Early Leave (min)", "Break (min)",
            "Status", "Location Verified", "Remarks", "Auto Marked", "Suspicious",
        ];
        const parser = new Parser({ fields });
        const csv = parser.parse(rows);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=attendance_${startDate}_to_${endDate}.csv`
        );
        return res.status(200).send(csv);

    } catch (error) {
        console.error("Error generating attendance report:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to generate attendance report",
            error: error.message,
        });
    }
};
/**
 * Alternative method to generate CSV in the exact matrix format with dates as headers
 */
export const generateAttendanceMatrixCSV = async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            department,
            employeeCode
        } = req.query;
        let companyId;
        companyId = req.user._id || req.user?.id;
        const role = req.user?.role || req.user?.type;
        if (role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }

        // Validate required fields
        if (!companyId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: "companyId, startDate, and endDate are required"
            });
        }

        // Parse dates
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Build employee filter
        const employeeFilter = { companyId, employmentStatus: "active" };
        if (department) employeeFilter["jobInfo.department"] = department;
        if (employeeCode) employeeFilter.empCode = employeeCode;

        // Fetch employees
        const employees = await Employee.find(employeeFilter)
            .populate("shift")
            .lean();

        if (!employees.length) {
            return res.status(404).json({
                success: false,
                message: "No employees found"
            });
        }

        // Fetch attendance records
        const attendanceRecords = await Attendance.find({
            companyId,
            employeeId: { $in: employees.map(emp => emp._id) },
            date: { $gte: start, $lte: end }
        }).lean();

        // Create attendance map
        const attendanceMap = new Map();
        attendanceRecords.forEach(record => {
            const key = `${record.employeeId}_${record.date.toISOString().split('T')[0]}`;
            attendanceMap.set(key, record);
        });

        // Get all dates in range
        const dateRange = [];
        let currentDate = new Date(start);
        while (currentDate <= end) {
            dateRange.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Prepare matrix data
        const matrixData = [];

        for (const employee of employees) {
            const weeklyOffDays = employee.weeklyOff || ["Sunday"];
            const row = {
                "Emp Code": employee.empCode,
                "Emp Name": employee.user_name || employee.userId?.name || "N/A",
                "Department": employee.jobInfo?.department || "N/A"
            };

            // Add data for each date
            for (const date of dateRange) {
                const dateKey = date.toISOString().split('T')[0];
                const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
                const attendanceKey = `${employee._id}_${dateKey}`;
                const attendance = attendanceMap.get(attendanceKey);
                const isWeeklyOff = weeklyOffDays.includes(dayOfWeek);

                let punchInTime = "";
                let punchOutTime = "";
                let workingHours = "";
                let status = "";

                if (isWeeklyOff) {
                    punchInTime = "Weekly Off";
                    punchOutTime = "Weekly Off";
                    workingHours = "0:00";
                    status = "Week Off";
                }
                else if (attendance) {
                    switch (attendance.status) {
                        case "leave":
                            punchInTime = attendance.remarks || "Leave";
                            punchOutTime = attendance.remarks || "Leave";
                            workingHours = "0:00";
                            status = "Leave";
                            break;
                        case "half_day":
                            punchInTime = attendance.punchIn ? formatTime(attendance.punchIn) : "N/A";
                            punchOutTime = attendance.punchOut ? formatTime(attendance.punchOut) : "N/A";
                            workingHours = formatWorkingHours(attendance.workSummary?.totalMinutes || 0);
                            status = "Half Day";
                            break;
                        default:
                            punchInTime = attendance.punchIn ? formatTime(attendance.punchIn) : "N/A";
                            punchOutTime = attendance.punchOut ? formatTime(attendance.punchOut) : "N/A";
                            workingHours = formatWorkingHours(attendance.workSummary?.totalMinutes || 0);
                            status = attendance.status === "present" ? "Present" : "Present";
                    }
                }
                else {
                    punchInTime = "Absent";
                    punchOutTime = "Absent";
                    workingHours = "0:00";
                    status = "Absent";
                }

                // Add combined data for the date
                row[dateKey] = `${punchInTime}|${punchOutTime}|${workingHours}|${status}`;
            }

            matrixData.push(row);
        }

        // Build CSV headers
        const headers = ["Emp Code", "Emp Name", "Department"];
        dateRange.forEach(date => {
            headers.push(date.toISOString().split('T')[0]);
        });

        // Build CSV rows
        const csvRows = [];
        csvRows.push(headers.join(','));

        for (const row of matrixData) {
            const csvRow = [];
            csvRow.push(`"${row["Emp Code"]}"`);
            csvRow.push(`"${row["Emp Name"]}"`);
            csvRow.push(`"${row["Department"]}"`);

            dateRange.forEach(date => {
                const dateKey = date.toISOString().split('T')[0];
                const value = row[dateKey] || "N/A|N/A|0:00|Absent";
                const [punchIn, punchOut, hours, status] = value.split('|');
                // Format as per your requirement - you can customize this
                csvRow.push(`"${punchIn}"`);
            });

            csvRows.push(csvRow.join(','));
        }

        const csv = csvRows.join('\n');

        // Send response
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_matrix_${startDate}_to_${endDate}.csv`);
        return res.status(200).send(csv);

    } catch (error) {
        console.error("Error generating attendance matrix CSV:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to generate attendance matrix report",
            error: error.message
        });
    }
};

// controllers/attendanceController.js

/**
 * Generate attendance summary report with statistics
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
export const generateAttendanceSummaryCSV = async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            department,
            employeeCode
        } = req.query;
        let companyId;
        companyId = req.user._id || req.user?.id;
        const role = req.user?.role || req.user?.type;
        if (role === 'user') {
            companyId = req.user?.companyId || req.user?.companyId;
        }

        // Validate required fields
        if (!companyId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: "companyId, startDate, and endDate are required"
            });
        }

        // Parse dates
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Build employee filter
        const employeeFilter = { companyId, employmentStatus: "active" };
        if (department) employeeFilter["jobInfo.department"] = department;
        if (employeeCode) employeeFilter.empCode = employeeCode;

        // Fetch employees with their shift and weekly off details
        const employees = await Employee.find(employeeFilter)
            .populate("shift")
            .lean();

        if (!employees.length) {
            return res.status(404).json({
                success: false,
                message: "No employees found"
            });
        }

        // Fetch attendance records for the date range
        const attendanceRecords = await Attendance.find({
            companyId,
            employeeId: { $in: employees.map(emp => emp._id) },
            date: { $gte: start, $lte: end }
        }).lean();

        // Create a map for quick attendance lookup
        const attendanceMap = new Map();
        attendanceRecords.forEach(record => {
            const key = `${record.employeeId}_${record.date.toISOString().split('T')[0]}`;
            attendanceMap.set(key, record);
        });

        // Get all dates in range
        const dateRange = [];
        let currentDate = new Date(start);
        while (currentDate <= end) {
            dateRange.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        const totalWorkingDays = dateRange.length;

        // Prepare summary data
        const summaryData = [];

        for (const employee of employees) {
            // Get employee's weekly off days
            const weeklyOffDays = employee.weeklyOff || ["Sunday"];

            let presentCount = 0;
            let absentCount = 0;
            let leaveCount = 0;
            let weekOffCount = 0;
            let halfDayCount = 0;
            let holidayCount = 0;
            let totalWorkingHours = 0;
            let totalWorkingMinutes = 0;
            let totalOvertimeMinutes = 0;
            let totalLateMinutes = 0;

            // Calculate statistics for each date
            for (const date of dateRange) {
                const dateKey = date.toISOString().split('T')[0];
                const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
                const attendanceKey = `${employee._id}_${dateKey}`;
                const attendance = attendanceMap.get(attendanceKey);
                const isWeeklyOff = weeklyOffDays.includes(dayOfWeek);

                if (isWeeklyOff) {
                    weekOffCount++;
                }
                else if (attendance) {
                    switch (attendance.status) {
                        case "leave":
                            leaveCount++;
                            break;
                        case "half_day":
                            halfDayCount++;
                            presentCount++; // Count half day as present but with reduced hours
                            if (attendance.workSummary?.totalMinutes) {
                                totalWorkingMinutes += attendance.workSummary.totalMinutes;
                                totalWorkingHours += attendance.workSummary.totalMinutes / 60;
                            }
                            if (attendance.workSummary?.overtimeMinutes) {
                                totalOvertimeMinutes += attendance.workSummary.overtimeMinutes;
                            }
                            if (attendance.workSummary?.lateMinutes) {
                                totalLateMinutes += attendance.workSummary.lateMinutes;
                            }
                            break;
                        case "holiday":
                            holidayCount++;
                            break;
                        default: // present
                            presentCount++;
                            if (attendance.workSummary?.totalMinutes) {
                                totalWorkingMinutes += attendance.workSummary.totalMinutes;
                                totalWorkingHours += attendance.workSummary.totalMinutes / 60;
                            }
                            if (attendance.workSummary?.overtimeMinutes) {
                                totalOvertimeMinutes += attendance.workSummary.overtimeMinutes;
                            }
                            if (attendance.workSummary?.lateMinutes) {
                                totalLateMinutes += attendance.workSummary.lateMinutes;
                            }
                            break;
                    }
                }
                else {
                    absentCount++;
                }
            }

            // Calculate average working hours (only for days actually worked)
            const actualWorkedDays = presentCount + halfDayCount;
            const avgWorkingHours = actualWorkedDays > 0
                ? (totalWorkingMinutes / actualWorkedDays / 60).toFixed(2)
                : 0;

            // Calculate attendance percentage
            const totalPresentableDays = totalWorkingDays - weekOffCount - holidayCount;
            const attendancePercentage = totalPresentableDays > 0
                ? ((presentCount + halfDayCount) / totalPresentableDays * 100).toFixed(2)
                : 0;

            summaryData.push({
                "Emp Code": employee.empCode,
                "Emp Name": employee.user_name || employee.userId?.name || "N/A",
                "Department": employee.jobInfo?.department || "N/A",
                "Designation": employee.jobInfo?.designation || "N/A",
                "Total Working Days": totalWorkingDays,
                "Present": presentCount,
                "Half Day": halfDayCount,
                "Absent": absentCount,
                "Leave": leaveCount,
                "Week Off": weekOffCount,
                "Holiday": holidayCount,
                "Total Working Hours": totalWorkingHours.toFixed(2),
                "Average Working Hours": avgWorkingHours,
                "Total Overtime (Hours)": (totalOvertimeMinutes / 60).toFixed(2),
                "Total Late (Minutes)": totalLateMinutes,
                "Attendance Percentage": `${attendancePercentage}%`
            });
        }

        // Define CSV fields in exact order
        const fields = [
            "Emp Code",
            "Emp Name",
            "Department",
            "Designation",
            "Total Working Days",
            "Present",
            "Half Day",
            "Absent",
            "Leave",
            "Week Off",
            "Holiday",
            "Total Working Hours",
            "Average Working Hours",
            "Total Overtime (Hours)",
            "Total Late (Minutes)",
            "Attendance Percentage"
        ];

        // Create CSV parser
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(summaryData);

        // Set response headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_summary_${startDate}_to_${endDate}.csv`);

        // Send CSV
        return res.status(200).send(csv);

    } catch (error) {
        console.error("Error generating attendance summary CSV:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to generate attendance summary report",
            error: error.message
        });
    }
};

// Helper function to format time from Date object
function formatTime(date) {
    if (!date) return "N/A";
    const d = new Date(date);
    return d.toTimeString().split(' ')[0];
}

// Helper function to format working hours
function formatWorkingHours(minutes) {
    if (!minutes || minutes === 0) return "0:00";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
}