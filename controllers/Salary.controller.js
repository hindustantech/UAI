// controllers/SalaryController.js
import { calculateEmployeeSalary, calculateBatchSalaries } from "../services/SalaryEngine.js";
import { SalaryExcelGenerator } from "../services/CsvbuilderSalary.js";
import Employee from "../models/Attandance/Employee.js";
import Payroll from "../models/Attandance/Payroll.js";
import SalaryRule from "../models/salaryRules.js";
// Constants
const DEFAULT_WORKING_DAYS = 30;
const ESI_GROSS_LIMIT = 21000;

/**
 * Helper: Get active payroll rules from database
 */
const getActivePayrollRules = async (companyId) => {
  try {
    const payrollRule = await PayrollRule.findOne({ 
      companyId, 
      isActive: true 
    }).lean();
    
    if (!payrollRule) {
      throw new Error('No active payroll rules found. Please configure payroll rules first.');
    }
    
    return payrollRule;
  } catch (error) {
    console.error('Error fetching payroll rules:', error);
    throw error;
  }
};

/**
 * Helper: Get salary rules from database
 */
const getSalaryRules = async () => {
  try {
    const salaryRule = await SalaryRule.findOne().lean();
    
    if (!salaryRule) {
      // Return default rules if not found
      return {
        late: { ruleName: "3 Late = 0.5 Day Cut", count: 3, deductionDays: 0.5 },
        halfDay: { ruleName: "2 Half Days = 1 Day Cut", count: 2, deductionDays: 1 }
      };
    }
    
    return salaryRule;
  } catch (error) {
    console.error('Error fetching salary rules:', error);
    // Return default rules on error
    return {
      late: { ruleName: "3 Late = 0.5 Day Cut", count: 3, deductionDays: 0.5 },
      halfDay: { ruleName: "2 Half Days = 1 Day Cut", count: 2, deductionDays: 1 }
    };
  }
};

/**
 * Helper: Get employee attendance from database or calculate from attendance records
 */
const getEmployeeAttendance = async (employeeId, empCode, month, year) => {
  try {
    // Option 1: If you have an Attendance model, fetch from there
    // const attendance = await Attendance.findOne({
    //   employeeId,
    //   month,
    //   year
    // }).lean();

    // Option 2: Calculate from attendance records
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    
    // This is a placeholder - implement based on your Attendance model structure
    const attendanceRecords = await Attendance.find({
      employeeId,
      date: { $gte: startDate, $lte: endDate }
    }).lean();

    if (!attendanceRecords || attendanceRecords.length === 0) {
      // Return default attendance if no records found
      return {
        daysWorked: DEFAULT_WORKING_DAYS,
        lateDays: 0,
        halfDays: 0,
        overtimeHours: 0
      };
    }

    // Calculate attendance metrics
    const daysWorked = attendanceRecords.filter(r => r.status === 'present' || r.status === 'half-day').length;
    const lateDays = attendanceRecords.filter(r => r.isLate === true).length;
    const halfDays = attendanceRecords.filter(r => r.status === 'half-day').length;
    const overtimeHours = attendanceRecords.reduce((sum, r) => sum + (r.overtimeHours || 0), 0);

    return {
      daysWorked,
      lateDays,
      halfDays,
      overtimeHours: parseFloat(overtimeHours.toFixed(2))
    };
  } catch (error) {
    console.error(`Error fetching attendance for ${empCode}:`, error);
    // Return default attendance on error
    return {
      daysWorked: DEFAULT_WORKING_DAYS,
      lateDays: 0,
      halfDays: 0,
      overtimeHours: 0
    };
  }
};

/**
 * Helper: Build attendance map for batch processing
 */
const buildAttendanceMap = async (employees, month, year) => {
  const attendanceMap = {};
  
  for (const employee of employees) {
    const attendance = await getEmployeeAttendance(
      employee.userId,
      employee.empCode,
      month,
      year
    );
    
    // Use empCode as key (fallback to _id)
    const key = employee.empCode || employee._id.toString();
    attendanceMap[key] = attendance;
  }
  
  return attendanceMap;
};

/**
 * Calculate salary for all employees
 * GET /api/salary/calculate-all
 * Query params: month, year, companyId (optional, defaults to current month/year)
 */
export const calculateAll = async (req, res) => {
  try {
    const { 
      month = new Date().getMonth() + 1, 
      year = new Date().getFullYear(),
      companyId,
      department,
      employeeType 
    } = req.query;

    // Build filter for employees
    const filter = {
      employmentStatus: 'active'
    };

    if (companyId) {
      filter.companyId = companyId;
    }

    if (department) {
      filter['jobInfo.department'] = department;
    }

    if (employeeType) {
      filter.employeeType = employeeType;
    }

    // Fetch active employees from database
    const employees = await Employee.find(filter)
      .populate('userId', 'name email')
      .lean();

    if (!employees || employees.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active employees found.'
      });
    }

    // Get payroll rules (use first employee's companyId if not provided)
    const targetCompanyId = companyId || employees[0].companyId;
    const payrollRule = await getActivePayrollRules(targetCompanyId);
    const salaryRule = await getSalaryRules();

    // Build attendance data
    const attendanceMap = await buildAttendanceMap(employees, month, year);

    // Calculate salaries
    const results = calculateBatchSalaries(employees, attendanceMap, payrollRule, salaryRule);

    // Generate summary statistics
    const summary = {
      period: {
        month: new Date(year, month - 1).toLocaleString('default', { month: 'long' }),
        year: parseInt(year),
        defaultWorkingDays: DEFAULT_WORKING_DAYS
      },
      totalEmployees: results.length,
      financials: {
        totalGrossSalary: parseFloat(results.reduce((sum, r) => sum + r.earnings.grossSalary, 0).toFixed(2)),
        totalDeductions: parseFloat(results.reduce((sum, r) => sum + r.deductions.totalDeductions, 0).toFixed(2)),
        totalNetSalary: parseFloat(results.reduce((sum, r) => sum + r.netSalary, 0).toFixed(2)),
        totalEmployerGratuity: parseFloat(results.reduce((sum, r) => sum + r.deductions.gratuity, 0).toFixed(2)),
        averageNetSalary: parseFloat((results.reduce((sum, r) => sum + r.netSalary, 0) / results.length).toFixed(2))
      },
      employeeTypes: {},
      departmentWise: {}
    };

    // Group by employee type
    results.forEach(r => {
      const type = r.employeeInfo.employeeType;
      if (!summary.employeeTypes[type]) {
        summary.employeeTypes[type] = { count: 0, totalNetSalary: 0 };
      }
      summary.employeeTypes[type].count++;
      summary.employeeTypes[type].totalNetSalary += r.netSalary;
    });

    // Group by department
    results.forEach(r => {
      const dept = r.employeeInfo.department;
      if (!summary.departmentWise[dept]) {
        summary.departmentWise[dept] = { 
          count: 0, 
          totalGrossSalary: 0, 
          totalNetSalary: 0,
          employees: []
        };
      }
      summary.departmentWise[dept].count++;
      summary.departmentWise[dept].totalGrossSalary += r.earnings.grossSalary;
      summary.departmentWise[dept].totalNetSalary += r.netSalary;
      summary.departmentWise[dept].employees.push({
        empCode: r.employeeInfo.empCode,
        name: r.employeeInfo.name,
        netSalary: r.netSalary
      });
    });

    // Round department values
    Object.keys(summary.departmentWise).forEach(dept => {
      summary.departmentWise[dept].totalGrossSalary = 
        parseFloat(summary.departmentWise[dept].totalGrossSalary.toFixed(2));
      summary.departmentWise[dept].totalNetSalary = 
        parseFloat(summary.departmentWise[dept].totalNetSalary.toFixed(2));
    });

    res.json({
      success: true,
      count: results.length,
      summary,
      data: results
    });

  } catch (error) {
    console.error('Salary calculation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate salaries',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Calculate salary for a single employee
 * POST /api/salary/calculate
 * Body: { empCode, month, year, ...optional overrides }
 */
export const calculateOne = async (req, res) => {
  try {
    const {
      empCode,
      month = new Date().getMonth() + 1,
      year = new Date().getFullYear(),
      // Optional overrides (for manual calculations)
      basic,
      hra,
      da,
      bonus,
      otherAllowence,
      incomeTax,
      professionalTax,
      otherDeduction,
      daysWorked,
      lateDays,
      halfDays,
      overtimeHours
    } = req.body;

    // Find employee by empCode
    const employee = await Employee.findOne({ 
      empCode,
      employmentStatus: 'active'
    })
    .populate('userId', 'name email')
    .lean();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: `Employee with code ${empCode} not found or inactive.`
      });
    }

    // Get payroll rules
    const payrollRule = await getActivePayrollRules(employee.companyId);
    const salaryRule = await getSalaryRules();

    // Get or override attendance
    let attendance;
    if (daysWorked !== undefined || lateDays !== undefined || halfDays !== undefined) {
      // Use provided attendance data
      attendance = {
        daysWorked: daysWorked || DEFAULT_WORKING_DAYS,
        lateDays: lateDays || 0,
        halfDays: halfDays || 0,
        overtimeHours: overtimeHours || 0
      };
    } else {
      // Fetch from database
      attendance = await getEmployeeAttendance(employee.userId, empCode, month, year);
    }

    // Override salary structure if provided
    const employeeData = { ...employee };
    if (basic !== undefined || hra !== undefined || da !== undefined || bonus !== undefined || otherAllowence) {
      employeeData.salaryStructure = {
        ...employee.salaryStructure,
        ...(basic !== undefined && { basic }),
        ...(hra !== undefined && { hra }),
        ...(da !== undefined && { da }),
        ...(bonus !== undefined && { bonus }),
        ...(otherAllowence && { otherAllowence })
      };
    }

    // Override deductions if provided
    if (incomeTax !== undefined || professionalTax !== undefined || otherDeduction) {
      employeeData.deductions = {
        ...employee.deductions,
        ...(incomeTax !== undefined && { incomeTax }),
        ...(professionalTax !== undefined && { professionalTax }),
        ...(otherDeduction && { otherDeduction })
      };
    }

    // Calculate salary
    const result = calculateEmployeeSalary(employeeData, attendance, payrollRule, salaryRule);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Single salary calculation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate salary'
    });
  }
};

/**
 * Calculate salary for a specific employee by empCode
 * GET /api/salary/calculate/:empCode?month=6&year=2026
 */
export const calculateByEmployee = async (req, res) => {
  try {
    const { empCode } = req.params;
    const { 
      month = new Date().getMonth() + 1, 
      year = new Date().getFullYear() 
    } = req.query;

    // Find employee
    const employee = await Employee.findOne({ 
      empCode,
      employmentStatus: 'active'
    })
    .populate('userId', 'name email')
    .lean();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: `Employee with code ${empCode} not found or inactive.`
      });
    }

    // Get rules
    const payrollRule = await getActivePayrollRules(employee.companyId);
    const salaryRule = await getSalaryRules();

    // Get attendance
    const attendance = await getEmployeeAttendance(employee.userId, empCode, month, year);

    // Calculate
    const result = calculateEmployeeSalary(employee, attendance, payrollRule, salaryRule);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Employee salary calculation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate salary'
    });
  }
};

/**
 * Calculate salary for employees by department
 * GET /api/salary/calculate-by-department/:department?month=6&year=2026
 */
export const calculateByDepartment = async (req, res) => {
  try {
    const { department } = req.params;
    const { 
      month = new Date().getMonth() + 1, 
      year = new Date().getFullYear(),
      companyId 
    } = req.query;

    // Build filter
    const filter = {
      employmentStatus: 'active',
      'jobInfo.department': department
    };

    if (companyId) {
      filter.companyId = companyId;
    }

    // Fetch employees in department
    const employees = await Employee.find(filter)
      .populate('userId', 'name email')
      .lean();

    if (!employees || employees.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No active employees found in department: ${department}`
      });
    }

    // Get rules (use first employee's companyId)
    const targetCompanyId = companyId || employees[0].companyId;
    const payrollRule = await getActivePayrollRules(targetCompanyId);
    const salaryRule = await getSalaryRules();

    // Get attendance
    const attendanceMap = await buildAttendanceMap(employees, month, year);

    // Calculate
    const results = calculateBatchSalaries(employees, attendanceMap, payrollRule, salaryRule);

    // Department summary
    const summary = {
      department,
      employeeCount: results.length,
      totalGrossSalary: parseFloat(results.reduce((sum, r) => sum + r.earnings.grossSalary, 0).toFixed(2)),
      totalDeductions: parseFloat(results.reduce((sum, r) => sum + r.deductions.totalDeductions, 0).toFixed(2)),
      totalNetSalary: parseFloat(results.reduce((sum, r) => sum + r.netSalary, 0).toFixed(2)),
      averageNetSalary: parseFloat((results.reduce((sum, r) => sum + r.netSalary, 0) / results.length).toFixed(2))
    };

    res.json({
      success: true,
      summary,
      data: results
    });

  } catch (error) {
    console.error('Department salary calculation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate department salaries'
    });
  }
};

/**
 * Export salary register as Excel
 * GET /api/salary/export?month=6&year=2026&companyId=xxx
 */
export const exportExcel = async (req, res) => {
  try {
    const { 
      month = new Date().getMonth() + 1, 
      year = new Date().getFullYear(),
      companyId,
      department 
    } = req.query;

    // Build filter
    const filter = { employmentStatus: 'active' };
    if (companyId) filter.companyId = companyId;
    if (department) filter['jobInfo.department'] = department;

    // Fetch employees
    const employees = await Employee.find(filter)
      .populate('userId', 'name email')
      .lean();

    if (!employees || employees.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active employees found for export.'
      });
    }

    // Get rules
    const targetCompanyId = companyId || employees[0].companyId;
    const payrollRule = await getActivePayrollRules(targetCompanyId);
    const salaryRule = await getSalaryRules();

    // Get attendance
    const attendanceMap = await buildAttendanceMap(employees, month, year);

    // Calculate salaries
    const results = calculateBatchSalaries(employees, attendanceMap, payrollRule, salaryRule);

    // Generate Excel
    const generator = new SalaryExcelGenerator(results);
    await generator.generate();
    
    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
    const filename = `Salary_Register_${monthName}_${year}.xlsx`;
    
    await generator.writeToResponse(res, filename);
    
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to export Excel'
    });
  }
};

/**
 * Export individual salary slip
 * GET /api/salary/slip/:empCode?month=6&year=2026
 */
export const exportSalarySlip = async (req, res) => {
  try {
    const { empCode } = req.params;
    const { 
      month = new Date().getMonth() + 1, 
      year = new Date().getFullYear() 
    } = req.query;

    // Find employee
    const employee = await Employee.findOne({ 
      empCode,
      employmentStatus: 'active'
    })
    .populate('userId', 'name email')
    .lean();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: `Employee with code ${empCode} not found.`
      });
    }

    // Get rules
    const payrollRule = await getActivePayrollRules(employee.companyId);
    const salaryRule = await getSalaryRules();

    // Get attendance
    const attendance = await getEmployeeAttendance(employee.userId, empCode, month, year);

    // Calculate
    const result = calculateEmployeeSalary(employee, attendance, payrollRule, salaryRule);

    // Generate single employee slip
    const generator = new SalaryExcelGenerator([result]);
    await generator.generate();
    
    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
    const filename = `Salary_Slip_${empCode}_${monthName}_${year}.xlsx`;
    
    await generator.writeToResponse(res, filename);
    
  } catch (error) {
    console.error('Salary slip export error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to export salary slip'
    });
  }
};

/**
 * Get payroll rules
 * GET /api/salary/rules?companyId=xxx
 */
export const getRules = async (req, res) => {
  try {
    const { companyId } = req.query;

    let payrollRule;
    if (companyId) {
      payrollRule = await PayrollRule.findOne({ 
        companyId, 
        isActive: true 
      }).lean();
    } else {
      // Get the first active rule
      payrollRule = await PayrollRule.findOne({ isActive: true }).lean();
    }

    const salaryRule = await SalaryRule.findOne().lean();

    if (!payrollRule) {
      return res.status(404).json({
        success: false,
        message: 'No active payroll rules found. Please configure payroll rules.'
      });
    }

    res.json({
      success: true,
      data: {
        payrollRule,
        salaryRule: salaryRule || {
          late: { ruleName: "3 Late = 0.5 Day Cut", count: 3, deductionDays: 0.5 },
          halfDay: { ruleName: "2 Half Days = 1 Day Cut", count: 2, deductionDays: 1 }
        },
        rules: [
          {
            category: "Provident Fund (PF)",
            employeeContribution: `${payrollRule.deductions.pf.value}% of Basic Salary (prorated)`,
            calculationType: payrollRule.deductions.pf.calculationType,
            enabled: payrollRule.deductions.pf.enabled,
            notes: "Employee contribution deducted from salary"
          },
          {
            category: "Employee State Insurance (ESI)",
            employeeContribution: `${payrollRule.deductions.esi.value}% of Gross Salary`,
            calculationType: payrollRule.deductions.esi.calculationType,
            enabled: payrollRule.deductions.esi.enabled,
            applicability: `Only if Gross Salary ≤ ₹${ESI_GROSS_LIMIT}/month`,
            notes: "Not applicable for employees with Gross > ₹21,000"
          },
          {
            category: "Gratuity",
            contribution: `${payrollRule.deductions.gratuity.value}% of Basic Salary (prorated)`,
            calculationType: payrollRule.deductions.gratuity.calculationType,
            enabled: payrollRule.deductions.gratuity.enabled,
            borneBy: "Employer",
            notes: "Not deducted from employee salary. Shown for transparency."
          },
          {
            category: "Working Days",
            defaultDays: DEFAULT_WORKING_DAYS
          },
          {
            category: "Salary Proration",
            formula: "Component = (Monthly Amount / 30) × Effective Days"
          },
          {
            category: "Net Salary Formula",
            formula: "Net = Gross - PF - ESI - Income Tax - Professional Tax - Other Deductions"
          }
        ]
      }
    });

  } catch (error) {
    console.error('Rules fetch error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch rules'
    });
  }
};

/**
 * Get salary summary statistics
 * GET /api/salary/summary?month=6&year=2026&companyId=xxx
 */
export const getSummary = async (req, res) => {
  try {
    const { 
      month = new Date().getMonth() + 1, 
      year = new Date().getFullYear(),
      companyId 
    } = req.query;

    // Build filter
    const filter = { employmentStatus: 'active' };
    if (companyId) filter.companyId = companyId;

    // Fetch employees
    const employees = await Employee.find(filter)
      .populate('userId', 'name email')
      .lean();

    if (!employees || employees.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active employees found.'
      });
    }

    // Get rules
    const targetCompanyId = companyId || employees[0].companyId;
    const payrollRule = await getActivePayrollRules(targetCompanyId);
    const salaryRule = await getSalaryRules();

    // Get attendance
    const attendanceMap = await buildAttendanceMap(employees, month, year);

    // Calculate
    const results = calculateBatchSalaries(employees, attendanceMap, payrollRule, salaryRule);

    // Generate detailed summary
    const summary = {
      period: {
        month: new Date(year, month - 1).toLocaleString('default', { month: 'long' }),
        year: parseInt(year),
        defaultWorkingDays: DEFAULT_WORKING_DAYS
      },
      employeeCount: results.length,
      financials: {
        totalGrossSalary: parseFloat(results.reduce((sum, r) => sum + r.earnings.grossSalary, 0).toFixed(2)),
        totalDeductions: parseFloat(results.reduce((sum, r) => sum + r.deductions.totalDeductions, 0).toFixed(2)),
        totalNetSalary: parseFloat(results.reduce((sum, r) => sum + r.netSalary, 0).toFixed(2)),
        totalEmployerGratuity: parseFloat(results.reduce((sum, r) => sum + r.deductions.gratuity, 0).toFixed(2)),
        averageNetSalary: parseFloat((results.reduce((sum, r) => sum + r.netSalary, 0) / results.length).toFixed(2)),
        highestNetSalary: Math.max(...results.map(r => r.netSalary)),
        lowestNetSalary: Math.min(...results.map(r => r.netSalary))
      },
      deductions: {
        totalPF: parseFloat(results.reduce((sum, r) => sum + r.deductions.pf, 0).toFixed(2)),
        totalESI: parseFloat(results.reduce((sum, r) => sum + r.deductions.esi, 0).toFixed(2)),
        totalIncomeTax: parseFloat(results.reduce((sum, r) => sum + r.deductions.incomeTax, 0).toFixed(2)),
        totalProfessionalTax: parseFloat(results.reduce((sum, r) => sum + r.deductions.professionalTax, 0).toFixed(2)),
        totalOtherDeductions: parseFloat(results.reduce((sum, r) => sum + r.deductions.totalOtherDeductions, 0).toFixed(2))
      },
      attendanceSummary: {
        averageDaysWorked: parseFloat((results.reduce((sum, r) => sum + r.attendance.daysWorked, 0) / results.length).toFixed(1)),
        totalLateDays: results.reduce((sum, r) => sum + r.attendance.lateDays, 0),
        totalHalfDays: results.reduce((sum, r) => sum + r.attendance.halfDays, 0),
        totalDeductionDays: parseFloat(results.reduce((sum, r) => sum + r.attendance.deductionDays, 0).toFixed(2))
      },
      byDepartment: {},
      byEmployeeType: {}
    };

    // Group by department
    results.forEach(r => {
      const dept = r.employeeInfo.department || 'Unassigned';
      if (!summary.byDepartment[dept]) {
        summary.byDepartment[dept] = { 
          count: 0, 
          totalGrossSalary: 0, 
          totalNetSalary: 0,
          totalDeductions: 0
        };
      }
      summary.byDepartment[dept].count++;
      summary.byDepartment[dept].totalGrossSalary += r.earnings.grossSalary;
      summary.byDepartment[dept].totalNetSalary += r.netSalary;
      summary.byDepartment[dept].totalDeductions += r.deductions.totalDeductions;
    });

    // Round department values
    Object.keys(summary.byDepartment).forEach(dept => {
      const d = summary.byDepartment[dept];
      d.totalGrossSalary = parseFloat(d.totalGrossSalary.toFixed(2));
      d.totalNetSalary = parseFloat(d.totalNetSalary.toFixed(2));
      d.totalDeductions = parseFloat(d.totalDeductions.toFixed(2));
    });

    // Group by employee type
    results.forEach(r => {
      const type = r.employeeInfo.employeeType || 'non_sales';
      if (!summary.byEmployeeType[type]) {
        summary.byEmployeeType[type] = { 
          count: 0, 
          totalGrossSalary: 0, 
          totalNetSalary: 0 
        };
      }
      summary.byEmployeeType[type].count++;
      summary.byEmployeeType[type].totalGrossSalary += r.earnings.grossSalary;
      summary.byEmployeeType[type].totalNetSalary += r.netSalary;
    });

    // Round employee type values
    Object.keys(summary.byEmployeeType).forEach(type => {
      const t = summary.byEmployeeType[type];
      t.totalGrossSalary = parseFloat(t.totalGrossSalary.toFixed(2));
      t.totalNetSalary = parseFloat(t.totalNetSalary.toFixed(2));
    });

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate summary'
    });
  }
};