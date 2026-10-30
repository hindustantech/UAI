import mongoose from "mongoose";

import LeavePolicy from "../../models/Attandance/LeavePolicy.js";
import LeaveType from "../../models/Attandance/LeaveType.js";
import LeaveBalance from "../../models/Attandance/LeaveBalance.js";
import LeaveLedger from "../../models/Attandance/LeaveLedger.js";
import Employee from "../../models/Attandance/Employee.js";
import Holiday from "../../models/Attandance/Holiday.js";

const DAY_MS = 1000 * 60 * 60 * 24;

const deepMerge = (base, override) => {
    if (!override) return base;
    const result = { ...(base || {}) };
    for (const key of Object.keys(override)) {
        const value = override[key];
        if (value === undefined || value === null) continue;
        if (typeof value === "object" && !Array.isArray(value)) {
            result[key] = deepMerge(result[key], value);
        } else {
            result[key] = value;
        }
    }
    return result;
};

const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const dayKey = (date) => startOfDay(date).toISOString().slice(0, 10);

/**
 * Resolve the leave policy and per-employee overrides for a given employee.
 * Returns { policy, employee, mergedLeaveRules, employeeOverride } or null.
 */
export const resolveEmployeePolicy = async (employeeId) => {
    const employee = await Employee.findById(employeeId).populate("leavePolicy.policyId");
    if (!employee || !employee.leavePolicy?.policyId) {
        return null;
    }

    const policy = employee.leavePolicy.policyId;
    const overrides = employee.leavePolicy.overrides || [];

    // Fetch leave types so we can attach the catalog category to each rule
    const typeIds = policy.leaveRules.map((r) => r.leaveTypeId).filter(Boolean);
    const leaveTypes = await LeaveType.find({ _id: { $in: typeIds } }).lean();
    const typeMap = new Map(leaveTypes.map((t) => [String(t._id), t]));

    const mergedLeaveRules = {};

    for (const rule of policy.leaveRules) {
        if (!rule.leaveTypeId) continue;
        const key = String(rule.leaveTypeId);
        const override = overrides.find((o) => String(o.leaveTypeId) === key);
        const type = typeMap.get(key);

        mergedLeaveRules[key] = {
            leaveTypeId: rule.leaveTypeId,
            category: type?.category || rule.category,
            name: type?.name,
            code: type?.code,
            paid: type?.paid ?? true,
            accrual: deepMerge(rule.accrual?.toObject?.() || rule.accrual || {}, override?.accrual),
            limits: deepMerge(rule.limits?.toObject?.() || rule.limits || {}, override?.limits),
            lifecycle: deepMerge(rule.lifecycle?.toObject?.() || rule.lifecycle || {}, override?.lifecycle),
            requestRules: deepMerge(
                rule.requestRules?.toObject?.() || rule.requestRules || {},
                override?.requestRules
            ),
        };
    }

    // Include any leave types present only as employee overrides (rare)
    for (const override of overrides) {
        if (!override.leaveTypeId) continue;
        const key = String(override.leaveTypeId);
        if (mergedLeaveRules[key]) continue;

        const type = typeMap.get(key);
        mergedLeaveRules[key] = {
            leaveTypeId: override.leaveTypeId,
            category: type?.category,
            name: type?.name,
            code: type?.code,
            paid: type?.paid ?? true,
            accrual: override.accrual || {},
            limits: override.limits || {},
            lifecycle: override.lifecycle || {},
            requestRules: override.requestRules || {},
        };
    }

    return {
        policy,
        employee,
        mergedLeaveRules,
        employeeOverride: overrides[0] || null,
    };
};

/**
 * Check if a leave request is eligible based on waiting period.
 * Returns { eligible, reason, eligibleFrom, daysUntilEligible, rule }.
 */
export const validateLeaveEligibility = async (
    employeeId,
    leaveTypeId,
    startDate,
    endDate,
    requestType = "create"
) => {
    const emp = await Employee.findById(employeeId);
    if (!emp) {
        return { eligible: false, reason: "Employee not found", eligibleFrom: null };
    }

    const resolution = await resolveEmployeePolicy(employeeId);
    // If no policy assigned, allow with default waiting of 0
    if (!resolution) {
        return { eligible: true, reason: null, eligibleFrom: null, rule: null };
    }

    const { mergedLeaveRules } = resolution;
    const rule = mergedLeaveRules[String(leaveTypeId)];
    if (!rule) {
        return {
            eligible: false,
            reason: "Leave type not configured for this employee",
            eligibleFrom: null,
            rule: null,
        };
    }

    const accrual = rule.accrual || {};
    const joining = emp.joiningDate ? new Date(emp.joiningDate) : null;

    // No joining date configured -> treat as eligible (data not set up yet)
    if (!joining || Number.isNaN(joining.getTime())) {
        return { eligible: true, reason: null, eligibleFrom: null, rule };
    }

    const eligibleDate = new Date(joining);
    eligibleDate.setMonth(eligibleDate.getMonth() + (accrual.afterMonths || 0));
    eligibleDate.setDate(eligibleDate.getDate() + (accrual.afterDays || 0));

    const start = startOfDay(startDate);
    const now = startOfDay(new Date());
    const daysUntilEligible = Math.max(
        0,
        Math.ceil((eligibleDate - now) / DAY_MS)
    );

    if (start < startOfDay(eligibleDate)) {
        return {
            eligible: false,
            reason: `Leave not eligible before ${eligibleDate.toLocaleDateString()}. ${daysUntilEligible} day(s) remaining.`,
            eligibleFrom: eligibleDate,
            daysUntilEligible,
            rule,
        };
    }

    return {
        eligible: true,
        reason: null,
        eligibleFrom: eligibleDate,
        daysUntilEligible,
        rule,
    };
};

/**
 * Count chargeable leave days between two dates (inclusive), excluding weekly
 * offs, half-day weekly offs (counted as 0.5) and company holidays.
 */
export const countWorkingDays = async (employeeId, startDate, endDate) => {
    const employee = await Employee.findById(employeeId).populate("shift");
    if (!employee) return 0;

    const weeklyOff = employee.weeklyOff?.length
        ? employee.weeklyOff
        : (employee.shift?.weeklyOff?.length ? employee.shift.weeklyOff : []);
    const weeklyOffHalfDay = employee.weeklyOffHalfDay || [];

    const start = startOfDay(startDate);
    const end = startOfDay(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        return 0;
    }

    const holidays = await Holiday.find({
        companyId: employee.companyId,
        date: { $gte: start, $lte: new Date(end.getTime() + DAY_MS) },
    }).lean();
    const holidayKeys = new Set(holidays.map((h) => dayKey(h.date)));

    let days = 0;
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + DAY_MS)) {
        const key = dayKey(d);
        if (holidayKeys.has(key)) continue;

        const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
        if (weeklyOff.includes(dayName)) continue;
        days += weeklyOffHalfDay.includes(dayName) ? 0.5 : 1;
    }

    return days;
};

const getBalanceDoc = (employeeId, leaveTypeId, year) =>
    LeaveBalance.findOne({ employeeId, leaveTypeId, year });

/**
 * Reserve (hold) leave days for a pending request.
 * Moves days from available `balance` into `pending`.
 */
export const reserveLeave = async (employeeId, leaveTypeId, days, reason, requestId, adminId, year = new Date().getFullYear()) => {
    if (!days || days <= 0) return { reserved: 0, balanceAfter: 0, ledger: null };

    const employee = await Employee.findById(employeeId);
    if (!employee) return { reserved: 0, balanceAfter: 0, ledger: null };

    const balanceDoc = await getBalanceDoc(employeeId, leaveTypeId, year);
    const available = balanceDoc?.balance || 0;
    const reserved = Math.min(days, Math.max(0, available));
    if (reserved <= 0) {
        return { reserved: 0, balanceAfter: available, ledger: null };
    }

    const updated = await LeaveBalance.findOneAndUpdate(
        { employeeId, leaveTypeId, year },
        {
            $inc: { pending: reserved, balance: -reserved },
            $setOnInsert: {
                companyId: employee.companyId,
                employeeId,
                leaveTypeId,
                year,
                policyId: employee.leavePolicy?.policyId,
            },
        },
        { upsert: true, new: true }
    );

    const ledger = await LeaveLedger.create({
        companyId: employee.companyId,
        employeeId,
        leaveTypeId,
        year,
        month: new Date().getMonth() + 1,
        type: "debit",
        days: reserved,
        requestId,
        reason: reason || `Reserved for request ${requestId}`,
        balanceAfter: updated.balance,
        createdBy: adminId || null,
        source: adminId ? "user" : "system",
    });

    return { reserved, balanceAfter: updated.balance, ledger };
};

/**
 * Convert reserved (pending) days into used days once a request is approved.
 */
export const commitLeave = async (employeeId, leaveTypeId, days, requestId, adminId, year = new Date().getFullYear()) => {
    if (!days || days <= 0) return { committed: 0, balanceAfter: 0, ledger: null };

    const employee = await Employee.findById(employeeId);
    if (!employee) return { committed: 0, balanceAfter: 0, ledger: null };

    const balanceDoc = await getBalanceDoc(employeeId, leaveTypeId, year);
    if (!balanceDoc) return { committed: 0, balanceAfter: 0, ledger: null };

    const pendingDays = Math.min(days, balanceDoc.pending || 0);
    const updated = await LeaveBalance.findOneAndUpdate(
        { _id: balanceDoc._id },
        { $inc: { pending: -pendingDays, used: pendingDays } },
        { new: true }
    );

    const ledger = await LeaveLedger.create({
        companyId: employee.companyId,
        employeeId,
        leaveTypeId,
        year,
        month: new Date().getMonth() + 1,
        type: "debit",
        days: pendingDays,
        requestId,
        reason: `Consumed for request ${requestId}`,
        balanceAfter: updated.balance,
        createdBy: adminId || null,
        source: adminId ? "user" : "system",
    });

    return { committed: pendingDays, balanceAfter: updated.balance, ledger };
};

/**
 * Release reserved days (on reject/cancel). Moves `pending` back to `balance`.
 */
export const releaseLeave = async (employeeId, leaveTypeId, days, reason, requestId, adminId, year = new Date().getFullYear()) => {
    if (!days || days <= 0) return { released: 0, balanceAfter: 0, ledger: null };

    const employee = await Employee.findById(employeeId);
    if (!employee) return { released: 0, balanceAfter: 0, ledger: null };

    const balanceDoc = await getBalanceDoc(employeeId, leaveTypeId, year);
    if (!balanceDoc) return { released: 0, balanceAfter: 0, ledger: null };

    const pendingDays = Math.min(days, balanceDoc.pending || 0);
    if (pendingDays <= 0) {
        return { released: 0, balanceAfter: balanceDoc.balance, ledger: null };
    }

    const updated = await LeaveBalance.findOneAndUpdate(
        { _id: balanceDoc._id },
        { $inc: { pending: -pendingDays, balance: pendingDays } },
        { new: true }
    );

    const ledger = await LeaveLedger.create({
        companyId: employee.companyId,
        employeeId,
        leaveTypeId,
        year,
        month: new Date().getMonth() + 1,
        type: "reversal",
        days: pendingDays,
        requestId,
        reason: reason || `Released for request ${requestId}`,
        balanceAfter: updated.balance,
        createdBy: adminId || null,
        source: adminId ? "user" : "system",
    });

    return { released: pendingDays, balanceAfter: updated.balance, ledger };
};

export default {
    resolveEmployeePolicy,
    validateLeaveEligibility,
    countWorkingDays,
    reserveLeave,
    commitLeave,
    releaseLeave,
};
