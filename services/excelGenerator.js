// services/excelGenerator.js
// Generates the company-wide payroll Excel file with 3 sheets:
//   1. Monthly Salary  (basic salary calculated for the current month)
//   2. Per Hour Wages  (gross/net working hours × per-hour rate)
//   3. Per Day Wages   (per-day rate × payable days)
// Called by downloadCompanyExcel controller — writes to filePath, returns void.

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

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * @param {Object[]} records  - Payroll documents (lean)
 * @param {string}   filePath - Absolute path to write the .xlsx
 */
export async function generatePayrollExcel(records, filePath) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Payroll System";
    wb.created = new Date();

    await createMonthlySalarySheet(wb, records);
    await createPerHourWageSheet(wb, records);
    await createPerDayWageSheet(wb, records);

    await wb.xlsx.writeFile(filePath);
}

/**
 * Helper: Add title + info row + header row; returns the next data row index
 */
function writeHeaderBlock(ws, columns, title, infoText) {
    let row = 1;

    ws.mergeCells(row, 1, row, columns.length);
    const titleCell = ws.getCell(row, 1);
    titleCell.value = title;
    styleCell(titleCell, {
        bold: true, size: 14, color: COLORS.HEADER_TEXT, bg: COLORS.PRIMARY,
        alignment: { horizontal: "center", vertical: "middle" }
    });
    ws.getRow(row).height = 30;
    row++;

    ws.mergeCells(row, 1, row, columns.length);
    const infoCell = ws.getCell(row, 1);
    infoCell.value = infoText;
    styleCell(infoCell, {
        bold: true, color: COLORS.HEADER_TEXT, bg: COLORS.SECONDARY,
        alignment: { horizontal: "left", vertical: "middle" }
    });
    ws.getRow(row).height = 22;
    row++;

    const headerRow = ws.getRow(row);
    headerRow.height = 30;
    columns.forEach((col, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = col.header;
        styleCell(cell, {
            bold: true, color: COLORS.HEADER_TEXT, bg: COLORS.PRIMARY,
            wrapText: true, alignment: { horizontal: "center", vertical: "middle" }
        });
    });
    row++;

    return row;
}

/**
 * Helper: Write data rows; returns next row index
 */
function writeDataRows(ws, rows, startRow, moneyCols = []) {
    let row = startRow;

    rows.forEach((data, idx) => {
        const r = ws.getRow(row);
        r.height = 20;
        const isEven = idx % 2 === 0;

        data.forEach((val, i) => {
            const c = r.getCell(i + 1);
            c.value = val;
            styleCell(c, {
                bg: isEven ? COLORS.ALT_ROW : COLORS.WHITE,
                alignment: { horizontal: i < 4 ? "left" : "center", vertical: "middle" }
            });
            if (moneyCols.includes(i + 1)) c.numFmt = '₹#,##0.00';
        });

        row++;
    });

    return row;
}

/**
 * Helper: Totals row with SUM formulas over the data range
 */
function writeTotalsRow(ws, columns, startRow, endRow, sumCols) {
    const totRow = ws.getRow(endRow);
    ws.mergeCells(endRow, 1, endRow, 4);
    const labelCell = totRow.getCell(1);
    labelCell.value = "TOTAL";
    styleCell(labelCell, {
        bold: true, bg: COLORS.TOTAL_BG,
        alignment: { horizontal: "right", vertical: "middle" }
    });
    ws.getRow(endRow).height = 22;

    sumCols.forEach(ci => {
        const c = totRow.getCell(ci);
        const colLetter = columnLetter(ci);
        c.value = { formula: `SUM(${colLetter}${startRow}:${colLetter}${endRow - 1})` };
        styleCell(c, { bold: true, bg: COLORS.TOTAL_BG });
        if (ci >= 5) c.numFmt = '₹#,##0.00';
    });

    return endRow + 1;
}

/**
 * Sheet 1: Monthly Salary (basic salary per current month)
 */
async function createMonthlySalarySheet(wb, records) {
    const ws = wb.addWorksheet("Monthly Salary", {
        properties: { tabColor: { argb: COLORS.PRIMARY } },
        views: [{ state: "frozen", ySplit: 3, xSplit: 2 }]
    });

    const monthly = records.filter(r => (r.payType ?? "monthly") === "monthly");

    const columns = [
        { header: "Emp Code", key: "empCode", width: 12 },
        { header: "Emp Name", key: "name", width: 25 },
        { header: "Department", key: "department", width: 18 },
        { header: "Designation", key: "designation", width: 20 },
        { header: "Present", key: "present", width: 10 },
        { header: "Late Days", key: "lateDays", width: 10 },
        { header: "Half Days", key: "halfDays", width: 10 },
        { header: "Payable Days", key: "payableDays", width: 12 },
        { header: "Basic", key: "basic", width: 14 },
        { header: "HRA", key: "hra", width: 14 },
        { header: "DA", key: "da", width: 14 },
        { header: "Bonus", key: "bonus", width: 14 },
        { header: "Other Allow.", key: "otherAllowance", width: 14 },
        { header: "Gross Salary", key: "gross", width: 16 },
        { header: "PF", key: "pf", width: 14 },
        { header: "ESI", key: "esi", width: 14 },
        { header: "Income Tax", key: "incomeTax", width: 14 },
        { header: "Prof. Tax", key: "professionalTax", width: 14 },
        { header: "Other Ded.", key: "otherDeductions", width: 14 },
        { header: "Total Ded.", key: "totalDeductions", width: 16 },
        { header: "Net Salary", key: "netSalary", width: 16 }
    ];

    columns.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

    const period = records[0]?.payPeriod?.label ?? "";
    let row = writeHeaderBlock(ws, columns, "MONTHLY SALARY REGISTER", `${period} | Employees: ${monthly.length}`);

    if (!monthly.length) {
        ws.mergeCells(row, 1, row, columns.length);
        ws.getCell(row, 1).value = "No monthly salary employees found for the selected period.";
        return;
    }

    const rows = monthly.map(p => {
        const att = p.attendance ?? {};
        const ear = p.earnings ?? {};
        const std = p.statutoryDeductions ?? {};
        const oth = p.otherDeductions ?? {};
        const emp = p.employeeSnapshot ?? {};

        return [
            emp.empCode, emp.name, emp.department, emp.designation,
            att.presentDays ?? 0,
            att.lateDays ?? 0,
            att.halfDays ?? 0,
            p.payableDays ?? 0,
            ear.basic ?? 0, ear.hra ?? 0, ear.da ?? 0, ear.bonus ?? 0,
            (ear.otherAllowances ?? []).reduce((s, a) => s + (a.amount ?? 0), 0),
            p.grossSalary ?? 0,
            std.pf ?? 0, std.esi ?? 0,
            oth.incomeTax ?? 0, oth.professionalTax ?? 0,
            (oth.additionalLines ?? []).reduce((s, d) => s + (d.amount ?? 0), 0),
            p.totalDeductions ?? 0,
            p.netSalary ?? 0
        ];
    });

    const dataStart = row;
    row = writeDataRows(ws, rows, row, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    writeTotalsRow(ws, columns, dataStart, row, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
}

/**
 * Sheet 2: Per Hour Wages (gross/net working hours × per-hour rate)
 */
async function createPerHourWageSheet(wb, records) {
    const ws = wb.addWorksheet("Per Hour Wages", {
        properties: { tabColor: { argb: "E8611A" } },
        views: [{ state: "frozen", ySplit: 3, xSplit: 2 }]
    });

    const hourly = records.filter(r => (r.payType ?? "monthly") === "hourly");

    const columns = [
        { header: "Emp Code", key: "empCode", width: 12 },
        { header: "Emp Name", key: "name", width: 25 },
        { header: "Department", key: "department", width: 18 },
        { header: "Designation", key: "designation", width: 20 },
        { header: "Present Days", key: "present", width: 12 },
        { header: "Gross Hrs", key: "grossHours", width: 12 },
        { header: "Net Hrs", key: "netHours", width: 12 },
        { header: "Break Hrs", key: "breakHours", width: 11 },
        { header: "OT Hrs", key: "otHours", width: 10 },
        { header: "Per Hour Rate", key: "perHour", width: 14 },
        { header: "OT Rate", key: "overtimeRate", width: 12 },
        { header: "Hourly Wages", key: "hourlyWages", width: 14 },
        { header: "OT Salary", key: "otSalary", width: 14 },
        { header: "Total Salary", key: "totalSalary", width: 14 }
    ];

    columns.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

    const period = records[0]?.payPeriod?.label ?? "";
    let row = writeHeaderBlock(ws, columns, "PER HOUR WAGES SHEET", `${period} | Employees: ${hourly.length}`);

    if (!hourly.length) {
        ws.mergeCells(row, 1, row, columns.length);
        ws.getCell(row, 1).value = "No per-hour wage employees found for the selected period.";
        return;
    }

    const rows = hourly.map(p => {
        const att = p.attendance ?? {};
        const emp = p.employeeSnapshot ?? {};
        const rates = p.ratesUsed ?? {};

        const perHour = rates.perHour ?? rates.perHourRate ?? 0;
        const overtimeRate = rates.overtimeRate ?? 0;

        const grossMinutes = att.totalMinutes ?? att.totalPayableMinutes ?? 0;
        const payableMinutes = att.totalPayableMinutes ?? 0;
        const overtimeMinutes = att.overtimeMinutes ?? 0;

        const grossHours = round2(grossMinutes / 60);
        const netHours = round2(payableMinutes / 60);
        const breakHours = round2(Math.max(0, grossHours - netHours));
        const otHours = round2(overtimeMinutes / 60);

        const hourlyWages = round2(perHour * netHours);
        const otSalary = round2(overtimeRate * otHours);

        return [
            emp.empCode, emp.name, emp.department, emp.designation,
            att.presentDays ?? 0,
            grossHours, netHours, breakHours, otHours,
            perHour, overtimeRate,
            hourlyWages, otSalary,
            round2(hourlyWages + otSalary)
        ];
    });

    const dataStart = row;
    row = writeDataRows(ws, rows, row, [10, 11, 12, 13, 14]);
    writeTotalsRow(ws, columns, dataStart, row, [5, 6, 7, 8, 9, 12, 13, 14]);
}

/**
 * Sheet 3: Per Day Wages (per-day rate × payable days)
 */
async function createPerDayWageSheet(wb, records) {
    const ws = wb.addWorksheet("Per Day Wages", {
        properties: { tabColor: { argb: COLORS.SUCCESS } },
        views: [{ state: "frozen", ySplit: 3, xSplit: 2 }]
    });

    const perDay = records.filter(r => (r.payType ?? "monthly") === "perday");

    const columns = [
        { header: "Emp Code", key: "empCode", width: 12 },
        { header: "Emp Name", key: "name", width: 25 },
        { header: "Department", key: "department", width: 18 },
        { header: "Designation", key: "designation", width: 20 },
        { header: "Total Days", key: "totalDays", width: 11 },
        { header: "Present", key: "present", width: 10 },
        { header: "Absent", key: "absent", width: 9 },
        { header: "Leave", key: "leave", width: 9 },
        { header: "Late Days", key: "lateDays", width: 10 },
        { header: "Payable Days", key: "payableDays", width: 12 },
        { header: "Per Day Rate", key: "perDay", width: 14 },
        { header: "OT Rate", key: "overtimeRate", width: 12 },
        { header: "Day Wages", key: "dayWages", width: 14 },
        { header: "OT Salary", key: "otSalary", width: 14 },
        { header: "Total Salary", key: "totalSalary", width: 14 }
    ];

    columns.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

    const period = records[0]?.payPeriod?.label ?? "";
    let row = writeHeaderBlock(ws, columns, "PER DAY WAGES SHEET", `${period} | Employees: ${perDay.length}`);

    if (!perDay.length) {
        ws.mergeCells(row, 1, row, columns.length);
        ws.getCell(row, 1).value = "No per-day wage employees found for the selected period.";
        return;
    }

    const rows = perDay.map(p => {
        const att = p.attendance ?? {};
        const emp = p.employeeSnapshot ?? {};
        const rates = p.ratesUsed ?? {};

        const perDayRate = rates.perDay ?? rates.perDayRate ?? 0;
        const overtimeRate = rates.overtimeRate ?? 0;
        const payableDays = p.payableDays ?? 0;
        const otHours = round2((att.overtimeMinutes ?? 0) / 60);

        const dayWages = round2(perDayRate * payableDays);
        const otSalary = round2(overtimeRate * otHours);

        return [
            emp.empCode, emp.name, emp.department, emp.designation,
            att.standardDays ?? 30,
            att.presentDays ?? 0,
            att.absentDays ?? 0,
            att.leaveDays ?? 0,
            att.lateDays ?? 0,
            payableDays,
            perDayRate, overtimeRate,
            dayWages, otSalary,
            round2(dayWages + otSalary)
        ];
    });

    const dataStart = row;
    row = writeDataRows(ws, rows, row, [11, 12, 13, 14, 15]);
    writeTotalsRow(ws, columns, dataStart, row, [5, 6, 7, 8, 9, 10, 13, 14, 15]);
}

/**
 * Helper: Style a cell
 */
function styleCell(cell, options = {}) {
    const {
        bold = false,
        size = 10,
        color = COLORS.BLACK,
        bg = null,
        wrapText = false,
        italic = false,
        alignment = { horizontal: "center", vertical: "middle" }
    } = options;

    cell.font = {
        name: "Calibri",
        bold,
        size,
        color: { argb: "FF" + color },
        italic
    };

    if (bg) {
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF" + bg }
        };
    }

    cell.alignment = {
        ...alignment,
        wrapText
    };

    cell.border = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } }
    };
}

/**
 * Helper: Convert column number to letter
 */
function columnLetter(col) {
    let letter = "";
    while (col > 0) {
        const temp = (col - 1) % 26;
        letter = String.fromCharCode(65 + temp) + letter;
        col = (col - temp - 1) / 26;
    }
    return letter;
}
