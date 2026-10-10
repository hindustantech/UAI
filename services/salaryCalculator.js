const STANDARD_MONTHLY_HOURS = 240;

const MONTHS_31_DAYS = [1, 3, 5, 7, 8, 10, 12]; // Jan, Mar, May, Jul, Aug, Oct, Dec

function getCurrentMonthStandardDays() {
    const now = dayjs();
    const month = now.month() + 1; // 1-12
    if (MONTHS_31_DAYS.includes(month)) return 31;
    if (month === 2) return 28; // simplified: don't handle leap year here
    return 30;
}

function getCurrentMonthDays(month, year) {
    // Allow override for specific month calculation
    const m = month || (dayjs().month() + 1);
    const y = year || dayjs().year();
    const month31 = [1, 3, 5, 7, 8, 10, 12];
    if (month31.includes(m)) return 31;
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
    standardDays
}) {
    if (!employee?.salaryStructure?.basic && !employee?.salaryStructure?.perHour && !employee?.salaryStructure?.perDay) {
        throw new Error("Employee salary structure (basic, perHour or perDay) is required.");
    }

    const payType = employee.salaryStructure?.perHour > 0 ? "hourly"
        : employee.salaryStructure?.perDay > 0 ? "perday"
            : "monthly";
    const salaryApproach = employee.salaryStructure?.salaryApproach || "full_minus_lop";

    // Use provided standardDays or detect from current month
    const stdDays = standardDays || getCurrentMonthStandardDays();

    let result;
    if (payType === "hourly") {
        result = calculateHourly({ employee, attendance, payrollRule, payPeriod, payDate, generatedBy, stdDays });
    } else if (payType === "perday") {
        result = calculatePerDay({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy, stdDays });
    } else if (salaryApproach === "pro_rata") {
        result = calculateMonthlyProRata({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy, stdDays });
    } else {
        result = calculateMonthlyFullMinusLOP({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy, stdDays });
    }

    result.payType = payType;
    result.salaryApproach = salaryApproach;
    return result;
}

function calculateHourly({ employee, attendance, payrollRule, payPeriod, payDate, generatedBy, stdDays }) {
    const sal = employee.salaryStructure;
    const perHourRate = sal.perHour ?? 0;
    const overtimeRate = sal.overtimeRate ?? 0;

    const totalPayableMinutes = attendance.totalPayableMinutes ?? 0;
    const totalPayableHours = roundTo2(totalPayableMinutes / 60);

    const regularEarnings = roundTo2(perHourRate * totalPayableHours);

    const attendanceOvertimeMinutes = attendance.overtimeMinutes ?? 0;
    const overtimeHours = roundTo2(attendanceOvertimeMinutes / 60);
    const overtimeEarned = roundTo2(overtimeRate * overtimeHours);

    const grossSalary = roundTo2(regularEarnings + overtimeEarned);

    const pfcut = grossSalary;

    let pf = 0, esi = 0, gratuity = 0;
    if (payrollRule?.deductions) {
        const pRule = payrollRule.deductions;
        pf = pRule.pf?.enabled ? computeDeduction(pfcut, pRule.pf) : 0;
        esi = pRule.esi?.enabled ? computeDeduction(pfcut, pRule.esi) : 0;
        gratuity = pRule.gratuity?.enabled ? computeDeduction(pfcut, pRule.gratuity) : 0;
    }

    const incomeTax = roundTo2(employee.deductions?.incomeTax ?? 0);
    const professionalTax = roundTo2(employee.deductions?.professionalTax ?? 0);
    const additionalLines = (employee.deductions?.otherDeduction ?? []).map(d => ({
        name: d.name,
        amount: roundTo2(d.amount)
    }));
    const additionalTotal = additionalLines.reduce((s, d) => s + d.amount, 0);

    const totalDeductions = roundTo2(pf + esi + gratuity + incomeTax + professionalTax + additionalTotal);
    const netSalary = roundTo2(grossSalary - totalDeductions);

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

        attendance: buildAttendanceBlock(attendance, { totalPayableMinutes }),

        salaryRuleDeductions: { lateCutDays: 0, halfDayCutDays: 0, totalCutDays: 0, salaryRuleCutAmount: 0 },
        payableDays: 0,

        earnings: {
            basic: 0, hra: 0, da: 0, bonus: 0,
            overtime: overtimeEarned,
            otherAllowances: [],
            regularEarnings,
            totalPayableHours
        },

        grossSalary,

        statutoryDeductions: { pf, esi, gratuity },

        otherDeductions: { incomeTax, professionalTax, additionalLines },

        lossOfPay: { lopDays: 0, lopAmount: 0 },

        totalDeductions,
        netSalary,

        ratesUsed: { perDayRate: 0, perHourRate: perHourRate, perDay: 0, perHour: perHourRate, overtimeRate },

        generatedBy
    };
}

function calculatePerDay({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy, extraWorkDays = 0 }) {
    const sal = employee.salaryStructure;
    const perDayRate = sal.perDay ?? 0;
    const overtimeRate = sal.overtimeRate ?? 0;

    const { presentDays = 0, absentDays = 0, unpaidLeaveDays = 0, lateDays = 0, halfDays = 0,
            leaveDays = 0, paidLeaveDays = 0, holidays = 0, weeklyOffDays = 0, weekOffHalfDays = 0 } = attendance;

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

    const payableDays = Math.max(0, presentDays + weeklyOffDays + weekOffHalfDays - totalSalaryRuleCutDays + extraWorkDays);
    const dayWages = roundTo2(perDayRate * payableDays);

    const attendanceOvertimeMinutes = attendance.overtimeMinutes ?? 0;
    const overtimeHours = roundTo2(attendanceOvertimeMinutes / 60);
    const overtimeEarned = roundTo2(overtimeRate * overtimeHours);

    const grossSalary = roundTo2(dayWages + overtimeEarned);

    let pf = 0, esi = 0, gratuity = 0;
    if (payrollRule?.deductions) {
        const pRule = payrollRule.deductions;
        pf = pRule.pf?.enabled ? computeDeduction(grossSalary, pRule.pf) : 0;
        esi = pRule.esi?.enabled ? computeDeduction(grossSalary, pRule.esi) : 0;
        gratuity = pRule.gratuity?.enabled ? computeDeduction(grossSalary, pRule.gratuity) : 0;
    }

    const incomeTax = roundTo2(employee.deductions?.incomeTax ?? 0);
    const professionalTax = roundTo2(employee.deductions?.professionalTax ?? 0);
    const additionalLines = (employee.deductions?.otherDeduction ?? []).map(d => ({
        name: d.name,
        amount: roundTo2(d.amount)
    }));
    const additionalTotal = additionalLines.reduce((s, d) => s + d.amount, 0);

    const totalDeductions = roundTo2(pf + esi + gratuity + incomeTax + professionalTax + additionalTotal);
    const netSalary = roundTo2(grossSalary - totalDeductions);

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

        attendance: buildAttendanceBlock(attendance, { paidLeaveDays, unpaidLeaveDays }),

        salaryRuleDeductions: {
            lateCutDays,
            halfDayCutDays,
            totalCutDays: totalSalaryRuleCutDays,
            salaryRuleCutAmount: 0
        },

        payableDays,

        earnings: {
            basic: 0, hra: 0, da: 0, bonus: 0,
            overtime: overtimeEarned,
            otherAllowances: [],
            dayWages,
            totalPayableHours: roundTo2((attendance.totalPayableMinutes ?? 0) / 60)
        },

        grossSalary,

        statutoryDeductions: { pf, esi, gratuity },

        otherDeductions: { incomeTax, professionalTax, additionalLines },

        lossOfPay: { lopDays: 0, lopAmount: 0 },

        totalDeductions,
        netSalary,

        ratesUsed: { perDayRate, perHourRate: 0, perDay: perDayRate, perHour: 0, overtimeRate },

        generatedBy
    };
}

function calculateMonthlyProRata({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy, stdDays, extraWorkDays = 0 }) {
    const sal = employee.salaryStructure;

    const monthlyBasic = sal.basic ?? 0;
    const monthlyHra = sal.hra ?? 0;
    const monthlyDa = sal.da ?? 0;
    const monthlyBonus = sal.bonus ?? 0;

    const monthlyOtherAllowances = (sal.otherAllowence ?? []).map(a => ({
        name: a.name,
        amount: a.amount ?? 0
    }));
    const monthlyOtherAllowTotal = monthlyOtherAllowances.reduce((s, a) => s + a.amount, 0);
    const totalMonthlyGross = monthlyBasic + monthlyHra + monthlyDa + monthlyBonus + monthlyOtherAllowTotal;
    const perDayRate = roundTo2(totalMonthlyGross / (stdDays || STANDARD_MONTH_DAYS));

    const { presentDays = 0, absentDays = 0, unpaidLeaveDays = 0, lateDays = 0, halfDays = 0,
            leaveDays = 0, paidLeaveDays = 0, holidays = 0, weeklyOffDays = 0, weekOffHalfDays = 0 } = attendance;

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

    const payableDays = Math.max(0, presentDays + weeklyOffDays + weekOffHalfDays - totalSalaryRuleCutDays + (extraWorkDays || 0));
    const factor = STANDARD_MONTH_DAYS > 0 ? payableDays / STANDARD_MONTH_DAYS : 0;

    const basicEarned = roundTo2(monthlyBasic * factor);
    const hraEarned = roundTo2(monthlyHra * factor);
    const daEarned = roundTo2(monthlyDa * factor);
    const bonusEarned = roundTo2(monthlyBonus * factor);

    const otherAllowancesEarned = monthlyOtherAllowances.map(a => ({
        name: a.name,
        amount: roundTo2(a.amount * factor)
    }));
    const otherAllowTotal = otherAllowancesEarned.reduce((s, a) => s + a.amount, 0);
    const overtimeEarned = roundTo2(sal.overtimeRate ?? 0);

    const grossSalary = roundTo2(basicEarned + hraEarned + daEarned + bonusEarned + otherAllowTotal + overtimeEarned);

    const pfcut = roundTo2(basicEarned + daEarned);

    const salaryRuleCutAmount = roundTo2(perDayRate * totalSalaryRuleCutDays);

    let pf = 0, esi = 0, gratuity = 0;
    if (payrollRule?.deductions) {
        const pRule = payrollRule.deductions;
        pf = pRule.pf?.enabled ? computeDeduction(pfcut, pRule.pf) : 0;
        esi = pRule.esi?.enabled ? computeDeduction(pfcut, pRule.esi) : 0;
        gratuity = pRule.gratuity?.enabled ? computeDeduction(pfcut, pRule.gratuity) : 0;
    }

    const incomeTax = roundTo2(employee.deductions?.incomeTax ?? 0);
    const professionalTax = roundTo2(employee.deductions?.professionalTax ?? 0);
    const additionalLines = (employee.deductions?.otherDeduction ?? []).map(d => ({
        name: d.name,
        amount: roundTo2(d.amount)
    }));
    const additionalTotal = additionalLines.reduce((s, d) => s + d.amount, 0);

    const totalDeductions = roundTo2(pf + esi + gratuity + incomeTax + professionalTax + additionalTotal);
    const netSalary = roundTo2(grossSalary - totalDeductions);

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

        attendance: buildAttendanceBlock(attendance, { paidLeaveDays, unpaidLeaveDays }),

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
            otherAllowances: otherAllowancesEarned,
            prorationFactor: roundTo2(factor)
        },

        grossSalary,

        statutoryDeductions: { pf, esi, gratuity },

        otherDeductions: { incomeTax, professionalTax, additionalLines },

        lossOfPay: { lopDays: 0, lopAmount: 0 },

        totalDeductions,
        netSalary,

        ratesUsed: { perDayRate, perHourRate: 0, perDay: sal.perDay ?? 0, perHour: 0, overtimeRate: sal.overtimeRate ?? 0 },

        generatedBy
    };
}

function calculateMonthlyFullMinusLOP({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy, stdDays, extraWorkDays = 0 }) {
    const sal = employee.salaryStructure;

    const monthlyBasic = sal.basic ?? 0;
    const monthlyHra = sal.hra ?? 0;
    const monthlyDa = sal.da ?? 0;
    const monthlyBonus = sal.bonus ?? 0;

    const monthlyOtherAllowances = (sal.otherAllowence ?? []).map(a => ({
        name: a.name,
        amount: a.amount ?? 0
    }));
    const monthlyOtherAllowTotal = monthlyOtherAllowances.reduce((s, a) => s + a.amount, 0);
    const totalMonthlyGross = monthlyBasic + monthlyHra + monthlyDa + monthlyBonus + monthlyOtherAllowTotal;
    const perDayRate = roundTo2(totalMonthlyGross / (stdDays || STANDARD_MONTH_DAYS));

    const { presentDays = 0, absentDays = 0, unpaidLeaveDays = 0, lateDays = 0, halfDays = 0,
            leaveDays = 0, paidLeaveDays = 0, holidays = 0, weeklyOffDays = 0, weekOffHalfDays = 0 } = attendance;

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

    const basicEarned = monthlyBasic;
    const hraEarned = monthlyHra;
    const daEarned = monthlyDa;
    const bonusEarned = monthlyBonus;

    const otherAllowancesEarned = monthlyOtherAllowances.map(a => ({
        name: a.name,
        amount: a.amount
    }));
    const otherAllowTotal = monthlyOtherAllowTotal;
    const overtimeEarned = roundTo2(sal.overtimeRate ?? 0);

    const grossSalary = roundTo2(basicEarned + hraEarned + daEarned + bonusEarned + otherAllowTotal + overtimeEarned);

    const pfcut = roundTo2(basicEarned + daEarned);

    const lopDays = Math.max(0, absentDays + unpaidLeaveDays);
    const lopAmount = roundTo2(perDayRate * lopDays);

    const salaryRuleCutAmount = roundTo2(perDayRate * totalSalaryRuleCutDays);

    const payableDays = Math.max(0, presentDays + weeklyOffDays + weekOffHalfDays - totalSalaryRuleCutDays + extraWorkDays);

    let pf = 0, esi = 0, gratuity = 0;
    if (payrollRule?.deductions) {
        const pRule = payrollRule.deductions;
        pf = pRule.pf?.enabled ? computeDeduction(pfcut, pRule.pf) : 0;
        esi = pRule.esi?.enabled ? computeDeduction(pfcut, pRule.esi) : 0;
        gratuity = pRule.gratuity?.enabled ? computeDeduction(pfcut, pRule.gratuity) : 0;
    }

    const incomeTax = roundTo2(employee.deductions?.incomeTax ?? 0);
    const professionalTax = roundTo2(employee.deductions?.professionalTax ?? 0);
    const additionalLines = (employee.deductions?.otherDeduction ?? []).map(d => ({
        name: d.name,
        amount: roundTo2(d.amount)
    }));
    const additionalTotal = additionalLines.reduce((s, d) => s + d.amount, 0);

    const totalDeductions = roundTo2(pf + esi + gratuity + incomeTax + professionalTax + additionalTotal + lopAmount + salaryRuleCutAmount);
    const netSalary = roundTo2(grossSalary - totalDeductions);

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

        attendance: buildAttendanceBlock(attendance, { paidLeaveDays, unpaidLeaveDays }),

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

        otherDeductions: { incomeTax, professionalTax, additionalLines },

        lossOfPay: { lopDays, lopAmount },

        totalDeductions,
        netSalary,

        ratesUsed: { perDayRate, perHourRate: 0, perDay: sal.perDay ?? 0, perHour: 0, overtimeRate: sal.overtimeRate ?? 0 },

        generatedBy
    };
}

function buildAttendanceBlock(attendance, extras = {}) {
    const {
        presentDays = 0, absentDays = 0, leaveDays = 0, holidays = 0,
        weeklyOffDays = 0, weekOffHalfDays = 0, halfDays = 0, lateDays = 0,
        totalPayableMinutes = 0, totalMinutes = 0, overtimeMinutes = 0,
        compOffDaysUsed = 0
    } = attendance;
    const { paidLeaveDays = 0, unpaidLeaveDays = 0 } = extras;

    return {
        standardDays: STANDARD_MONTH_DAYS,
        weeklyOffDays,
        weekOffHalfDays,
        holidays,
        leaveDays,
        paidLeaveDays,
        unpaidLeaveDays,
        compOffDaysUsed,
        absentDays,
        lateDays,
        halfDays,
        presentDays,
        totalPayableMinutes,
        totalMinutes,
        overtimeMinutes
    };
}

function computeDeduction(gross, rule) {
    if (rule.calculationType === "percentage") {
        return roundTo2((gross * rule.value) / 100);
    }
    return roundTo2(rule.value);
}

function roundTo2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
