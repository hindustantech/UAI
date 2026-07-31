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
    this.periodMonth = null;
    this.periodYear = null;
  }

  setPeriodInfo(month, year) {
    this.periodMonth = month;
    this.periodYear = year;
  }

  /**
   * Generate complete Excel workbook
   */
  async generate() {
    this.workbook.creator = "HRMS Salary System";
    this.workbook.created = new Date();

    await this._createMonthlySalarySheet();
    await this._createPerHourWageSheet();
    await this._createPerDayWageSheet();

    return this.workbook;
  }

  /**
   * Helper: Period label (e.g. "June 2026")
   */
  _periodLabel() {
    return this.periodMonth
      ? new Date(this.periodYear, this.periodMonth - 1).toLocaleString('default', { month: 'long', year: 'numeric' })
      : 'Current Month';
  }

  /**
   * Helper: Add section title + info row + header row to a sheet
   */
  _writeHeaderBlock(ws, columns, title, infoText) {
    let row = 1;

    // Title row
    ws.mergeCells(row, 1, row, columns.length);
    const titleCell = ws.getCell(row, 1);
    titleCell.value = title;
    this._styleCell(titleCell, {
      bold: true,
      size: 14,
      color: COLORS.HEADER_TEXT,
      bg: COLORS.PRIMARY,
      alignment: { horizontal: 'center', vertical: 'middle' }
    });
    ws.getRow(row).height = 30;
    row++;

    // Info row
    ws.mergeCells(row, 1, row, columns.length);
    const infoCell = ws.getCell(row, 1);
    infoCell.value = infoText;
    this._styleCell(infoCell, {
      bold: true,
      color: COLORS.HEADER_TEXT,
      bg: COLORS.SECONDARY,
      alignment: { horizontal: 'left', vertical: 'middle' }
    });
    ws.getRow(row).height = 22;
    row++;

    // Header row
    const headerRow = ws.getRow(row);
    headerRow.height = 30;
    columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.header;
      this._styleCell(cell, {
        bold: true,
        color: COLORS.HEADER_TEXT,
        bg: COLORS.PRIMARY,
        wrapText: true,
        alignment: { horizontal: 'center', vertical: 'middle' }
      });
    });
    row++;

    return row;
  }

  /**
   * Helper: Write data rows and return next row index
   */
  _writeDataRows(ws, rows, startRow, moneyCols = []) {
    let row = startRow;

    rows.forEach((data, idx) => {
      const r = ws.getRow(row);
      r.height = 20;
      const isEven = idx % 2 === 0;

      data.forEach((val, i) => {
        const c = r.getCell(i + 1);
        c.value = val;
        this._styleCell(c, {
          bg: isEven ? COLORS.ALT_ROW : COLORS.WHITE,
          alignment: { horizontal: i < 4 ? 'left' : 'center', vertical: 'middle' }
        });
        if (moneyCols.includes(i + 1)) c.numFmt = '₹#,##0.00';
      });

      row++;
    });

    return row;
  }

  /**
   * Helper: Write totals row using SUM formulas over the data range
   */
  _writeTotalsRow(ws, columns, startRow, endRow, sumCols) {
    const totRow = ws.getRow(endRow);
    ws.mergeCells(endRow, 1, endRow, 4);
    const labelCell = totRow.getCell(1);
    labelCell.value = "TOTAL";
    this._styleCell(labelCell, {
      bold: true,
      bg: COLORS.TOTAL_BG,
      alignment: { horizontal: 'right', vertical: 'middle' }
    });
    ws.getRow(endRow).height = 22;

    sumCols.forEach(ci => {
      const c = totRow.getCell(ci);
      const colLetter = this._columnLetter(ci);
      c.value = { formula: `SUM(${colLetter}${startRow}:${colLetter}${endRow - 1})` };
      this._styleCell(c, { bold: true, bg: COLORS.TOTAL_BG });
      if (ci >= 5) c.numFmt = '₹#,##0.00';
    });

    return endRow + 1;
  }

  /**
   * Sheet 1: Monthly Salary (employees with monthly structure - no perHour/perDay)
   */
  async _createMonthlySalarySheet() {
    const ws = this.workbook.addWorksheet("Monthly Salary", {
      properties: { tabColor: { argb: COLORS.PRIMARY } }
    });

    const monthly = this.salaryResults.filter(
      r => !r.employeeInfo.perHour && !r.employeeInfo.perDay
    );

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
      { header: "Net Salary", key: "netSalary", width: 16 }
    ];

    columns.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

    let row = this._writeHeaderBlock(ws, columns, "MONTHLY SALARY REGISTER", `${this._periodLabel()} | Default Working Days: 30`);

    if (!monthly.length) {
      ws.mergeCells(row, 1, row, columns.length);
      ws.getCell(row, 1).value = "No monthly salary employees found for the selected period.";
      return;
    }

    const rows = monthly.map(r => [
      r.employeeInfo.empCode,
      r.employeeInfo.name,
      r.employeeInfo.designation,
      r.employeeInfo.department,
      r.attendance.daysWorked,
      r.attendance.lateDays,
      r.attendance.halfDays,
      r.attendance.effectiveDays,
      r.earnings.basic,
      r.earnings.hra,
      r.earnings.da,
      r.earnings.bonus,
      r.earnings.otherAllowance.reduce((sum, a) => sum + a.amount, 0),
      r.earnings.grossSalary,
      r.deductions.pf,
      r.deductions.esi,
      r.deductions.incomeTax,
      r.deductions.professionalTax,
      r.deductions.totalOtherDeductions,
      r.deductions.totalDeductions,
      r.netSalary
    ]);

    const dataStart = row;
    row = this._writeDataRows(ws, rows, row, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);

    this._writeTotalsRow(ws, columns, dataStart, row, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);

    // Freeze panes
    ws.views = [
      { state: 'frozen', ySplit: 3, xSplit: 2 }
    ];
  }

  /**
   * Sheet 2: Per Hour Wage Employees (perHour available in employee table)
   */
  async _createPerHourWageSheet() {
    const ws = this.workbook.addWorksheet("Per Hour Wages", {
      properties: { tabColor: { argb: "E8611A" } }
    });

    const hourly = this.salaryResults.filter(r => r.employeeInfo.perHour > 0);

    const columns = [
      { header: "Emp Code", key: "empCode", width: 12 },
      { header: "Emp Name", key: "name", width: 25 },
      { header: "Department", key: "department", width: 18 },
      { header: "Designation", key: "designation", width: 20 },
      { header: "Present Days", key: "presentDays", width: 12 },
      { header: "Gross Hrs", key: "grossHours", width: 12 },
      { header: "Net Hrs", key: "netHours", width: 12 },
      { header: "Break Hrs", key: "breakHours", width: 11 },
      { header: "Deducted Hrs", key: "deductedHours", width: 13 },
      { header: "OT Hrs", key: "otHours", width: 10 },
      { header: "Per Hour Rate", key: "perHour", width: 14 },
      { header: "OT Rate", key: "overtimeRate", width: 12 },
      { header: "Hourly Wages", key: "hourlyWages", width: 14 },
      { header: "OT Salary", key: "otSalary", width: 14 },
      { header: "Total Salary", key: "totalSalary", width: 14 }
    ];

    columns.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

    const att = hourly[0]?.attendanceDetail;
    const totalDays = att?.totalDaysInMonth || 30;
    let row = this._writeHeaderBlock(ws, columns, "PER HOUR WAGES SHEET", `${this._periodLabel()} | Total Days: ${totalDays} | Employees: ${hourly.length}`);

    if (!hourly.length) {
      ws.mergeCells(row, 1, row, columns.length);
      ws.getCell(row, 1).value = "No per-hour wage employees found for the selected period.";
      return;
    }

    const rows = hourly.map(r => {
      const emp = r.employeeInfo;
      const att = r.attendanceDetail || {};
      const perHour = emp.perHour || 0;
      const overtimeRate = emp.overtimeRate || 0;
      const netHrs = att.netHours ?? 0;
      const otHrs = att.otHours ?? 0;

      const hourlyWages = parseFloat((perHour * netHrs).toFixed(2));
      const otSalary = parseFloat((overtimeRate * otHrs).toFixed(2));

      return [
        emp.empCode,
        emp.name,
        emp.department,
        emp.designation,
        att.presentDays ?? 0,
        att.grossHours ?? 0,
        netHrs,
        att.breakHours ?? 0,
        att.deductedHours ?? 0,
        otHrs,
        perHour,
        overtimeRate,
        hourlyWages,
        otSalary,
        parseFloat((hourlyWages + otSalary).toFixed(2))
      ];
    });

    const dataStart = row;
    row = this._writeDataRows(ws, rows, row, [11, 12, 13, 14, 15]);

    this._writeTotalsRow(ws, columns, dataStart, row, [5, 6, 7, 8, 9, 10, 13, 14, 15]);

    // Freeze panes
    ws.views = [
      { state: 'frozen', ySplit: 3, xSplit: 2 }
    ];
  }

  /**
   * Sheet 3: Per Day Wage Employees (perDay available in employee table)
   */
  async _createPerDayWageSheet() {
    const ws = this.workbook.addWorksheet("Per Day Wages", {
      properties: { tabColor: { argb: COLORS.SUCCESS } }
    });

    const perDay = this.salaryResults.filter(
      r => r.employeeInfo.perDay > 0 && !r.employeeInfo.perHour
    );

    const columns = [
      { header: "Emp Code", key: "empCode", width: 12 },
      { header: "Emp Name", key: "name", width: 25 },
      { header: "Department", key: "department", width: 18 },
      { header: "Designation", key: "designation", width: 20 },
      { header: "Total Days", key: "totalDays", width: 11 },
      { header: "Present", key: "presentDays", width: 10 },
      { header: "Absent", key: "absentDays", width: 9 },
      { header: "Leave", key: "leaveDays", width: 9 },
      { header: "Late Days", key: "lateDays", width: 10 },
      { header: "Days Worked", key: "daysWorked", width: 12 },
      { header: "Eff. Days", key: "effectiveDays", width: 12 },
      { header: "Per Day Rate", key: "perDay", width: 14 },
      { header: "OT Rate", key: "overtimeRate", width: 12 },
      { header: "Day Wages", key: "dayWages", width: 14 },
      { header: "OT Salary", key: "otSalary", width: 14 },
      { header: "Total Salary", key: "totalSalary", width: 14 }
    ];

    columns.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

    const att = perDay[0]?.attendanceDetail;
    const totalDays = att?.totalDaysInMonth || 30;
    let row = this._writeHeaderBlock(ws, columns, "PER DAY WAGES SHEET", `${this._periodLabel()} | Total Days: ${totalDays} | Employees: ${perDay.length}`);

    if (!perDay.length) {
      ws.mergeCells(row, 1, row, columns.length);
      ws.getCell(row, 1).value = "No per-day wage employees found for the selected period.";
      return;
    }

    const rows = perDay.map(r => {
      const emp = r.employeeInfo;
      const att = r.attendanceDetail || {};
      const perDayRate = emp.perDay || 0;
      const overtimeRate = emp.overtimeRate || 0;
      const effectiveDays = r.attendance.effectiveDays || 0;
      const otHrs = att.otHours ?? 0;

      const dayWages = parseFloat((perDayRate * effectiveDays).toFixed(2));
      const otSalary = parseFloat((overtimeRate * otHrs).toFixed(2));

      return [
        emp.empCode,
        emp.name,
        emp.department,
        emp.designation,
        att.totalDaysInMonth ?? 30,
        att.presentDays ?? 0,
        att.absentDays ?? 0,
        att.leaveDays ?? 0,
        att.lateDays ?? 0,
        r.attendance.daysWorked,
        effectiveDays,
        perDayRate,
        overtimeRate,
        dayWages,
        otSalary,
        parseFloat((dayWages + otSalary).toFixed(2))
      ];
    });

    const dataStart = row;
    row = this._writeDataRows(ws, rows, row, [12, 13, 14, 15, 16]);

    this._writeTotalsRow(ws, columns, dataStart, row, [5, 6, 7, 8, 9, 10, 11, 14, 15, 16]);

    // Freeze panes
    ws.views = [
      { state: 'frozen', ySplit: 3, xSplit: 2 }
    ];
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
