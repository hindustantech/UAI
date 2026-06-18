// services/salaryCalculator.js
/**
 * Salary Calculator Service
 * Applies SalaryRule + PayrollRule + attendance to produce a Payroll document.
 * Both SalaryRule and PayrollRule are OPTIONAL — if not found, their deductions are skipped.
 *
 * Standard month = 30 days (as specified)
 * Full salary is paid, LOP is deducted for absent days
 */

const STANDARD_MONTH_DAYS = 30;

/**
 * @param {Object} params
 * @param {Object} params.employee        - Employee document
 * @param {Object} params.attendance      - { presentDays, absentDays, leaveDays, holidays, weeklyOffDays, halfDays, lateDays }
 * @param {Object|null} params.salaryRule - SalaryRule document (optional)
 * @param {Object|null} params.payrollRule- PayrollRule document (optional)
 * @param {Object} params.payPeriod       - { month, year, label, startDate, endDate }
 * @param {Date}   params.payDate
 * @returns {Object}  payroll fields ready to save
 */
export function calculateSalary({
    employee,
    attendance,
    salaryRule,
    payrollRule,
    payPeriod,
    payDate,
    generatedBy
}) {
    /* ── 1. Validate inputs ── */
    if (!employee?.salaryStructure?.basic) {
        throw new Error("Employee salary structure (basic) is required.");
    }

    const {
        presentDays = 0,
        absentDays = 0,
        leaveDays = 0,
        holidays = 0,
        weeklyOffDays = 0,
        halfDays = 0,
        lateDays = 0
    } = attendance;

    /* ── 2. Calculate per-day rate based on standard 30-day month ── */
    const sal = employee.salaryStructure;
    
    // Calculate total monthly gross to determine per-day LOP rate
    const monthlyBasic = sal.basic ?? 0;
    const monthlyHra = sal.hra ?? 0;
    const monthlyDa = sal.da ?? 0;
    const monthlyBonus = sal.bonus ?? 0;
    
    // Calculate total monthly other allowances
    const monthlyOtherAllowances = (sal.otherAllowence ?? []).map(a => ({
        name: a.name,
        amount: a.amount ?? 0
    }));
    const monthlyOtherAllowTotal = monthlyOtherAllowances.reduce((s, a) => s + a.amount, 0);

    // Total monthly gross salary
    const totalMonthlyGross = monthlyBasic + monthlyHra + monthlyDa + 
                              monthlyBonus + monthlyOtherAllowTotal;

    // Per-day rate for LOP calculation (based on total gross salary)
    const perDayRate = roundTo2(totalMonthlyGross / STANDARD_MONTH_DAYS);

    /* ── 3. Salary Rule cuts (optional) ── */
    let lateCutDays = 0;
    let halfDayCutDays = 0;

    if (salaryRule?.late && salaryRule?.halfDay) {
        // e.g. every 3 lates → 0.5 day cut
        if (salaryRule.late.count > 0) {
            lateCutDays = Math.floor(lateDays / salaryRule.late.count) * salaryRule.late.deductionDays;
        }
        // e.g. every 2 half-days → 1 day cut
        if (salaryRule.halfDay.count > 0) {
            halfDayCutDays = Math.floor(halfDays / salaryRule.halfDay.count) * salaryRule.halfDay.deductionDays;
        }
    }

    const totalSalaryRuleCutDays = lateCutDays + halfDayCutDays;

    /* ── 4. Full earnings (no proration, full salary) ── */
    const basicEarned = monthlyBasic;
    const hraEarned = monthlyHra;
    const daEarned = monthlyDa;
    const bonusEarned = monthlyBonus;

    // Full other allowances
    const otherAllowancesEarned = monthlyOtherAllowances.map(a => ({
        name: a.name,
        amount: a.amount
    }));
    const otherAllowTotal = monthlyOtherAllowTotal;

    // Overtime (flat, not prorated)
    const overtimeEarned = roundTo2(sal.overtimeRate ?? 0);

    const grossSalary = roundTo2(
        basicEarned + hraEarned + daEarned + bonusEarned + otherAllowTotal + overtimeEarned
    );

    /* ── 5. Loss of Pay (LOP) — absent days deduction ── */
    // LOP applies to absent days
    const lopDays = Math.max(0, absentDays);
    const lopAmount = roundTo2(perDayRate * lopDays);

    // Also deduct for salary rule cuts (late/half-day penalties)
    const salaryRuleCutAmount = roundTo2(perDayRate * totalSalaryRuleCutDays);

    /* ── 6. Payable days for reporting ── */
    const payableDays = Math.max(0, presentDays - totalSalaryRuleCutDays);

    /* ── 7. Statutory deductions (PayrollRule — optional) ── */
    let pf = 0;
    let esi = 0;
    let gratuity = 0;

    if (payrollRule?.deductions) {
        const pRule = payrollRule.deductions;

        pf = pRule.pf?.enabled
            ? computeDeduction(grossSalary, pRule.pf)
            : 0;

        esi = pRule.esi?.enabled
            ? computeDeduction(grossSalary, pRule.esi)
            : 0;

        gratuity = pRule.gratuity?.enabled
            ? computeDeduction(grossSalary, pRule.gratuity)
            : 0;
    }

    /* ── 8. Other deductions (from employee) ── */
    const incomeTax = roundTo2(employee.deductions?.incomeTax ?? 0);
    const professionalTax = roundTo2(employee.deductions?.professionalTax ?? 0);
    const additionalLines = (employee.deductions?.otherDeduction ?? []).map(d => ({
        name: d.name,
        amount: roundTo2(d.amount)
    }));
    const additionalTotal = additionalLines.reduce((s, d) => s + d.amount, 0);

    /* ── 9. Total deductions (includes LOP + salary rule penalties) ── */
    const totalDeductions = roundTo2(
        pf + esi + gratuity + incomeTax + professionalTax + additionalTotal + lopAmount + salaryRuleCutAmount
    );

    /* ── 10. Net salary = Full gross - All deductions ── */
    const netSalary = roundTo2(grossSalary - totalDeductions);

    /* ── 11. Build payroll object ── */
    const jobInfo = employee.jobInfo ?? {};
    const bank = employee.bankDetails ?? {};

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
            joiningDate: jobInfo.joiningDate
        },

        attendance: {
            standardDays: STANDARD_MONTH_DAYS,
            weeklyOffDays,
            holidays,
            leaveDays,
            absentDays,
            lateDays,
            halfDays,
            presentDays
        },

        salaryRuleDeductions: {
            lateCutDays,
            halfDayCutDays,
            totalCutDays: totalSalaryRuleCutDays,
            salaryRuleCutAmount
        },

        payableDays,

        earnings: {
            basic: basicEarned,
            hra: hraEarned,
            da: daEarned,
            bonus: bonusEarned,
            overtime: overtimeEarned,
            otherAllowances: otherAllowancesEarned
        },

        grossSalary,

        statutoryDeductions: { pf, esi, gratuity },

        otherDeductions: {
            incomeTax,
            professionalTax,
            additionalLines
        },

        lossOfPay: {
            lopDays,
            lopAmount
        },

        totalDeductions,
        netSalary,

        ratesUsed: { perDayRate },

        generatedBy
    };
}

/* ── Helpers ── */
function computeDeduction(gross, rule) {
    if (rule.calculationType === "percentage") {
        return roundTo2((gross * rule.value) / 100);
    }
    return roundTo2(rule.value); // fixed
}

function roundTo2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}