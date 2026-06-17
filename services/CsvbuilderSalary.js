// services/ExcelBuilder.js
import ExcelJS from "exceljs";

const COLORS = {
  PRIMARY: "1F3864",
  SECONDARY: "2E75B6",
  SUCCESS: "375623",
  DANGER: "C00000",
  WARNING: "ED7D31",
  ALT_ROW: "DEEAF1",
  DEDUCTION_BG: "FCE4D6",
  TOTAL_BG: "E2EFDA",
  HEADER_TEXT: "FFFFFF",
  WHITE: "FFFFFF",
  BLACK: "000000"
};

export class SalaryExcelGenerator {
  constructor(salaryResults) {
    this.salaryResults = salaryResults;
    this.workbook = new ExcelJS.Workbook();
  }

  /**
   * Generate complete Excel workbook
   */
  async generate() {
    this.workbook.creator = "HRMS Salary System";
    this.workbook.created = new Date();
    
    await this._createSummarySheet();
    await this._createDetailedSheet();
    await this._createSalarySlips();
    await this._createRulesSheet();
    
    return this.workbook;
  }

  /**
   * Sheet 1: Salary Summary (One-line per employee)
   */
  async _createSummarySheet() {
    const ws = this.workbook.addWorksheet("Salary Summary", {
      properties: { tabColor: { argb: COLORS.PRIMARY } }
    });

    // Column configuration
    const columns = [
      { header: "Emp Code", key: "empCode", width: 12 },
      { header: "Employee Name", key: "name", width: 25 },
      { header: "Designation", key: "designation", width: 22 },
      { header: "Department", key: "department", width: 18 },
      { header: "Days Worked", key: "daysWorked", width: 14 },
      { header: "Late Days", key: "lateDays", width: 12 },
      { header: "Half Days", key: "halfDays", width: 12 },
      { header: "Eff. Days", key: "effectiveDays", width: 12 },
      { header: "Basic", key: "basic", width: 14 },
      { header: "HRA", key: "hra", width: 14 },
      { header: "DA", key: "da", width: 14 },
      { header: "Bonus", key: "bonus", width: 14 },
      { header: "Other Allow.", key: "otherAllowance", width: 14 },
      { header: "Gross Salary", key: "grossSalary", width: 16 },
      { header: "PF", key: "pf", width: 14 },
      { header: "ESI", key: "esi", width: 14 },
      { header: "Income Tax", key: "incomeTax", width: 14 },
      { header: "Prof. Tax", key: "professionalTax", width: 14 },
      { header: "Other Ded.", key: "otherDeductions", width: 14 },
      { header: "Total Ded.", key: "totalDeductions", width: 16 },
      { header: "Net Salary", key: "netSalary", width: 16 },
      { header: "Gratuity (Emp)", key: "gratuity", width: 16 }
    ];

    ws.columns = columns;

    // Title row
    ws.mergeCells(1, 1, 1, columns.length);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = "MONTHLY SALARY REGISTER";
    this._styleCell(titleCell, { 
      bold: true, 
      size: 14, 
      color: COLORS.HEADER_TEXT, 
      bg: COLORS.PRIMARY,
      alignment: { horizontal: 'center', vertical: 'middle' }
    });
    ws.getRow(1).height = 30;

    // Info row
    ws.mergeCells(2, 1, 2, columns.length);
    const infoCell = ws.getCell(2, 1);
    const date = new Date();
    infoCell.value = `Month: ${date.toLocaleString('default', { month: 'long', year: 'numeric' })} | Default Working Days: 30 | Generated: ${date.toLocaleDateString('en-IN')}`;
    this._styleCell(infoCell, { 
      bold: true, 
      color: COLORS.HEADER_TEXT, 
      bg: COLORS.SECONDARY,
      alignment: { horizontal: 'left', vertical: 'middle' }
    });
    ws.getRow(2).height = 22;

    // Header row
    const headerRow = ws.getRow(3);
    headerRow.height = 40;
    headerRow.eachCell((cell) => {
      this._styleCell(cell, {
        bold: true,
        color: COLORS.HEADER_TEXT,
        bg: COLORS.PRIMARY,
        wrapText: true,
        alignment: { horizontal: 'center', vertical: 'middle' }
      });
    });

    // Data rows
    this.salaryResults.forEach((result, index) => {
      const rowNum = index + 4;
      const row = ws.getRow(rowNum);
      
      const data = {
        empCode: result.employeeInfo.empCode,
        name: result.employeeInfo.name,
        designation: result.employeeInfo.designation,
        department: result.employeeInfo.department,
        daysWorked: result.attendance.daysWorked,
        lateDays: result.attendance.lateDays,
        halfDays: result.attendance.halfDays,
        effectiveDays: result.attendance.effectiveDays,
        basic: result.earnings.basic,
        hra: result.earnings.hra,
        da: result.earnings.da,
        bonus: result.earnings.bonus,
        otherAllowance: result.earnings.otherAllowance.reduce((sum, a) => sum + a.amount, 0),
        grossSalary: result.earnings.grossSalary,
        pf: result.deductions.pf,
        esi: result.deductions.esi,
        incomeTax: result.deductions.incomeTax,
        professionalTax: result.deductions.professionalTax,
        otherDeductions: result.deductions.totalOtherDeductions,
        totalDeductions: result.deductions.totalDeductions,
        netSalary: result.netSalary,
        gratuity: result.deductions.gratuity
      };

      Object.keys(data).forEach((key, colIndex) => {
        const cell = row.getCell(colIndex + 1);
        cell.value = data[key];
        
        // Format currency columns
        if ([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].includes(colIndex + 1)) {
          cell.numFmt = '₹#,##0.00';
        }
        
        // Style
        const isEven = index % 2 === 0;
        this._styleCell(cell, {
          bg: isEven ? COLORS.ALT_ROW : COLORS.WHITE,
          alignment: { horizontal: colIndex < 3 ? 'left' : 'center', vertical: 'middle' }
        });
      });
      
      row.height = 20;
    });

    // Totals row
    const totalRowNum = this.salaryResults.length + 4;
    const totalRow = ws.getRow(totalRowNum);
    
    // Merge first 7 columns for "TOTAL" label
    ws.mergeCells(totalRowNum, 1, totalRowNum, 7);
    totalRow.getCell(1).value = "TOTAL";
    this._styleCell(totalRow.getCell(1), { 
      bold: true, 
      bg: COLORS.TOTAL_BG,
      alignment: { horizontal: 'right', vertical: 'middle' }
    });
    
    // Add SUM formulas for numeric columns
    for (let col = 8; col <= columns.length; col++) {
      const cell = totalRow.getCell(col);
      cell.value = { 
        formula: `SUM(${this._columnLetter(col)}4:${this._columnLetter(col)}${totalRowNum - 1})` 
      };
      cell.numFmt = '₹#,##0.00';
      this._styleCell(cell, { bold: true, bg: COLORS.TOTAL_BG });
    }
    
    totalRow.height = 22;

    // Freeze panes
    ws.views = [
      { state: 'frozen', ySplit: 3, xSplit: 7 }
    ];
  }

  /**
   * Sheet 2: Detailed Salary Breakdown
   */
  async _createDetailedSheet() {
    const ws = this.workbook.addWorksheet("Detailed Breakdown", {
      properties: { tabColor: { argb: COLORS.SECONDARY } }
    });

    let row = 1;

    this.salaryResults.forEach((result, index) => {
      // Employee header
      ws.mergeCells(row, 1, row, 6);
      const empHeader = ws.getCell(row, 1);
      empHeader.value = `${result.employeeInfo.name} (${result.employeeInfo.empCode}) - ${result.employeeInfo.designation}`;
      this._styleCell(empHeader, { 
        bold: true, 
        size: 12, 
        color: COLORS.HEADER_TEXT, 
        bg: COLORS.PRIMARY 
      });
      ws.getRow(row).height = 25;
      row++;

      // Column headers
      const colHeaders = ['Component', 'Monthly Rate', 'Effective Days', 'Prorated Amount', 'Factor', 'Remarks'];
      colHeaders.forEach((header, i) => {
        const cell = ws.getCell(row, i + 1);
        cell.value = header;
        this._styleCell(cell, { bold: true, bg: COLORS.SECONDARY, color: COLORS.HEADER_TEXT });
      });
      row++;

      // Earnings section
      ws.getCell(row, 1).value = 'EARNINGS';
      ws.mergeCells(row, 1, row, 6);
      this._styleCell(ws.getCell(row, 1), { bold: true, bg: COLORS.SUCCESS, color: COLORS.HEADER_TEXT });
      row++;

      const earningsData = [
        ['Basic Salary', result.earnings.breakdown.basicRate, result.attendance.effectiveDays, result.earnings.basic],
        ['HRA', result.earnings.breakdown.hraRate, result.attendance.effectiveDays, result.earnings.hra],
        ['DA', result.earnings.breakdown.daRate, result.attendance.effectiveDays, result.earnings.da],
        ['Bonus', result.earnings.breakdown.bonusRate, result.attendance.effectiveDays, result.earnings.bonus],
        ...result.earnings.otherAllowance.map(a => [a.name, (a.originalAmount / 30).toFixed(2), result.attendance.effectiveDays, a.amount])
      ];

      earningsData.forEach(([name, rate, days, amount]) => {
        ws.getCell(row, 1).value = name;
        ws.getCell(row, 2).value = rate;
        ws.getCell(row, 3).value = days;
        ws.getCell(row, 4).value = amount;
        ws.getCell(row, 4).numFmt = '₹#,##0.00';
        ws.getCell(row, 5).value = result.attendance.prorationFactor;
        ws.getCell(row, 6).value = `= ${rate} × ${days}`;
        row++;
      });

      // Gross total
      ws.getCell(row, 1).value = 'GROSS SALARY';
      ws.mergeCells(row, 1, row, 3);
      ws.getCell(row, 4).value = result.earnings.grossSalary;
      ws.getCell(row, 4).numFmt = '₹#,##0.00';
      this._styleCell(ws.getCell(row, 1), { bold: true, bg: COLORS.TOTAL_BG });
      this._styleCell(ws.getCell(row, 4), { bold: true, bg: COLORS.TOTAL_BG });
      row++;
      row++;

      // Deductions section
      ws.getCell(row, 1).value = 'DEDUCTIONS (From Employee Salary)';
      ws.mergeCells(row, 1, row, 6);
      this._styleCell(ws.getCell(row, 1), { bold: true, bg: COLORS.DANGER, color: COLORS.HEADER_TEXT });
      row++;

      const deductionsData = [
        ['PF (Employee Contribution)', result.deductions.pf, '12% of Basic'],
        ['ESI (Employee Contribution)', result.deductions.esi, '0.75% of Gross (if ≤ ₹21,000)'],
        ['Income Tax', result.deductions.incomeTax, 'As per IT declaration'],
        ['Professional Tax', result.deductions.professionalTax, 'As per state rules'],
        ...result.deductions.otherDeductions.map(d => [d.name, d.amount, 'Other Deduction'])
      ];

      deductionsData.forEach(([name, amount, remark]) => {
        ws.getCell(row, 1).value = name;
        ws.getCell(row, 4).value = amount;
        ws.getCell(row, 4).numFmt = '₹#,##0.00';
        ws.getCell(row, 6).value = remark;
        row++;
      });

      // Total deductions
      ws.getCell(row, 1).value = 'TOTAL DEDUCTIONS';
      ws.mergeCells(row, 1, row, 3);
      ws.getCell(row, 4).value = result.deductions.totalDeductions;
      ws.getCell(row, 4).numFmt = '₹#,##0.00';
      this._styleCell(ws.getCell(row, 1), { bold: true, bg: COLORS.DEDUCTION_BG });
      this._styleCell(ws.getCell(row, 4), { bold: true, bg: COLORS.DEDUCTION_BG });
      row++;

      // Net salary
      ws.getCell(row, 1).value = 'NET SALARY PAYABLE';
      ws.mergeCells(row, 1, row, 3);
      ws.getCell(row, 4).value = result.netSalary;
      ws.getCell(row, 4).numFmt = '₹#,##0.00';
      this._styleCell(ws.getCell(row, 1), { bold: true, size: 11, bg: COLORS.SUCCESS, color: COLORS.HEADER_TEXT });
      this._styleCell(ws.getCell(row, 4), { bold: true, size: 12, bg: COLORS.SUCCESS, color: COLORS.HEADER_TEXT });
      row++;

      // Employer contributions
      ws.getCell(row, 1).value = 'EMPLOYER CONTRIBUTIONS (Not deducted from salary)';
      ws.mergeCells(row, 1, row, 6);
      this._styleCell(ws.getCell(row, 1), { bold: true, bg: COLORS.WARNING, color: COLORS.HEADER_TEXT });
      row++;

      ws.getCell(row, 1).value = 'Gratuity (4.81% of Basic)';
      ws.getCell(row, 4).value = result.deductions.gratuity;
      ws.getCell(row, 4).numFmt = '₹#,##0.00';
      row++;

      // Notes
      result.notes.forEach(note => {
        ws.getCell(row, 1).value = note;
        ws.mergeCells(row, 1, row, 6);
        this._styleCell(ws.getCell(row, 1), { color: "7F0000", alignment: { horizontal: 'left' } });
        row++;
      });

      // Spacing between employees
      row += 2;
    });
  }

  /**
   * Sheet 3: Individual Salary Slips
   */
  async _createSalarySlips() {
    const ws = this.workbook.addWorksheet("Salary Slips", {
      properties: { tabColor: { argb: COLORS.SUCCESS } }
    });

    // Set column widths
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 30;
    ws.getColumn(3).width = 20;
    ws.getColumn(4).width = 5;
    ws.getColumn(5).width = 30;
    ws.getColumn(6).width = 20;
    ws.getColumn(7).width = 5;

    let row = 1;

    this.salaryResults.forEach((result, index) => {
      // Company header (you can customize this)
      ws.mergeCells(row, 1, row, 7);
      const companyCell = ws.getCell(row, 1);
      companyCell.value = "YOUR COMPANY NAME";
      this._styleCell(companyCell, { bold: true, size: 16, bg: COLORS.PRIMARY, color: COLORS.HEADER_TEXT, alignment: { horizontal: 'center' } });
      ws.getRow(row).height = 35;
      row++;

      ws.mergeCells(row, 1, row, 7);
      const slipTitle = ws.getCell(row, 1);
      slipTitle.value = "SALARY SLIP";
      this._styleCell(slipTitle, { bold: true, size: 14, bg: COLORS.SECONDARY, color: COLORS.HEADER_TEXT, alignment: { horizontal: 'center' } });
      ws.getRow(row).height = 28;
      row++;

      // Period
      ws.mergeCells(row, 1, row, 7);
      const periodCell = ws.getCell(row, 1);
      periodCell.value = `For the Month of ${result.period.month} ${result.period.year}`;
      this._styleCell(periodCell, { bold: true, alignment: { horizontal: 'center' } });
      row++;
      row++;

      // Employee Details
      const details = [
        ['', 'Employee Code', result.employeeInfo.empCode, '', 'Employee Name', result.employeeInfo.name],
        ['', 'Designation', result.employeeInfo.designation, '', 'Department', result.employeeInfo.department],
        ['', 'Days Worked', result.attendance.daysWorked.toString(), '', 'Effective Days', result.attendance.effectiveDays.toString()],
        ['', 'Late Days', result.attendance.lateDays.toString(), '', 'Half Days', result.attendance.halfDays.toString()],
      ];

      details.forEach(([s1, label1, value1, s2, label2, value2]) => {
        ws.getCell(row, 1).value = '';
        ws.getCell(row, 2).value = label1;
        this._styleCell(ws.getCell(row, 2), { bold: true, alignment: { horizontal: 'left' } });
        ws.getCell(row, 3).value = value1;
        ws.getCell(row, 4).value = '';
        ws.getCell(row, 5).value = label2;
        this._styleCell(ws.getCell(row, 5), { bold: true, alignment: { horizontal: 'left' } });
        ws.getCell(row, 6).value = value2;
        ws.getCell(row, 7).value = '';
        
        // Borders
        for (let col = 1; col <= 7; col++) {
          ws.getCell(row, col).border = {
            bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } }
          };
        }
        
        row++;
      });

      row++;

      // Earnings and Deductions side by side
      // Headers
      ws.mergeCells(row, 1, row, 3);
      ws.getCell(row, 1).value = 'EARNINGS';
      this._styleCell(ws.getCell(row, 1), { bold: true, bg: COLORS.SUCCESS, color: COLORS.HEADER_TEXT, alignment: { horizontal: 'center' } });
      
      ws.mergeCells(row, 5, row, 7);
      ws.getCell(row, 5).value = 'DEDUCTIONS';
      this._styleCell(ws.getCell(row, 5), { bold: true, bg: COLORS.DANGER, color: COLORS.HEADER_TEXT, alignment: { horizontal: 'center' } });
      row++;

      // Column sub-headers
      ws.getCell(row, 2).value = 'Particulars';
      ws.getCell(row, 3).value = 'Amount (₹)';
      this._styleCell(ws.getCell(row, 2), { bold: true, bg: COLORS.TOTAL_BG });
      this._styleCell(ws.getCell(row, 3), { bold: true, bg: COLORS.TOTAL_BG });
      
      ws.getCell(row, 5).value = 'Particulars';
      ws.getCell(row, 6).value = 'Amount (₹)';
      this._styleCell(ws.getCell(row, 5), { bold: true, bg: COLORS.DEDUCTION_BG });
      this._styleCell(ws.getCell(row, 6), { bold: true, bg: COLORS.DEDUCTION_BG });
      row++;

      // Earnings items
      const earningItems = [
        ['Basic Salary', result.earnings.basic],
        ['HRA', result.earnings.hra],
        ['DA', result.earnings.da],
        ['Bonus', result.earnings.bonus],
        ...result.earnings.otherAllowance.map(a => [a.name, a.amount])
      ];

      const deductionItems = [
        ['PF (12% of Basic)', result.deductions.pf],
        ['ESI (0.75% of Gross)', result.deductions.esi],
        ['Income Tax', result.deductions.incomeTax],
        ['Professional Tax', result.deductions.professionalTax],
        ...result.deductions.otherDeductions.map(d => [d.name, d.amount])
      ];

      const maxRows = Math.max(earningItems.length, deductionItems.length);
      
      for (let i = 0; i < maxRows; i++) {
        const [eName, eAmt] = earningItems[i] || ['', ''];
        const [dName, dAmt] = deductionItems[i] || ['', ''];
        
        ws.getCell(row, 2).value = eName;
        ws.getCell(row, 3).value = eAmt || '';
        if (eAmt) ws.getCell(row, 3).numFmt = '₹#,##0.00';
        
        ws.getCell(row, 5).value = dName;
        ws.getCell(row, 6).value = dAmt || '';
        if (dAmt) ws.getCell(row, 6).numFmt = '₹#,##0.00';
        
        // Alternate row colors
        const isEven = i % 2 === 0;
        this._styleCell(ws.getCell(row, 2), { bg: isEven ? COLORS.ALT_ROW : COLORS.WHITE });
        this._styleCell(ws.getCell(row, 3), { bg: isEven ? COLORS.ALT_ROW : COLORS.WHITE });
        this._styleCell(ws.getCell(row, 5), { bg: isEven ? COLORS.ALT_ROW : COLORS.WHITE });
        this._styleCell(ws.getCell(row, 6), { bg: isEven ? COLORS.ALT_ROW : COLORS.WHITE });
        
        row++;
      }

      // Totals
      ws.getCell(row, 2).value = 'GROSS SALARY';
      this._styleCell(ws.getCell(row, 2), { bold: true, bg: COLORS.TOTAL_BG });
      ws.getCell(row, 3).value = result.earnings.grossSalary;
      ws.getCell(row, 3).numFmt = '₹#,##0.00';
      this._styleCell(ws.getCell(row, 3), { bold: true, bg: COLORS.TOTAL_BG });
      
      ws.getCell(row, 5).value = 'TOTAL DEDUCTIONS';
      this._styleCell(ws.getCell(row, 5), { bold: true, bg: COLORS.DEDUCTION_BG });
      ws.getCell(row, 6).value = result.deductions.totalDeductions;
      ws.getCell(row, 6).numFmt = '₹#,##0.00';
      this._styleCell(ws.getCell(row, 6), { bold: true, bg: COLORS.DEDUCTION_BG });
      row++;

      // Net Salary
      ws.mergeCells(row, 1, row, 3);
      ws.getCell(row, 1).value = 'NET SALARY PAYABLE';
      this._styleCell(ws.getCell(row, 1), { bold: true, size: 12, bg: COLORS.SUCCESS, color: COLORS.HEADER_TEXT, alignment: { horizontal: 'center' } });
      
      ws.mergeCells(row, 5, row, 7);
      ws.getCell(row, 5).value = `₹ ${result.netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      this._styleCell(ws.getCell(row, 5), { bold: true, size: 14, bg: COLORS.SUCCESS, color: COLORS.HEADER_TEXT, alignment: { horizontal: 'center' } });
      ws.getRow(row).height = 30;
      row++;

      // Amount in words
      ws.mergeCells(row, 1, row, 7);
      ws.getCell(row, 1).value = `Amount in words: ${result.netSalaryInWords}`;
      this._styleCell(ws.getCell(row, 1), { italic: true, alignment: { horizontal: 'left' } });
      row++;

      // Employer contribution note
      ws.mergeCells(row, 1, row, 7);
      ws.getCell(row, 1).value = `Employer Contribution - Gratuity: ₹${result.deductions.gratuity.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (Not deducted from employee salary)`;
      this._styleCell(ws.getCell(row, 1), { color: "7F0000", alignment: { horizontal: 'left' } });
      row++;

      // Page break for next employee
      if (index < this.salaryResults.length - 1) {
        row += 3;
        ws.addPageBreak(row - 1);
      }
    });
  }

  /**
   * Sheet 4: Payroll Rules Reference
   */
  async _createRulesSheet() {
    const ws = this.workbook.addWorksheet("Payroll Rules", {
      properties: { tabColor: { argb: COLORS.WARNING } }
    });

    ws.getColumn(1).width = 30;
    ws.getColumn(2).width = 60;

    ws.mergeCells(1, 1, 1, 2);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = 'PAYROLL RULES & CALCULATION POLICIES';
    this._styleCell(titleCell, { bold: true, size: 13, color: COLORS.HEADER_TEXT, bg: COLORS.PRIMARY, alignment: { horizontal: 'center' } });
    ws.getRow(1).height = 28;

    const rules = [
      ['Rule', 'Description'],
      ['Working Days', '30 days per month (standard)'],
      ['Proration Formula', 'Component Amount = (Monthly Amount / 30) × Effective Days'],
      ['Effective Days', 'Days Worked - Late Deductions - Half Day Deductions'],
      ['PF (Provident Fund)', 'Employee Contribution: 12% of Basic Salary (prorated). Deducted from employee salary.'],
      ['ESI (Employee State Insurance)', 'Employee Contribution: 0.75% of Gross Salary. Applicable only if Gross ≤ ₹21,000/month. Not deducted if Gross > ₹21,000.'],
      ['Gratuity', 'Employer Contribution: 4.81% of Basic Salary (prorated). Borne by employer. NOT deducted from employee salary.'],
      ['Late Deduction', 'Every 3 late marks = 0.5 working day deduction from effective days.'],
      ['Half Day Deduction', 'Every 2 half days = 1 full working day deduction from effective days.'],
      ['Income Tax (TDS)', 'Deducted as per employees tax declaration and applicable tax slab.'],
      ['Professional Tax', 'Deducted as per state government rules.'],
      ['Net Salary Formula', 'Net Salary = Gross Salary - PF - ESI - Income Tax - Professional Tax - Other Deductions'],
      ['Overtime', 'Calculated at specified overtime rate × overtime hours (if applicable).'],
      ['Salary Cycle', 'Monthly - from 1st to last day of the month.'],
      ['Payment Date', 'Salary credited by 7th of following month (or as per company policy).'],
    ];

    rules.forEach((rule, index) => {
      const row = ws.getRow(index + 2);
      row.getCell(1).value = rule[0];
      row.getCell(2).value = rule[1];
      
      const isHeader = index === 0;
      this._styleCell(row.getCell(1), { 
        bold: isHeader, 
        bg: isHeader ? COLORS.SECONDARY : (index % 2 === 0 ? COLORS.ALT_ROW : COLORS.WHITE),
        color: isHeader ? COLORS.HEADER_TEXT : COLORS.BLACK,
        alignment: { horizontal: 'left', vertical: 'middle' }
      });
      this._styleCell(row.getCell(2), { 
        bold: isHeader,
        bg: isHeader ? COLORS.SECONDARY : (index % 2 === 0 ? COLORS.ALT_ROW : COLORS.WHITE),
        color: isHeader ? COLORS.HEADER_TEXT : COLORS.BLACK,
        alignment: { horizontal: 'left', vertical: 'middle' }
      });
      
      row.height = isHeader ? 22 : 20;
    });
  }

  /**
   * Helper: Style a cell
   */
  _styleCell(cell, options = {}) {
    const {
      bold = false,
      size = 10,
      color = COLORS.BLACK,
      bg = null,
      wrapText = false,
      italic = false,
      alignment = { horizontal: 'center', vertical: 'middle' }
    } = options;

    cell.font = {
      name: 'Calibri',
      bold,
      size,
      color: { argb: 'FF' + color },
      italic
    };

    if (bg) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF' + bg }
      };
    }

    cell.alignment = {
      ...alignment,
      wrapText
    };

    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
    };
  }

  /**
   * Helper: Convert column number to letter
   */
  _columnLetter(col) {
    let letter = '';
    while (col > 0) {
      const temp = (col - 1) % 26;
      letter = String.fromCharCode(65 + temp) + letter;
      col = (col - temp - 1) / 26;
    }
    return letter;
  }

  /**
   * Write to response
   */
  async writeToResponse(res, filename) {
    res.setHeader(
      'Content-Type', 
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition', 
      `attachment; filename="${filename}"`
    );
    
    await this.workbook.xlsx.write(res);
  }
}