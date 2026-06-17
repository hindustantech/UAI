// services/salaryCalculator.js
/**
 * Salary Calculator Service
 * Applies SalaryRule + PayrollRule + attendance to produce a Payroll document.
 *
 * Standard month = 30 days (as specified)
 */

const STANDARD_MONTH_DAYS = 30;

/**
 * @param {Object} params
 * @param {Object} params.employee        - Employee document
 * @param {Object} params.attendance      - { presentDays, absentDays, leaveDays, holidays, weeklyOffDays, halfDays, lateDays }
 * @param {Object} params.salaryRule      - SalaryRule document { late: {count, deductionDays}, halfDay: {count, deductionDays} }
 * @param {Object} params.payrollRule     - PayrollRule document { deductions: { pf, esi, gratuity } }
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
    if (!salaryRule?.late || !salaryRule?.halfDay) {
        throw new Error("SalaryRule must include late and halfDay rules.");
    }
    if (!payrollRule?.deductions) {
        throw new Error("PayrollRule with deductions is required.");
    }

    const {
        presentDays = 0,
        absentDays  = 0,
        leaveDays   = 0,
        holidays    = 0,
        weeklyOffDays = 0,
        halfDays    = 0,
        lateDays    = 0
    } = attendance;

    /* ── 2. Salary Rule: Late deductions ── */
    // e.g. every 3 lates → 0.5 day cut
    const lateCutDays = Math.floor(lateDays / salaryRule.late.count) * salaryRule.late.deductionDays;

    // e.g. every 2 half-days → 1 day cut
    const halfDayCutDays = Math.floor(halfDays / salaryRule.halfDay.count) * salaryRule.halfDay.deductionDays;

    const totalCutDays = lateCutDays + halfDayCutDays;

    /* ── 3. Payable days ── */
    // payable = presentDays − salary-rule cuts  (can't go below 0)
    const payableDays = Math.max(0, presentDays - totalCutDays);

    /* ── 4. Per-day rate (based on standard 30-day month) ── */
    const sal = employee.salaryStructure;
    const perDayRate  = sal.perDay  ?? (sal.basic / STANDARD_MONTH_DAYS);
    const perHourRate = sal.perHour ?? (perDayRate / 8);

    /* ── 5. Prorate earnings by payable days ── */
    const ratio = payableDays / STANDARD_MONTH_DAYS;

    const basicEarned  = roundTo2(sal.basic  * ratio);
    const hraEarned    = roundTo2((sal.hra   ?? 0) * ratio);
    const daEarned     = roundTo2((sal.da    ?? 0) * ratio);
    const bonusEarned  = roundTo2((sal.bonus ?? 0) * ratio);

    // Other allowances (prorated)
    const otherAllowancesEarned = (sal.otherAllowence ?? []).map(a => ({
        name:   a.name,
        amount: roundTo2(a.amount * ratio)
    }));

    const otherAllowTotal = otherAllowancesEarned.reduce((s, a) => s + a.amount, 0);

    // Overtime (flat, not prorated)
    const overtimeEarned = roundTo2(sal.overtimeRate ?? 0);

    const grossSalary = roundTo2(
        basicEarned + hraEarned + daEarned + bonusEarned + otherAllowTotal + overtimeEarned
    );

    /* ── 6. Statutory deductions (PayrollRule) ── */
    const pRule = payrollRule.deductions;

    const pf = pRule.pf.enabled
        ? computeDeduction(grossSalary, pRule.pf)
        : 0;

    const esi = pRule.esi.enabled
        ? computeDeduction(grossSalary, pRule.esi)
        : 0;

    const gratuity = pRule.gratuity.enabled
        ? computeDeduction(grossSalary, pRule.gratuity)
        : 0;

    /* ── 7. Other deductions (from employee) ── */
    const incomeTax       = roundTo2(employee.deductions?.incomeTax ?? 0);
    const professionalTax = roundTo2(employee.deductions?.professionalTax ?? 0);
    const additionalLines = (employee.deductions?.otherDeduction ?? []).map(d => ({
        name:   d.name,
        amount: roundTo2(d.amount)
    }));
    const additionalTotal = additionalLines.reduce((s, d) => s + d.amount, 0);

    const totalDeductions = roundTo2(pf + esi + gratuity + incomeTax + professionalTax + additionalTotal);

    /* ── 8. Net salary ── */
    const netSalary = roundTo2(grossSalary - totalDeductions);

    /* ── 9. Build payroll object ── */
    const jobInfo = employee.jobInfo ?? {};
    const bank    = employee.bankDetails ?? {};

    return {
        companyId:  employee.companyId,
        employeeId: employee._id,

        payPeriod,
        payDate,

        employeeSnapshot: {
            empCode:     employee.empCode,
            name:        employee.user_name,
            designation: jobInfo.designation,
            department:  jobInfo.department,
            grade:       jobInfo.grade,
            bankAccount: bank.accountNo,
            bankName:    bank.bankName,
            ifsc:        bank.ifsc,
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
            totalCutDays
        },

        payableDays,

        earnings: {
            basic:           basicEarned,
            hra:             hraEarned,
            da:              daEarned,
            bonus:           bonusEarned,
            overtime:        overtimeEarned,
            otherAllowances: otherAllowancesEarned
        },

        grossSalary,

        statutoryDeductions: { pf, esi, gratuity },

        otherDeductions: {
            incomeTax,
            professionalTax,
            additionalLines
        },

        totalDeductions,
        netSalary,

        ratesUsed: { perDayRate, perHourRate },

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
