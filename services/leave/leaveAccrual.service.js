import mongoose from "mongoose";

import LeaveBalance from "../../models/Attandance/LeaveBalance.js";
import LeaveLedger from "../../models/Attandance/LeaveLedger.js";
import Employee from "../../models/Attandance/Employee.js";
import Attendance from "../../models/Attandance/Attendance.js";
import { resolveEmployeePolicy } from "./leavePolicy.service.js";

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Get employee's joining date and policy resolution.
 */
const getEmployeeJoiningInfo = async (employeeId) => {
    const emp = await Employee.findById(employeeId);
    const policyResolution = await resolveEmployeePolicy(employeeId);
    return { emp, joiningDate: emp?.joiningDate, policyResolution };
};

const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

/**
 * Add `days` to the year-level balance and record them in the monthly bucket.
 */
const addCredit = async ({
    employee,
    employeeId,
    leaveTypeId,
    year,
    month,
    days,
    policyId,
}) => {
    const balance = await LeaveBalance.findOneAndUpdate(
        { employeeId, leaveTypeId, year },
        {
            $inc: { allocated: days, balance: days },
            $setOnInsert: {
                companyId: employee.companyId,
                employeeId,
                leaveTypeId,
                year,
                policyId,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const monthlyUpdate = await LeaveBalance.updateOne(
        { _id: balance._id, "monthly.month": month },
        { $inc: { "monthly.$.credited": days } }
    );

    if (monthlyUpdate.modifiedCount === 0) {
        await LeaveBalance.updateOne(
            { _id: balance._id },
            { $push: { monthly: { month, credited: days } } }
        );
    }

    return balance;
};

const writeCreditLedger = async ({
    employee,
    employeeId,
    leaveTypeId,
    year,
    month,
    days,
    reason,
    balanceAfter,
}) => {
    await LeaveLedger.create({
        companyId: employee.companyId,
        employeeId,
        leaveTypeId,
        year,
        month,
        type: "credit",
        days,
        reason,
        balanceAfter,
        createdBy: null,
        source: "cron",
    });
};

const yearlyReason = (year) => `Yearly allocation ${year}`;
const monthlyReason = (year, month) => `Monthly credit ${year}-${month}`;
const earnedReasonPrefix = (year) => `Earned accrual ${year}`;

/**
 * Run yearly fixed leave allocation for a financial year.
 */
export const runYearlyAllocation = async (employeeId, year) => {
    const { emp, joiningDate, policyResolution } = await getEmployeeJoiningInfo(employeeId);
    if (!emp || !policyResolution) return { allocated: 0, reason: "No policy" };

    const { mergedLeaveRules, policy } = policyResolution;
    const fyStartMonth = Math.min(12, Math.max(1, policy?.financialYearStartMonth || 1));
    const fyStart = new Date(year, fyStartMonth - 1, 1);
    const fyEnd = new Date(year + 1, fyStartMonth - 1, 1);
    const now = new Date();

    let totalAllocated = 0;

    for (const [leaveTypeId, rule] of Object.entries(mergedLeaveRules)) {
        if (rule.category !== "yearly_fixed") continue;

        const accrual = rule.accrual || {};
        const limits = rule.limits || {};

        // Eligibility date from joining + waiting period
        const eligibleDate = joiningDate ? new Date(joiningDate) : fyStart;
        eligibleDate.setMonth(eligibleDate.getMonth() + (accrual.afterMonths || 0));
        eligibleDate.setDate(eligibleDate.getDate() + (accrual.afterDays || 0));

        // Only allocate once the employee is eligible and the FY has begun
        if (now < fyStart || now < eligibleDate) continue;

        const reason = yearlyReason(year);
        const already = await LeaveLedger.findOne({
            employeeId,
            leaveTypeId,
            type: "credit",
            reason,
        });
        if (already) continue;

        let amount = Number(accrual.yearlyQuota || 0);
        if (limits.maxPerYear) {
            amount = Math.min(amount, limits.maxPerYear);
        }
        if (amount <= 0) continue;

        const balance = await addCredit({
            employee: emp,
            employeeId,
            leaveTypeId,
            year,
            month: fyStartMonth,
            days: amount,
            policyId: policy?._id,
        });

        await writeCreditLedger({
            employee: emp,
            employeeId,
            leaveTypeId,
            year,
            month: fyStartMonth,
            days: amount,
            reason,
            balanceAfter: balance.balance,
        });

        totalAllocated += amount;
    }

    return { allocated: totalAllocated };
};

/**
 * Run monthly leave credit for the given year/month.
 */
export const runMonthlyCredit = async (employeeId, year, month) => {
    const { emp, joiningDate, policyResolution } = await getEmployeeJoiningInfo(employeeId);
    if (!emp || !policyResolution) return { credited: 0, reason: "No policy" };

    const { mergedLeaveRules, policy } = policyResolution;
    let totalCredited = 0;

    for (const [leaveTypeId, rule] of Object.entries(mergedLeaveRules)) {
        if (rule.category !== "monthly") continue;

        const accrual = rule.accrual || {};
        const limits = rule.limits || {};

        const eligibleDate = joiningDate ? new Date(joiningDate) : new Date(year, month - 1, 1);
        eligibleDate.setMonth(eligibleDate.getMonth() + (accrual.afterMonths || 0));
        eligibleDate.setDate(eligibleDate.getDate() + (accrual.afterDays || 0));

        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

        if (eligibleDate > monthEnd) continue;

        const reason = monthlyReason(year, month);
        const already = await LeaveLedger.findOne({
            employeeId,
            leaveTypeId,
            type: "credit",
            reason,
        });
        if (already) continue;

        let amount = Number(accrual.creditPerMonth ?? 1);

        // Optionally prorate the first month based on remaining days
        if (accrual.prorateFirstMonth && joiningDate) {
            const joining = new Date(joiningDate);
            if (joining >= monthStart && joining <= monthEnd) {
                const daysInMonth = monthEnd.getDate();
                const remaining = daysInMonth - joining.getDate() + 1;
                amount = amount * (remaining / daysInMonth);
                amount = Math.round(amount * 2) / 2;
            }
        }

        if (limits.maxPerMonth) {
            const balanceDoc = await LeaveBalance.findOne({ employeeId, leaveTypeId, year }).lean();
            const bucket = balanceDoc?.monthly?.find((m) => m.month === month);
            const alreadyThisMonth = bucket?.credited || 0;
            amount = Math.min(amount, Math.max(0, limits.maxPerMonth - alreadyThisMonth));
        }

        if (limits.maxPerYear) {
            const balanceDoc = await LeaveBalance.findOne({ employeeId, leaveTypeId, year }).lean();
            const allocatedThisYear = balanceDoc?.allocated || 0;
            amount = Math.min(amount, Math.max(0, limits.maxPerYear - allocatedThisYear));
        }

        if (amount <= 0) continue;

        const balance = await addCredit({
            employee: emp,
            employeeId,
            leaveTypeId,
            year,
            month,
            days: amount,
            policyId: policy?._id,
        });

        await writeCreditLedger({
            employee: emp,
            employeeId,
            leaveTypeId,
            year,
            month,
            days: amount,
            reason,
            balanceAfter: balance.balance,
        });

        totalCredited += amount;
    }

    return { credited: totalCredited };
};

/**
 * Run earned/attendance-based leave accrual for the given year.
 * Counts qualifying attendance days and credits leave for each full block.
 */
export const runEarnedAccrual = async (employeeId, year) => {
    const { emp, joiningDate, policyResolution } = await getEmployeeJoiningInfo(employeeId);
    if (!emp || !policyResolution) return { credited: 0, reason: "No policy" };

    const { mergedLeaveRules, policy } = policyResolution;
    let totalCredited = 0;

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const startDate = joiningDate && new Date(joiningDate) > yearStart
        ? startOfDay(joiningDate)
        : yearStart;

    for (const [leaveTypeId, rule] of Object.entries(mergedLeaveRules)) {
        if (rule.category !== "earned") continue;

        const accrual = rule.accrual || {};
        const limits = rule.limits || {};
        const countStatuses = accrual.countStatuses?.length
            ? accrual.countStatuses
            : ["present", "half_day"];
        const workingDaysPerCredit = Math.max(1, accrual.workingDaysPerCredit || 20);
        const creditDays = Number(accrual.creditDays ?? 1);
        const halfDayCredit = Number(accrual.halfDayCredit ?? 0.5);

        const records = await Attendance.find({
            employeeId,
            companyId: emp.companyId,
            status: { $in: countStatuses },
            date: { $gte: startDate, $lt: yearEnd },
        }).lean();

        let qualifyingDays = 0;
        for (const rec of records) {
            if (rec.status === "half_day") {
                qualifyingDays += halfDayCredit;
            } else {
                qualifyingDays += 1;
            }
        }

        const earnedCredits = Math.floor(qualifyingDays / workingDaysPerCredit) * creditDays;
        if (earnedCredits <= 0) continue;

        // Only credit the delta versus what was already credited this year
        const creditedSoFarAgg = await LeaveLedger.aggregate([
            {
                $match: {
                    employeeId: new mongoose.Types.ObjectId(employeeId),
                    leaveTypeId: new mongoose.Types.ObjectId(leaveTypeId),
                    year,
                    type: "credit",
                    reason: { $regex: `^${earnedReasonPrefix(year)}` },
                },
            },
            { $group: { _id: null, total: { $sum: "$days" } } },
        ]);
        const creditedSoFar = creditedSoFarAgg[0]?.total || 0;
        let amount = earnedCredits - creditedSoFar;

        if (limits.maxPerYear) {
            const balanceDoc = await LeaveBalance.findOne({ employeeId, leaveTypeId, year }).lean();
            const allocatedThisYear = balanceDoc?.allocated || 0;
            amount = Math.min(amount, Math.max(0, limits.maxPerYear - allocatedThisYear));
        }

        if (amount <= 0) continue;

        const month = new Date().getMonth() + 1;
        const balance = await addCredit({
            employee: emp,
            employeeId,
            leaveTypeId,
            year,
            month,
            days: amount,
            policyId: policy?._id,
        });

        await writeCreditLedger({
            employee: emp,
            employeeId,
            leaveTypeId,
            year,
            month,
            days: amount,
            reason: `${earnedReasonPrefix(year)} (${Math.round(qualifyingDays)} qualifying days)`,
            balanceAfter: balance.balance,
        });

        totalCredited += amount;
    }

    return { credited: totalCredited };
};

export default { runYearlyAllocation, runMonthlyCredit, runEarnedAccrual };
