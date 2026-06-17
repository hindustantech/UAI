// services/SalaryEngine.js
import Employee from "../models/Attandance/Employee.js";
import PayrollRuleSchema from "../models/PayrollRuleSchema.js";
import salaryRules from "../models/salaryRules.js";


const DEFAULT_WORKING_DAYS = 30;
const ESI_GROSS_LIMIT = 21000;

export class SalaryCalculator {
  constructor(employee, attendance, payrollRule, salaryRule) {
    this.employee = employee;
    this.attendance = attendance;
    this.payrollRule = payrollRule;
    this.salaryRule = salaryRule;
    this.result = null;
  }

  /**
   * Main calculation method
   */
  calculate() {
    // Step 1: Calculate effective working days
    const effectiveDays = this._calculateEffectiveDays();
    
    // Step 2: Calculate earnings (prorated)
    const earnings = this._calculateEarnings(effectiveDays);
    
    // Step 3: Calculate deductions
    const deductions = this._calculateDeductions(earnings.grossSalary, effectiveDays);
    
    // Step 4: Calculate net salary
    const netSalary = this._calculateNetSalary(earnings.grossSalary, deductions);
    
    // Step 5: Build final result
    this.result = this._buildResult(effectiveDays, earnings, deductions, netSalary);
    
    return this.result;
  }

  /**
   * Step 1: Calculate effective working days
   */
  _calculateEffectiveDays() {
    const { daysWorked = DEFAULT_WORKING_DAYS, lateDays = 0, halfDays = 0 } = this.attendance;
    
    let deductionDays = 0;
    
    // Late deduction: e.g., every 3 lates = 0.5 day cut
    if (this.salaryRule?.late?.count && this.salaryRule?.late?.deductionDays) {
      const lateDeductions = Math.floor(lateDays / this.salaryRule.late.count) * this.salaryRule.late.deductionDays;
      deductionDays += lateDeductions;
    }
    
    // Half-day deduction: e.g., every 2 half-days = 1 day cut
    if (this.salaryRule?.halfDay?.count && this.salaryRule?.halfDay?.deductionDays) {
      const halfDayDeductions = Math.floor(halfDays / this.salaryRule.halfDay.count) * this.salaryRule.halfDay.deductionDays;
      deductionDays += halfDayDeductions;
    }
    
    const effectiveDays = Math.max(0, daysWorked - deductionDays);
    
    return {
      totalDays: DEFAULT_WORKING_DAYS,
      daysWorked,
      lateDays,
      halfDays,
      deductionDays: parseFloat(deductionDays.toFixed(2)),
      effectiveDays: parseFloat(effectiveDays.toFixed(2)),
      prorationFactor: parseFloat((effectiveDays / DEFAULT_WORKING_DAYS).toFixed(4))
    };
  }

  /**
   * Step 2: Calculate earnings (all prorated)
   */
  _calculateEarnings(effectiveData) {
    const salary = this.employee.salaryStructure || {};
    const factor = effectiveData.prorationFactor;
    
    // Calculate each earning component
    const basic = parseFloat(((salary.basic || 0) * factor).toFixed(2));
    const hra = parseFloat(((salary.hra || 0) * factor).toFixed(2));
    const da = parseFloat(((salary.da || 0) * factor).toFixed(2));
    const bonus = parseFloat(((salary.bonus || 0) * factor).toFixed(2));
    
    // Other allowances (prorated)
    const otherAllowance = (salary.otherAllowence || []).map(allowance => ({
      name: allowance.name,
      originalAmount: allowance.amount || 0,
      amount: parseFloat(((allowance.amount || 0) * factor).toFixed(2))
    }));
    
    // Calculate overtime if applicable
    const overtimeAmount = this._calculateOvertime(effectiveData);
    
    // Total earnings
    const totalAllowances = otherAllowance.reduce((sum, a) => sum + a.amount, 0);
    const grossSalary = parseFloat((basic + hra + da + bonus + totalAllowances + overtimeAmount).toFixed(2));
    
    // Per day rate
    const totalMonthlyFixed = (salary.basic || 0) + (salary.hra || 0) + (salary.da || 0) + 
      (salary.bonus || 0) + (salary.otherAllowence || []).reduce((sum, a) => sum + (a.amount || 0), 0);
    const perDayRate = salary.perDay || parseFloat((totalMonthlyFixed / DEFAULT_WORKING_DAYS).toFixed(2));
    
    return {
      basic,
      hra,
      da,
      bonus,
      otherAllowance,
      overtimeAmount,
      grossSalary,
      perDayRate,
      breakdown: {
        basicRate: parseFloat(((salary.basic || 0) / DEFAULT_WORKING_DAYS).toFixed(2)),
        hraRate: parseFloat(((salary.hra || 0) / DEFAULT_WORKING_DAYS).toFixed(2)),
        daRate: parseFloat(((salary.da || 0) / DEFAULT_WORKING_DAYS).toFixed(2)),
        bonusRate: parseFloat(((salary.bonus || 0) / DEFAULT_WORKING_DAYS).toFixed(2))
      }
    };
  }

  /**
   * Calculate overtime
   */
  _calculateOvertime(effectiveData) {
    const salary = this.employee.salaryStructure || {};
    const overtimeRate = salary.overtimeRate || 0;
    const overtimeHours = this.attendance.overtimeHours || 0;
    
    return overtimeRate && overtimeHours ? 
      parseFloat((overtimeRate * overtimeHours).toFixed(2)) : 0;
  }

  /**
   * Step 3: Calculate deductions
   */
  _calculateDeductions(grossSalary, effectiveDays) {
    const salary = this.employee.salaryStructure || {};
    const employeeDeductions = this.employee.deductions || {};
    const factor = effectiveDays.prorationFactor;
    
    const deductions = {};
    
    // PF Calculation (12% of basic, employee contribution)
    deductions.pf = this._calculatePF(salary.basic || 0, factor);
    
    // ESI Calculation (0.75% of gross, applicable only if gross ≤ 21,000)
    deductions.esi = this._calculateESI(grossSalary);
    
    // Gratuity (4.81% of basic - employer contribution, not deducted)
    deductions.gratuity = this._calculateGratuity(salary.basic || 0, factor);
    
    // Income Tax (from employee record)
    deductions.incomeTax = employeeDeductions.incomeTax || 0;
    
    // Professional Tax (from employee record)
    deductions.professionalTax = employeeDeductions.professionalTax || 0;
    
    // Other deductions (from employee record)
    const otherDeductions = (employeeDeductions.otherDeduction || []).map(d => ({
      name: d.name,
      amount: d.amount || 0
    }));
    deductions.otherDeductions = otherDeductions;
    deductions.totalOtherDeductions = otherDeductions.reduce((sum, d) => sum + d.amount, 0);
    
    // Total deductions from employee salary
    deductions.totalDeductions = parseFloat(
      (deductions.pf + deductions.esi + deductions.incomeTax + 
       deductions.professionalTax + deductions.totalOtherDeductions).toFixed(2)
    );
    
    return deductions;
  }

  /**
   * PF Calculation
   */
  _calculatePF(basic, factor) {
    if (!this.payrollRule?.deductions?.pf?.enabled) return 0;
    
    const pfConfig = this.payrollRule.deductions.pf;
    const basicProRated = basic * factor;
    
    if (pfConfig.calculationType === 'percentage') {
      return parseFloat((basicProRated * (pfConfig.value / 100)).toFixed(2));
    } else {
      return pfConfig.value || 0;
    }
  }

  /**
   * ESI Calculation
   */
  _calculateESI(grossSalary) {
    if (!this.payrollRule?.deductions?.esi?.enabled) return 0;
    if (grossSalary > ESI_GROSS_LIMIT) return 0;
    
    const esiConfig = this.payrollRule.deductions.esi;
    
    if (esiConfig.calculationType === 'percentage') {
      return parseFloat((grossSalary * (esiConfig.value / 100)).toFixed(2));
    } else {
      return esiConfig.value || 0;
    }
  }

  /**
   * Gratuity Calculation (Employer contribution)
   */
  _calculateGratuity(basic, factor) {
    if (!this.payrollRule?.deductions?.gratuity?.enabled) return 0;
    
    const gratuityConfig = this.payrollRule.deductions.gratuity;
    const basicProRated = basic * factor;
    
    if (gratuityConfig.calculationType === 'percentage') {
      return parseFloat((basicProRated * (gratuityConfig.value / 100)).toFixed(2));
    } else {
      return gratuityConfig.value || 0;
    }
  }

  /**
   * Step 4: Calculate Net Salary
   */
  _calculateNetSalary(grossSalary, deductions) {
    return parseFloat((grossSalary - deductions.totalDeductions).toFixed(2));
  }

  /**
   * Step 5: Build final result
   */
  _buildResult(effectiveDays, earnings, deductions, netSalary) {
    return {
      // Employee Info
      employeeInfo: {
        empCode: this.employee.empCode,
        userId: this.employee.userId,
        name: this.employee.user_name || "—",
        designation: this.employee.jobInfo?.designation || "—",
        department: this.employee.jobInfo?.department || "—",
        employeeType: this.employee.employeeType || "non_sales",
        role: this.employee.role || "employee"
      },
      
      // Period Info
      period: {
        month: new Date().toLocaleString("default", { month: "long" }),
        year: new Date().getFullYear(),
        defaultWorkingDays: DEFAULT_WORKING_DAYS,
        calculationDate: new Date().toISOString()
      },
      
      // Attendance Summary
      attendance: effectiveDays,
      
      // Earnings Detail
      earnings: {
        ...earnings,
        summary: {
          fixedComponents: parseFloat((earnings.basic + earnings.hra + earnings.da + earnings.bonus).toFixed(2)),
          allowances: earnings.otherAllowance.reduce((sum, a) => sum + a.amount, 0),
          overtime: earnings.overtimeAmount,
          grossSalary: earnings.grossSalary
        }
      },
      
      // Deductions Detail
      deductions: {
        ...deductions,
        employeeContributions: {
          pf: deductions.pf,
          esi: deductions.esi
        },
        statutoryDeductions: {
          incomeTax: deductions.incomeTax,
          professionalTax: deductions.professionalTax
        },
        otherDeductionsDetail: deductions.otherDeductions,
        employerContributions: {
          gratuity: deductions.gratuity,
          // You can add employer PF contribution here if needed
        },
        totalDeductionsFromSalary: deductions.totalDeductions
      },
      
      // Net Salary
      netSalary,
      
      // Salary in Words (optional but useful)
      netSalaryInWords: this._numberToWords(netSalary),
      
      // Rules Applied
      rulesApplied: {
        lateRule: this.salaryRule?.late || null,
        halfDayRule: this.salaryRule?.halfDay || null,
        pfRule: this.payrollRule?.deductions?.pf || null,
        esiRule: this.payrollRule?.deductions?.esi || null,
        gratuityRule: this.payrollRule?.deductions?.gratuity || null,
        esiLimit: ESI_GROSS_LIMIT
      },
      
      // Notes
      notes: this._generateNotes(deductions)
    };
  }

  /**
   * Generate calculation notes
   */
  _generateNotes(deductions) {
    const notes = [];
    
    notes.push(`PF (Employee Contribution): ₹${deductions.pf} (12% of Basic)`);
    
    if (deductions.esi > 0) {
      notes.push(`ESI (Employee Contribution): ₹${deductions.esi} (0.75% of Gross ≤ ₹${ESI_GROSS_LIMIT})`);
    } else {
      notes.push(`ESI: Not Applicable (Gross > ₹${ESI_GROSS_LIMIT} or disabled)`);
    }
    
    notes.push(`Gratuity (Employer Contribution): ₹${deductions.gratuity} (4.81% of Basic) - NOT deducted from employee salary`);
    
    notes.push(`Late Deduction: ${this.salaryRule?.late?.count || 3} lates = ${this.salaryRule?.late?.deductionDays || 0.5} day deduction`);
    notes.push(`Half Day Deduction: ${this.salaryRule?.halfDay?.count || 2} half days = ${this.salaryRule?.halfDay?.deductionDays || 1} day deduction`);
    
    return notes;
  }

  /**
   * Convert number to words (Indian Rupees)
   */
  _numberToWords(num) {
    // Simple implementation - you can use a library like 'number-to-words' for better results
    const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    if (num === 0) return 'Zero Rupees Only';
    
    const numStr = Math.floor(num).toString();
    const decimal = Math.round((num - Math.floor(num)) * 100);
    
    let words = '';
    
    if (numStr.length > 5) {
      words += units[Math.floor(num / 100000)] + ' Lakh ';
      num %= 100000;
    }
    
    if (Math.floor(num / 1000) > 0) {
      const thousands = Math.floor(num / 1000);
      if (thousands < 10) {
        words += units[thousands] + ' ';
      } else if (thousands < 20) {
        words += teens[thousands - 10] + ' ';
      } else {
        words += tens[Math.floor(thousands / 10)] + ' ' + units[thousands % 10] + ' ';
      }
      words += 'Thousand ';
      num %= 1000;
    }
    
    if (Math.floor(num / 100) > 0) {
      words += units[Math.floor(num / 100)] + ' Hundred ';
      num %= 100;
    }
    
    if (num > 0) {
      if (num < 10) {
        words += units[num] + ' ';
      } else if (num < 20) {
        words += teens[num - 10] + ' ';
      } else {
        words += tens[Math.floor(num / 10)] + ' ' + units[num % 10] + ' ';
      }
    }
    
    words += 'Rupees';
    
    if (decimal > 0) {
      words += ' and ' + (decimal < 10 ? units[decimal] : tens[Math.floor(decimal / 10)] + ' ' + units[decimal % 10]) + ' Paise';
    }
    
    words += ' Only';
    
    return words.trim();
  }
}

// Export calculation functions
export const calculateEmployeeSalary = (employee, attendance, payrollRule, salaryRule) => {
  const calculator = new SalaryCalculator(employee, attendance, payrollRule, salaryRule);
  return calculator.calculate();
};

export const calculateBatchSalaries = (employees, attendanceMap, payrollRule, salaryRule) => {
  return employees.map(employee => {
    const attendance = attendanceMap[employee._id?.toString() || employee.empCode] || {
      daysWorked: DEFAULT_WORKING_DAYS,
      lateDays: 0,
      halfDays: 0,
      overtimeHours: 0
    };
    
    return calculateEmployeeSalary(employee, attendance, payrollRule, salaryRule);
  });
};