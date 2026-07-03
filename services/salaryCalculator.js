// services/salaryCalculator.js

/**
 * Enhanced Salary Calculator Service
 * Handles: Standard month (basic), Per-Day, Per-Hour salary structures
 * Overtime calculations, Break deductions, Late/Half-day penalties
 */

const STANDARD_MONTH_DAYS = 30;
const STANDARD_WORK_HOURS = 8; // Standard 8-hour work day

/**
 * @param {Object} params
 * @param {Object} params.employee        - Employee document
 * @param {Object} params.attendance      - Attendance summary
 * @param {Object|null} params.salaryRule - SalaryRule document (optional)
 * @param {Object|null} params.payrollRule- PayrollRule document (optional)
 * @param {Object} params.payPeriod       - { month, year, label, startDate, endDate }
 * @param {Date}   params.payDate
 * @param {Array}  params.attendanceRecords - Full attendance records for detailed calculations
 * @returns {Object}  payroll fields ready to save
 */
export function calculateSalary({
    employee,
    attendance,
    salaryRule,
    payrollRule,
    payPeriod,
    payDate,
    generatedBy,
    attendanceRecords = []
}) {
    /* ── 1. Validate inputs ── */
    if (!employee) {
        throw new Error("Employee data is required.");
    }

    const sal = employee.salaryStructure || {};
    
    // Determine salary calculation type
    const hasBasic = !!(sal.basic && sal.basic > 0);
    const hasPerDay = !!(sal.perDay && sal.perDay > 0);
    const hasPerHour = !!(sal.perHour && sal.perHour > 0);
    
    let salaryType = 'basic'; // default
    if (!hasBasic && hasPerHour) salaryType = 'per_hour';
    if (!hasBasic && hasPerDay) salaryType = 'per_day';
    if (hasBasic && hasPerDay && hasPerHour) salaryType = 'basic'; // priority: basic > per_day > per_hour

    const {
        presentDays = 0,
        absentDays = 0,
        leaveDays = 0,
        holidays = 0,
        weeklyOffDays = 0,
        halfDays = 0,
        lateDays = 0
    } = attendance;

    /* ── 2. Calculate per-day and per-hour rates ── */
    let perDayRate = 0;
    let perHourRate = 0;
    let basicEarned = 0;
    let hraEarned = 0;
    let daEarned = 0;
    let bonusEarned = 0;
    let otherAllowancesEarned = [];
    let otherAllowTotal = 0;

    // Monthly components (only used for basic salary type)
    const monthlyBasic = sal.basic ?? 0;
    const monthlyHra = sal.hra ?? 0;
    const monthlyDa = sal.da ?? 0;
    const monthlyBonus = sal.bonus ?? 0;
    
    const monthlyOtherAllowances = (sal.otherAllowence ?? []).map(a => ({
        name: a.name,
        amount: a.amount ?? 0
    }));
    const monthlyOtherAllowTotal = monthlyOtherAllowances.reduce((s, a) => s + a.amount, 0);

    if (salaryType === 'basic') {
        // Standard monthly salary based on 30-day month
        const totalMonthlyGross = monthlyBasic + monthlyHra + monthlyDa + monthlyBonus + monthlyOtherAllowTotal;
        perDayRate = roundTo2(totalMonthlyGross / STANDARD_MONTH_DAYS);
        perHourRate = roundTo2(perDayRate / STANDARD_WORK_HOURS);
        
        basicEarned = monthlyBasic;
        hraEarned = monthlyHra;
        daEarned = monthlyDa;
        bonusEarned = monthlyBonus;
        otherAllowancesEarned = monthlyOtherAllowances.map(a => ({...a}));
        otherAllowTotal = monthlyOtherAllowTotal;
        
    } else if (salaryType === 'per_day') {
        // Per-day salary calculation
        perDayRate = sal.perDay ?? 0;
        perHourRate = roundTo2(perDayRate / STANDARD_WORK_HOURS);
        
        // Calculate earnings based on actual present days
        basicEarned = roundTo2(perDayRate * presentDays);
        // No HRA, DA, Bonus for per-day workers typically
        hraEarned = 0;
        daEarned = 0;
        bonusEarned = 0;
        otherAllowancesEarned = [];
        otherAllowTotal = 0;
        
    } else if (salaryType === 'per_hour') {
        // Per-hour salary calculation
        perHourRate = sal.perHour ?? 0;
        perDayRate = roundTo2(perHourRate * STANDARD_WORK_HOURS);
        
        // Calculate total working hours from attendance records
        const totalWorkHours = calculateTotalWorkHours(attendanceRecords);
        basicEarned = roundTo2(perHourRate * totalWorkHours);
        hraEarned = 0;
        daEarned = 0;
        bonusEarned = 0;
        otherAllowancesEarned = [];
        otherAllowTotal = 0;
    }

    /* ── 3. Calculate Break Deductions ── */
    let breakDeductionAmount = 0;
    let breakDeductionHours = 0;
    
    if (attendanceRecords && attendanceRecords.length > 0) {
        const breakDeductions = calculateBreakDeductions(attendanceRecords, perHourRate);
        breakDeductionAmount = breakDeductions.amount;
        breakDeductionHours = breakDeductions.hours;
    }

    /* ── 4. Overtime Calculation ── */
    let overtimeEarned = 0;
    let overtimeHours = 0;
    let overtimeRate = sal.overtimeRate ?? 0;
    
    if (attendanceRecords && attendanceRecords.length > 0) {
        const overtimeCalc = calculateOvertime(attendanceRecords, perHourRate, overtimeRate);
        overtimeEarned = overtimeCalc.amount;
        overtimeHours = overtimeCalc.hours;
    }

    /* ── 5. Salary Rule cuts (optional) ── */
    let lateCutDays = 0;
    let halfDayCutDays = 0;

    if (salaryRule?.late && salaryRule?.halfDay) {
        if (salaryRule.late.count > 0) {
            lateCutDays = Math.floor(lateDays / salaryRule.late.count) * salaryRule.late.deductionDays;
        }
        if (salaryRule.halfDay.count > 0) {
            halfDayCutDays = Math.floor(halfDays / salaryRule.halfDay.count) * salaryRule.halfDay.deductionDays;
        }
    }

    const totalSalaryRuleCutDays = lateCutDays + halfDayCutDays;

    /* ── 6. Gross Salary Calculation ── */
    const grossSalary = roundTo2(
        basicEarned + hraEarned + daEarned + bonusEarned + otherAllowTotal + overtimeEarned
    );

    /* ── 7. Loss of Pay (LOP) — absent days deduction ── */
    const lopDays = Math.max(0, absentDays);
    const lopAmount = roundTo2(perDayRate * lopDays);

    // Salary rule penalty deductions
    const salaryRuleCutAmount = roundTo2(perDayRate * totalSalaryRuleCutDays);

    /* ── 8. Payable days for reporting ── */
    const payableDays = salaryType === 'basic' 
        ? Math.max(0, presentDays - totalSalaryRuleCutDays)
        : presentDays; // For per-day/hour, payable = actual present

    /* ── 9. Statutory deductions (PayrollRule — optional) ── */
    let pf = 0;
    let esi = 0;
    let gratuity = 0;
    const pfcut = roundTo2(basicEarned + daEarned); // PF calculated on Basic + DA

    if (payrollRule?.deductions) {
        const pRule = payrollRule.deductions;

        pf = pRule.pf?.enabled ? computeDeduction(pfcut, pRule.pf) : 0;
        esi = pRule.esi?.enabled ? computeDeduction(pfcut, pRule.esi) : 0;
        gratuity = pRule.gratuity?.enabled ? computeDeduction(pfcut, pRule.gratuity) : 0;
    }

    /* ── 10. Other deductions (from employee) ── */
    const incomeTax = roundTo2(employee.deductions?.incomeTax ?? 0);
    const professionalTax = roundTo2(employee.deductions?.professionalTax ?? 0);
    const additionalLines = (employee.deductions?.otherDeduction ?? []).map(d => ({
        name: d.name,
        amount: roundTo2(d.amount)
    }));
    const additionalTotal = additionalLines.reduce((s, d) => s + d.amount, 0);

    /* ── 11. Total deductions ── */
    const totalDeductions = roundTo2(
        pf + esi + gratuity + incomeTax + professionalTax + 
        additionalTotal + lopAmount + salaryRuleCutAmount + breakDeductionAmount
    );

    /* ── 12. Net salary ── */
    const netSalary = roundTo2(grossSalary - totalDeductions);

    /* ── 13. Build payroll object ── */
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

        overtime: {
            hours: overtimeHours,
            rate: overtimeRate > 0 ? overtimeRate : perHourRate,
            amount: overtimeEarned,
            calculationType: overtimeRate > 0 ? 'custom_rate' : 'standard_rate'
        },

        breakDeductions: {
            hours: breakDeductionHours,
            amount: breakDeductionAmount
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

        ratesUsed: {
            salaryType,
            perDayRate,
            perHourRate,
            standardDays: STANDARD_MONTH_DAYS,
            standardHours: STANDARD_WORK_HOURS
        },

        generatedBy
    };
}

/**
 * Calculate total working hours from attendance records
 */
function calculateTotalWorkHours(attendanceRecords) {
    let totalMinutes = 0;
    
    for (const record of attendanceRecords) {
        if (record.workSummary?.payableMinutes) {
            totalMinutes += record.workSummary.payableMinutes;
        } else if (record.totalWorkingHours) {
            totalMinutes += record.totalWorkingHours * 60;
        }
    }
    
    return roundTo2(totalMinutes / 60);
}

/**
 * Calculate break deductions
 * Unpaid breaks are deducted from payable hours
 */
function calculateBreakDeductions(attendanceRecords, perHourRate) {
    let totalUnpaidBreakMinutes = 0;
    
    for (const record of attendanceRecords) {
        if (record.breaks && Array.isArray(record.breaks)) {
            for (const brk of record.breaks) {
                // Only deduct if break is not paid and duration exceeds allowed
                if (!brk.isPaid && brk.exceededMinutes && brk.exceededMinutes > 0) {
                    totalUnpaidBreakMinutes += brk.exceededMinutes;
                } else if (!brk.isPaid && brk.durationMinutes) {
                    totalUnpaidBreakMinutes += brk.durationMinutes;
                }
            }
        }
    }
    
    const breakHours = roundTo2(totalUnpaidBreakMinutes / 60);
    const breakAmount = roundTo2(breakHours * perHourRate);
    
    return {
        hours: breakHours,
        amount: breakAmount
    };
}

/**
 * Calculate overtime from attendance records
 */
function calculateOvertime(attendanceRecords, perHourRate, overtimeRate) {
    let totalOvertimeMinutes = 0;
    const rate = overtimeRate > 0 ? overtimeRate : perHourRate;
    
    for (const record of attendanceRecords) {
        if (record.workSummary?.overtimeMinutes && record.workSummary.overtimeMinutes > 0) {
            totalOvertimeMinutes += record.workSummary.overtimeMinutes;
        }
    }
    
    const overtimeHours = roundTo2(totalOvertimeMinutes / 60);
    const overtimeAmount = roundTo2(overtimeHours * rate);
    
    return {
        hours: overtimeHours,
        amount: overtimeAmount,
        rate
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