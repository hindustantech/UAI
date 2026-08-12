const STANDARD_MONTH_DAYS = 30;
const STANDARD_MONTHLY_HOURS = 240;

export function calculateSalary({
    employee,
    attendance,
    salaryRule,
    payrollRule,
    payPeriod,
    payDate,
    generatedBy
}) {
    if (!employee?.salaryStructure?.basic && !employee?.salaryStructure?.perHour && !employee?.salaryStructure?.perDay) {
        throw new Error("Employee salary structure (basic, perHour or perDay) is required.");
    }

    const payType = employee.salaryStructure?.perHour > 0 ? "hourly"
        : employee.salaryStructure?.perDay > 0 ? "perday"
            : "monthly";
    const salaryApproach = employee.salaryStructure?.salaryApproach || "full_minus_lop";

    let result;
    if (payType === "hourly") {
        result = calculateHourly({ employee, attendance, payrollRule, payPeriod, payDate, generatedBy });
    } else if (payType === "perday") {
        result = calculatePerDay({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy });
    } else if (salaryApproach === "pro_rata") {
        result = calculateMonthlyProRata({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy });
    } else {
        result = calculateMonthlyFullMinusLOP({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy });
    }

    result.payType = payType;
    result.salaryApproach = salaryApproach;
    return result;
}

function calculateHourly({ employee, attendance, payrollRule, payPeriod, payDate, generatedBy }) {
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

function calculatePerDay({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy }) {
    const sal = employee.salaryStructure;
    const perDayRate = sal.perDay ?? 0;
    const overtimeRate = sal.overtimeRate ?? 0;

    const { presentDays = 0, absentDays = 0, unpaidLeaveDays = 0, lateDays = 0, halfDays = 0,
            leaveDays = 0, paidLeaveDays = 0, holidays = 0, weeklyOffDays = 0 } = attendance;

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

    const payableDays = Math.max(0, presentDays - totalSalaryRuleCutDays);
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

function calculateMonthlyProRata({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy }) {
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
    const perDayRate = roundTo2(totalMonthlyGross / STANDARD_MONTH_DAYS);

    const { presentDays = 0, absentDays = 0, unpaidLeaveDays = 0, lateDays = 0, halfDays = 0,
            leaveDays = 0, paidLeaveDays = 0, holidays = 0, weeklyOffDays = 0 } = attendance;

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

    const payableDays = Math.max(0, presentDays - totalSalaryRuleCutDays);
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

function calculateMonthlyFullMinusLOP({ employee, attendance, salaryRule, payrollRule, payPeriod, payDate, generatedBy }) {
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
    const perDayRate = roundTo2(totalMonthlyGross / STANDARD_MONTH_DAYS);

    const { presentDays = 0, absentDays = 0, unpaidLeaveDays = 0, lateDays = 0, halfDays = 0,
            leaveDays = 0, paidLeaveDays = 0, holidays = 0, weeklyOffDays = 0 } = attendance;

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

    const payableDays = Math.max(0, presentDays - totalSalaryRuleCutDays);

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
        weeklyOffDays = 0, halfDays = 0, lateDays = 0,
        totalPayableMinutes = 0, totalMinutes = 0, overtimeMinutes = 0,
        compOffDaysUsed = 0
    } = attendance;
    const { paidLeaveDays = 0, unpaidLeaveDays = 0 } = extras;

    return {
        standardDays: STANDARD_MONTH_DAYS,
        weeklyOffDays,
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
