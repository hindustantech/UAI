import Attendance from "../../../models/Attandance/Attendance.js";
import Employee from "../../../models/Attandance/Employee.js";
import mongoose from "mongoose";
import { Parser } from "json2csv";
import ExcelJS from "exceljs";
import { Subscription } from "../../../models/Attandance/subscration/Subscription.js";

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
 * Calculate working hours considering breaks
 * - Unpaid breaks: deduct ALL break time
 * - Paid breaks within limits: no deduction
 * - Paid breaks exceeded: deduct only excess minutes
 */
const calculateWorkingHoursWithBreaks = (punchIn, punchOut, actualBreaks = [], shiftBreakConfig = []) => {
    if (!punchIn || !punchOut) return { 
        totalMinutes: 0, 
        payableMinutes: 0, 
        breakDeductedMinutes: 0,
        excessBreakMinutes: 0 
    };

    const punchInTime = new Date(punchIn).getTime();
    const punchOutTime = new Date(punchOut).getTime();
    
    // Total gross working minutes (punch to punch)
    const totalGrossMinutes = Math.round((punchOutTime - punchInTime) / (1000 * 60));
    
    let totalDeductMinutes = 0;
    let excessBreakMinutes = 0;
    
    if (actualBreaks && actualBreaks.length > 0) {
        actualBreaks.forEach(breakEntry => {
            // Calculate actual break duration
            let breakDuration = 0;
            if (breakEntry.durationMinutes) {
                breakDuration = breakEntry.durationMinutes;
            } else if (breakEntry.startTime && breakEntry.endTime) {
                breakDuration = Math.round(
                    (new Date(breakEntry.endTime).getTime() - new Date(breakEntry.startTime).getTime()) / (1000 * 60)
                );
            }
            
            if (breakDuration > 0 && shiftBreakConfig && shiftBreakConfig.length > 0) {
                // Find matching shift break configuration
                const shiftBreak = shiftBreakConfig.find(sb => {
                    const breakName = (breakEntry.breakName || breakEntry.type || "").toLowerCase();
                    const configName = (sb.name || "").toLowerCase();
                    return configName === breakName || 
                           configName.includes(breakName) || 
                           breakName.includes(configName);
                });
                
                if (shiftBreak) {
                    const allowedMinutes = shiftBreak.duration || shiftBreak.allowedMinutes || 30;
                    
                    if (shiftBreak.isPaid === false) {
                        // UNPAID BREAK: Deduct ALL break time
                        totalDeductMinutes += breakDuration;
                    } else {
                        // PAID BREAK: Only deduct excess time
                        if (breakDuration > allowedMinutes) {
                            const exceeded = breakDuration - allowedMinutes;
                            excessBreakMinutes += exceeded;
                            totalDeductMinutes += exceeded;
                        }
                        // If within allowed time, no deduction (paid break)
                    }
                } else {
                    // No matching config found, treat as unpaid (safe default)
                    totalDeductMinutes += breakDuration;
                }
            } else if (breakDuration > 0) {
                // No shift config available, deduct all break time (safe default)
                totalDeductMinutes += breakDuration;
            }
        });
    }
    
    const payableMinutes = Math.max(0, totalGrossMinutes - totalDeductMinutes);
    
    return {
        totalMinutes: totalGrossMinutes,
        payableMinutes: payableMinutes,
        breakDeductedMinutes: totalDeductMinutes,
        excessBreakMinutes: excessBreakMinutes
    };
};

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
        if (b.startTime && b.endTime)
            acc += Math.round((new Date(b.endTime) - new Date(b.startTime)) / 60000);
        else if (b.durationMinutes)
            acc += b.durationMinutes;
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
            hour12: true,
        }).format(d);

    } catch (error) {
        console.error("formatTime error:", error);
        return "Invalid Date";
    }
}

// Helper function to format working hours as HH:MM
function formatWorkingHours(minutes) {
    if (!minutes || minutes === 0) return "0:00";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
}

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
    if (isWeeklyOff) return { code: "WO", label: "Week Off", punchIn: "—", punchOut: "—", hours: "0:00" };
    if (!attendance) return { code: "A", label: "Absent", punchIn: "—", punchOut: "—", hours: "0:00" };

    const pi = formatTime(attendance.punchIn);
    const po = formatTime(attendance.punchOut);

    switch (attendance.status) {
        case "leave": return { code: "L", label: "Leave", punchIn: "—", punchOut: "—", hours: "0:00" };
        case "holiday": return { code: "H", label: "Holiday", punchIn: "—", punchOut: "—", hours: "0:00" };
        case "week_off": return { code: "WO", label: "Week Off", punchIn: "—", punchOut: "—", hours: "0:00" };
        case "absent": return { code: "A", label: "Absent", punchIn: "—", punchOut: "—", hours: "0:00" };
        default: {
            // Calculate working hours with break deductions
            let hrs = "0:00";
            if (attendance.punchIn && attendance.punchOut) {
                // Get shift breaks configuration
                const shiftBreaks = attendance.shift?.breaks || [];
                
                // Calculate working hours with break deductions
                const workCalc = calculateWorkingHoursWithBreaks(
                    attendance.punchIn, 
                    attendance.punchOut, 
                    attendance.breaks, 
                    shiftBreaks
                );
                
                // Format as HH:MM
                hrs = formatWorkingHours(workCalc.payableMinutes);
            }

            // Check for half day (less than 4 hours = 240 minutes)
            if (attendance.status === "half_day") {
                return { code: "HD", label: "Half Day", punchIn: pi || "—", punchOut: po || "—", hours: hrs };
            }

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
const ALT_ROW = "FFF2F6FC";

const PREMIUM_CONFIG = {
    maxFreeRows: 1,
};

// ── Premium check (returns boolean) ───────────────────────────────────────
const checkPremiumAccess = async (companyId) => {
    try {
        const subscription = await Subscription.findOne({
            company: companyId,
            isActive: true,
            status: "ACTIVE",
            endDate: { $gte: new Date() },
        })
            .populate("plan")
            .sort({ endDate: -1 });

        if (!subscription?.plan) return false;

        console.log("Subscription found:", {
            planName: subscription.plan.name,
            isFree: subscription.plan.isfree,
            endDate: subscription.endDate,
        });

        return !subscription.plan.isfree;
    } catch (error) {
        console.error("Premium Check Error:", error);
        return false;
    }
};

// ── Dummy row generators ─────────────────────────────────────────────────
const makeDummySummaryRow = (index) => ({
    empCode: `EMP-${String(index + 1).padStart(3, "0")}`,
    empName: "****** ******",
    department: "**********",
    designation: "**********",
    shift: "**:00–**:00",
    totalDays: "—",
    weekOff: "—",
    holiday: "—",
    presentableDays: "—",
    present: "—",
    halfDay: "—",
    absent: "—",
    leave: "—",
    late: "—",
    earlyExit: "—",
    totalWorkHrs: "—",
    avgWorkHrs: "—",
    totalOTHrs: "—",
    totalLateHrs: "—",
    attPct: "—",
    basic: "—",
    hra: "—",
    da: "—",
    bonus: "—",
    perDay: "—",
    perHour: "—",
    overtimeRate: "—",
});

const makeDummyDetailRow = (empIndex, dateIndex) => ({
    "Emp Code": `EMP-${String(empIndex + 1).padStart(3, "0")}`,
    "Emp Name": "****** ******",
    "Department": "**********",
    "Shift": "**:00–**:00",
    "Date": `****-**-${String(dateIndex + 1).padStart(2, "0")}`,
    "Day": "**day",
    "Punch In": "**:**",
    "Punch Out": "**:**",
    "Total Hours": "**:00",
    "Overtime (min)": "—",
    "Late (min)": "—",
    "Early Leave (min)": "—",
    "Break (min)": "—",
    "Status": "🔒 Locked",
    "Location Verified": "—",
    "Remarks": "Upgrade to unlock",
    "Auto Marked": "—",
    "Suspicious": "—",
});

// ── Upgrade worksheet ─────────────────────────────────────────────────────
const createUpgradeWorksheet = (wb, startDate, endDate, recordCount) => {
    const ws = wb.addWorksheet("⚠️ Upgrade Required");
    ws.columns = [{ width: 60 }];

    const addRow = (rowNum, value, fontOpts = {}, fillArgb = null, height = 22) => {
        ws.getRow(rowNum).height = height;
        const cell = ws.getCell(rowNum, 1);
        cell.value = value;
        cell.font = { name: "Arial", size: 12, ...fontOpts };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        if (fillArgb) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
    };

    addRow(1, "⚠️  PREMIUM FEATURE — UPGRADE REQUIRED  ⚠️",
        { bold: true, size: 16, color: { argb: "FF9C0006" } }, "FFFFC7CE", 36);

    addRow(2, "Full attendance reports with salary structure are available on Premium plans only.",
        { bold: true }, null, 28);

    addRow(3,
        `Your request covers ${recordCount} employee(s) from ${startDate} to ${endDate}. ` +
        `Free plan is limited to ${PREMIUM_CONFIG.maxFreeRows} employees.`,
        {}, "FFFFF2CC", 28);

    addRow(4, "The data below is blurred. Upgrade to see the complete report.",
        { italic: true, color: { argb: "FF555555" } });

    addRow(5, "🔓  Upgrade to Premium to unlock:", { bold: true, size: 13, color: { argb: "FF137333" } }, null, 28);

    const features = [
        "✓  Full attendance report for unlimited employees",
        "✓  Salary structure columns (Basic, HRA, DA, Bonus, Per Day, OT Rate)",
        "✓  Department-wise pivot analysis",
        "✓  Overtime & late-hours calculations",
        "✓  Advanced attendance grading",
        "✓  CSV & XLSX export",
        "✓  Priority email support",
    ];
    features.forEach((f, i) => {
        ws.getRow(6 + i).height = 20;
        const cell = ws.getCell(6 + i, 1);
        cell.value = f;
        cell.font = { name: "Arial", size: 11 };
        cell.alignment = { horizontal: "left", vertical: "middle" };
    });

    const contactRow = 6 + features.length;
    ws.getRow(contactRow).height = 28;
    const contactCell = ws.getCell(contactRow, 1);
    contactCell.value = "📧  Contact us: sales@yourcompany.com  |  🌐  www.yourcompany.com/upgrade";
    contactCell.font = { name: "Arial", size: 11, italic: true, color: { argb: "FF243F60" } };
    contactCell.alignment = { horizontal: "center", vertical: "middle" };

    return ws;
};

// ═════════════════════════════════════════════════════════════════════════════
//  EXPORT 1 — DETAILED ATTENDANCE (day-by-day)
// ═════════════════════════════════════════════════════════════════════════════
export const generateAttendanceCSV = async (req, res) => {
    try {
        const { startDate, endDate, department, employeeCode, format = "xlsx" } = req.query;
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

        const attendanceMap = new Map();
        attRecords.forEach((r) => {
            attendanceMap.set(`${r.employeeId}_${r.date.toISOString().split("T")[0]}`, r);
        });

        const dateRange = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1))
            dateRange.push(new Date(d));

        const employeeCount = employees.length;
        const totalRecords = employeeCount * dateRange.length;

        const isPremium = await checkPremiumAccess(companyId);
        console.log(`Company ${companyId} premium access: ${isPremium}`);

        const exceedsFreeLimit = !isPremium && employeeCount > PREMIUM_CONFIG.maxFreeRows;

        // ── Build rows ────────────────────────────────────────────────
        let rows = [];

        const employeesToProcess = exceedsFreeLimit
            ? employees.slice(0, PREMIUM_CONFIG.maxFreeRows)
            : employees;

        for (const emp of employeesToProcess) {
            const weeklyOffDays = emp.weeklyOff?.length ? emp.weeklyOff : ["Sunday"];
            const shiftStart = emp.shift?.startTime || "09:00";
            const shiftEnd = emp.shift?.endTime || "18:00";
            const shiftName = emp.shift?.shiftName || "Default (09:00–18:00)";
            const graceIn = emp.shift?.gracePeriod?.lateEntry ?? 10;
            const graceOut = emp.shift?.gracePeriod?.earlyExit ?? 10;
            const shiftBreaks = emp.shift?.breaks || [];

            for (const date of dateRange) {
                const dateKey = date.toISOString().split("T")[0];
                const dayOfWeek = date.toLocaleDateString("en-IN", { weekday: "long" });
                const attendance = attendanceMap.get(`${emp._id}_${dateKey}`);
                const isWeeklyOff = weeklyOffDays.includes(dayOfWeek);

                let punchInTime = "—", punchOutTime = "—", totalHours = "0:00";
                let overtimeMinutes = 0, lateMinutes = 0, earlyLeaveMinutes = 0, breakMinutes = 0;
                let statusLabel = "", locationVerified = "No", remarks = "", autoMarked = "No", suspicious = "No";

                if (isWeeklyOff) {
                    statusLabel = "Week Off";
                } else if (!attendance) {
                    statusLabel = "Absent";
                } else {
                    punchInTime = attendance.punchIn ? formatTime(attendance.punchIn) : "—";
                    punchOutTime = attendance.punchOut ? formatTime(attendance.punchOut) : "—";
                    
                    // Calculate working hours with break deductions
                    const workCalc = calculateWorkingHoursWithBreaks(
                        attendance.punchIn,
                        attendance.punchOut,
                        attendance.breaks,
                        shiftBreaks
                    );
                    
                    totalHours = formatWorkingHours(workCalc.payableMinutes);
                    overtimeMinutes = attendance.workSummary?.overtimeMinutes || 0;
                    lateMinutes = formatLateTime(attendance.workSummary?.lateMinutes) || 0;
                    earlyLeaveMinutes = attendance.workSummary?.earlyLeaveMinutes || 0;
                    breakMinutes = totalBreakMinutes(attendance.breaks);
                    locationVerified = attendance.geoLocation?.verified ? "Yes" : "No";
                    remarks = attendance.remarks || "";
                    autoMarked = attendance.isAutoMarked ? "Yes" : "No";
                    suspicious = attendance.isSuspicious ? "Yes" : "No";

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

                    switch (attendance.status) {
                        case "leave": statusLabel = "Leave"; punchInTime = punchOutTime = "—"; totalHours = "0:00"; break;
                        case "half_day": statusLabel = "Half Day"; break;
                        case "holiday": statusLabel = "Holiday"; punchInTime = punchOutTime = "—"; totalHours = "0:00"; break;
                        case "week_off": statusLabel = "Week Off"; break;
                        case "absent": statusLabel = "Absent"; break;
                        default: {
                            const tags = getLateEarlyTags(shiftStart, shiftEnd, attendance.punchIn, attendance.punchOut, graceIn, graceOut);
                            statusLabel = tags.length ? tags.join(" + ") : "Present";
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

        // Pad remaining employees with dummy rows for free users
        if (exceedsFreeLimit) {
            const dummyEmpCount = employeeCount - PREMIUM_CONFIG.maxFreeRows;
            for (let ei = 0; ei < dummyEmpCount; ei++) {
                for (let di = 0; di < dateRange.length; di++) {
                    rows.push(makeDummyDetailRow(PREMIUM_CONFIG.maxFreeRows + ei, di));
                }
            }
        }

        const fields = [
            "Emp Code", "Emp Name", "Department", "Shift",
            "Date", "Day", "Punch In", "Punch Out",
            "Total Hours", "Overtime (min)", "Late (min)", "Early Leave (min)", "Break (min)",
            "Status", "Location Verified", "Remarks", "Auto Marked", "Suspicious",
        ];

        /* ── XLSX output ──────────────────────────────────────────────── */
        if (format !== "csv") {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = "HR System";
            workbook.created = new Date();

            if (exceedsFreeLimit) {
                createUpgradeWorksheet(workbook, startDate, endDate, employeeCount);
            }

            const sheetLabel = exceedsFreeLimit ? "⚠️ Sample Data" : "Attendance Report";
            const sheet = workbook.addWorksheet(sheetLabel, {
                views: [{ state: "frozen", ySplit: exceedsFreeLimit ? 3 : 1 }],
            });

            let nextRow = 1;

            if (exceedsFreeLimit) {
                sheet.mergeCells(1, 1, 1, fields.length);
                const bannerCell = sheet.getCell(1, 1);
                bannerCell.value =
                    `⚠️ SAMPLE DATA — Showing ${PREMIUM_CONFIG.maxFreeRows} of ${employeeCount} employees ` +
                    `(${PREMIUM_CONFIG.maxFreeRows * dateRange.length} of ${totalRecords} records). ` +
                    `🔒 Locked rows need Premium. Contact: sales@yourcompany.com`;
                bannerCell.font = { name: "Arial", bold: true, size: 11, color: { argb: "FF9C0006" } };
                bannerCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
                bannerCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
                sheet.getRow(1).height = 32;

                sheet.mergeCells(2, 1, 2, fields.length);
                const subNoteCell = sheet.getCell(2, 1);
                subNoteCell.value = `Rows marked 🔒 contain dummy data. Upgrade to Premium for full access.`;
                subNoteCell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF555555" } };
                subNoteCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
                subNoteCell.alignment = { horizontal: "center", vertical: "middle" };
                sheet.getRow(2).height = 20;

                nextRow = 3;
            }

            sheet.columns = fields.map((f) => ({ header: f, key: f, width: 15 }));
            const headerRow = sheet.getRow(nextRow);
            if (exceedsFreeLimit) {
                fields.forEach((f, i) => { headerRow.getCell(i + 1).value = f; });
            }
            headerRow.eachCell((cell) => {
                cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5496" } };
                cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
            });
            headerRow.height = 20;

            const STATUS_COLORS = {
                "Present": "FFD9EAD3",
                "Late": "FFFFF2CC",
                "Late + Early Leave": "FFFCE5CD",
                "Early Leave": "FFFCE5CD",
                "Half Day": "FFFFE599",
                "Absent": "FFFFC7CE",
                "Leave": "FFD9D2E9",
                "Week Off": "FFD0E4F7",
                "Holiday": "FFD9EAD3",
                "🔒 Locked": "FFD3D3D3",
            };

            rows.forEach((r, idx) => {
                const isLocked = r["Status"] === "🔒 Locked";
                const dataRow = exceedsFreeLimit ? sheet.addRow({}) : sheet.addRow(r);
                if (exceedsFreeLimit) {
                    fields.forEach((f, i) => { dataRow.getCell(i + 1).value = r[f]; });
                }
                dataRow.height = 16;

                const baseFill = isLocked ? "FFD3D3D3" : (idx % 2 === 0 ? "FFF9FAFB" : "FFFFFFFF");

                dataRow.eachCell({ includeEmpty: true }, (cell) => {
                    cell.alignment = { horizontal: "center", vertical: "middle" };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: baseFill } };
                    cell.font = {
                        name: "Arial", size: 9,
                        color: { argb: isLocked ? "FF888888" : "FF000000" },
                        italic: isLocked,
                    };
                });

                const statusCell = dataRow.getCell("Status");
                const bgColor = STATUS_COLORS[r["Status"]] || baseFill;
                statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
                statusCell.font = { name: "Arial", size: 9, bold: !isLocked, italic: isLocked, color: { argb: isLocked ? "FF888888" : "FF000000" } };

                if (!isLocked && r["Suspicious"] === "Yes") {
                    dataRow.eachCell((cell) => {
                        cell.font = { ...cell.font, color: { argb: "FF9C0006" } };
                    });
                }
            });

            if (!exceedsFreeLimit) {
                sheet.autoFilter = {
                    from: { row: 1, column: 1 },
                    to: { row: 1, column: sheet.columns.length },
                };

                const summary = workbook.addWorksheet("Summary");
                summary.columns = [
                    { header: "Status", key: "status", width: 20 },
                    { header: "Count", key: "count", width: 10 },
                    { header: "% of Total", key: "pct", width: 14 },
                ];
                summary.getRow(1).eachCell((cell) => {
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
                    summary.addRow({ status, count, pct: `${((count / total) * 100).toFixed(1)}%` });
                });
                summary.addRow({});
                summary.addRow({ status: "Total Records", count: total, pct: "100%" });
            }

            const filename = exceedsFreeLimit
                ? `attendance_sample_${startDate}_to_${endDate}.xlsx`
                : `attendance_premium_${startDate}_to_${endDate}.xlsx`;

            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
            await workbook.xlsx.write(res);
            return res.end();
        }

        /* ── CSV output ───────────────────────────────────────────────── */
        if (exceedsFreeLimit) {
            let csv = `# ⚠️ PREMIUM FEATURE — UPGRADE REQUIRED\n`;
            csv += `# Showing ${PREMIUM_CONFIG.maxFreeRows} of ${employeeCount} employees (${PREMIUM_CONFIG.maxFreeRows * dateRange.length} of ${totalRecords} records)\n`;
            csv += `# Locked rows contain dummy placeholder data — upgrade to see real data\n`;
            csv += `# Contact: sales@yourcompany.com\n\n`;
            csv += fields.map((f) => `"${f}"`).join(",") + "\n";
            rows.forEach((r) => {
                csv += fields.map((f) => `"${r[f] ?? ""}"`).join(",") + "\n";
            });
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", `attachment; filename=attendance_sample_${startDate}_to_${endDate}.csv`);
            return res.status(200).send(csv);
        }

        const parser = new Parser({ fields });
        const csv = parser.parse(rows);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=attendance_premium_${startDate}_to_${endDate}.csv`);
        return res.status(200).send(csv);

    } catch (error) {
        console.error("Error generating attendance report:", error);
        return res.status(500).json({ success: false, message: "Failed to generate attendance report", error: error.message });
    }
};

/* ─────────────────────────────────────────
   MATRIX EXPORT
   One row per employee, dates as columns.
   Each cell shows status code with HH:MM format
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
                // Show: code with hours in HH:MM format
                cell.value = `${code}\n${hours}`;
                cell.font = {
                    name: "Arial", size: 9, bold: true,
                    color: { argb: STATUS_FONT[code] || "FF000000" },
                };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL[code] || "FFFFFFFF" } };
                cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
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

// ═════════════════════════════════════════════════════════════════════════════
//  EXPORT 3 — ATTENDANCE SUMMARY (with salary structure)
// ═════════════════════════════════════════════════════════════════════════════
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
        const employeeCount = employees.length;

        const isPremium = await checkPremiumAccess(companyId);
        console.log(`Premium access for company ${companyId}: ${isPremium}`);

        const exceedsFreeLimit = !isPremium && employeeCount > PREMIUM_CONFIG.maxFreeRows;

        // ── Build summary rows ────────────────────────────────────────
        let summaryRows = [];

        const employeesToProcess = exceedsFreeLimit
            ? employees.slice(0, PREMIUM_CONFIG.maxFreeRows)
            : employees;

        for (const emp of employeesToProcess) {
            const weeklyOff = emp.weeklyOff?.length ? emp.weeklyOff : ["Sunday"];
            const shiftStart = emp.shift?.startTime || "09:00";
            const shiftEnd = emp.shift?.endTime || "18:00";
            const graceIn = emp.shift?.gracePeriod?.lateEntry ?? 10;
            const graceOut = emp.shift?.gracePeriod?.earlyExit ?? 10;

            let present = 0, absent = 0, leave = 0, weekOff = 0, halfDay = 0;
            let holiday = 0, late = 0, earlyExit = 0;
            let totalWorkMin = 0, totalOTMin = 0, totalLateMin = 0;

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
                        halfDay++; present++;
                        if (att) {
                            const shiftBreaks = emp.shift?.breaks || [];
                            const workCalc = calculateWorkingHoursWithBreaks(
                                att.punchIn, att.punchOut, att.breaks, shiftBreaks
                            );
                            totalWorkMin += workCalc.payableMinutes;
                            totalOTMin += att.workSummary?.overtimeMinutes || 0;
                            totalLateMin += att.workSummary?.lateMinutes || 0;
                        }
                        break;
                    default:
                        present++;
                        if (code === "PL" || code === "PLE") late++;
                        if (code === "PE" || code === "PLE") earlyExit++;
                        if (att) {
                            const shiftBreaks = emp.shift?.breaks || [];
                            const workCalc = calculateWorkingHoursWithBreaks(
                                att.punchIn, att.punchOut, att.breaks, shiftBreaks
                            );
                            totalWorkMin += workCalc.payableMinutes;
                            totalOTMin += att.workSummary?.overtimeMinutes || 0;
                            totalLateMin += att.workSummary?.lateMinutes || 0;
                        }
                }
            }

            const presentableDays = totalDays - weekOff - holiday;
            const attPct = presentableDays > 0 ? (present / presentableDays) * 100 : 0;
            const avgHrs = present > 0 ? totalWorkMin / present / 60 : 0;

            summaryRows.push({
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
                totalLateHrs: parseFloat((totalLateMin / 60).toFixed(2)),
                attPct: parseFloat(attPct.toFixed(2)),
                basic: isPremium ? (emp.salaryStructure?.basic || 0) : "—",
                hra: isPremium ? (emp.salaryStructure?.hra || 0) : "—",
                da: isPremium ? (emp.salaryStructure?.da || 0) : "—",
                bonus: isPremium ? (emp.salaryStructure?.bonus || 0) : "—",
                perDay: isPremium ? (emp.salaryStructure?.perDay || 0) : "—",
                perHour: isPremium ? (emp.salaryStructure?.perHour || 0) : "—",
                overtimeRate: isPremium ? (emp.salaryStructure?.overtimeRate || 0) : "—",
            });
        }

        // Pad remaining rows with dummy data for free users
        if (exceedsFreeLimit) {
            const dummyCount = employeeCount - PREMIUM_CONFIG.maxFreeRows;
            for (let i = 0; i < dummyCount; i++) {
                summaryRows.push(makeDummySummaryRow(PREMIUM_CONFIG.maxFreeRows + i));
            }
        }

        /* ── Build workbook ──────────────────────────────────────────── */
        const wb = new ExcelJS.Workbook();
        wb.creator = "HR System";

        const HEADER_BG = "FF243F60";
        const ALT_ROW = "FFF2F2F2";
        const LOCKED_BG = "FFD3D3D3";

        if (exceedsFreeLimit) {
            createUpgradeWorksheet(wb, startDate, endDate, employeeCount);
        }

        const sheetName = exceedsFreeLimit ? "⚠️ Sample Summary" : "Attendance Summary";
        const wsSummary = wb.addWorksheet(sheetName, {
            views: [{ state: "frozen", ySplit: 3 }],
        });

        const sCols = 26;

        // Row 1: title
        wsSummary.mergeCells(1, 1, 1, sCols);
        const sTitleCell = wsSummary.getCell(1, 1);
        sTitleCell.value = exceedsFreeLimit
            ? `⚠️ SAMPLE REPORT (${PREMIUM_CONFIG.maxFreeRows} of ${employeeCount} employees shown — UPGRADE FOR FULL DATA)  |  ${startDate} to ${endDate}`
            : `ATTENDANCE SUMMARY WITH SALARY STRUCTURE  |  ${startDate} to ${endDate}`;
        sTitleCell.font = { name: "Arial", bold: true, size: 13, color: { argb: exceedsFreeLimit ? "FF9C0006" : "FFFFFFFF" } };
        sTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: exceedsFreeLimit ? "FFFFC7CE" : HEADER_BG } };
        sTitleCell.alignment = { horizontal: "center", vertical: "middle" };
        wsSummary.getRow(1).height = 30;

        // Row 2: upgrade note (free only)
        if (exceedsFreeLimit) {
            wsSummary.mergeCells(2, 1, 2, sCols);
            const noteCell = wsSummary.getCell(2, 1);
            noteCell.value =
                `🔒 Rows with "******" are locked. Upgrade to Premium to unlock all ${employeeCount} employees with full salary data.  ` +
                `Contact: sales@yourcompany.com`;
            noteCell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF9C0006" } };
            noteCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
            noteCell.alignment = { horizontal: "center", vertical: "middle" };
            wsSummary.getRow(2).height = 22;
        }

        // ── Employee Master Data (premium only) ────────────────────────
        if (!exceedsFreeLimit) {
            const wsMaster = wb.addWorksheet("Employee Master");
            wsMaster.views = [{ state: "frozen", ySplit: 2 }];

            const mCols = 23;

            wsMaster.mergeCells(1, 1, 1, mCols);
            const mTitle = wsMaster.getCell(1, 1);
            mTitle.value = `EMPLOYEE MASTER DATA  |  Generated on ${new Date().toLocaleDateString("en-IN")}`;
            mTitle.font = { name: "Arial", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
            mTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
            mTitle.alignment = { horizontal: "center", vertical: "middle" };
            wsMaster.getRow(1).height = 26;

            const mHeaders = [
                "#", "ReferalCode", "Emp Code", "Emp Name", "Department", "Designation",
                "Employment Status", "Weekly Off",
                "Shift Name", "Shift Start", "Shift End",
                "Grace (Late Entry)", "Grace (Early Exit)",
                "Email", "Phone", "Date of Joining",
                "basic", "HRA", "DA", "Bonus", "PerDay", "PerHour", "OvertimeRate",
            ];
            const mHdrRow = wsMaster.getRow(2);
            mHdrRow.height = 18;
            mHeaders.forEach((h, i) => {
                const cell = mHdrRow.getCell(i + 1);
                cell.value = h;
                cell.font = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
                cell.alignment = { horizontal: "center", vertical: "middle" };
            });

            employees.forEach((emp, idx) => {
                const row = wsMaster.addRow([]);
                row.height = 16;
                const bg = idx % 2 === 0 ? ALT_ROW : "FFFFFFFF";

                const weeklyOff = emp.weeklyOff?.length ? emp.weeklyOff.join(", ") : "Sunday";
                const shiftName = emp.shift?.shiftName || "N/A";
                const shiftStart = emp.shift?.startTime || "09:00";
                const shiftEnd = emp.shift?.endTime || "18:00";
                const graceIn = emp.shift?.gracePeriod?.lateEntry ?? 10;
                const graceOut = emp.shift?.gracePeriod?.earlyExit ?? 10;

                const vals = [
                    idx + 1,
                    emp.referalCode || '_',
                    emp.empCode || "—",
                    emp.user_name || "N/A",
                    emp.jobInfo?.department || "N/A",
                    emp.jobInfo?.designation || "N/A",
                    emp.employmentStatus || "N/A",
                    weeklyOff,
                    shiftName,
                    shiftStart,
                    shiftEnd,
                    `${graceIn} min`,
                    `${graceOut} min`,
                    emp.email || emp.userId?.email || "N/A",
                    emp.phone || emp.userId?.phone || "N/A",
                    emp.jobInfo?.dateOfJoining
                        ? new Date(emp.jobInfo.dateOfJoining).toLocaleDateString("en-IN")
                        : "N/A",
                    emp.salaryStructure?.basic || 0,
                    emp.salaryStructure?.hra || 0,
                    emp.salaryStructure?.da || 0,
                    emp.salaryStructure?.bonus || 0,
                    emp.salaryStructure?.perDay || 0,
                    emp.salaryStructure?.perHour || 0,
                    emp.salaryStructure?.overtimeRate || 0,
                ];

                vals.forEach((v, i) => {
                    const c = row.getCell(i + 1);
                    c.value = v;
                    c.font = { name: "Arial", size: 9, bold: i <= 1 };
                    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
                    c.alignment = {
                        horizontal: (i >= 2 && i <= 4) || i === 12 || i === 13 ? "left" : "center",
                        vertical: "middle",
                    };
                });
            });

            wsMaster.columns = [
                { width: 5 }, { width: 12 }, { width: 12 }, { width: 22 }, { width: 18 }, { width: 18 },
                { width: 16 }, { width: 16 },
                { width: 16 }, { width: 12 }, { width: 12 },
                { width: 16 }, { width: 16 },
                { width: 24 }, { width: 16 }, { width: 16 },
                { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
                { width: 12 }, { width: 12 }, { width: 12 },
            ];

            wsMaster.autoFilter = {
                from: { row: 2, column: 1 },
                to: { row: 2, column: mCols },
            };
        }

        // Row 2 (premium) or Row 3 (free): group headers
        const grpRowNum = exceedsFreeLimit ? 3 : 2;
        const groups = [
            { label: "EMPLOYEE INFO", start: 1, span: 5 },
            { label: "DATE BREAKDOWN", start: 6, span: 8 },
            { label: "HOURS", start: 14, span: 4 },
            { label: "ATTENDANCE", start: 18, span: 2 },
            { label: "SALARY STRUCTURE (₹)", start: 20, span: 7 },
        ];
        const grpRow = wsSummary.getRow(grpRowNum);
        grpRow.height = 16;
        groups.forEach(({ label, start, span }) => {
            if (span > 1) wsSummary.mergeCells(grpRowNum, start, grpRowNum, start + span - 1);
            const cell = wsSummary.getCell(grpRowNum, start);
            cell.value = label;
            cell.font = { name: "Arial", bold: true, size: 9, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
            cell.alignment = { horizontal: "center", vertical: "middle" };
        });

        // Sub-headers row
        const subRowNum = grpRowNum + 1;
        const sHeaders = [
            "#", "Emp Code", "Emp Name", "Department", "Designation",
            "Total Days", "Week Off", "Holiday", "Presentable Days", "Present", "Half Day", "Absent", "Leave", "Late Days",
            "Total Hrs", "Avg Hrs/Day", "OT Hrs", "Late (Hrs)",
            "Att %", "Att Grade",
            "Basic", "HRA", "DA", "Bonus", "Per Day", "Per Hour", "OT Rate",
        ];
        const sHeaderRow = wsSummary.getRow(subRowNum);
        sHeaderRow.height = 18;
        sHeaders.forEach((h, i) => {
            const cell = sHeaderRow.getCell(i + 1);
            cell.value = h;
            cell.font = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
            cell.alignment = { horizontal: "center", vertical: "middle" };
        });

        wsSummary.columns = [
            { width: 5 }, { width: 12 }, { width: 22 }, { width: 18 }, { width: 18 },
            { width: 11 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 10 },
            { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 },
            { width: 11 }, { width: 13 }, { width: 10 }, { width: 11 },
            { width: 10 }, { width: 12 },
            { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
            { width: 12 }, { width: 12 }, { width: 12 },
        ];

        const dataStartRow = subRowNum + 1;

        summaryRows.forEach((r, idx) => {
            const row = wsSummary.addRow([]);
            row.height = 16;

            const isDummy = typeof r.empName === "string" && r.empName.startsWith("***");
            const bg = isDummy ? LOCKED_BG : (idx % 2 === 0 ? ALT_ROW : "FFFFFFFF");

            const grade = isDummy || typeof r.attPct !== "number" ? "🔒"
                : r.attPct >= 95 ? "Excellent" : r.attPct >= 85 ? "Good" : r.attPct >= 75 ? "Average" : "Poor";
            const gradeColor = isDummy ? "FF888888"
                : r.attPct >= 95 ? "FF137333" : r.attPct >= 85 ? "FF0B5394" : r.attPct >= 75 ? "FF7D4604" : "FF9C0006";
            const gradeBg = isDummy ? LOCKED_BG
                : r.attPct >= 95 ? "FFB7E1CD" : r.attPct >= 85 ? "FFD0E4F7" : r.attPct >= 75 ? "FFFFF2CC" : "FFFFC7CE";

            const attDisplay = isDummy || typeof r.attPct !== "number" ? "🔒" : r.attPct / 100;

            const vals = [
                idx + 1, r.empCode, r.empName, r.department, r.designation,
                r.totalDays, r.weekOff, r.holiday, r.presentableDays,
                r.present, r.halfDay, r.absent, r.leave, r.late,
                r.totalWorkHrs, r.avgWorkHrs, r.totalOTHrs, r.totalLateHrs,
                attDisplay, grade,
                r.basic, r.hra, r.da, r.bonus, r.perDay, r.perHour, r.overtimeRate,
            ];

            vals.forEach((v, i) => {
                const c = row.getCell(i + 1);
                c.value = v;
                c.font = { name: "Arial", size: 9, bold: i <= 1, color: { argb: isDummy ? "FF888888" : "FF000000" } };
                c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
                c.alignment = {
                    horizontal: (i === 2 || i === 3 || i === 4) ? "left" : "center",
                    vertical: "middle",
                };
                if (!isDummy && typeof v === "number") {
                    if (i >= 14 && i <= 17) c.numFmt = "0.00";
                    if (i >= 20) c.numFmt = "#,##0.00";
                }
            });

            // Att % formatting
            if (!isDummy && typeof r.attPct === "number") {
                const attCell = row.getCell(19);
                attCell.value = r.attPct / 100;
                attCell.numFmt = "0.0%";
                attCell.font = { name: "Arial", size: 9, bold: true };
                attCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
            }

            // Grade cell
            const gradeCell = row.getCell(20);
            gradeCell.font = { name: "Arial", size: 9, bold: true, color: { argb: gradeColor } };
            gradeCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: gradeBg } };

            // Absent highlight (real rows only)
            if (!isDummy && r.absent > 0) {
                row.getCell(12).font = { name: "Arial", size: 9, bold: true, color: { argb: "FF9C0006" } };
                row.getCell(12).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
            }
        });

        // Totals row
        const realCount = exceedsFreeLimit ? PREMIUM_CONFIG.maxFreeRows : summaryRows.length;
        const lastReal = dataStartRow + realCount - 1;
        const totRow = wsSummary.addRow([]);
        totRow.height = 18;

        [
            [1, "Total / Avg"],
            [6, `=SUM(F${dataStartRow}:F${lastReal})`],
            [7, `=SUM(G${dataStartRow}:G${lastReal})`],
            [8, `=SUM(H${dataStartRow}:H${lastReal})`],
            [9, `=SUM(I${dataStartRow}:I${lastReal})`],
            [10, `=SUM(J${dataStartRow}:J${lastReal})`],
            [11, `=SUM(K${dataStartRow}:K${lastReal})`],
            [12, `=SUM(L${dataStartRow}:L${lastReal})`],
            [13, `=SUM(M${dataStartRow}:M${lastReal})`],
            [14, `=SUM(N${dataStartRow}:N${lastReal})`],
            [15, `=AVERAGE(O${dataStartRow}:O${lastReal})`],
            [16, `=AVERAGE(P${dataStartRow}:P${lastReal})`],
            [17, `=SUM(Q${dataStartRow}:Q${lastReal})`],
            [18, `=AVERAGE(R${dataStartRow}:R${lastReal})`],
            [19, `=AVERAGE(S${dataStartRow}:S${lastReal})`],
        ].forEach(([col, val]) => {
            const c = totRow.getCell(col);
            c.value = val;
            c.font = { name: "Arial", size: 9, bold: true };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
            c.alignment = { horizontal: "center", vertical: "middle" };
            if (col === 19) c.numFmt = "0.0%";
        });

        wsSummary.autoFilter = {
            from: { row: subRowNum, column: 1 },
            to: { row: subRowNum, column: sCols },
        };

        // ── Dept Pivot (premium only) ─────────────────────────────────
        if (!exceedsFreeLimit) {
            const wsDept = wb.addWorksheet("Dept Pivot");
            wsDept.views = [{ state: "frozen", ySplit: 2 }];

            wsDept.mergeCells(1, 1, 1, 11);
            const dtTitle = wsDept.getCell(1, 1);
            dtTitle.value = `DEPARTMENT-WISE PIVOT  |  ${startDate} to ${endDate}`;
            dtTitle.font = { name: "Arial", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
            dtTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
            dtTitle.alignment = { horizontal: "center", vertical: "middle" };
            wsDept.getRow(1).height = 26;

            const deptHdrs = ["Department", "Headcount", "Present Days", "Absent Days", "Leave Days",
                "Week Off", "Half Days", "Late Days", "Total OT Hrs", "Total Late Hrs", "Avg Att %"];
            const deptHdrRow = wsDept.getRow(2);
            deptHdrRow.height = 18;
            deptHdrs.forEach((h, i) => {
                const cell = deptHdrRow.getCell(i + 1);
                cell.value = h;
                cell.font = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
                cell.alignment = { horizontal: "center", vertical: "middle" };
            });

            const deptMap = new Map();
            summaryRows.forEach((r) => {
                const dept = r.department || "N/A";
                if (!deptMap.has(dept)) {
                    deptMap.set(dept, {
                        headcount: 0, present: 0, absent: 0, leave: 0, weekOff: 0,
                        halfDay: 0, late: 0, otHrs: 0, lateHrs: 0, attPctSum: 0,
                    });
                }
                const d = deptMap.get(dept);
                d.headcount++;
                d.present += r.present || 0;
                d.absent += r.absent || 0;
                d.leave += r.leave || 0;
                d.weekOff += r.weekOff || 0;
                d.halfDay += r.halfDay || 0;
                d.late += r.late || 0;
                d.otHrs += r.totalOTHrs || 0;
                d.lateHrs += r.totalLateHrs || 0;
                d.attPctSum += r.attPct || 0;
            });

            [...deptMap.entries()].forEach(([dept, d], idx) => {
                const row = wsDept.addRow([]);
                row.height = 16;
                const bg = idx % 2 === 0 ? ALT_ROW : "FFFFFFFF";
                const avgAtt = d.headcount > 0 ? d.attPctSum / d.headcount / 100 : 0;

                [dept, d.headcount, d.present, d.absent, d.leave, d.weekOff,
                    d.halfDay, d.late, parseFloat(d.otHrs.toFixed(2)),
                    parseFloat(d.lateHrs.toFixed(2)), avgAtt
                ].forEach((v, i) => {
                    const c = row.getCell(i + 1);
                    c.value = v;
                    c.font = { name: "Arial", size: 9, bold: i === 0 };
                    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
                    c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
                    if (i === 10) c.numFmt = "0.0%";
                });
            });

            wsDept.columns = [
                { width: 22 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 12 },
                { width: 12 }, { width: 12 }, { width: 12 }, { width: 13 }, { width: 12 }, { width: 12 },
            ];
        }

        // ── Send response ─────────────────────────────────────────────
        const filename = exceedsFreeLimit
            ? `attendance_sample_${startDate}_to_${endDate}.xlsx`
            : `attendance_premium_${startDate}_to_${endDate}.xlsx`;

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
        await wb.xlsx.write(res);
        return res.end();

    } catch (err) {
        console.error("Summary export error:", err);
        return res.status(500).json({ success: false, message: "Failed to generate summary report", error: err.message });
    }
};