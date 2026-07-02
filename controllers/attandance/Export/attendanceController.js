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
 * Get break details with deductions
 * Returns array of break info and calculates total deductions
 */
const getBreakDetails = (actualBreaks = [], shiftBreakConfig = []) => {
    const breakDetails = [];
    let totalDeductMinutes = 0;
    let totalExcessMinutes = 0;
    let totalBreakMinutes = 0;

    if (actualBreaks && actualBreaks.length > 0) {
        actualBreaks.forEach(breakEntry => {
            // Calculate actual break duration
            let breakDuration = 0;
            let startTime = "—";
            let endTime = "—";

            if (breakEntry.startTime) {
                startTime = formatTime(breakEntry.startTime);
            }
            if (breakEntry.endTime) {
                endTime = formatTime(breakEntry.endTime);
            }

            if (breakEntry.durationMinutes) {
                breakDuration = breakEntry.durationMinutes;
            } else if (breakEntry.startTime && breakEntry.endTime) {
                breakDuration = Math.round(
                    (new Date(breakEntry.endTime).getTime() - new Date(breakEntry.startTime).getTime()) / (1000 * 60)
                );
            }

            totalBreakMinutes += breakDuration;

            let allowedMinutes = 0;
            let isPaid = false;
            let deductedMinutes = 0;
            let excessMinutes = 0;
            let breakName = breakEntry.breakName || breakEntry.type || "Break";

            if (breakDuration > 0 && shiftBreakConfig && shiftBreakConfig.length > 0) {
                // Find matching shift break configuration
                const shiftBreak = shiftBreakConfig.find(sb => {
                    const configName = (sb.name || "").toLowerCase();
                    const entryName = breakName.toLowerCase();
                    return configName === entryName || 
                           configName.includes(entryName) || 
                           entryName.includes(configName);
                });

                if (shiftBreak) {
                    allowedMinutes = shiftBreak.duration || shiftBreak.allowedMinutes || 30;
                    isPaid = shiftBreak.isPaid === true;

                    if (!isPaid) {
                        // UNPAID BREAK: Deduct ALL break time
                        deductedMinutes = breakDuration;
                        totalDeductMinutes += breakDuration;
                    } else {
                        // PAID BREAK: Only deduct excess time
                        if (breakDuration > allowedMinutes) {
                            excessMinutes = breakDuration - allowedMinutes;
                            deductedMinutes = excessMinutes;
                            totalDeductMinutes += excessMinutes;
                            totalExcessMinutes += excessMinutes;
                        }
                    }
                } else {
                    // No matching config found, treat as unpaid (safe default)
                    allowedMinutes = 0;
                    isPaid = false;
                    deductedMinutes = breakDuration;
                    totalDeductMinutes += breakDuration;
                }
            } else if (breakDuration > 0) {
                // No shift config available, deduct all break time (safe default)
                deductedMinutes = breakDuration;
                totalDeductMinutes += breakDuration;
            }

            breakDetails.push({
                name: breakName,
                startTime: startTime,
                endTime: endTime,
                duration: breakDuration,
                durationFormatted: formatMinutes(breakDuration),
                allowedMinutes: allowedMinutes,
                allowedFormatted: formatMinutes(allowedMinutes),
                isPaid: isPaid,
                deductedMinutes: deductedMinutes,
                deductedFormatted: formatMinutes(deductedMinutes),
                excessMinutes: excessMinutes,
                excessFormatted: formatMinutes(excessMinutes),
            });
        });
    }

    return {
        breakDetails,
        totalBreakMinutes,
        totalDeductMinutes,
        totalExcessMinutes,
        summary: breakDetails.map(b => 
            `${b.name}: ${b.durationFormatted} (${b.isPaid ? 'Paid' : 'Unpaid'}, Allowed: ${b.allowedFormatted}, Deducted: ${b.deductedFormatted})`
        ).join(" | ")
    };
};

/**
 * Calculate working hours considering breaks
 */
const calculateWorkingHoursWithBreaks = (punchIn, punchOut, actualBreaks = [], shiftBreakConfig = []) => {
    if (!punchIn || !punchOut) return { 
        totalMinutes: 0, 
        payableMinutes: 0, 
        breakDeductedMinutes: 0,
        excessBreakMinutes: 0,
        breakDetails: []
    };

    const punchInTime = new Date(punchIn).getTime();
    const punchOutTime = new Date(punchOut).getTime();
    
    // Total gross working minutes (punch to punch)
    const totalGrossMinutes = Math.round((punchOutTime - punchInTime) / (1000 * 60));
    
    const { breakDetails, totalDeductMinutes, totalExcessMinutes } = getBreakDetails(actualBreaks, shiftBreakConfig);
    
    const payableMinutes = Math.max(0, totalGrossMinutes - totalDeductMinutes);
    
    return {
        totalMinutes: totalGrossMinutes,
        payableMinutes: payableMinutes,
        breakDeductedMinutes: totalDeductMinutes,
        excessBreakMinutes: totalExcessMinutes,
        breakDetails: breakDetails
    };
};

/**
 * Determine Late / Early-leave status given shift & punch times.
 * Returns empty array for flexible shifts
 */
const getLateEarlyTags = (shiftStart, shiftEnd, punchIn, punchOut, graceIn = 10, graceOut = 10, isFlexible = false) => {
    // For flexible shifts, ignore late/early rules
    if (isFlexible) return [];
    
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

// Helper to check if shift is flexible
const isFlexibleShift = (employee) => {
    return employee?.shift?.shiftType === "flexible";
};

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

/** Returns { code, label, punchIn, punchOut, hours, breakInfo, isFlexible, isAutoPunchOut } for one day */
const resolveDayStatus = (attendance, isWeeklyOff, shiftStart = "09:00", shiftEnd = "18:00", graceIn = 10, graceOut = 10, isFlexible = false) => {
    if (isWeeklyOff) return { code: "WO", label: "Week Off", punchIn: "—", punchOut: "—", hours: "0:00", breakInfo: "", isFlexible: false, isAutoPunchOut: false };
    if (!attendance) return { code: "A", label: "Absent", punchIn: "—", punchOut: "—", hours: "0:00", breakInfo: "", isFlexible: false, isAutoPunchOut: false };

    const pi = formatTime(attendance.punchIn);
    const po = formatTime(attendance.punchOut);

    switch (attendance.status) {
        case "leave": return { code: "L", label: "Leave", punchIn: "—", punchOut: "—", hours: "0:00", breakInfo: "", isFlexible: false, isAutoPunchOut: false };
        case "holiday": return { code: "H", label: "Holiday", punchIn: "—", punchOut: "—", hours: "0:00", breakInfo: "", isFlexible: false, isAutoPunchOut: false };
        case "week_off": return { code: "WO", label: "Week Off", punchIn: "—", punchOut: "—", hours: "0:00", breakInfo: "", isFlexible: false, isAutoPunchOut: false };
        case "absent": return { code: "A", label: "Absent", punchIn: "—", punchOut: "—", hours: "0:00", breakInfo: "", isFlexible: false, isAutoPunchOut: false };
        default: {
            let hrs = "0:00";
            let breakInfo = "";
            if (attendance.punchIn && attendance.punchOut) {
                const shiftBreaks = attendance.shift?.breaks || [];
                
                const workCalc = calculateWorkingHoursWithBreaks(
                    attendance.punchIn, 
                    attendance.punchOut, 
                    attendance.breaks, 
                    shiftBreaks
                );
                
                hrs = formatWorkingHours(workCalc.payableMinutes);
                breakInfo = workCalc.breakDetails.map(b => 
                    `${b.name}(${b.durationFormatted}${b.deductedMinutes > 0 ? ` -${b.deductedFormatted}` : ''})`
                ).join(", ");
            }

            if (attendance.status === "half_day") {
                return { 
                    code: "HD", 
                    label: "Half Day", 
                    punchIn: pi || "—", 
                    punchOut: po || "—", 
                    hours: hrs, 
                    breakInfo,
                    isFlexible: isFlexible,
                    isAutoPunchOut: attendance.isAutoPunchOut || false
                };
            }

            // For flexible shifts, always mark as Present regardless of time
            if (isFlexible) {
                return { 
                    code: "P", 
                    label: "Present", 
                    punchIn: pi || "—", 
                    punchOut: po || "—", 
                    hours: hrs, 
                    breakInfo,
                    isFlexible: true,
                    isAutoPunchOut: attendance.isAutoPunchOut || false
                };
            }

            let tag = "P";
            if (pi) {
                const inMin = timeStrToMinutes(pi);
                if (inMin - timeStrToMinutes(shiftStart) > graceIn) tag = "PL";
            }
            if (po) {
                const outMin = timeStrToMinutes(po);
                const shiftOut = timeStrToMinutes(shiftEnd);
                if (shiftOut - outMin > graceOut) tag = tag === "PL" ? "PLE" : "PE";
            }
            const labels = { P: "Present", PL: "Late", PE: "Early Exit", PLE: "Late+Early" };
            return { 
                code: tag, 
                label: labels[tag] || "Present", 
                punchIn: pi || "—", 
                punchOut: po || "—", 
                hours: hrs, 
                breakInfo,
                isFlexible: false,
                isAutoPunchOut: attendance.isAutoPunchOut || false
            };
        }
    }
};

/* Status colour palette */
const STATUS_FILL = {
    P: "FFD9EAD3",
    PL: "FFFFFF99",
    PE: "FFFCE5CD",
    PLE: "FFFFD966",
    HD: "FFFFE599",
    A: "FFFFC7CE",
    L: "FFD9D2E9",
    WO: "FFD0E4F7",
    H: "FFB7E1CD",
};
const STATUS_FONT = {
    A: "FF9C0006", L: "FF6A0DAD", WO: "FF1155CC", H: "FF137333",
    PL: "FF7D6608", PE: "FF7D4604", PLE: "FF7D4604",
};

const HEADER_BG = "FF1F3864";
const SUBHEAD_BG = "FF2F5496";
const ALT_ROW_BG = "FFF2F6FC";
const ALT_ROW = "FFF2F6FC";

const PREMIUM_CONFIG = {
    maxFreeRows: 1,
};

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

        return !subscription.plan.isfree;
    } catch (error) {
        console.error("Premium Check Error:", error);
        return false;
    }
};

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
    totalBreakHrs: "—",
    totalDeductedHrs: "—",
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
    "Gross Hours": "**:00",
    "Break Deducted": "**:00",
    "Overtime (min)": "—",
    "Late (min)": "—",
    "Early Leave (min)": "—",
    "Break Details": "*****",
    "Break (min)": "—",
    "Status": "🔒 Locked",
    "Location Verified": "—",
    "Remarks": "Upgrade to unlock",
    "Auto Marked": "—",
    "Suspicious": "—",
});

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

    addRow(2, "Full attendance reports with break details and salary structure are available on Premium plans only.",
        { bold: true }, null, 28);

    addRow(3,
        `Your request covers ${recordCount} employee(s) from ${startDate} to ${endDate}. ` +
        `Free plan is limited to ${PREMIUM_CONFIG.maxFreeRows} employees.`,
        {}, "FFFFF2CC", 28);

    addRow(4, "The data below is blurred. Upgrade to see complete break details and deductions.",
        { italic: true, color: { argb: "FF555555" } });

    addRow(5, "🔓  Upgrade to Premium to unlock:", { bold: true, size: 13, color: { argb: "FF137333" } }, null, 28);

    const features = [
        "✓  Full attendance report with break details (Paid/Unpaid, Allowed vs Actual)",
        "✓  Break deduction calculations (excess time reduced from working hours)",
        "✓  Salary structure columns (Basic, HRA, DA, Bonus, Per Day, OT Rate)",
        "✓  Department-wise pivot analysis",
        "✓  Overtime & late-hours calculations",
        "✓  Advanced attendance grading",
        "✓  CSV & XLSX export with all break information",
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
//  EXPORT 1 — DETAILED ATTENDANCE (day-by-day) WITH BREAK DETAILS
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
        const exceedsFreeLimit = !isPremium && employeeCount > PREMIUM_CONFIG.maxFreeRows;

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
            const isFlexible = isFlexibleShift(emp);

            for (const date of dateRange) {
                const dateKey = date.toISOString().split("T")[0];
                const dayOfWeek = date.toLocaleDateString("en-IN", { weekday: "long" });
                const attendance = attendanceMap.get(`${emp._id}_${dateKey}`);
                const isWeeklyOff = weeklyOffDays.includes(dayOfWeek);

                let punchInTime = "—", punchOutTime = "—", totalHours = "0:00";
                let grossHours = "0:00", breakDeducted = "0:00", breakDetails = "";
                let overtimeMinutes = 0, lateMinutes = 0, earlyLeaveMinutes = 0, breakMinutes = 0;
                let statusLabel = "", locationVerified = "No", remarks = "", autoMarked = "No", suspicious = "No";

                if (isWeeklyOff) {
                    statusLabel = "Week Off";
                } else if (!attendance) {
                    statusLabel = "Absent";
                } else {
                    punchInTime = attendance.punchIn ? formatTime(attendance.punchIn) : "—";
                    punchOutTime = attendance.punchOut ? formatTime(attendance.punchOut) : "—";
                    
                    const workCalc = calculateWorkingHoursWithBreaks(
                        attendance.punchIn,
                        attendance.punchOut,
                        attendance.breaks,
                        shiftBreaks
                    );
                    
                    totalHours = formatWorkingHours(workCalc.payableMinutes);
                    grossHours = formatWorkingHours(workCalc.totalMinutes);
                    breakDeducted = formatWorkingHours(workCalc.breakDeductedMinutes);
                    breakMinutes = workCalc.breakDeductedMinutes + workCalc.excessBreakMinutes;
                    
                    // Build detailed break information
                    const { summary } = getBreakDetails(attendance.breaks, shiftBreaks);
                    breakDetails = summary || "No breaks";
                    
                    overtimeMinutes = attendance.workSummary?.overtimeMinutes || 0;
                    
                    // For flexible shifts, skip late/early calculations
                    if (!isFlexible) {
                        lateMinutes = attendance.workSummary?.lateMinutes || 0;
                        earlyLeaveMinutes = attendance.workSummary?.earlyLeaveMinutes || 0;
                        
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
                    } else {
                        lateMinutes = "—";
                        earlyLeaveMinutes = "—";
                    }
                    
                    locationVerified = attendance.geoLocation?.verified ? "Yes" : "No";
                    remarks = attendance.remarks || "";
                    autoMarked = attendance.isAutoMarked ? "Yes" : "No";
                    suspicious = attendance.isSuspicious ? "Yes" : "No";

                    switch (attendance.status) {
                        case "leave": statusLabel = "Leave"; punchInTime = punchOutTime = "—"; totalHours = "0:00"; grossHours = "0:00"; breakDeducted = "0:00"; breakDetails = ""; break;
                        case "half_day": statusLabel = "Half Day"; break;
                        case "holiday": statusLabel = "Holiday"; punchInTime = punchOutTime = "—"; totalHours = "0:00"; grossHours = "0:00"; breakDeducted = "0:00"; breakDetails = ""; break;
                        case "week_off": statusLabel = "Week Off"; break;
                        case "absent": statusLabel = "Absent"; break;
                        default: {
                            if (isFlexible) {
                                statusLabel = "Present";
                            } else {
                                const tags = getLateEarlyTags(shiftStart, shiftEnd, attendance.punchIn, attendance.punchOut, graceIn, graceOut);
                                statusLabel = tags.length ? tags.join(" + ") : "Present";
                            }
                        }
                    }
                }

                rows.push({
                    "Emp Code": emp.empCode || "—",
                    "Emp Name": emp.user_name || "N/A",
                    "Department": emp.jobInfo?.department || "N/A",
                    "Shift": isFlexible ? `${shiftName} (Flexible)` : shiftName,
                    "Date": dateKey,
                    "Day": dayOfWeek,
                    "Punch In": punchInTime,
                    "Punch Out": punchOutTime,
                    "Gross Hours": grossHours,
                    "Total Hours": totalHours,
                    "Break Deducted": breakDeducted,
                    "Break Details": breakDetails,
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
            "Gross Hours", "Total Hours", "Break Deducted", "Break Details",
            "Overtime (min)", "Late (min)", "Early Leave (min)", "Break (min)",
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
                subNoteCell.value = `Rows marked 🔒 contain dummy data. Upgrade to Premium for full access with break details.`;
                subNoteCell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF555555" } };
                subNoteCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
                subNoteCell.alignment = { horizontal: "center", vertical: "middle" };
                sheet.getRow(2).height = 20;

                nextRow = 3;
            }

            sheet.columns = fields.map((f) => ({ header: f, key: f, width: 18 }));
            const headerRow = sheet.getRow(nextRow);
            if (exceedsFreeLimit) {
                fields.forEach((f, i) => { headerRow.getCell(i + 1).value = f; });
            }
            headerRow.eachCell((cell) => {
                cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 9 };
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
                    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: baseFill } };
                    cell.font = {
                        name: "Arial", size: 8,
                        color: { argb: isLocked ? "FF888888" : "FF000000" },
                        italic: isLocked,
                    };
                });

                const statusCell = dataRow.getCell("Status");
                const bgColor = STATUS_COLORS[r["Status"]] || baseFill;
                statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
                statusCell.font = { name: "Arial", size: 8, bold: !isLocked, italic: isLocked, color: { argb: isLocked ? "FF888888" : "FF000000" } };

                // Highlight break deducted
                if (!isLocked && r["Break Deducted"] && r["Break Deducted"] !== "0:00") {
                    const breakCell = dataRow.getCell("Break Deducted");
                    breakCell.font = { name: "Arial", size: 8, bold: true, color: { argb: "FF9C0006" } };
                }

                if (!isLocked && r["Suspicious"] === "Yes") {
                    dataRow.eachCell((cell) => {
                        cell.font = { ...cell.font, color: { argb: "FF9C0006" } };
                    });
                }
            });

            // Add Break Details sheet for premium users
            if (!exceedsFreeLimit) {
                const wsBreaks = workbook.addWorksheet("Break Details");
                wsBreaks.views = [{ state: "frozen", ySplit: 1 }];

                wsBreaks.mergeCells(1, 1, 1, 10);
                const bTitleCell = wsBreaks.getCell(1, 1);
                bTitleCell.value = `BREAK DETAILS REPORT  |  ${startDate} to ${endDate}`;
                bTitleCell.font = { name: "Arial", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
                bTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
                bTitleCell.alignment = { horizontal: "center", vertical: "middle" };
                wsBreaks.getRow(1).height = 24;

                const bHeaders = ["Emp Code", "Emp Name", "Date", "Break Name", "Start", "End", "Duration", "Allowed", "Paid/Unpaid", "Deducted"];
                const bHeaderRow = wsBreaks.getRow(2);
                bHeaders.forEach((h, i) => {
                    const cell = bHeaderRow.getCell(i + 1);
                    cell.value = h;
                    cell.font = { name: "Arial", bold: true, size: 9, color: { argb: "FFFFFFFF" } };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_BG } };
                    cell.alignment = { horizontal: "center", vertical: "middle" };
                });
                bHeaderRow.height = 18;

                wsBreaks.columns = [
                    { width: 12 }, { width: 22 }, { width: 13 }, { width: 15 },
                    { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
                    { width: 12 }, { width: 12 },
                ];

                let breakRowNum = 3;
                for (const emp of employeesToProcess) {
                    const shiftBreaks = emp.shift?.breaks || [];
                    for (const date of dateRange) {
                        const dateKey = date.toISOString().split("T")[0];
                        const attendance = attendanceMap.get(`${emp._id}_${dateKey}`);
                        
                        if (attendance && attendance.breaks && attendance.breaks.length > 0) {
                            const { breakDetails } = getBreakDetails(attendance.breaks, shiftBreaks);
                            
                            breakDetails.forEach((bd) => {
                                const row = wsBreaks.getRow(breakRowNum++);
                                row.height = 15;
                                const bg = (breakRowNum % 2 === 0) ? ALT_ROW_BG : "FFFFFFFF";
                                
                                const vals = [
                                    emp.empCode || "—",
                                    emp.user_name || "N/A",
                                    dateKey,
                                    bd.name,
                                    bd.startTime,
                                    bd.endTime,
                                    bd.durationFormatted,
                                    bd.allowedFormatted,
                                    bd.isPaid ? "Paid" : "Unpaid",
                                    bd.deductedFormatted,
                                ];
                                
                                vals.forEach((v, i) => {
                                    const cell = row.getCell(i + 1);
                                    cell.value = v;
                                    cell.font = { name: "Arial", size: 9 };
                                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
                                    cell.alignment = { horizontal: "center", vertical: "middle" };
                                });
                                
                                // Highlight deductions
                                if (bd.deductedMinutes > 0) {
                                    const deductCell = row.getCell(10);
                                    deductCell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF9C0006" } };
                                    deductCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
                                }
                            });
                        }
                    }
                }
            }

            sheet.autoFilter = {
                from: { row: nextRow, column: 1 },
                to: { row: nextRow, column: fields.length },
            };

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
            csv += `# Locked rows contain dummy placeholder data — upgrade to see real data with break details\n`;
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
   MATRIX EXPORT WITH BREAK INFO
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

        const wb = new ExcelJS.Workbook();
        wb.creator = "HR System";
        wb.created = new Date();

        /* ══════════════════════════════
           SHEET 1 – MATRIX (PIVOT)
        ══════════════════════════════ */
        const ws = wb.addWorksheet("Attendance Matrix", {
            views: [{ state: "frozen", xSplit: 4, ySplit: 3 }],
        });

        // Row 1: Title
        ws.mergeCells(1, 1, 1, 4 + dateRange.length);
        const titleCell = ws.getCell(1, 1);
        titleCell.value = `ATTENDANCE MATRIX REPORT  |  ${startDate}  to  ${endDate}`;
        titleCell.font = { name: "Arial", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
        titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
        titleCell.alignment = { horizontal: "center", vertical: "middle" };
        ws.getRow(1).height = 28;

        // Row 2: Date sub-headers
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

        // Row 3: Legend
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

        ws.getColumn(1).width = 5;
        ws.getColumn(2).width = 12;
        ws.getColumn(3).width = 22;
        ws.getColumn(4).width = 18;
        dateRange.forEach((_, i) => { ws.getColumn(5 + i).width = 10; });

        // Data rows
        employees.forEach((emp, empIdx) => {
            const weeklyOff = emp.weeklyOff?.length ? emp.weeklyOff : ["Sunday"];
            const shiftStart = emp.shift?.startTime || "09:00";
            const shiftEnd = emp.shift?.endTime || "18:00";
            const graceIn = emp.shift?.gracePeriod?.lateEntry ?? 10;
            const graceOut = emp.shift?.gracePeriod?.earlyExit ?? 10;
            const isFlexible = isFlexibleShift(emp);

            const dataRow = ws.addRow([]);
            const rowNum = dataRow.number;
            const isAlt = empIdx % 2 === 0;

            dataRow.height = 25;

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

            dateRange.forEach((date, di) => {
                const dateKey = date.toISOString().split("T")[0];
                const dayName = date.toLocaleDateString("en-IN", { weekday: "long" });
                const att = attMap.get(`${emp._id}_${dateKey}`);
                const isWO = weeklyOff.includes(dayName);

                const { code, label, punchIn, punchOut, hours, breakInfo, isFlexible: flexShift, isAutoPunchOut } = 
                    resolveDayStatus(att, isWO, shiftStart, shiftEnd, graceIn, graceOut, isFlexible);

                const cell = ws.getCell(rowNum, 5 + di);
                cell.value = `${code}\n${hours}`;
                cell.font = {
                    name: "Arial", size: 8, bold: true,
                    color: { argb: STATUS_FONT[code] || "FF000000" },
                };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL[code] || "FFFFFFFF" } };
                cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
                
                // Enhanced tooltip with break info and flexible shift indicator
                let tooltipText = `${label}\nIn:  ${punchIn}\nOut: ${punchOut}\nHrs: ${hours}`;
                if (flexShift) {
                    tooltipText += `\n(Flexible Shift)`;
                    if (isAutoPunchOut) {
                        tooltipText += `\nAuto Punch-Out`;
                    }
                }
                if (breakInfo) {
                    tooltipText += `\nBreaks: ${breakInfo}`;
                }
                
                cell.note = {
                    texts: [
                        { font: { bold: true, size: 9 }, text: tooltipText },
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

        ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 4 } };

        /* ══════════════════════════════
           SHEET 2 – DETAIL WITH BREAKS
        ══════════════════════════════ */
        const wsDetail = wb.addWorksheet("Daily Detail");
        wsDetail.views = [{ state: "frozen", ySplit: 2 }];

        wsDetail.mergeCells(1, 1, 1, 16);
        const dTitleCell = wsDetail.getCell(1, 1);
        dTitleCell.value = `DAILY DETAIL WITH BREAKS  |  ${startDate}  to  ${endDate}`;
        dTitleCell.font = { name: "Arial", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
        dTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
        dTitleCell.alignment = { horizontal: "center", vertical: "middle" };
        wsDetail.getRow(1).height = 24;

        const detailHeaders = [
            "#", "Emp Code", "Emp Name", "Department", "Shift", 
            "Date", "Day", "Punch In", "Punch Out", 
            "Gross Hrs", "Total Hrs", "Break Deducted", "Break Details",
            "Status", "Overtime", "Remarks"
        ];
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
            { width: 13 }, { width: 11 }, { width: 10 }, { width: 10 }, 
            { width: 10 }, { width: 10 }, { width: 12 }, { width: 35 },
            { width: 14 }, { width: 10 }, { width: 25 },
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
            const shiftBreaks = emp.shift?.breaks || [];
            const isFlexible = isFlexibleShift(emp);

            for (const date of dateRange) {
                const dateKey = date.toISOString().split("T")[0];
                const dayName = date.toLocaleDateString("en-IN", { weekday: "long" });
                const att = attMap.get(`${emp._id}_${dateKey}`);
                const isWO = weeklyOff.includes(dayName);
                const { code, label, punchIn, punchOut, hours, breakInfo, isFlexible: flexShift } = 
                    resolveDayStatus(att, isWO, shiftStart, shiftEnd, graceIn, graceOut, isFlexible);

                let grossHrs = "0:00";
                let breakDeducted = "0:00";
                let overtimeDisplay = "—";
                
                if (att && att.punchIn && att.punchOut) {
                    const workCalc = calculateWorkingHoursWithBreaks(
                        att.punchIn, att.punchOut, att.breaks, shiftBreaks
                    );
                    grossHrs = formatWorkingHours(workCalc.totalMinutes);
                    breakDeducted = formatWorkingHours(workCalc.breakDeductedMinutes);
                    overtimeDisplay = att.workSummary?.overtimeMinutes 
                        ? `${att.workSummary.overtimeMinutes} min` 
                        : "—";
                }

                const row = wsDetail.getRow(detailRowNum++);
                row.height = 15;
                const isAlt = seq % 2 === 0;
                const vals = [
                    seq++, emp.empCode || "—", emp.user_name || "N/A", 
                    emp.jobInfo?.department || "N/A", isFlexible ? `${shiftName} (Flexible)` : shiftName, 
                    dateKey, dayName.slice(0, 3), punchIn, punchOut,
                    grossHrs, hours, breakDeducted, breakInfo || "—",
                    label, overtimeDisplay, att?.remarks || ""
                ];
                vals.forEach((v, i) => {
                    const c = row.getCell(i + 1);
                    c.value = v;
                    c.font = { name: "Arial", size: 8 };
                    c.alignment = { horizontal: i <= 1 || i >= 5 ? "center" : "left", vertical: "middle" };
                    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isAlt ? ALT_ROW_BG : "FFFFFFFF" } };
                });
                
                // Status cell colour
                const statusCell = row.getCell(14);
                statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL[code] || "FFFFFFFF" } };
                statusCell.font = { name: "Arial", size: 8, bold: true, color: { argb: STATUS_FONT[code] || "FF000000" } };
                statusCell.alignment = { horizontal: "center", vertical: "middle" };
                
                // Highlight break deducted
                if (breakDeducted && breakDeducted !== "0:00") {
                    const breakCell = row.getCell(12);
                    breakCell.font = { name: "Arial", size: 8, bold: true, color: { argb: "FF9C0006" } };
                }
            }
        }
        wsDetail.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 16 } };

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
//  EXPORT 3 — ATTENDANCE SUMMARY WITH BREAK SUMMARY
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
        const exceedsFreeLimit = !isPremium && employeeCount > PREMIUM_CONFIG.maxFreeRows;

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
            const shiftBreaks = emp.shift?.breaks || [];
            const isFlexible = isFlexibleShift(emp);

            let present = 0, absent = 0, leave = 0, weekOff = 0, halfDay = 0;
            let holiday = 0, late = 0, earlyExit = 0;
            let totalWorkMin = 0, totalOTMin = 0, totalLateMin = 0;
            let totalBreakMin = 0, totalBreakDeductedMin = 0, totalGrossMin = 0;
            
            // For flexible shifts with auto punch-out, track separately for avg calculation
            let totalWorkMinForAvg = 0;
            let presentDaysForAvg = 0;

            for (const date of dateRange) {
                const dateKey = date.toISOString().split("T")[0];
                const dayName = date.toLocaleDateString("en-IN", { weekday: "long" });
                const att = attMap.get(`${emp._id}_${dateKey}`);
                const isWO = weeklyOff.includes(dayName);
                const { code, isFlexible: flexShift, isAutoPunchOut } = 
                    resolveDayStatus(att, isWO, shiftStart, shiftEnd, graceIn, graceOut, isFlexible);

                switch (code) {
                    case "WO": weekOff++; break;
                    case "A": absent++; break;
                    case "L": leave++; break;
                    case "H": holiday++; break;
                    case "HD":
                        halfDay++; present++;
                        if (att) {
                            const workCalc = calculateWorkingHoursWithBreaks(
                                att.punchIn, att.punchOut, att.breaks, shiftBreaks
                            );
                            totalWorkMin += workCalc.payableMinutes;
                            totalGrossMin += workCalc.totalMinutes;
                            totalBreakMin += workCalc.breakDeductedMinutes + workCalc.excessBreakMinutes;
                            totalBreakDeductedMin += workCalc.breakDeductedMinutes;
                            totalOTMin += att.workSummary?.overtimeMinutes || 0;
                            
                            // Only count in average if not auto punch-out for flexible shifts
                            if (!isFlexible || !isAutoPunchOut) {
                                totalWorkMinForAvg += workCalc.payableMinutes;
                                presentDaysForAvg++;
                            }
                            
                            // Skip late minutes for flexible shifts
                            if (!isFlexible) {
                                totalLateMin += att.workSummary?.lateMinutes || 0;
                            }
                        }
                        break;
                    default:
                        present++;
                        if (!isFlexible) {
                            if (code === "PL" || code === "PLE") late++;
                            if (code === "PE" || code === "PLE") earlyExit++;
                        }
                        if (att) {
                            const workCalc = calculateWorkingHoursWithBreaks(
                                att.punchIn, att.punchOut, att.breaks, shiftBreaks
                            );
                            totalWorkMin += workCalc.payableMinutes;
                            totalGrossMin += workCalc.totalMinutes;
                            totalBreakMin += workCalc.breakDeductedMinutes + workCalc.excessBreakMinutes;
                            totalBreakDeductedMin += workCalc.breakDeductedMinutes;
                            totalOTMin += att.workSummary?.overtimeMinutes || 0;
                            
                            // Only count in average if not auto punch-out for flexible shifts
                            if (!isFlexible || !isAutoPunchOut) {
                                totalWorkMinForAvg += workCalc.payableMinutes;
                                presentDaysForAvg++;
                            }
                            
                            // Skip late minutes for flexible shifts
                            if (!isFlexible) {
                                totalLateMin += att.workSummary?.lateMinutes || 0;
                            }
                        }
                }
            }

            const presentableDays = totalDays - weekOff - holiday;
            const attPct = presentableDays > 0 ? (present / presentableDays) * 100 : 0;
            
            // Calculate average only using non-auto-punch-out days for flexible shifts
            const avgHrs = presentDaysForAvg > 0 ? totalWorkMinForAvg / presentDaysForAvg / 60 : 
                          present > 0 ? totalWorkMin / present / 60 : 0;

            summaryRows.push({
                empCode: emp.empCode || "—",
                empName: emp.user_name || "N/A",
                department: emp.jobInfo?.department || "N/A",
                designation: emp.jobInfo?.designation || "N/A",
                shift: isFlexible 
                    ? `${emp.shift?.shiftName || 'Flexible'} (Flexible)` 
                    : emp.shift?.shiftName || `${shiftStart}–${shiftEnd}`,
                totalDays,
                weekOff,
                holiday,
                presentableDays,
                present,
                halfDay,
                absent,
                leave,
                late: isFlexible ? 0 : late,
                earlyExit: isFlexible ? 0 : earlyExit,
                totalGrossHrs: parseFloat((totalGrossMin / 60).toFixed(2)),
                totalWorkHrs: parseFloat((totalWorkMin / 60).toFixed(2)),
                totalBreakHrs: parseFloat((totalBreakMin / 60).toFixed(2)),
                totalDeductedHrs: parseFloat((totalBreakDeductedMin / 60).toFixed(2)),
                avgWorkHrs: parseFloat(avgHrs.toFixed(2)),
                totalOTHrs: parseFloat((totalOTMin / 60).toFixed(2)),
                totalLateHrs: isFlexible ? 0 : parseFloat((totalLateMin / 60).toFixed(2)),
                attPct: parseFloat(attPct.toFixed(2)),
                basic: isPremium ? (emp.salaryStructure?.basic || 0) : "—",
                hra: isPremium ? (emp.salaryStructure?.hra || 0) : "—",
                da: isPremium ? (emp.salaryStructure?.da || 0) : "—",
                bonus: isPremium ? (emp.salaryStructure?.bonus || 0) : "—",
                perDay: isPremium ? (emp.salaryStructure?.perDay || 0) : "—",
                perHour: isPremium ? (emp.salaryStructure?.perHour || 0) : "—",
                overtimeRate: isPremium ? (emp.salaryStructure?.overtimeRate || 0) : "—",
                isFlexible: isFlexible,
            });
        }

        if (exceedsFreeLimit) {
            const dummyCount = employeeCount - PREMIUM_CONFIG.maxFreeRows;
            for (let i = 0; i < dummyCount; i++) {
                summaryRows.push(makeDummySummaryRow(PREMIUM_CONFIG.maxFreeRows + i));
            }
        }

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

        const sCols = 29;

        wsSummary.mergeCells(1, 1, 1, sCols);
        const sTitleCell = wsSummary.getCell(1, 1);
        sTitleCell.value = exceedsFreeLimit
            ? `⚠️ SAMPLE REPORT (${PREMIUM_CONFIG.maxFreeRows} of ${employeeCount} employees shown)  |  ${startDate} to ${endDate}`
            : `ATTENDANCE SUMMARY WITH BREAK DETAILS & SALARY  |  ${startDate} to ${endDate}`;
        sTitleCell.font = { name: "Arial", bold: true, size: 13, color: { argb: exceedsFreeLimit ? "FF9C0006" : "FFFFFFFF" } };
        sTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: exceedsFreeLimit ? "FFFFC7CE" : HEADER_BG } };
        sTitleCell.alignment = { horizontal: "center", vertical: "middle" };
        wsSummary.getRow(1).height = 30;

        if (exceedsFreeLimit) {
            wsSummary.mergeCells(2, 1, 2, sCols);
            const noteCell = wsSummary.getCell(2, 1);
            noteCell.value =
                `🔒 Rows with "******" are locked. Upgrade to Premium for full break details and salary data. Contact: sales@yourcompany.com`;
            noteCell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF9C0006" } };
            noteCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
            noteCell.alignment = { horizontal: "center", vertical: "middle" };
            wsSummary.getRow(2).height = 22;
        }

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
                "Shift Name", "Shift Start", "Shift End", "Shift Type",
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
                const shiftType = emp.shift?.shiftType || "fixed";
                const graceIn = emp.shift?.gracePeriod?.lateEntry ?? 10;
                const graceOut = emp.shift?.gracePeriod?.earlyExit ?? 10;

                const vals = [
                    idx + 1, emp.referalCode || '_', emp.empCode || "—",
                    emp.user_name || "N/A", emp.jobInfo?.department || "N/A",
                    emp.jobInfo?.designation || "N/A", emp.employmentStatus || "N/A",
                    weeklyOff, shiftName, shiftStart, shiftEnd, shiftType,
                    `${graceIn} min`, `${graceOut} min`,
                    emp.email || emp.userId?.email || "N/A",
                    emp.phone || emp.userId?.phone || "N/A",
                    emp.jobInfo?.dateOfJoining ? new Date(emp.jobInfo.dateOfJoining).toLocaleDateString("en-IN") : "N/A",
                    emp.salaryStructure?.basic || 0, emp.salaryStructure?.hra || 0,
                    emp.salaryStructure?.da || 0, emp.salaryStructure?.bonus || 0,
                    emp.salaryStructure?.perDay || 0, emp.salaryStructure?.perHour || 0,
                    emp.salaryStructure?.overtimeRate || 0,
                ];

                vals.forEach((v, i) => {
                    const c = row.getCell(i + 1);
                    c.value = v;
                    c.font = { name: "Arial", size: 9, bold: i <= 1 };
                    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
                    c.alignment = { horizontal: (i >= 2 && i <= 4) || i === 12 || i === 13 ? "left" : "center", vertical: "middle" };
                    
                    // Highlight flexible shifts
                    if (i === 11 && v === "flexible") {
                        c.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF0B5394" } };
                        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD0E4F7" } };
                    }
                });
            });

            wsMaster.columns = Array(mCols).fill({ width: 15 });
            wsMaster.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: mCols } };
        }

        const grpRowNum = exceedsFreeLimit ? 3 : 2;
        const groups = [
            { label: "EMPLOYEE INFO", start: 1, span: 5 },
            { label: "DATE BREAKDOWN", start: 6, span: 9 },
            { label: "WORKING HOURS", start: 15, span: 3 },
            { label: "BREAK SUMMARY", start: 18, span: 2 },
            { label: "HOURS", start: 20, span: 3 },
            { label: "ATTENDANCE", start: 23, span: 2 },
            { label: "SALARY (₹)", start: 25, span: 5 },
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

        const subRowNum = grpRowNum + 1;
        const sHeaders = [
            "#", "Emp Code", "Emp Name", "Department", "Designation",
            "Total Days", "Week Off", "Holiday", "Presentable Days", 
            "Present", "Half Day", "Absent", "Leave", "Late Days",
            "Gross Hrs", "Net Hrs", "Avg Hrs/Day",
            "Break Hrs", "Deducted Hrs",
            "OT Hrs", "Late Hrs", "Att %",
            "Att %", "Att Grade",
            "Basic", "HRA", "DA", "Bonus", "Per Day", "Per Hour", "OT Rate",
        ];
        const sHeaderRow = wsSummary.getRow(subRowNum);
        sHeaderRow.height = 18;
        sHeaders.forEach((h, i) => {
            const cell = sHeaderRow.getCell(i + 1);
            cell.value = h;
            cell.font = { name: "Arial", bold: true, size: 9, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
            cell.alignment = { horizontal: "center", vertical: "middle" };
        });

        wsSummary.columns = Array(sCols).fill({ width: 14 });

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
                r.totalGrossHrs, r.totalWorkHrs, r.avgWorkHrs,
                r.totalBreakHrs, r.totalDeductedHrs,
                r.totalOTHrs, r.totalLateHrs,
                attDisplay, grade,
                r.basic, r.hra, r.da, r.bonus, r.perDay, r.perHour, r.overtimeRate,
            ];

            vals.forEach((v, i) => {
                const c = row.getCell(i + 1);
                c.value = v;
                c.font = { name: "Arial", size: 9, bold: i <= 1, color: { argb: isDummy ? "FF888888" : "FF000000" } };
                c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
                c.alignment = { horizontal: (i === 2 || i === 3 || i === 4) ? "left" : "center", vertical: "middle" };
                
                // Highlight flexible shifts in shift column
                if (!isDummy && i === 4 && r.isFlexible) {
                    c.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF0B5394" } };
                }
                
                if (!isDummy && typeof v === "number") {
                    if (i >= 14 && i <= 21) c.numFmt = "0.00";
                    if (i >= 24) c.numFmt = "#,##0.00";
                }
            });

            // Att % formatting
            if (!isDummy && typeof r.attPct === "number") {
                const attCell = row.getCell(23);
                attCell.value = r.attPct / 100;
                attCell.numFmt = "0.0%";
                attCell.font = { name: "Arial", size: 9, bold: true };
                attCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
            }

            // Grade cell
            const gradeCell = row.getCell(24);
            gradeCell.font = { name: "Arial", size: 9, bold: true, color: { argb: gradeColor } };
            gradeCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: gradeBg } };

            // Highlight break deductions
            if (!isDummy && r.totalDeductedHrs > 0) {
                const deductCell = row.getCell(19);
                deductCell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF9C0006" } };
            }

            // Absent highlight
            if (!isDummy && r.absent > 0) {
                row.getCell(12).font = { name: "Arial", size: 9, bold: true, color: { argb: "FF9C0006" } };
                row.getCell(12).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
            }
        });

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
            [15, `=SUM(O${dataStartRow}:O${lastReal})`],
            [16, `=SUM(P${dataStartRow}:P${lastReal})`],
            [17, `=AVERAGE(Q${dataStartRow}:Q${lastReal})`],
            [18, `=SUM(R${dataStartRow}:R${lastReal})`],
            [19, `=SUM(S${dataStartRow}:S${lastReal})`],
            [20, `=SUM(T${dataStartRow}:T${lastReal})`],
            [21, `=AVERAGE(U${dataStartRow}:U${lastReal})`],
            [23, `=AVERAGE(W${dataStartRow}:W${lastReal})`],
        ].forEach(([col, val]) => {
            const c = totRow.getCell(col);
            c.value = val;
            c.font = { name: "Arial", size: 9, bold: true };
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
            c.alignment = { horizontal: "center", vertical: "middle" };
            if (col === 23) c.numFmt = "0.0%";
        });

        wsSummary.autoFilter = { from: { row: subRowNum, column: 1 }, to: { row: subRowNum, column: sCols } };

        // Department Pivot (premium only)
        if (!exceedsFreeLimit) {
            const wsDept = wb.addWorksheet("Dept Pivot");
            wsDept.views = [{ state: "frozen", ySplit: 2 }];

            wsDept.mergeCells(1, 1, 1, 12);
            const dtTitle = wsDept.getCell(1, 1);
            dtTitle.value = `DEPARTMENT-WISE PIVOT  |  ${startDate} to ${endDate}`;
            dtTitle.font = { name: "Arial", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
            dtTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
            dtTitle.alignment = { horizontal: "center", vertical: "middle" };
            wsDept.getRow(1).height = 26;

            const deptHdrs = ["Department", "Headcount", "Present Days", "Absent Days", "Leave Days",
                "Week Off", "Half Days", "Late Days", "Total OT Hrs", "Total Late Hrs", "Total Break Hrs", "Avg Att %"];
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
                        halfDay: 0, late: 0, otHrs: 0, lateHrs: 0, breakHrs: 0, attPctSum: 0,
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
                d.breakHrs += r.totalBreakHrs || 0;
                d.attPctSum += r.attPct || 0;
            });

            [...deptMap.entries()].forEach(([dept, d], idx) => {
                const row = wsDept.addRow([]);
                row.height = 16;
                const bg = idx % 2 === 0 ? ALT_ROW : "FFFFFFFF";
                const avgAtt = d.headcount > 0 ? d.attPctSum / d.headcount / 100 : 0;

                [dept, d.headcount, d.present, d.absent, d.leave, d.weekOff,
                    d.halfDay, d.late, parseFloat(d.otHrs.toFixed(2)),
                    parseFloat(d.lateHrs.toFixed(2)), parseFloat(d.breakHrs.toFixed(2)), avgAtt
                ].forEach((v, i) => {
                    const c = row.getCell(i + 1);
                    c.value = v;
                    c.font = { name: "Arial", size: 9, bold: i === 0 };
                    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
                    c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
                    if (i === 11) c.numFmt = "0.0%";
                });
            });

            wsDept.columns = Array(12).fill({ width: 14 });
        }

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