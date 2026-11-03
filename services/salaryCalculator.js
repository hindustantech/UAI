// services/salaryCalculator.js
//
// Payroll calculation engine.
//
// Locked rules:
//   • Day-count basis: actual calendar days of the payroll month.
//   • LOP = absent days + unpaid leave days + 0.5 per unpaid half-day.
//   • Paid leave, holidays and weekly offs stay paid.
//   • Late salary-rule cuts are applied; half-day cuts are NOT applied on top
//     of LOP (the half-day is already counted as 0.5 LOP).
//   • PF on earned basic, ESI only when gross ≤ ₹21,000.
//   • Gratuity is an employer contribution and is never deducted from net.
//   • Net salary is clamped at zero.

import dayjs from "dayjs";

const STANDARD_MONTH_DAYS = 30;
const ESI_WAGE_CEILING = 21000;

const MONTHS_31_DAYS = [1, 3, 5, 7, 8, 10, 12];

export function getMonthDays(month, year) {
    const m = Number(month);
    const y = Number(year);

    if (!m || !y) {
        const now = dayjs();
        return getMonthDays(now.month() + 1, now.year());
    }

    if (MONTHS_31_DAYS.includes(m)) return 31;
    if (m === 2) {
        const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        return isLeap ? 29 : 28;
    }
    return 30;
}

export function calculateSalary({
    employee,
    attendance,
    salaryRule,
    payrollRule,
    payPeriod,
    payDate,
    generatedBy,
    standardDays,
}) {
    if (!employee?.salaryStructure?.basic && !employee?.salaryStructure?.perHour && !employee?.salaryStructure?.perDay) {
        throw new Error("Employee salary structure (basic, perHour or perDay) is required.");
    }

    const sal = employee.salaryStructure || {};
    const payType = sal.perHour > 0 ? "hourly" : sal.perDay > 0 ? "perday" : "monthly";
    const salaryApproach = sal.salaryApproach || "full_minus_lop";

    const stdDays = Number(standardDays)
        || Number(attendance?.standardDays)
        || getMonthDays(payPeriod?.month, payPeriod?.year)
        || STANDARD_MONTH_DAYS;

    const ctx = {
        employee,
        attendance: attendance || {},
        salaryRule,
        payrollRule,
        payPeriod,
        payDate,
        generatedBy,
        stdDays,
    };

    let result;
    if (payType === "hourly") {
        result = calculateHourly(ctx);
    } else if (payType === "perday") {
        result = calculatePerDay(ctx);
    } else if (salaryApproach === "pro_rata") {
        result = calculateMonthlyProRata(ctx);
    } else {
        result = calculateMonthlyFullMinusLOP(ctx);
    }

    result.payType = payType;
    result.salaryApproach = payType === "monthly" ? salaryApproach : "full_minus_lop";
    return result;
}

/* ═══════════════════════════════════════════════════════════════════
   Monthly — full salary minus LOP / proration
   ═══════════════════════════════════════════════════════════════════ */
function calculateMonthlyFullMinusLOP(ctx) {
    const { employee, attendance, salaryRule, payrollRule, stdDays } = ctx;
    const sal = employee.salaryStructure || {};
    const monthly = getMonthlyComponents(sal);

    const perDayRate = roundTo2(monthly.total / stdDays);
    const cuts = computeSalaryRuleCuts(attendance, salaryRule);
    const lateCutAmount = roundTo2(perDayRate * cuts.totalCutDays);

    const overtimeEarned = computeOvertime(attendance, sal.overtimeRate);
    const grossSalary = roundTo2(monthly.total + overtimeEarned);

    const lossOfPay = buildLossOfPay({
        attendance,
        perDayRate,
        mode: "full_minus_lop",
        deducted: true,
    });

    const earnedGross = Math.max(
        0,
        roundTo2(grossSalary - lossOfPay.totalDeductedAmount - lateCutAmount)
    );
    const earnedBasic = roundTo2(
        monthly.basic * (Math.min(stdDays, numberOr(attendance.payableDays, stdDays)) / stdDays)
    );

    const statutory = computeStatutory(payrollRule, earnedBasic, earnedGross);
    const other = getOtherDeductions(employee);

    const totalDeductions = roundTo2(
        statutory.pf +
        statutory.esi +
        other.incomeTax +
        other.professionalTax +
        other.additionalTotal +
        lossOfPay.totalDeductedAmount +
        lateCutAmount
    );

    return buildResult({
        ctx,
        earnings: {
            basic: monthly.basic,
            hra: monthly.hra,
            da: monthly.da,
            bonus: monthly.bonus,
            overtime: overtimeEarned,
            otherAllowances: monthly.otherAllowances,
        },
        grossSalary,
        statutory,
        other,
        lossOfPay,
        totalDeductions,
        netSalary: Math.max(0, roundTo2(grossSalary - totalDeductions)),
        payableDays: numberOr(attendance.payableDays, stdDays),
        salaryRuleDeductions: {
            lateCutDays: cuts.lateCutDays,
            halfDayCutDays: cuts.halfDayCutDays,
            totalCutDays: cuts.totalCutDays,
            salaryRuleCutAmount: lateCutAmount,
        },
        ratesUsed: {
            perDayRate,
            perHourRate: 0,
            perDay: numberOr(sal.perDay, 0),
            perHour: 0,
            overtimeRate: numberOr(sal.overtimeRate, 0),
        },
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Monthly — pro-rata (pay only for payable days)
   ═══════════════════════════════════════════════════════════════════ */
function calculateMonthlyProRata(ctx) {
    const { employee, attendance, salaryRule, payrollRule, stdDays } = ctx;
    const sal = employee.salaryStructure || {};
    const monthly = getMonthlyComponents(sal);

    const perDayRate = roundTo2(monthly.total / stdDays);
    const cuts = computeSalaryRuleCuts(attendance, salaryRule);
    const lateCutAmount = roundTo2(perDayRate * cuts.totalCutDays);

    const payableDays = Math.max(0, numberOr(attendance.payableDays, stdDays));
    const factor = stdDays > 0 ? Math.min(1, payableDays / stdDays) : 0;

    const basicEarned = roundTo2(monthly.basic * factor);
    const hraEarned = roundTo2(monthly.hra * factor);
    const daEarned = roundTo2(monthly.da * factor);
    const bonusEarned = roundTo2(monthly.bonus * factor);
    const otherAllowancesEarned = monthly.otherAllowances.map((a) => ({
        name: a.name,
        amount: roundTo2(a.amount * factor),
    }));
    const otherAllowTotal = roundTo2(
        otherAllowancesEarned.reduce((sum, a) => sum + a.amount, 0)
    );

    const overtimeEarned = computeOvertime(attendance, sal.overtimeRate);
    const grossSalary = roundTo2(
        basicEarned + hraEarned + daEarned + bonusEarned + otherAllowTotal + overtimeEarned
    );

    const lossOfPay = buildLossOfPay({
        attendance,
        perDayRate,
        mode: "pro_rata",
        deducted: false,
    });

    const statutory = computeStatutory(payrollRule, basicEarned + daEarned, grossSalary);
    const other = getOtherDeductions(employee);

    const totalDeductions = roundTo2(
        statutory.pf +
        statutory.esi +
        other.incomeTax +
        other.professionalTax +
        other.additionalTotal +
        lateCutAmount
    );

    return buildResult({
        ctx,
        earnings: {
            basic: basicEarned,
            hra: hraEarned,
            da: daEarned,
            bonus: bonusEarned,
            overtime: overtimeEarned,
            otherAllowances: otherAllowancesEarned,
            prorationFactor: roundTo2(factor),
        },
        grossSalary,
        statutory,
        other,
        lossOfPay,
        totalDeductions,
        netSalary: Math.max(0, roundTo2(grossSalary - totalDeductions)),
        payableDays,
        salaryRuleDeductions: {
            lateCutDays: cuts.lateCutDays,
            halfDayCutDays: cuts.halfDayCutDays,
            totalCutDays: cuts.totalCutDays,
            salaryRuleCutAmount: lateCutAmount,
        },
        ratesUsed: {
            perDayRate,
            perHourRate: 0,
            perDay: numberOr(sal.perDay, 0),
            perHour: 0,
            overtimeRate: numberOr(sal.overtimeRate, 0),
        },
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Per-day
   ═══════════════════════════════════════════════════════════════════ */
function calculatePerDay(ctx) {
    const { employee, attendance, salaryRule, payrollRule } = ctx;
    const sal = employee.salaryStructure || {};

    const perDayRate = numberOr(sal.perDay, 0);
    const cuts = computeSalaryRuleCuts(attendance, salaryRule);

    const payableDays = Math.max(
        0,
        roundTo2(
            numberOr(attendance.presentDays) +
            numberOr(attendance.weeklyOffDays) +
            numberOr(attendance.weeklyOffHalfDays) * 0.5 -
            cuts.totalCutDays
        )
    );

    const dayWages = roundTo2(perDayRate * payableDays);
    const overtimeEarned = computeOvertime(attendance, sal.overtimeRate);
    const grossSalary = roundTo2(dayWages + overtimeEarned);

    const lossOfPay = buildLossOfPay({
        attendance,
        perDayRate,
        mode: "per_day",
        deducted: false,
    });

    const statutory = computeStatutory(payrollRule, dayWages, grossSalary);
    const other = getOtherDeductions(employee);

    const totalDeductions = roundTo2(
        statutory.pf +
        statutory.esi +
        other.incomeTax +
        other.professionalTax +
        other.additionalTotal
    );

    return buildResult({
        ctx,
        earnings: {
            basic: 0,
            hra: 0,
            da: 0,
            bonus: 0,
            overtime: overtimeEarned,
            otherAllowances: [],
            dayWages,
            totalPayableHours: roundTo2(numberOr(attendance.totalPayableMinutes) / 60),
        },
        grossSalary,
        statutory,
        other,
        lossOfPay,
        totalDeductions,
        netSalary: Math.max(0, roundTo2(grossSalary - totalDeductions)),
        payableDays,
        salaryRuleDeductions: {
            lateCutDays: cuts.lateCutDays,
            halfDayCutDays: cuts.halfDayCutDays,
            totalCutDays: cuts.totalCutDays,
            salaryRuleCutAmount: 0,
        },
        ratesUsed: {
            perDayRate,
            perHourRate: 0,
            perDay: perDayRate,
            perHour: 0,
            overtimeRate: numberOr(sal.overtimeRate, 0),
        },
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Hourly
   ═══════════════════════════════════════════════════════════════════ */
function calculateHourly(ctx) {
    const { employee, attendance, payrollRule } = ctx;
    const sal = employee.salaryStructure || {};

    const perHourRate = numberOr(sal.perHour, 0);
    const overtimeRate = numberOr(sal.overtimeRate, 0);

    const totalPayableHours = roundTo2(numberOr(attendance.totalPayableMinutes) / 60);
    const regularEarnings = roundTo2(perHourRate * totalPayableHours);

    const overtimeHours = roundTo2(numberOr(attendance.overtimeMinutes) / 60);
    const overtimeEarned = roundTo2(overtimeRate * overtimeHours);

    const grossSalary = roundTo2(regularEarnings + overtimeEarned);

    const lossOfPay = buildLossOfPay({
        attendance,
        perDayRate: 0,
        mode: "hourly",
        deducted: false,
    });

    const statutory = computeStatutory(payrollRule, grossSalary, grossSalary);
    const other = getOtherDeductions(employee);

    const totalDeductions = roundTo2(
        statutory.pf +
        statutory.esi +
        other.incomeTax +
        other.professionalTax +
        other.additionalTotal
    );

    return buildResult({
        ctx,
        earnings: {
            basic: 0,
            hra: 0,
            da: 0,
            bonus: 0,
            overtime: overtimeEarned,
            otherAllowances: [],
            regularEarnings,
            totalPayableHours,
        },
        grossSalary,
        statutory,
        other,
        lossOfPay,
        totalDeductions,
        netSalary: Math.max(0, roundTo2(grossSalary - totalDeductions)),
        payableDays: 0,
        salaryRuleDeductions: {
            lateCutDays: 0,
            halfDayCutDays: 0,
            totalCutDays: 0,
            salaryRuleCutAmount: 0,
        },
        ratesUsed: {
            perDayRate: 0,
            perHourRate,
            perDay: 0,
            perHour: perHourRate,
            overtimeRate,
        },
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Shared helpers
   ═══════════════════════════════════════════════════════════════════ */
function buildResult({
    ctx,
    earnings,
    grossSalary,
    statutory,
    other,
    lossOfPay,
    totalDeductions,
    netSalary,
    payableDays,
    salaryRuleDeductions,
    ratesUsed,
}) {
    const { employee, attendance, payPeriod, payDate, generatedBy, stdDays } = ctx;
    const jobInfo = employee.jobInfo || {};
    const bank = employee.bankDetails || {};

    return {
        companyId: employee.companyId,
        employeeId: employee._id,

        payPeriod,
        payDate,

        employeeSnapshot: {
            empCode: employee.empCode,
            name: employee.user_name,
            designation: jobInfo.designation,
            department: jobInfo.department,
            grade: jobInfo.grade,
            bankAccount: bank.accountNo,
            bankName: bank.bankName,
            ifsc: bank.ifsc,
            joiningDate: jobInfo.joiningDate,
        },

        attendance: buildAttendanceBlock(attendance, stdDays),
        salaryRuleDeductions,
        payableDays,

        earnings,

        grossSalary,

        statutoryDeductions: {
            pf: statutory.pf,
            esi: statutory.esi,
            gratuity: statutory.gratuity,
        },
        employerContributions: {
            gratuity: statutory.gratuity,
        },

        otherDeductions: {
            incomeTax: other.incomeTax,
            professionalTax: other.professionalTax,
            additionalLines: other.additionalLines,
        },

        lossOfPay,

        totalDeductions,
        netSalary,

        ratesUsed,

        generatedBy,
    };
}

function buildAttendanceBlock(attendance, standardDays) {
    return {
        standardDays: numberOr(attendance.standardDays, standardDays || STANDARD_MONTH_DAYS),
        employmentCalendarDays: numberOr(attendance.employmentCalendarDays, standardDays),
        workingDays: numberOr(attendance.workingDays, 0),
        weeklyOffDays: numberOr(attendance.weeklyOffDays, 0),
        weeklyOffHalfDays: numberOr(attendance.weeklyOffHalfDays, 0),
        holidays: numberOr(attendance.holidays, 0),
        leaveDays: numberOr(attendance.leaveDays, 0),
        paidLeaveDays: numberOr(attendance.paidLeaveDays, 0),
        unpaidLeaveDays: numberOr(attendance.unpaidLeaveDays, 0),
        unpaidHalfDays: numberOr(attendance.unpaidHalfDays, 0),
        compOffDaysUsed: numberOr(attendance.compOffDaysUsed ?? attendance.compOffUsed, 0),
        absentDays: numberOr(attendance.absentDays, 0),
        lateDays: numberOr(attendance.lateDays, 0),
        halfDays: numberOr(attendance.halfDays, 0),
        presentDays: numberOr(attendance.presentDays, 0),
        totalPayableMinutes: numberOr(attendance.totalPayableMinutes, 0),
        totalMinutes: numberOr(attendance.totalMinutes, 0),
        overtimeMinutes: numberOr(attendance.overtimeMinutes, 0),
        leaveBreakdown: Array.isArray(attendance.leaveBreakdown)
            ? attendance.leaveBreakdown
            : [],
    };
}

function buildLossOfPay({ attendance, perDayRate, mode, deducted }) {
    const lopDays = roundTo2(
        numberOr(attendance.lopDays) ||
        (
            numberOr(attendance.absentDays) +
            numberOr(attendance.unpaidLeaveDays) +
            numberOr(attendance.unpaidHalfDays)
        )
    );

    const prorationDays = roundTo2(numberOr(attendance.prorationDays));
    const lopAmount = roundTo2(perDayRate * lopDays);
    const prorationAmount = roundTo2(perDayRate * prorationDays);

    const totalDeductedDays = deducted ? roundTo2(lopDays + prorationDays) : 0;
    const totalDeductedAmount = deducted ? roundTo2(lopAmount + prorationAmount) : 0;

    return {
        lopDays,
        lopAmount,
        absentDays: numberOr(attendance.absentDays),
        unpaidLeaveDays: numberOr(attendance.unpaidLeaveDays),
        unpaidHalfDays: numberOr(attendance.unpaidHalfDays),
        prorationDays,
        prorationAmount,
        totalDeductedDays,
        totalDeductedAmount,
        deducted: Boolean(deducted),
        mode,
    };
}

function getMonthlyComponents(sal) {
    const basic = numberOr(sal.basic);
    const hra = numberOr(sal.hra);
    const da = numberOr(sal.da);
    const bonus = numberOr(sal.bonus);

    const otherAllowances = Array.isArray(sal.otherAllowence)
        ? sal.otherAllowence.map((a) => ({
            name: a.name,
            amount: numberOr(a.amount),
        }))
        : [];

    const otherTotal = roundTo2(
        otherAllowances.reduce((sum, a) => sum + a.amount, 0)
    );

    return {
        basic,
        hra,
        da,
        bonus,
        otherAllowances,
        otherTotal,
        total: roundTo2(basic + hra + da + bonus + otherTotal),
    };
}

function computeSalaryRuleCuts(attendance, salaryRule) {
    const lateDays = numberOr(attendance.lateDays);

    let lateCutDays = 0;
    if (numberOr(salaryRule?.late?.count) > 0) {
        lateCutDays = Math.floor(lateDays / salaryRule.late.count) * numberOr(salaryRule.late.deductionDays);
    }

    // Half-day cuts are intentionally disabled: absent half-days are already
    // counted as 0.5 LOP, so applying the rule again would double-deduct.
    return {
        lateCutDays: roundTo2(lateCutDays),
        halfDayCutDays: 0,
        totalCutDays: roundTo2(lateCutDays),
    };
}

function computeOvertime(attendance, overtimeRate) {
    const overtimeHours = numberOr(attendance.overtimeMinutes) / 60;
    return roundTo2(numberOr(overtimeRate) * overtimeHours);
}

function computeStatutory(payrollRule, pfBase, esiBase) {
    const rules = payrollRule?.deductions || {};

    const pf = rules.pf?.enabled ? computeDeduction(pfBase, rules.pf) : 0;

    const esi = rules.esi?.enabled && numberOr(esiBase) <= ESI_WAGE_CEILING
        ? computeDeduction(esiBase, rules.esi)
        : 0;

    // Gratuity is an employer contribution — tracked but not deducted.
    const gratuity = rules.gratuity?.enabled ? computeDeduction(pfBase, rules.gratuity) : 0;

    return {
        pf: roundTo2(pf),
        esi: roundTo2(esi),
        gratuity: roundTo2(gratuity),
    };
}

function getOtherDeductions(employee) {
    const deductions = employee?.deductions || {};

    const additionalLines = Array.isArray(deductions.otherDeduction)
        ? deductions.otherDeduction.map((d) => ({
            name: d.name,
            amount: roundTo2(d.amount),
        }))
        : [];

    return {
        incomeTax: roundTo2(numberOr(deductions.incomeTax)),
        professionalTax: roundTo2(numberOr(deductions.professionalTax)),
        additionalLines,
        additionalTotal: roundTo2(
            additionalLines.reduce((sum, d) => sum + d.amount, 0)
        ),
    };
}

export function computeDeduction(base, rule) {
    if (!rule) return 0;
    if (rule.calculationType === "percentage") {
        return roundTo2((numberOr(base) * numberOr(rule.value)) / 100);
    }
    return roundTo2(numberOr(rule.value));
}

export function roundTo2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function numberOr(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export default calculateSalary;
