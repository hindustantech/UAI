import test from "node:test";
import assert from "node:assert/strict";

import {
    calculateSalary,
    computeDeduction,
    getMonthDays,
} from "../../services/salaryCalculator.js";

/* ───────────────────────── helpers ───────────────────────── */

function employee(overrides = {}) {
    return {
        _id: "emp-1",
        companyId: "company-1",
        empCode: "EMP001",
        user_name: "Test Employee",
        jobInfo: { designation: "Engineer", department: "Engineering" },
        salaryStructure: {
            basic: 30000,
            hra: 12000,
            da: 0,
            bonus: 0,
            otherAllowence: [],
            salaryApproach: "full_minus_lop",
        },
        deductions: {},
        ...overrides,
    };
}

function attendance(overrides = {}) {
    return {
        standardDays: 30,
        employmentCalendarDays: 30,
        payableDays: 30,
        presentDays: 30,
        absentDays: 0,
        unpaidLeaveDays: 0,
        unpaidHalfDays: 0,
        paidLeaveDays: 0,
        halfDays: 0,
        lateDays: 0,
        lopDays: 0,
        overtimeMinutes: 0,
        ...overrides,
    };
}

function calc({ emp, att, salaryRule = null, payrollRule = null, month = 4, year = 2026 } = {}) {
    return calculateSalary({
        employee: emp ?? employee(),
        attendance: att ?? attendance(),
        salaryRule,
        payrollRule,
        payPeriod: { month, year, label: "Period" },
    });
}

const payrollRule = (deductions) => ({ deductions });

/* ───────────────────────── month basis ───────────────────────── */

test("getMonthDays handles all month lengths", () => {
    assert.equal(getMonthDays(1, 2026), 31);
    assert.equal(getMonthDays(2, 2026), 28);
    assert.equal(getMonthDays(2, 2028), 29);
    assert.equal(getMonthDays(4, 2026), 30);
});

test("28-day February uses a 28-day per-day rate", () => {
    const res = calc({
        emp: employee(),
        att: attendance({ standardDays: 28, payableDays: 27, absentDays: 1, lopDays: 1 }),
        month: 2,
        year: 2026,
    });

    assert.equal(res.ratesUsed.perDayRate, 1500);
    assert.equal(res.lossOfPay.lopAmount, 1500);
    assert.equal(res.grossSalary, 42000);
    assert.equal(res.totalDeductions, 1500);
    assert.equal(res.netSalary, 40500);
});

test("29-day leap February uses a 29-day per-day rate", () => {
    const res = calc({
        att: attendance({ standardDays: 29, payableDays: 28, absentDays: 1, lopDays: 1 }),
        month: 2,
        year: 2028,
    });

    assert.equal(res.ratesUsed.perDayRate, round(42000 / 29));
    assert.equal(res.lossOfPay.lopAmount, round(42000 / 29));
});

test("31-day month uses a 31-day per-day rate", () => {
    const res = calc({
        att: attendance({ standardDays: 31, payableDays: 30, absentDays: 1, lopDays: 1 }),
        month: 1,
        year: 2026,
    });

    assert.equal(res.ratesUsed.perDayRate, 1354.84);
    assert.equal(res.lossOfPay.lopAmount, 1354.84);
});

/* ───────────────────────── LOP rules ───────────────────────── */

test("paid leave and holidays do not reduce salary", () => {
    const res = calc({
        att: attendance({
            paidLeaveDays: 4,
            holidays: 2,
            weeklyOffDays: 4,
            presentDays: 20,
            payableDays: 30,
            lopDays: 0,
        }),
    });

    assert.equal(res.lossOfPay.lopDays, 0);
    assert.equal(res.lossOfPay.lopAmount, 0);
    assert.equal(res.netSalary, 42000);
});

test("unpaid leave and unpaid half-days become LOP", () => {
    const res = calc({
        att: attendance({
            payableDays: 28.5,
            unpaidLeaveDays: 1,
            unpaidHalfDays: 0.5,
            lopDays: 1.5,
        }),
    });

    assert.equal(res.lossOfPay.lopDays, 1.5);
    assert.equal(res.lossOfPay.lopAmount, 2100);
    assert.equal(res.netSalary, 39900);
});

test("half-day salary-rule cuts are not applied on top of LOP", () => {
    const res = calc({
        att: attendance({
            payableDays: 29,
            unpaidHalfDays: 1,
            halfDays: 2,
            lopDays: 1,
        }),
        salaryRule: { halfDay: { count: 1, deductionDays: 1 } },
    });

    assert.equal(res.salaryRuleDeductions.halfDayCutDays, 0);
    assert.equal(res.salaryRuleDeductions.totalCutDays, 0);
    assert.equal(res.totalDeductions, 1400);
});

test("late arrivals apply the salary rule cut once", () => {
    const res = calc({
        att: attendance({ payableDays: 30, lateDays: 6 }),
        salaryRule: { late: { count: 3, deductionDays: 1 } },
    });

    assert.equal(res.salaryRuleDeductions.lateCutDays, 2);
    assert.equal(res.salaryRuleDeductions.salaryRuleCutAmount, 2800);
    assert.equal(res.totalDeductions, 2800);
    assert.equal(res.netSalary, 39200);
});

test("overtime pays hours x overtime rate", () => {
    const res = calc({
        att: attendance({ overtimeMinutes: 120 }),
        emp: employee({
            salaryStructure: {
                ...employee().salaryStructure,
                overtimeRate: 100,
            },
        }),
    });

    assert.equal(res.earnings.overtime, 200);
    assert.equal(res.grossSalary, 42200);
});

/* ───────────────────── statutory deductions ───────────────────── */

test("PF is calculated on earned basic", () => {
    const res = calc({
        emp: employee({
            salaryStructure: {
                ...employee().salaryStructure,
                salaryApproach: "pro_rata",
            },
        }),
        att: attendance({ payableDays: 15 }),
        payrollRule: payrollRule({
            pf: { enabled: true, calculationType: "percentage", value: 12 },
        }),
    });

    // basic 30000 * 15/30 = 15000 earned basic; hra 12000 * 0.5 = 6000.
    assert.equal(res.earnings.basic, 15000);
    assert.equal(res.earnings.hra, 6000);
    assert.equal(res.grossSalary, 21000);
    assert.equal(res.statutoryDeductions.pf, 1800);
    assert.equal(res.netSalary, 19200);
});

test("ESI applies at exactly the 21000 ceiling", () => {
    const res = calc({
        emp: employee({
            salaryStructure: { basic: 21000, hra: 0, da: 0, bonus: 0, otherAllowence: [] },
        }),
        payrollRule: payrollRule({
            esi: { enabled: true, calculationType: "percentage", value: 0.75 },
        }),
    });

    assert.equal(res.grossSalary, 21000);
    assert.equal(res.statutoryDeductions.esi, 157.5);
});

test("ESI does not apply above the 21000 ceiling", () => {
    const res = calc({
        emp: employee({
            salaryStructure: { basic: 21001, hra: 0, da: 0, bonus: 0, otherAllowence: [] },
        }),
        payrollRule: payrollRule({
            esi: { enabled: true, calculationType: "percentage", value: 0.75 },
        }),
    });

    assert.equal(res.statutoryDeductions.esi, 0);
});

test("gratuity is an employer contribution, not a deduction", () => {
    const res = calc({
        payrollRule: payrollRule({
            gratuity: { enabled: true, calculationType: "percentage", value: 4.81 },
        }),
    });

    const expected = 1443;
    assert.equal(res.grossSalary, 42000);
    assert.equal(res.statutoryDeductions.gratuity, expected);
    assert.equal(res.employerContributions.gratuity, expected);
    assert.equal(res.totalDeductions, 0);
    assert.equal(res.netSalary, 42000);
});

test("net salary is clamped at zero", () => {
    const res = calc({
        emp: employee({
            salaryStructure: { basic: 3000, hra: 0, da: 0, bonus: 0, otherAllowence: [] },
        }),
        att: attendance({ payableDays: 0, absentDays: 30, lopDays: 30 }),
    });

    assert.equal(res.grossSalary, 3000);
    assert.equal(res.totalDeductions, 3000);
    assert.equal(res.netSalary, 0);
});

test("other deductions larger than gross still clamp net at zero", () => {
    const res = calc({
        emp: employee({
            salaryStructure: { basic: 1000, hra: 0, da: 0, bonus: 0, otherAllowence: [] },
            deductions: { incomeTax: 5000 },
        }),
    });

    assert.equal(res.netSalary, 0);
});

test("computeDeduction supports flat and percentage rules", () => {
    assert.equal(computeDeduction(10000, { calculationType: "percentage", value: 12 }), 1200);
    assert.equal(computeDeduction(10000, { calculationType: "fixed", value: 500 }), 500);
    assert.equal(computeDeduction(10000, null), 0);
});

/* ───────────────────── pay types ───────────────────── */

test("per-day employees are paid for payable days", () => {
    const res = calc({
        emp: employee({
            salaryStructure: { perDay: 1000, overtimeRate: 100, otherAllowence: [] },
        }),
        att: attendance({ presentDays: 20, weeklyOffDays: 4, overtimeMinutes: 60 }),
    });

    assert.equal(res.payType, "perday");
    assert.equal(res.payableDays, 24);
    assert.equal(res.earnings.dayWages, 24000);
    assert.equal(res.earnings.overtime, 100);
    assert.equal(res.grossSalary, 24100);
});

test("hourly employees are paid for payable hours", () => {
    const res = calc({
        emp: employee({
            salaryStructure: { perHour: 100, overtimeRate: 150, otherAllowence: [] },
        }),
        att: attendance({ totalPayableMinutes: 9000, overtimeMinutes: 120 }),
    });

    assert.equal(res.payType, "hourly");
    assert.equal(res.earnings.totalPayableHours, 150);
    assert.equal(res.earnings.regularEarnings, 15000);
    assert.equal(res.earnings.overtime, 300);
    assert.equal(res.grossSalary, 15300);
});

/* ───────────────────── pro-rata ───────────────────── */

test("pro-rata pays only for payable days", () => {
    const res = calc({
        emp: employee({
            salaryStructure: {
                ...employee().salaryStructure,
                salaryApproach: "pro_rata",
            },
        }),
        att: attendance({ payableDays: 15 }),
    });

    assert.equal(res.salaryApproach, "pro_rata");
    assert.equal(res.grossSalary, 21000);
    assert.equal(res.lossOfPay.deducted, false);
    assert.equal(res.lossOfPay.totalDeductedAmount, 0);
});

/* ───────────────────── helpers ───────────────────── */

function round(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
