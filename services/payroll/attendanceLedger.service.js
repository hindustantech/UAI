// services/payroll/attendanceLedger.service.js
//
// Single source of truth for turning raw attendance + leave + holiday data
// into a payroll-ready attendance summary.
//
// Day-by-day precedence:
//   1. present / half_day / comp_off attendance record
//   2. approved leave (paid or unpaid, from LeaveType.paid)
//   3. company holiday
//   4. weekly off / half-day weekly off
//   5. absent / missing record on a working day
//
// The ledger is always clamped to the employee's employment window
// (jobInfo.joiningDate .. deactivatedAt) so new joiners and exits are
// prorated instead of being marked absent.

import Attendance from "../../models/Attandance/Attendance.js";
import AttendanceRequest from "../../models/Attandance/Request.js";
import Holiday from "../../models/Attandance/Holiday.js";
import Employee from "../../models/Attandance/Employee.js";
import Shift from "../../models/Attandance/Shift.js";

const DAY_MS = 1000 * 60 * 60 * 24;
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const startOfDay = (value) => {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
};

/** Local (not UTC) date key — avoids timezone off-by-one errors. */
export const toDateKey = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

export const getMonthDays = (month, year) => {
    const m = Number(month);
    const y = Number(year);
    if (!m || !y) return 30;
    return new Date(y, m, 0).getDate();
};

export const getWeeklyOffs = (employee) => {
    if (Array.isArray(employee?.weeklyOff) && employee.weeklyOff.length) {
        return employee.weeklyOff;
    }
    if (Array.isArray(employee?.shift?.weeklyOff) && employee.shift.weeklyOff.length) {
        return employee.shift.weeklyOff;
    }
    return [];
};

export const getWeeklyOffHalfDays = (employee) => {
    if (Array.isArray(employee?.weeklyOffHalfDay) && employee.weeklyOffHalfDay.length) {
        return employee.weeklyOffHalfDay;
    }
    if (Array.isArray(employee?.shift?.weeklyOffHalfDay) && employee.shift.weeklyOffHalfDay.length) {
        return employee.shift.weeklyOffHalfDay;
    }
    return [];
};

export const holidayAppliesToEmployee = (holiday, employee) => {
    const applicable = holiday?.applicableTo || {};

    if (Array.isArray(applicable.departments) && applicable.departments.length) {
        const dept = employee?.jobInfo?.department;
        if (!dept || !applicable.departments.includes(dept)) return false;
    }

    if (Array.isArray(applicable.roles) && applicable.roles.length) {
        const role = employee?.role;
        if (!role || !applicable.roles.includes(role)) return false;
    }

    return true;
};

const resolveShift = async (employee) => {
    if (!employee?.shift) return employee;
    if (Array.isArray(employee.shift.weeklyOff)) return employee;

    try {
        const shift = await Shift.findById(employee.shift).lean();
        if (shift) {
            return { ...employee, shift };
        }
    } catch {
        // ignore — fall back to employee.weeklyOff
    }
    return employee;
};

const asNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * Build the payroll attendance ledger for one employee / month.
 *
 * @param {object} params
 * @param {object} [params.employee] Mongoose doc or lean object
 * @param {string|object} [params.employeeId] used when employee is not supplied
 * @param {number} params.month 1-12
 * @param {number} params.year
 * @param {object} [params.data] optional pre-fetched raw data (tests / integrations)
 * @returns {Promise<object>} attendance summary + LOP breakdown
 */
export async function buildAttendanceLedger({ employee, employeeId, month, year, data }) {
    const m = Number(month);
    const y = Number(year);

    if (!m || m < 1 || m > 12 || !y) {
        throw new Error("A valid month (1-12) and year are required.");
    }

    let emp = employee;
    if (!emp) {
        emp = await Employee.findById(employeeId).lean();
    }
    if (!emp) throw new Error("Employee not found.");

    emp = await resolveShift(emp);

    const employeeObjectId = emp._id;
    const companyId = emp.companyId;

    const standardDays = getMonthDays(m, y);
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m - 1, standardDays, 23, 59, 59, 999);

    /* ── Employment window ─────────────────────────────────────────── */
    const joiningRaw = emp?.jobInfo?.joiningDate || emp?.joiningDate || null;
    const exitRaw = emp?.deactivatedAt || null;

    const joining = joiningRaw ? startOfDay(joiningRaw) : null;
    const exit = exitRaw ? startOfDay(exitRaw) : null;

    let windowStart = monthStart;
    let windowEnd = startOfDay(monthEnd);

    if (joining && joining > windowStart) windowStart = joining;
    if (exit && exit < windowEnd) windowEnd = exit;

    const employed = windowStart <= windowEnd;
    const employmentCalendarDays = employed
        ? Math.floor((startOfDay(windowEnd) - startOfDay(windowStart)) / DAY_MS) + 1
        : 0;
    const prorationDays = Math.max(0, standardDays - employmentCalendarDays);

    const weeklyOffs = getWeeklyOffs(emp);
    const weeklyOffHalfDays = getWeeklyOffHalfDays(emp);

    /* ── Fetch raw data ─────────────────────────────────────────────── */
    const [records, holidays, leaveRequests, compOffRequests] = data
        ? [
            data.records || [],
            data.holidays || [],
            data.leaveRequests || [],
            data.compOffRequests || [],
        ]
        : await Promise.all([
        Attendance.find({
            employeeId: employeeObjectId,
            date: { $gte: monthStart, $lte: monthEnd },
        }).lean(),
        Holiday.find({
            companyId,
            date: { $gte: monthStart, $lte: monthEnd },
        }).lean(),
        AttendanceRequest.find({
            employeeId: employeeObjectId,
            companyId,
            requestType: "leave",
            status: "approved",
            "leaveDetails.startDate": { $lte: monthEnd },
            "leaveDetails.endDate": { $gte: monthStart },
        })
            .populate("leaveTypeId", "name code paid")
            .lean(),
        AttendanceRequest.find({
            employeeId: employeeObjectId,
            companyId,
            requestType: "comp_off",
            status: "approved",
            "leaveDetails.startDate": { $lte: monthEnd },
            "leaveDetails.endDate": { $gte: monthStart },
        }).lean(),
    ]);

    const recordByKey = new Map();
    for (const rec of records) {
        const key = toDateKey(rec.date);
        if (key) recordByKey.set(key, rec);
    }

    const holidayByKey = new Map();
    for (const holiday of holidays) {
        if (!holidayAppliesToEmployee(holiday, emp)) continue;
        const key = toDateKey(holiday.date);
        if (key) holidayByKey.set(key, holiday);
    }

    /* ── Expand approved leave into per-day entries ─────────────────── */
    const leaveDayMap = new Map();
    const leaveBreakdownMap = new Map();

    for (const request of leaveRequests) {
        if (!request?.leaveDetails?.startDate || !request?.leaveDetails?.endDate) continue;

        const leaveType = request.leaveTypeId;
        const leaveTypeId = String(leaveType?._id || request.leaveTypeId || "");
        const leaveTypeName = leaveType?.name || "Leave";
        const leaveTypeCode = leaveType?.code || "";
        const paid = typeof leaveType?.paid === "boolean"
            ? leaveType.paid
            : request.isPaid !== false;

        const isHalfDay = Boolean(request.isHalfDay);

        let remaining = asNumber(request.leaveDays, 0);
        if (remaining <= 0) remaining = isHalfDay ? 0.5 : Number.POSITIVE_INFINITY;

        const start = startOfDay(request.leaveDetails.startDate);
        const end = startOfDay(request.leaveDetails.endDate);

        for (let d = new Date(start); d <= end; d = new Date(d.getTime() + DAY_MS)) {
            if (remaining <= 0) break;
            if (d < startOfDay(windowStart) || d > startOfDay(windowEnd)) continue;

            const key = toDateKey(d);
            if (!key) continue;
            if (recordByKey.get(key)) {
                const status = recordByKey.get(key).status;
                // A worked full day or comp-off never becomes leave. A half-day
                // record may still be topped up by an approved half-day leave.
                if (["present", "comp_off"].includes(status)) continue;
                if (status === "half_day" && !isHalfDay) continue;
            }
            if (holidayByKey.has(key)) continue;

            const dayName = DOW[d.getDay()];
            if (weeklyOffs.includes(dayName)) continue;
            if (weeklyOffHalfDays.includes(dayName)) continue;

            const allocated = isHalfDay
                ? Math.min(0.5, remaining)
                : Math.min(1, remaining);

            const existing = leaveDayMap.get(key);
            if (existing) {
                // Already covered by another approved request — do not double count.
                remaining -= allocated;
                continue;
            }

            leaveDayMap.set(key, {
                leaveTypeId,
                leaveTypeName,
                leaveTypeCode,
                paid,
                days: allocated,
                requestId: request._id,
            });

            const aggKey = `${leaveTypeId}:${paid ? "paid" : "unpaid"}`;
            const agg = leaveBreakdownMap.get(aggKey) || {
                leaveTypeId,
                leaveTypeName,
                leaveTypeCode,
                paid,
                days: 0,
            };
            agg.days += allocated;
            leaveBreakdownMap.set(aggKey, agg);

            remaining -= allocated;
        }
    }

    /* ── Approved comp-off dates ────────────────────────────────────── */
    const compOffDates = new Set();
    for (const request of compOffRequests) {
        if (!request?.leaveDetails?.startDate || !request?.leaveDetails?.endDate) continue;
        const start = startOfDay(request.leaveDetails.startDate);
        const end = startOfDay(request.leaveDetails.endDate);
        for (let d = new Date(start); d <= end; d = new Date(d.getTime() + DAY_MS)) {
            const key = toDateKey(d);
            if (key) compOffDates.add(key);
        }
    }

    /* ── Walk the employment window day by day ──────────────────────── */
    let workingDays = 0;
    let presentDays = 0;
    let absentDays = 0;
    let halfDays = 0;
    let leaveDays = 0;
    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;
    let unpaidHalfDays = 0;
    let holidaysCount = 0;
    let weeklyOffDays = 0;
    let weeklyOffHalfDaysCount = 0;
    let lateDays = 0;
    let totalPayableMinutes = 0;
    let totalMinutes = 0;
    let overtimeMinutes = 0;
    let compOffUsed = 0;

    for (let d = new Date(startOfDay(windowStart)); d <= startOfDay(windowEnd); d = new Date(d.getTime() + DAY_MS)) {
        const key = toDateKey(d);
        const rec = recordByKey.get(key);
        const leaveDay = leaveDayMap.get(key);
        const dayName = DOW[d.getDay()];
        const isWeeklyOff = weeklyOffs.includes(dayName);
        const isWeeklyOffHalf = weeklyOffHalfDays.includes(dayName);
        const isHoliday = holidayByKey.has(key);

        const isWorkingDay = !isWeeklyOff && !isWeeklyOffHalf && !isHoliday;
        if (isWorkingDay) workingDays += 1;

        /* 1. Worked / comp-off record wins */
        if (rec && ["present", "half_day", "comp_off"].includes(rec.status)) {
            if (rec.status !== "present autocheckout") {
                totalPayableMinutes += rec.workSummary?.payableMinutes ?? 0;
                totalMinutes += rec.workSummary?.totalMinutes ?? 0;
                if (!isWeeklyOff && !isHoliday && rec.status !== "holiday" && rec.status !== "week_off") {
                    overtimeMinutes += rec.workSummary?.overtimeMinutes ?? 0;
                }
            }

            if (rec.status === "present") {
                presentDays += 1;
                if ((rec.workSummary?.lateMinutes ?? 0) > 0) lateDays += 1;
            } else if (rec.status === "comp_off") {
                presentDays += 1;
                compOffUsed += 1;
            } else {
                // half_day: 0.5 payable. The other half is LOP unless a paid
                // half-day leave covers it.
                halfDays += 1;
                presentDays += 0.5;

                if (leaveDay?.paid) {
                    paidLeaveDays += 0.5;
                } else if (leaveDay) {
                    unpaidLeaveDays += 0.5;
                } else {
                    unpaidHalfDays += 0.5;
                }
            }
            continue;
        }

        /* 2. Approved leave */
        if (leaveDay) {
            leaveDays += leaveDay.days;
            if (leaveDay.paid) paidLeaveDays += leaveDay.days;
            else unpaidLeaveDays += leaveDay.days;

            if (leaveDay.days === 0.5) {
                // Half-day leave = 0.5 paid day + 0.5 not worked.
                presentDays += 0.5;
                halfDays += 1;
            }
            continue;
        }

        /* 3. Holiday */
        if (isHoliday) {
            holidaysCount += 1;
            const holidayRecord = recordByKey.get(key);
            if (holidayRecord) {
                totalPayableMinutes += holidayRecord.workSummary?.payableMinutes ?? 0;
                totalMinutes += holidayRecord.workSummary?.totalMinutes ?? 0;
            }
            continue;
        }

        /* 4. Weekly offs */
        if (isWeeklyOff) {
            weeklyOffDays += 1;
            continue;
        }
        if (isWeeklyOffHalf) {
            weeklyOffHalfDaysCount += 1;
            continue;
        }

        /* 5. Approved comp-off with no attendance record */
        if (compOffDates.has(key)) {
            compOffUsed += 1;
            presentDays += 1;
            continue;
        }

        /* 6. Fall back to whatever attendance record exists */
        if (rec) {
            const status = rec.status;

            if (status !== "present autocheckout") {
                totalPayableMinutes += rec.workSummary?.payableMinutes ?? 0;
                totalMinutes += rec.workSummary?.totalMinutes ?? 0;
                if (!isWeeklyOff && !isHoliday) {
                    overtimeMinutes += rec.workSummary?.overtimeMinutes ?? 0;
                }
            }

            switch (status) {
                case "absent":
                case "present autocheckout":
                case "pending_approval":
                case "rejected":
                case "system_auto":
                    absentDays += 1;
                    break;
                case "leave":
                    // Leave record without an approved request -> unpaid.
                    leaveDays += 1;
                    unpaidLeaveDays += 1;
                    break;
                case "holiday":
                    holidaysCount += 1;
                    break;
                case "week_off":
                case "weekly_off":
                    weeklyOffDays += 1;
                    break;
                case "week_off_half":
                    weeklyOffHalfDaysCount += 1;
                    break;
                case "half_day":
                    // handled above, but keep safe
                    halfDays += 1;
                    presentDays += 0.5;
                    unpaidHalfDays += 0.5;
                    break;
                default:
                    absentDays += 1;
                    break;
            }
            continue;
        }

        /* 7. No record on a working day -> absent (LOP) */
        absentDays += 1;
    }

    const lopDays = roundTo2(absentDays + unpaidLeaveDays + unpaidHalfDays);
    const payableDays = Math.min(
        standardDays,
        roundTo2(
            presentDays +
            paidLeaveDays +
            holidaysCount +
            weeklyOffDays +
            weeklyOffHalfDaysCount * 0.5
        )
    );

    return {
        standardDays,
        employmentCalendarDays,
        prorationDays,
        workingDays,
        presentDays: roundTo2(presentDays),
        absentDays,
        halfDays,
        leaveDays: roundTo2(leaveDays),
        paidLeaveDays: roundTo2(paidLeaveDays),
        unpaidLeaveDays: roundTo2(unpaidLeaveDays),
        unpaidHalfDays: roundTo2(unpaidHalfDays),
        holidays: holidaysCount,
        weeklyOffDays,
        weeklyOffHalfDays: weeklyOffHalfDaysCount,
        lateDays,
        totalPayableMinutes,
        totalMinutes,
        overtimeMinutes,
        compOffUsed,
        compOffDaysUsed: compOffUsed,
        lopDays,
        payableDays,
        leaveBreakdown: Array.from(leaveBreakdownMap.values()).map((item) => ({
            ...item,
            days: roundTo2(item.days),
        })),
        periodStart: monthStart,
        periodEnd: monthEnd,
        windowStart: employed ? windowStart : null,
        windowEnd: employed ? windowEnd : null,
    };
}

function roundTo2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export default buildAttendanceLedger;
