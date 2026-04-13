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


/**
* Format minutes:
* < 60  → "X min"
* >= 60 → "X hr : Y min"
*/
export const formatLateTime = (totalMinutes = 0) => {
    if (typeof totalMinutes !== "number" || totalMinutes < 0) {
        return "0 min";
    }

    if (totalMinutes < 60) {
        return `${totalMinutes} min`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return `${hours} hr : ${minutes} min`;
};
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
                const dayOfWeek = date.toLocaleDateString("en-IN", { weekday: "long" });
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
                    lateMinutes = formatLateTime(attendance?.workSummary?.lateMinutes) || 0;
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




const resolveCompanyId = (req) => {
    let id = req.user._id || req.user?.id;
    if ((req.user?.role || req.user?.type) === "user") id = req.user?.companyId;
    return id;
};

const buildDateRange = (start, end) => {
    const dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1))
        dates.push(new Date(d));
    return dates;
};

const buildAttendanceMap = (records) => {
    const map = new Map();
    records.forEach((r) => {
        map.set(`${r.employeeId}_${r.date.toISOString().split("T")[0]}`, r);
    });
    return map;
};

/** Returns { code, label, punchIn, punchOut, hours } for one day */
const resolveDayStatus = (attendance, isWeeklyOff, shiftStart = "09:00", shiftEnd = "18:00", graceIn = 10, graceOut = 10) => {
    if (isWeeklyOff) return { code: "WO", label: "Week Off", punchIn: "—", punchOut: "—", hours: "0.00" };
    if (!attendance) return { code: "A", label: "Absent", punchIn: "—", punchOut: "—", hours: "0.00" };

    const pi = formatTime(attendance.punchIn);
    const po = formatTime(attendance.punchOut);
    const hrs = ((attendance.workSummary?.totalMinutes || 0) / 60).toFixed(2);

    switch (attendance.status) {
        case "leave": return { code: "L", label: "Leave", punchIn: "—", punchOut: "—", hours: "0.00" };
        case "holiday": return { code: "H", label: "Holiday", punchIn: "—", punchOut: "—", hours: "0.00" };
        case "week_off": return { code: "WO", label: "Week Off", punchIn: "—", punchOut: "—", hours: "0.00" };
        case "half_day": return { code: "HD", label: "Half Day", punchIn: pi || "—", punchOut: po || "—", hours: hrs };
        case "absent": return { code: "A", label: "Absent", punchIn: "—", punchOut: "—", hours: "0.00" };
        default: {
            // Present – detect late / early leave
            let tag = "P";
            if (pi) {
                const inMin = timeStrToMinutes(pi);
                if (inMin - timeStrToMinutes(shiftStart) > graceIn) tag = "PL"; // Present Late
            }
            if (po) {
                const outMin = timeStrToMinutes(po);
                const shiftOut = timeStrToMinutes(shiftEnd);
                if (shiftOut - outMin > graceOut) tag = tag === "PL" ? "PLE" : "PE"; // Early Exit
            }
            const labels = { P: "Present", PL: "Late", PE: "Early Exit", PLE: "Late+Early" };
            return { code: tag, label: labels[tag] || "Present", punchIn: pi || "—", punchOut: po || "—", hours: hrs };
        }
    }
};

/* Status colour palette */
const STATUS_FILL = {
    P: "FFD9EAD3", // green
    PL: "FFFFFF99", // yellow
    PE: "FFFCE5CD", // orange
    PLE: "FFFFD966", // amber
    HD: "FFFFE599", // light yellow
    A: "FFFFC7CE", // red
    L: "FFD9D2E9", // lavender
    WO: "FFD0E4F7", // blue
    H: "FFB7E1CD", // teal-green
};
const STATUS_FONT = {
    A: "FF9C0006", L: "FF6A0DAD", WO: "FF1155CC", H: "FF137333",
    PL: "FF7D6608", PE: "FF7D4604", PLE: "FF7D4604",
};

const HEADER_BG = "FF1F3864"; // dark navy
const SUBHEAD_BG = "FF2F5496"; // medium blue
const ALT_ROW_BG = "FFF2F6FC";

/* ─────────────────────────────────────────
   MATRIX EXPORT
   One row per employee, dates as columns.
   Each cell shows: IN / OUT / HRS / CODE
───────────────────────────────────────── */

export const generateAttendanceMatrixCSV = async (req, res) => {
    try {
        const { startDate, endDate, department, employeeCode } = req.query;
        const companyId = resolveCompanyId(req);

        if (!companyId || !startDate || !endDate)
            return res.status(400).json({ success: false, message: "companyId, startDate, and endDate are required" });

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        const empFilter = { companyId, employmentStatus: "active" };
        if (department) empFilter["jobInfo.department"] = department;
        if (employeeCode) empFilter.empCode = employeeCode;

        const employees = await Employee.find(empFilter).populate("shift").lean();
        if (!employees.length)
            return res.status(404).json({ success: false, message: "No employees found" });

        const attendanceRecords = await Attendance.find({
            companyId,
            employeeId: { $in: employees.map((e) => e._id) },
            date: { $gte: start, $lte: end },
        }).lean();

        const attMap = buildAttendanceMap(attendanceRecords);
        const dateRange = buildDateRange(start, end);

        /* ── Workbook ── */
        const wb = new ExcelJS.Workbook();
        wb.creator = "HR System";
        wb.created = new Date();

        /* ══════════════════════════════
           SHEET 1 – MATRIX (PIVOT)
        ══════════════════════════════ */
        const ws = wb.addWorksheet("Attendance Matrix", {
            views: [{ state: "frozen", xSplit: 4, ySplit: 3 }],
        });

        // ── Row 1: Title ──
        ws.mergeCells(1, 1, 1, 4 + dateRange.length);
        const titleCell = ws.getCell(1, 1);
        titleCell.value = `ATTENDANCE MATRIX REPORT  |  ${startDate}  to  ${endDate}`;
        titleCell.font = { name: "Arial", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
        titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
        titleCell.alignment = { horizontal: "center", vertical: "middle" };
        ws.getRow(1).height = 28;

        // ── Row 2: Date sub-headers ──
        const dateRow = ws.getRow(2);
        ["#", "Emp Code", "Emp Name", "Department"].forEach((h, i) => {
            const c = dateRow.getCell(i + 1);
            c.value = h;
            c.font = { name: "Arial", bold: true, size: 9, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_BG } };
            c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        });
        dateRange.forEach((date, i) => {
            const c = dateRow.getCell(5 + i);
            const day = date.toLocaleDateString("en-IN", { weekday: "short" });
            const dd = date.getDate().toString().padStart(2, "0");
            const mon = date.toLocaleDateString("en-IN", { month: "short" });
            c.value = `${dd}\n${mon}\n${day}`;
            c.font = { name: "Arial", bold: true, size: 8, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_BG } };
            c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        });
        dateRow.height = 40;

        // ── Row 3: Legend ──
        const legendRow = ws.getRow(3);
        const legends = [
            { code: "P", label: "Present" }, { code: "PL", label: "Late" },
            { code: "PE", label: "Early Exit" }, { code: "HD", label: "Half Day" },
            { code: "A", label: "Absent" }, { code: "L", label: "Leave" },
            { code: "WO", label: "Week Off" }, { code: "H", label: "Holiday" },
        ];
        legendRow.getCell(1).value = "LEGEND →";
        legendRow.getCell(1).font = { name: "Arial", bold: true, size: 8 };
        legendRow.getCell(1).alignment = { horizontal: "center" };
        legends.forEach((lg, i) => {
            const c = legendRow.getCell(2 + i);
            c.value = `${lg.code} = ${lg.label}`;
            c.font = { name: "Arial", size: 8, bold: true, color: { argb: STATUS_FONT[lg.code] || "FF000000" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL[lg.code] || "FFFFFFFF" } };
            c.alignment = { horizontal: "center", vertical: "middle" };
        });
        legendRow.height = 16;

        // ── Fixed columns widths ──
        ws.getColumn(1).width = 5;
        ws.getColumn(2).width = 12;
        ws.getColumn(3).width = 22;
        ws.getColumn(4).width = 18;
        dateRange.forEach((_, i) => { ws.getColumn(5 + i).width = 9; });

        // ── Data rows ──
        employees.forEach((emp, empIdx) => {
            const weeklyOff = emp.weeklyOff?.length ? emp.weeklyOff : ["Sunday"];
            const shiftStart = emp.shift?.startTime || "09:00";
            const shiftEnd = emp.shift?.endTime || "18:00";
            const graceIn = emp.shift?.gracePeriod?.lateEntry ?? 10;
            const graceOut = emp.shift?.gracePeriod?.earlyExit ?? 10;

            const dataRow = ws.addRow([]);
            const rowNum = dataRow.number;
            const isAlt = empIdx % 2 === 0;

            dataRow.height = 20;

            // Fixed cells
            const fixedVals = [
                empIdx + 1,
                emp.empCode || "—",
                emp.user_name || "N/A",
                emp.jobInfo?.department || "N/A",
            ];
            fixedVals.forEach((val, ci) => {
                const cell = ws.getCell(rowNum, ci + 1);
                cell.value = val;
                cell.font = { name: "Arial", size: 9, bold: ci <= 1 };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isAlt ? ALT_ROW_BG : "FFFFFFFF" } };
                cell.alignment = { horizontal: ci === 2 ? "left" : "center", vertical: "middle" };
                cell.border = { right: { style: "thin", color: { argb: "FFCCCCCC" } } };
            });

            // Date cells
            dateRange.forEach((date, di) => {
                const dateKey = date.toISOString().split("T")[0];
                const dayName = date.toLocaleDateString("en-IN", { weekday: "long" });
                const att = attMap.get(`${emp._id}_${dateKey}`);
                const isWO = weeklyOff.includes(dayName);

                const { code, label, punchIn, punchOut, hours } = resolveDayStatus(att, isWO, shiftStart, shiftEnd, graceIn, graceOut);

                const cell = ws.getCell(rowNum, 5 + di);
                // Show: code on top, then IN/OUT below
                cell.value = code;
                cell.font = {
                    name: "Arial", size: 9, bold: true,
                    color: { argb: STATUS_FONT[code] || "FF000000" },
                };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL[code] || "FFFFFFFF" } };
                cell.alignment = { horizontal: "center", vertical: "middle" };
                // Add tooltip via comment
                cell.note = {
                    texts: [
                        { font: { bold: true, size: 9 }, text: `${label}\n` },
                        { font: { size: 9 }, text: `In:  ${punchIn}\nOut: ${punchOut}\nHrs: ${hours}` },
                    ],
                };
                cell.border = {
                    top: { style: "hair", color: { argb: "FFCCCCCC" } },
                    left: { style: "hair", color: { argb: "FFCCCCCC" } },
                    bottom: { style: "hair", color: { argb: "FFCCCCCC" } },
                    right: { style: "hair", color: { argb: "FFCCCCCC" } },
                };
            });
        });

        // ── Auto filter row 2 cols 1-4 ──
        ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 4 } };

        /* ══════════════════════════════
           SHEET 2 – DETAIL (punch times)
           Flat list with all details
        ══════════════════════════════ */
        const wsDetail = wb.addWorksheet("Daily Detail");
        wsDetail.views = [{ state: "frozen", ySplit: 2 }];

        wsDetail.mergeCells(1, 1, 1, 12);
        const dTitleCell = wsDetail.getCell(1, 1);
        dTitleCell.value = `DAILY DETAIL  |  ${startDate}  to  ${endDate}`;
        dTitleCell.font = { name: "Arial", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
        dTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
        dTitleCell.alignment = { horizontal: "center", vertical: "middle" };
        wsDetail.getRow(1).height = 24;

        const detailHeaders = ["#", "Emp Code", "Emp Name", "Department", "Shift", "Date", "Day", "Punch In", "Punch Out", "Total Hrs", "Status", "Remarks"];
        const dHeaderRow = wsDetail.getRow(2);
        detailHeaders.forEach((h, i) => {
            const c = dHeaderRow.getCell(i + 1);
            c.value = h;
            c.font = { name: "Arial", bold: true, size: 9, color: { argb: "FFFFFFFF" } };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_BG } };
            c.alignment = { horizontal: "center", vertical: "middle" };
        });
        dHeaderRow.height = 18;

        wsDetail.columns = [
            { width: 5 }, { width: 12 }, { width: 22 }, { width: 18 }, { width: 20 },
            { width: 13 }, { width: 11 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 25 },
        ];

        let detailRowNum = 3;
        let seq = 1;
        for (const emp of employees) {
            const weeklyOff = emp.weeklyOff?.length ? emp.weeklyOff : ["Sunday"];
            const shiftStart = emp.shift?.startTime || "09:00";
            const shiftEnd = emp.shift?.endTime || "18:00";
            const graceIn = emp.shift?.gracePeriod?.lateEntry ?? 10;
            const graceOut = emp.shift?.gracePeriod?.earlyExit ?? 10;
            const shiftName = emp.shift?.shiftName || `Default (${shiftStart}–${shiftEnd})`;

            for (const date of dateRange) {
                const dateKey = date.toISOString().split("T")[0];
                const dayName = date.toLocaleDateString("en-IN", { weekday: "long" });
                const att = attMap.get(`${emp._id}_${dateKey}`);
                const isWO = weeklyOff.includes(dayName);
                const { code, label, punchIn, punchOut, hours } = resolveDayStatus(att, isWO, shiftStart, shiftEnd, graceIn, graceOut);

                const row = wsDetail.getRow(detailRowNum++);
                row.height = 15;
                const isAlt = seq % 2 === 0;
                const vals = [seq++, emp.empCode || "—", emp.user_name || "N/A", emp.jobInfo?.department || "N/A",
                    shiftName, dateKey, dayName.slice(0, 3), punchIn, punchOut, hours, label, att?.remarks || ""];
                vals.forEach((v, i) => {
                    const c = row.getCell(i + 1);
                    c.value = v;
                    c.font = { name: "Arial", size: 9 };
                    c.alignment = { horizontal: i <= 1 || i >= 5 ? "center" : "left", vertical: "middle" };
                    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isAlt ? ALT_ROW_BG : "FFFFFFFF" } };
                });
                // Status cell colour
                const statusCell = row.getCell(11);
                statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL[code] || "FFFFFFFF" } };
                statusCell.font = { name: "Arial", size: 9, bold: true, color: { argb: STATUS_FONT[code] || "FF000000" } };
                statusCell.alignment = { horizontal: "center", vertical: "middle" };
            }
        }
        wsDetail.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 12 } };

        /* ── Send ── */
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=attendance_matrix_${startDate}_to_${endDate}.xlsx`);
        await wb.xlsx.write(res);
        return res.end();

    } catch (err) {
        console.error("Matrix export error:", err);
        return res.status(500).json({ success: false, message: "Failed to generate matrix report", error: err.message });
    }
};



/**
 * Generate attendance summary report with statistics
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */



const ALT_ROW = "FFF2F6FC";

const applyHeader = (cell, value, opts = {}) => {
    cell.value = value;
    cell.font = { name: "Arial", bold: true, size: opts.size || 9, color: { argb: opts.fontColor || "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.bg || SUBHEAD_BG } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
};

const styleDataCell = (cell, value, opts = {}) => {
    cell.value = value;
    cell.font = { name: "Arial", size: opts.size || 9, bold: opts.bold || false, color: { argb: opts.color || "FF000000" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.bg || "FFFFFFFF" } };
    cell.alignment = { horizontal: opts.align || "center", vertical: "middle" };
    if (opts.numFmt) cell.numFmt = opts.numFmt;
};

/* ─────────────────────────────────────────
   SUMMARY + SALARY PIVOT EXPORT
───────────────────────────────────────── */

export const generateAttendanceSummaryCSV = async (req, res) => {
    try {
        const { startDate, endDate, department, employeeCode } = req.query;
        const companyId = resolveCompanyId(req);

        if (!companyId || !startDate || !endDate)
            return res.status(400).json({ success: false, message: "companyId, startDate, and endDate are required" });

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        const empFilter = { companyId, employmentStatus: "active" };
        if (department) empFilter["jobInfo.department"] = department;
        if (employeeCode) empFilter.empCode = employeeCode;

        const employees = await Employee.find(empFilter).populate("shift").lean();
        if (!employees.length)
            return res.status(404).json({ success: false, message: "No employees found" });

        const attRecords = await Attendance.find({
            companyId,
            employeeId: { $in: employees.map((e) => e._id) },
            date: { $gte: start, $lte: end },
        }).lean();

        const attMap = buildAttendanceMap(attRecords);
        const dateRange = buildDateRange(start, end);
        const totalDays = dateRange.length;

        /* ── Calculate per-employee stats ── */
        const summaryRows = employees.map((emp) => {
            const weeklyOff = emp.weeklyOff?.length ? emp.weeklyOff : ["Sunday"];
            const shiftStart = emp.shift?.startTime || "09:00";
            const shiftEnd = emp.shift?.endTime || "18:00";
            const graceIn = emp.shift?.gracePeriod?.lateEntry ?? 10;
            const graceOut = emp.shift?.gracePeriod?.earlyExit ?? 10;

            let present = 0, absent = 0, leave = 0, weekOff = 0, halfDay = 0;
            let holiday = 0, late = 0, earlyExit = 0;
            let totalWorkMin = 0, totalOTMin = 0, totalLateMin = 0, totalBreakMin = 0;

            for (const date of dateRange) {
                const dateKey = date.toISOString().split("T")[0];
                const dayName = date.toLocaleDateString("en-IN", { weekday: "long" });
                const att = attMap.get(`${emp._id}_${dateKey}`);
                const isWO = weeklyOff.includes(dayName);
                const { code } = resolveDayStatus(att, isWO, shiftStart, shiftEnd, graceIn, graceOut);

                switch (code) {
                    case "WO": weekOff++; break;
                    case "A": absent++; break;
                    case "L": leave++; break;
                    case "H": holiday++; break;
                    case "HD":
                        halfDay++;
                        present++;
                        if (att) {
                            totalWorkMin += att.workSummary?.totalMinutes || 0;
                            totalOTMin += att.workSummary?.overtimeMinutes || 0;
                            totalLateMin += att.workSummary?.lateMinutes || 0;
                        }
                        break;
                    default: // P, PL, PE, PLE
                        present++;
                        if (code === "PL" || code === "PLE") late++;
                        if (code === "PE" || code === "PLE") earlyExit++;
                        if (att) {
                            totalWorkMin += att.workSummary?.totalMinutes || 0;
                            totalOTMin += att.workSummary?.overtimeMinutes || 0;
                            totalLateMin += att.workSummary?.lateMinutes || 0;
                            // sum breaks
                            (att.breaks || []).forEach((b) => {
                                if (b.start && b.end)
                                    totalBreakMin += Math.round((new Date(b.end) - new Date(b.start)) / 60000);
                            });
                        }
                }
            }

            const presentableDays = totalDays - weekOff - holiday;
            const attPct = presentableDays > 0 ? ((present / presentableDays) * 100) : 0;
            const avgHrs = present > 0 ? (totalWorkMin / present / 60) : 0;

            // Salary calc inputs
            const perDay = emp.salaryStructure?.perDay || 0;
            const perHour = emp.salaryStructure?.perHour || 0;
            const otRate = emp.salaryStructure?.overtimeRate || (perHour * 1.5);

            // Payable days = present + halfDay * 0.5
            const payableDays = present - halfDay + halfDay * 0.5;
            const earnedSalary = payableDays * perDay;
            const overtimeEarning = (totalOTMin / 60) * otRate;
            const deductionAbsent = absent * perDay;
            const deductionLate = totalLateMin > 0 ? ((totalLateMin / 60) * perHour) : 0;
            const netPayable = earnedSalary + overtimeEarning - deductionAbsent - deductionLate;

            return {
                empCode: emp.empCode || "—",
                empName: emp.user_name || "N/A",
                department: emp.jobInfo?.department || "N/A",
                designation: emp.jobInfo?.designation || "N/A",
                shift: emp.shift?.shiftName || `${shiftStart}–${shiftEnd}`,

                totalDays,
                weekOff,
                holiday,
                presentableDays,
                present,
                halfDay,
                absent,
                leave,
                late,
                earlyExit,

                totalWorkHrs: parseFloat((totalWorkMin / 60).toFixed(2)),
                avgWorkHrs: parseFloat(avgHrs.toFixed(2)),
                totalOTHrs: parseFloat((totalOTMin / 60).toFixed(2)),
                totalLateMin,
                totalBreakMin,
                attPct: parseFloat(attPct.toFixed(2)),

                perDay,
                perHour,
                otRate,
                payableDays: parseFloat(payableDays.toFixed(2)),
                earnedSalary: parseFloat(earnedSalary.toFixed(2)),
                otEarning: parseFloat(overtimeEarning.toFixed(2)),
                deductAbsent: parseFloat(deductionAbsent.toFixed(2)),
                deductLate: parseFloat(deductionLate.toFixed(2)),
                netPayable: parseFloat(netPayable.toFixed(2)),
            };
        });

        /* ══════════════════════════════
           WORKBOOK
        ══════════════════════════════ */
        const wb = new ExcelJS.Workbook();
        wb.creator = "HR System";

        /* ──────────────────────────────
           SHEET 1 — ATTENDANCE SUMMARY
        ────────────────────────────── */
        const wsSummary = wb.addWorksheet("Attendance Summary", {
            views: [{ state: "frozen", ySplit: 3 }],
        });

        // Title row
        const sCols = 20;
        wsSummary.mergeCells(1, 1, 1, sCols);
        const sTitleCell = wsSummary.getCell(1, 1);
        sTitleCell.value = `ATTENDANCE SUMMARY REPORT  |  ${startDate}  to  ${endDate}`;
        sTitleCell.font = { name: "Arial", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
        sTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
        sTitleCell.alignment = { horizontal: "center", vertical: "middle" };
        wsSummary.getRow(1).height = 28;

        // Group headers row 2
        const grpRow = wsSummary.getRow(2);
        const groups = [
            { label: "EMPLOYEE INFO", start: 1, span: 5 },
            { label: "DATE BREAKDOWN", start: 6, span: 7 },
            { label: "HOURS", start: 13, span: 5 },
            { label: "ATTENDANCE", start: 18, span: 2 },
            { label: "EXTRA", start: 20, span: 1 },
        ];
        groups.forEach(({ label, start, span }) => {
            if (span > 1) wsSummary.mergeCells(2, start, 2, start + span - 1);
            applyHeader(wsSummary.getCell(2, start), label, { bg: "FF243F60", size: 9 });
        });
        grpRow.height = 16;

        // Column sub-headers row 3
        const sHeaders = [
            "#", "Emp Code", "Emp Name", "Department", "Designation",
            "Total Days", "Week Off", "Holiday", "Present", "Half Day", "Absent", "Leave", "Late Days",
            "Total Hrs", "Avg Hrs/Day", "OT Hrs", "Late (min)", "Break (min)",
            "Att %", "Att Grade",
            "Remarks",
        ];
        const sHeaderRow = wsSummary.getRow(3);
        sHeaders.forEach((h, i) => {
            applyHeader(sHeaderRow.getCell(i + 1), h);
        });
        sHeaderRow.height = 18;

        wsSummary.columns = [
            { width: 5 }, { width: 12 }, { width: 22 }, { width: 18 }, { width: 18 },
            { width: 11 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 },
            { width: 11 }, { width: 13 }, { width: 10 }, { width: 11 }, { width: 12 },
            { width: 10 }, { width: 12 },
            { width: 20 },
        ];

        summaryRows.forEach((r, idx) => {
            const row = wsSummary.addRow([]);
            row.height = 16;
            const isAlt = idx % 2 === 0;
            const bg = isAlt ? ALT_ROW : "FFFFFFFF";

            const grade = r.attPct >= 95 ? "Excellent" : r.attPct >= 85 ? "Good" : r.attPct >= 75 ? "Average" : "Poor";
            const gradeColor = r.attPct >= 95 ? "FF137333" : r.attPct >= 85 ? "FF0B5394" : r.attPct >= 75 ? "FF7D4604" : "FF9C0006";
            const gradeBg = r.attPct >= 95 ? "FFB7E1CD" : r.attPct >= 85 ? "FFD0E4F7" : r.attPct >= 75 ? "FFFFF2CC" : "FFFFC7CE";

            const vals = [
                idx + 1, r.empCode, r.empName, r.department, r.designation,
                r.totalDays, r.weekOff, r.holiday, r.present, r.halfDay, r.absent, r.leave, r.late,
                r.totalWorkHrs, r.avgWorkHrs, r.totalOTHrs, r.totalLateMin, r.totalBreakMin,
                r.attPct, grade,
                "",
            ];
            vals.forEach((v, i) => {
                const c = row.getCell(i + 1);
                const isNum = typeof v === "number";
                styleDataCell(c, v, {
                    bg,
                    bold: i <= 1,
                    align: i === 2 || i === 3 || i === 4 ? "left" : "center",
                    numFmt: isNum && i >= 13 && i <= 17 ? "0.00" : undefined,
                });
            });

            // Att % cell
            const attCell = row.getCell(19);
            attCell.value = r.attPct / 100;
            attCell.numFmt = "0.0%";
            attCell.font = { name: "Arial", size: 9, bold: true };
            attCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };

            // Grade cell
            const gradeCell = row.getCell(20);
            gradeCell.font = { name: "Arial", size: 9, bold: true, color: { argb: gradeColor } };
            gradeCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: gradeBg } };

            // Absent highlight
            if (r.absent > 0) {
                row.getCell(11).font = { name: "Arial", size: 9, bold: true, color: { argb: "FF9C0006" } };
                row.getCell(11).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
            }
        });

        // Totals row
        const totRow = wsSummary.addRow([]);
        totRow.height = 18;
        const lastDataRow = 3 + summaryRows.length;
        ["Total / Avg", "", "", "", "",
            `=SUM(F4:F${lastDataRow})`, `=SUM(G4:G${lastDataRow})`, `=SUM(H4:H${lastDataRow})`,
            `=SUM(I4:I${lastDataRow})`, `=SUM(J4:J${lastDataRow})`, `=SUM(K4:K${lastDataRow})`,
            `=SUM(L4:L${lastDataRow})`, `=SUM(M4:M${lastDataRow})`,
            `=AVERAGE(N4:N${lastDataRow})`, `=AVERAGE(O4:O${lastDataRow})`,
            `=SUM(P4:P${lastDataRow})`, `=SUM(Q4:Q${lastDataRow})`, `=SUM(R4:R${lastDataRow})`,
            `=AVERAGE(S4:S${lastDataRow})`, "", ""].forEach((v, i) => {
                const c = totRow.getCell(i + 1);
                c.value = v;
                c.font = { name: "Arial", size: 9, bold: true };
                c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
                c.alignment = { horizontal: "center", vertical: "middle" };
                if (i === 18) c.numFmt = "0.0%";
            });

        wsSummary.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: sCols } };

        /* ──────────────────────────────
           SHEET 2 — SALARY PIVOT
        ────────────────────────────── */
        const wsSalary = wb.addWorksheet("Salary Pivot");
        wsSalary.views = [{ state: "frozen", ySplit: 3 }];

        wsSalary.mergeCells(1, 1, 1, 16);
        const salTitleCell = wsSalary.getCell(1, 1);
        salTitleCell.value = `SALARY CALCULATION PIVOT  |  ${startDate}  to  ${endDate}`;
        salTitleCell.font = { name: "Arial", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
        salTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
        salTitleCell.alignment = { horizontal: "center", vertical: "middle" };
        wsSalary.getRow(1).height = 28;

        // Group header
        const salGrpRow = wsSalary.getRow(2);
        [
            { label: "EMPLOYEE", start: 1, span: 4 },
            { label: "ATTENDANCE INPUT", start: 5, span: 5 },
            { label: "RATE CARD", start: 10, span: 3 },
            { label: "EARNINGS", start: 13, span: 2 },
            { label: "DEDUCTIONS", start: 15, span: 2 },
            { label: "NET", start: 17, span: 1 },
        ].forEach(({ label, start, span }) => {
            if (span > 1) wsSalary.mergeCells(2, start, 2, start + span - 1);
            const bgMap = {
                "EMPLOYEE": "FF243F60", "ATTENDANCE INPUT": "FF274E13",
                "RATE CARD": "FF7F6000", "EARNINGS": "FF1C4587",
                "DEDUCTIONS": "FF4C1130", "NET": "FF20124D",
            };
            applyHeader(wsSalary.getCell(2, start), label, { bg: bgMap[label] || SUBHEAD_BG, size: 9 });
        });
        salGrpRow.height = 16;

        const salHeaders = [
            "#", "Emp Code", "Emp Name", "Department",
            "Total Days", "Payable Days", "Present", "Half Days", "Absent", "OT Hrs",
            "Per Day (₹)", "Per Hour (₹)", "OT Rate (₹/hr)",
            "Earned Salary (₹)", "OT Earning (₹)",
            "Absent Deduct (₹)", "Late Deduct (₹)",
            "Net Payable (₹)",
        ];
        const salHdrRow = wsSalary.getRow(3);
        salHeaders.forEach((h, i) => {
            applyHeader(salHdrRow.getCell(i + 1), h);
        });
        salHdrRow.height = 18;

        wsSalary.columns = [
            { width: 5 }, { width: 12 }, { width: 22 }, { width: 18 },
            { width: 11 }, { width: 13 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 },
            { width: 13 }, { width: 13 }, { width: 15 },
            { width: 18 }, { width: 15 },
            { width: 18 }, { width: 15 },
            { width: 16 },
        ];

        summaryRows.forEach((r, idx) => {
            const row = wsSalary.addRow([]);
            row.height = 16;
            const isAlt = idx % 2 === 0;
            const bg = isAlt ? ALT_ROW : "FFFFFFFF";
            const rn = 3 + idx + 1; // excel row number

            const vals = [
                idx + 1, r.empCode, r.empName, r.department,
                r.totalDays, r.payableDays, r.present, r.halfDay, r.absent, r.totalOTHrs,
                r.perDay, r.perHour, r.otRate,
                r.earnedSalary, r.otEarning,
                r.deductAbsent, r.deductLate,
                r.netPayable,
            ];

            vals.forEach((v, i) => {
                const c = row.getCell(i + 1);
                c.value = v;
                c.font = { name: "Arial", size: 9, bold: i === 17 };
                c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
                c.alignment = { horizontal: i <= 1 || i === 3 ? "center" : i === 2 ? "left" : "right", vertical: "middle" };
                if (i >= 10) c.numFmt = "#,##0.00";
            });

            // Net payable cell – green if > 0, else red
            const netCell = row.getCell(18);
            netCell.font = { name: "Arial", size: 9, bold: true, color: { argb: r.netPayable >= 0 ? "FF137333" : "FF9C0006" } };
            netCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: r.netPayable >= 0 ? "FFB7E1CD" : "FFFFC7CE" } };
            netCell.numFmt = "₹#,##0.00";

            // Deduction cells – red tint
            [16, 17].forEach((col) => {
                const c = row.getCell(col);
                c.font = { name: "Arial", size: 9, color: { argb: "FF9C0006" } };
                c.numFmt = "₹#,##0.00";
            });

            // Earning cells – blue tint
            [14, 15].forEach((col) => {
                const c = row.getCell(col);
                c.font = { name: "Arial", size: 9, color: { argb: "FF1C4587" } };
                c.numFmt = "₹#,##0.00";
            });
        });

        // Salary totals row
        const salLastData = 3 + summaryRows.length;
        const salTotRow = wsSalary.addRow([]);
        salTotRow.height = 20;
        ["TOTALS", "", "", ""].concat(
            [5, 6, 7, 8, 9, 10].map((col) => `=SUM(${String.fromCharCode(64 + col)}4:${String.fromCharCode(64 + col)}${salLastData})`),
            ["", "", ""],
            [14, 15, 16, 17, 18].map((col) => `=SUM(${String.fromCharCode(64 + col)}4:${String.fromCharCode(64 + col)}${salLastData})`),
        ).forEach((v, i) => {
            const c = salTotRow.getCell(i + 1);
            c.value = v;
            c.font = { name: "Arial", size: 10, bold: true };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
            c.alignment = { horizontal: "center", vertical: "middle" };
            if (i >= 13) { c.numFmt = "₹#,##0.00"; }
        });

        wsSalary.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 18 } };

        /* ──────────────────────────────
           SHEET 3 — DEPT PIVOT
        ────────────────────────────── */
        const wsDept = wb.addWorksheet("Dept Pivot");
        wsDept.views = [{ state: "frozen", ySplit: 2 }];

        wsDept.mergeCells(1, 1, 1, 11);
        const deptTitleCell = wsDept.getCell(1, 1);
        deptTitleCell.value = `DEPARTMENT-WISE PIVOT  |  ${startDate}  to  ${endDate}`;
        deptTitleCell.font = { name: "Arial", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
        deptTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
        deptTitleCell.alignment = { horizontal: "center", vertical: "middle" };
        wsDept.getRow(1).height = 26;

        const deptHdrs = ["Department", "Headcount", "Present Days", "Absent Days", "Leave Days", "Week Off", "Half Days", "Late Days", "Total OT Hrs", "Avg Att %", "Total Net Pay (₹)"];
        const deptHdrRow = wsDept.getRow(2);
        deptHdrs.forEach((h, i) => { applyHeader(deptHdrRow.getCell(i + 1), h); });
        deptHdrRow.height = 18;

        // Aggregate by department
        const deptMap = new Map();
        summaryRows.forEach((r) => {
            const dept = r.department || "N/A";
            if (!deptMap.has(dept)) {
                deptMap.set(dept, { headcount: 0, present: 0, absent: 0, leave: 0, weekOff: 0, halfDay: 0, late: 0, otHrs: 0, attPctSum: 0, netPay: 0 });
            }
            const d = deptMap.get(dept);
            d.headcount++;
            d.present += r.present;
            d.absent += r.absent;
            d.leave += r.leave;
            d.weekOff += r.weekOff;
            d.halfDay += r.halfDay;
            d.late += r.late;
            d.otHrs += r.totalOTHrs;
            d.attPctSum += r.attPct;
            d.netPay += r.netPayable;
        });

        [...deptMap.entries()].forEach(([dept, d], idx) => {
            const row = wsDept.addRow([]);
            row.height = 16;
            const bg = idx % 2 === 0 ? ALT_ROW : "FFFFFFFF";
            const avgAtt = d.headcount > 0 ? d.attPctSum / d.headcount : 0;
            [dept, d.headcount, d.present, d.absent, d.leave, d.weekOff, d.halfDay, d.late,
                parseFloat(d.otHrs.toFixed(2)), parseFloat(avgAtt.toFixed(2)), parseFloat(d.netPay.toFixed(2))
            ].forEach((v, i) => {
                const c = row.getCell(i + 1);
                c.value = i === 9 ? v / 100 : v;
                c.font = { name: "Arial", size: 9, bold: i === 0 || i === 10 };
                c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
                c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
                if (i === 9) c.numFmt = "0.0%";
                if (i === 10) { c.numFmt = "₹#,##0.00"; c.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF137333" } }; }
            });
        });

        wsDept.columns = [{ width: 22 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 13 }, { width: 12 }, { width: 18 }];

        /* ── Send ── */
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=attendance_summary_${startDate}_to_${endDate}.xlsx`);
        await wb.xlsx.write(res);
        return res.end();

    } catch (err) {
        console.error("Summary export error:", err);
        return res.status(500).json({ success: false, message: "Failed to generate summary report", error: err.message });
    }
};
// Helper function to format time from Date object
export function formatTime(date) {
    if (!date) return "N/A";

    try {
        const d = new Date(date);

        return new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true, // 24-hour format
        }).format(d);

    } catch (error) {
        console.error("formatTime error:", error);
        return "Invalid Date";
    }
}

// Helper function to format working hours
function formatWorkingHours(minutes) {
    if (!minutes || minutes === 0) return "0:00";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
}