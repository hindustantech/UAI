// services/excelGenerator.js
// Generates the company-wide payroll register Excel file.
// Called by downloadCompanyExcel controller — writes to filePath, returns void.

import ExcelJS from "exceljs";

const STD_DAYS = 30;

/**
 * @param {Object[]} records  - Payroll documents (lean)
 * @param {string}   filePath - Absolute path to write the .xlsx
 */
export async function generatePayrollExcel(records, filePath) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Payroll System";
    wb.created = new Date();

    const ws = wb.addWorksheet("Payroll Register", {
        views: [{ state: "frozen", ySplit: 4 }]
    });

    /* ── Colour palette ── */
    const DARK_BLUE  = "1F3864";
    const MED_BLUE   = "2F5496";
    const LIGHT_BLUE = "BDD7EE";
    const WHITE      = "FFFFFF";
    const YELLOW_BG  = "FFF9C4";
    const GREEN_BG   = "E8F5E9";
    const RED_BG     = "FFEBEE";
    const ORANGE_BG  = "FFF3E0";
    const PURPLE_BG  = "F3E5F5";
    const TEAL_BG    = "E0F2F1";
    const CYAN_BG    = "E0F7FA";

    const money  = '"₹"#,##0.00';
    const moneyNoSymbol = '#,##0.00';
    const intFmt = "0";
    const dayFmt = "0.00";
    const hourFmt = "0.00";

    /* ── Helper: apply style to a cell ── */
    function style(cell, { bg, fg = WHITE, bold = false, align = "center", numFmt } = {}) {
        if (bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + bg } };
        cell.font = { name: "Arial", bold, color: { argb: "FF" + (fg === WHITE ? WHITE : fg) }, size: 9 };
        cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
        cell.border = {
            top:    { style: "thin", color: { argb: "FFAAAAAA" } },
            left:   { style: "thin", color: { argb: "FFAAAAAA" } },
            bottom: { style: "thin", color: { argb: "FFAAAAAA" } },
            right:  { style: "thin", color: { argb: "FFAAAAAA" } }
        };
        if (numFmt) cell.numFmt = numFmt;
    }

    // Total columns = 35 (A → AI)
    const LAST_COL = "AI";

    /* ── Row 1: Company name ── */
    ws.mergeCells(`A1:${LAST_COL}1`);
    const companyCell = ws.getCell("A1");
    const companyName = records[0]?.employeeSnapshot?.company ?? "Company Payroll Register";
    const period      = records[0]?.payPeriod?.label ?? "";
    companyCell.value = `${companyName}  —  Payroll Register  |  ${period}  |  Standard Month: ${STD_DAYS} Days`;
    style(companyCell, { bg: DARK_BLUE, bold: true, fg: WHITE });
    ws.getRow(1).height = 26;

    /* ── Row 2: Group headers ── */
    const groups = [
        ["A2:D2",   "Employee Info",      DARK_BLUE],
        ["E2:F2",   "Pay Period",         MED_BLUE],
        ["G2:L2",   "Attendance",         "2E4057"],
        ["M2:M2",   "Payable Days",       "37474F"],
        ["N2:R2",   "Earnings",           "1B5E20"],
        ["S2:S2",   "Gross",              "004D40"],
        ["T2:X2",   "Deductions",         "B71C1C"],
        ["Y2:Y2",   "LOP",                "E65100"],
        ["Z2:Z2",   "Total Ded.",         "7B1FA2"],
        ["AA2:AA2", "Net Salary",         "1A237E"],
        ["AB2:AD2", "Overtime",           "00695C"],
        ["AE2:AF2", "Break Deductions",   "BF360C"],
        ["AG2:AI2", "Rates Info",         "4A148C"],
    ];
    for (const [range, label, bg] of groups) {
        ws.mergeCells(range);
        const c = ws.getCell(range.split(":")[0]);
        c.value = label;
        style(c, { bg, bold: true, fg: WHITE });
    }
    ws.getRow(2).height = 20;

    /* ── Row 3: Column headers ── */
    const headers = [
        // A–D: Employee Info
        "Emp Code", "Emp Name", "Department", "Designation",
        // E–F: Pay Period
        "Pay Period", "Pay Date",
        // G–L: Attendance
        "Std Days", "Present", "Absent", "Leave", "Half Days", "Late Days",
        // M: Payable
        "Payable Days",
        // N–R: Earnings
        "Basic", "HRA", "DA", "Bonus", "Other Allow.",
        // S: Gross
        "Gross Salary",
        // T–X: Deductions
        "PF (12%)", "ESI (0.75%)", "Gratuity (4.81%)", "Income Tax", "Prof. Tax",
        // Y: LOP
        "LOP Amount",
        // Z: Total Ded.
        "Total Ded.",
        // AA: Net
        "Net Salary",
        // AB–AD: Overtime
        "OT Hours", "OT Rate", "OT Amount",
        // AE–AF: Break Deductions
        "Break Ded. Hours", "Break Ded. Amount",
        // AG–AI: Rates Info
        "Salary Type", "Per Day Rate", "Per Hour Rate"
    ];
    const hRow = ws.getRow(3);
    hRow.height = 30;
    headers.forEach((h, i) => {
        const c = hRow.getCell(i + 1);
        c.value = h;
        style(c, { bg: LIGHT_BLUE, fg: DARK_BLUE, bold: true, align: "center" });
    });

    /* ── Column widths (35 columns: A → AI) ── */
    const widths = [
        10, 22, 16, 18,          // A–D  Employee Info
        13, 12,                  // E–F  Pay Period
        9, 9, 9, 9, 10, 10,      // G–L  Attendance
        13,                      // M    Payable Days
        12, 12, 12, 12, 13,      // N–R  Earnings
        14,                      // S    Gross Salary
        12, 14, 16, 12, 10,      // T–X  Deductions
        14,                      // Y    LOP Amount
        14,                      // Z    Total Ded.
        16,                      // AA   Net Salary
        10, 10, 13,              // AB–AD Overtime
        12, 14,                  // AE–AF Break Deductions
        12, 12, 12               // AG–AI Rates Info
    ];
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    /* ── Data rows ── */
    records.forEach((p, idx) => {
        const att = p.attendance          ?? {};
        const ear = p.earnings            ?? {};
        const std = p.statutoryDeductions ?? {};
        const oth = p.otherDeductions     ?? {};
        const rul = p.salaryRuleDeductions ?? {};
        const lop = p.lossOfPay           ?? {};
        const ot  = p.overtime            ?? {};
        const brk = p.breakDeductions     ?? {};
        const rates = p.ratesUsed         ?? {};
        const bg  = idx % 2 === 0 ? "F5F5F5" : WHITE;

        const rowNum = idx + 4;
        const row    = ws.getRow(rowNum);
        row.height   = 18;

        const vals = [
            // A–D
            p.employeeSnapshot?.empCode,
            p.employeeSnapshot?.name,
            p.employeeSnapshot?.department,
            p.employeeSnapshot?.designation,
            // E–F
            p.payPeriod?.label,
            p.payDate ? new Date(p.payDate) : null,
            // G–L
            att.standardDays ?? STD_DAYS,
            att.presentDays  ?? 0,
            att.absentDays   ?? 0,
            att.leaveDays    ?? 0,
            att.halfDays     ?? 0,
            att.lateDays     ?? 0,
            // M
            p.payableDays    ?? 0,
            // N–R
            ear.basic  ?? 0, ear.hra ?? 0, ear.da ?? 0, ear.bonus ?? 0,
            (ear.otherAllowances ?? []).reduce((s, a) => s + a.amount, 0),
            // S
            p.grossSalary    ?? 0,
            // T–X
            std.pf ?? 0, std.esi ?? 0, std.gratuity ?? 0,
            oth.incomeTax ?? 0, oth.professionalTax ?? 0,
            // Y  LOP Amount
            lop.lopAmount    ?? 0,
            // Z
            p.totalDeductions ?? 0,
            // AA
            p.netSalary      ?? 0,
            // AB–AD  Overtime
            ot.hours  ?? 0,
            ot.rate   ?? 0,
            ot.amount ?? 0,
            // AE–AF  Break Deductions
            brk.hours  ?? 0,
            brk.amount ?? 0,
            // AG–AI  Rates Info
            rates.salaryType  ?? 'basic',
            rates.perDayRate  ?? 0,
            rates.perHourRate ?? 0
        ];

        // col numbers (1-indexed) that are money / date / day / hour
        const moneyCols = new Set([
            14,15,16,17,18,   // N-R Earnings
            19,               // S Gross
            20,21,22,23,24,   // T-X Deductions
            25,               // Y LOP
            26,               // Z Total Ded
            27,               // AA Net
            30,               // AD OT Amount
            32,               // AF Break Ded Amount
            34,35             // AH-AI Rates
        ]);
        const dateCols  = new Set([6]);
        const dayCols   = new Set([13,28,29]); // M, AB, AC
        const hourCols  = new Set([28,31]);    // AB OT Hours, AE Break Hours

        vals.forEach((v, i) => {
            const colNum = i + 1;
            const c      = row.getCell(colNum);
            c.value      = v;

            let cellBg = bg;
            // Highlight important columns
            if (colNum === 19) cellBg = YELLOW_BG;                    // Gross Salary
            if (colNum === 27) cellBg = GREEN_BG;                     // Net Salary
            if (colNum >= 20 && colNum <= 25) cellBg = RED_BG;        // Deductions T–Y
            if (colNum === 26) cellBg = ORANGE_BG;                    // LOP Amount
            if (colNum >= 28 && colNum <= 30) cellBg = TEAL_BG;       // Overtime
            if (colNum >= 31 && colNum <= 32) cellBg = PURPLE_BG;     // Break Deductions
            if (colNum >= 33 && colNum <= 35) cellBg = CYAN_BG;       // Rates Info

            style(c, {
                bg:     cellBg,
                fg:     "333333",
                bold:   colNum === 19 || colNum === 27,
                align:  colNum <= 4 ? "left" : "center",
                numFmt: moneyCols.has(colNum) ? money
                      : dateCols.has(colNum)  ? "dd-mmm-yyyy"
                      : dayCols.has(colNum)   ? dayFmt
                      : hourCols.has(colNum)  ? hourFmt
                      : intFmt
            });
        });
    });

    /* ── Totals row ── */
    const totalRow = records.length + 4;
    ws.mergeCells(`A${totalRow}:M${totalRow}`);
    const tlCell = ws.getCell(`A${totalRow}`);
    tlCell.value = "TOTALS";
    style(tlCell, { bg: DARK_BLUE, bold: true, fg: WHITE, align: "center" });

    // Sum all money columns and numeric columns
    const totalCols = [
        14,15,16,17,18,   // N-R Earnings
        19,               // S Gross
        20,21,22,23,24,   // T-X Deductions
        25,               // Y LOP
        26,               // Z Total Ded
        27,               // AA Net
        30,               // AD OT Amount
        32                // AF Break Ded Amount
    ];
    totalCols.forEach(ci => {
        const col  = ws.getColumn(ci).letter;
        const cell = ws.getCell(`${col}${totalRow}`);
        cell.value = { formula: `SUM(${col}4:${col}${totalRow - 1})` };
        style(cell, { bg: DARK_BLUE, bold: true, fg: WHITE, numFmt: money });
    });
    ws.getRow(totalRow).height = 22;

    /* ── Summary sheet ── */
    const ws2 = wb.addWorksheet("Summary");
    
    const totalGross    = records.reduce((s, p) => s + (p.grossSalary       ?? 0), 0);
    const totalNet      = records.reduce((s, p) => s + (p.netSalary         ?? 0), 0);
    const totalDed      = records.reduce((s, p) => s + (p.totalDeductions   ?? 0), 0);
    const totalLOP      = records.reduce((s, p) => s + (p.lossOfPay?.lopAmount ?? 0), 0);
    const totalLOPDays  = records.reduce((s, p) => s + (p.lossOfPay?.lopDays   ?? 0), 0);
    const totalOTHours  = records.reduce((s, p) => s + (p.overtime?.hours     ?? 0), 0);
    const totalOTAmount = records.reduce((s, p) => s + (p.overtime?.amount    ?? 0), 0);
    const totalBreakHours = records.reduce((s, p) => s + (p.breakDeductions?.hours ?? 0), 0);
    const totalBreakAmount = records.reduce((s, p) => s + (p.breakDeductions?.amount ?? 0), 0);
    
    // Count salary types
    const salaryTypeCount = records.reduce((acc, p) => {
        const type = p.ratesUsed?.salaryType ?? 'basic';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
    }, {});

    const summaryRows = [
        ["Metric",                    "Value"],
        ["Pay Period",                records[0]?.payPeriod?.label ?? ""],
        ["Total Employees",           records.length],
        ["",                          ""],
        ["─── SALARY TYPE BREAKDOWN ───", ""],
        ["Basic (Monthly)",           salaryTypeCount.basic ?? 0],
        ["Per Day",                   salaryTypeCount.per_day ?? 0],
        ["Per Hour",                  salaryTypeCount.per_hour ?? 0],
        ["",                          ""],
        ["─── EARNINGS ───",          ""],
        ["Total Gross Salary",        totalGross],
        ["",                          ""],
        ["─── DEDUCTIONS ───",        ""],
        ["Total Deductions",          totalDed],
        ["Total Loss of Pay (LOP)",   totalLOP],
        ["Total LOP Days",            totalLOPDays],
        ["",                          ""],
        ["─── OVERTIME ───",          ""],
        ["Total OT Hours",            totalOTHours],
        ["Total OT Amount",           totalOTAmount],
        ["",                          ""],
        ["─── BREAK DEDUCTIONS ───",  ""],
        ["Total Break Ded. Hours",    totalBreakHours],
        ["Total Break Ded. Amount",   totalBreakAmount],
        ["",                          ""],
        ["─── NET PAY ───",           ""],
        ["Total Net Payable",         totalNet],
        ["",                          ""],
        ["─── STANDARDS ───",         ""],
        ["Standard Days",             STD_DAYS],
        ["PF Rate",                   "12%"],
        ["ESI Rate",                  "0.75%"],
        ["Gratuity Rate",             "4.81%"],
    ];
    
    summaryRows.forEach(([k, v], ri) => {
        const r  = ws2.getRow(ri + 1);
        const c1 = r.getCell(1); c1.value = k;
        const c2 = r.getCell(2); c2.value = v;
        const isHdr = ri === 0;
        const isSection = typeof k === 'string' && k.startsWith('───');
        
        style(c1, { 
            bg: isHdr ? DARK_BLUE : (isSection ? "E8EAF6" : "EBF2FA"), 
            fg: isHdr ? WHITE : (isSection ? "1A237E" : "1F3864"), 
            bold: true 
        });
        style(c2, {
            bg:     isHdr ? DARK_BLUE : (isSection ? "E8EAF6" : WHITE),
            fg:     isHdr ? WHITE     : (isSection ? "1A237E" : "333333"),
            numFmt: typeof v === "number" && ri > 2 ? money : undefined
        });
    });
    ws2.getColumn(1).width = 32;
    ws2.getColumn(2).width = 30;

    await wb.xlsx.writeFile(filePath);
}