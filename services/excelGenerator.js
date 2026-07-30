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
    const DARK_BLUE = "1F3864";
    const MED_BLUE = "2F5496";
    const LIGHT_BLUE = "BDD7EE";
    const WHITE = "FFFFFF";
    const YELLOW_BG = "FFF9C4";
    const GREEN_BG = "E8F5E9";
    const RED_BG = "FFEBEE";
    const ORANGE_BG = "FFF3E0";   // LOP highlight

    const money = '"₹"#,##0.00';
    const intFmt = "0";
    const dayFmt = "0.00";

    /* ── Helper: apply style to a cell ── */
    function style(cell, { bg, fg = WHITE, bold = false, align = "center", numFmt } = {}) {
        if (bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + bg } };
        cell.font = { name: "Arial", bold, color: { argb: "FF" + (fg === WHITE ? WHITE : fg) }, size: 9 };
        cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
        cell.border = {
            top: { style: "thin", color: { argb: "FFAAAAAA" } },
            left: { style: "thin", color: { argb: "FFAAAAAA" } },
            bottom: { style: "thin", color: { argb: "FFAAAAAA" } },
            right: { style: "thin", color: { argb: "FFAAAAAA" } }
        };
        if (numFmt) cell.numFmt = numFmt;
    }

    // Total columns = 33  (A through AG)
    const LAST_COL = "AG";

    /* ── Row 1: Company name ── */
    ws.mergeCells(`A1:${LAST_COL}1`);
    const companyCell = ws.getCell("A1");
    const companyName = records[0]?.employeeSnapshot?.company ?? "Company Payroll Register";
    const period = records[0]?.payPeriod?.label ?? "";
    companyCell.value = `${companyName}  —  Payroll Register  |  ${period}  |  Standard Month: ${STD_DAYS} Days`;
    style(companyCell, { bg: DARK_BLUE, bold: true, fg: WHITE });
    ws.getRow(1).height = 26;

    /* ── Row 2: Group headers ── */
    const groups = [
        ["A2:D2", "Employee Info", DARK_BLUE],
        ["E2:E2", "Pay Type", MED_BLUE],
        ["F2:G2", "Pay Period", MED_BLUE],
        ["H2:N2", "Attendance", "2E4057"],
        ["O2:O2", "Payable Days", "37474F"],
        ["P2:P2", "Payable Hours", "37474F"],
        ["Q2:U2", "Earnings", "1B5E20"],
        ["V2:V2", "Gross", "004D40"],
        ["W2:AA2", "Deductions", "B71C1C"],
        ["AB2:AB2", "LOP", "E65100"],
        ["AC2:AC2", "Total Ded.", "7B1FA2"],
        ["AD2:AD2", "Net Salary", "1A237E"],
        ["AE2:AG2", "Rule Cuts", "4A148C"],
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
        // E: Pay Type
        "Pay Type",
        // F–G: Pay Period
        "Pay Period", "Pay Date",
        // H–N: Attendance
        "Std Days", "Present", "Absent", "Paid Leave", "Unpaid Leave", "Half Days", "Late Days",
        // O: Payable Days
        "Payable Days",
        // P: Payable Hours
        "Payable Hrs",
        // Q–U: Earnings
        "Basic", "HRA", "DA", "Bonus", "Other Allow.",
        // V: Gross
        "Gross Salary",
        // W–AA: Deductions
        "PF (12%)", "ESI (0.75%)", "Gratuity (4.81%)", "Income Tax", "Prof. Tax",
        // AB: LOP
        "LOP Amount",
        // AC: Total Ded.
        "Total Ded.",
        // AD: Net
        "Net Salary",
        // AE–AG: Rule Cuts
        "Late Cut (days)", "Half-Day Cut (days)", "LOP Days"
    ];
    const hRow = ws.getRow(3);
    hRow.height = 30;
    headers.forEach((h, i) => {
        const c = hRow.getCell(i + 1);
        c.value = h;
        style(c, { bg: LIGHT_BLUE, fg: DARK_BLUE, bold: true, align: "center" });
    });

    /* ── Column widths (33 columns) ── */
    const widths = [
        10, 22, 16, 18,          // A–D  Employee Info
        10,                      // E    Pay Type
        13, 12,                  // F–G  Pay Period
        9, 9, 9, 10, 10, 10, 10, // H–N  Attendance
        13,                      // O    Payable Days
        12,                      // P    Payable Hours
        12, 12, 12, 12, 13,      // Q–U  Earnings
        14,                      // V    Gross
        12, 14, 16, 12, 10,      // W–AA Deductions
        14,                      // AB   LOP Amount
        14,                      // AC   Total Ded.
        16,                      // AD   Net Salary
        17, 19, 10               // AE–AG Rule Cuts + LOP Days
    ];
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    /* ── Data rows ── */
    records.forEach((p, idx) => {
        const att = p.attendance ?? {};
        const ear = p.earnings ?? {};
        const std = p.statutoryDeductions ?? {};
        const oth = p.otherDeductions ?? {};
        const rul = p.salaryRuleDeductions ?? {};
        const lop = p.lossOfPay ?? {};
        const bg = idx % 2 === 0 ? "F5F5F5" : WHITE;

        const rowNum = idx + 4;
        const row = ws.getRow(rowNum);
        row.height = 18;

        const vals = [
            // A–D
            p.employeeSnapshot?.empCode,
            p.employeeSnapshot?.name,
            p.employeeSnapshot?.department,
            p.employeeSnapshot?.designation,
            // E  Pay Type
            p.payType ?? "monthly",
            // F–G
            p.payPeriod?.label,
            p.payDate ? new Date(p.payDate) : null,
            // H–N  Attendance
            att.standardDays ?? STD_DAYS,
            att.presentDays ?? 0,
            att.absentDays ?? 0,
            att.paidLeaveDays ?? 0,
            att.unpaidLeaveDays ?? 0,
            att.halfDays ?? 0,
            att.lateDays ?? 0,
            // O  Payable Days
            p.payableDays ?? 0,
            // P  Payable Hours
            ear.totalPayableHours ?? 0,
            // Q–U  Earnings
            ear.basic ?? 0, ear.hra ?? 0, ear.da ?? 0, ear.bonus ?? 0,
            (ear.otherAllowances ?? []).reduce((s, a) => s + a.amount, 0),
            // V  Gross
            p.grossSalary ?? 0,
            // W–AA  Deductions
            std.pf ?? 0, std.esi ?? 0, std.gratuity ?? 0,
            oth.incomeTax ?? 0, oth.professionalTax ?? 0,
            // AB  LOP Amount
            lop.lopAmount ?? 0,
            // AC
            p.totalDeductions ?? 0,
            // AD
            p.netSalary ?? 0,
            // AE–AG  Rule Cuts + LOP Days
            rul.lateCutDays ?? 0,
            rul.halfDayCutDays ?? 0,
            lop.lopDays ?? 0
        ];

        // col numbers (1-indexed) that are money / date / day
        const moneyCols = new Set([17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
        const dateCols = new Set([7]);
        const dayCols = new Set([15, 16, 31, 32, 33]);

        vals.forEach((v, i) => {
            const colNum = i + 1;
            const c = row.getCell(colNum);
            c.value = v;

            let cellBg = bg;
            if (colNum === 22) cellBg = YELLOW_BG;                    // Gross (V)
            if (colNum === 30) cellBg = GREEN_BG;                     // Net Salary (AD)
            if (colNum >= 23 && colNum <= 27) cellBg = RED_BG;        // Deductions W–AA
            if (colNum === 28) cellBg = ORANGE_BG;                    // LOP Amount (AB)

            style(c, {
                bg: cellBg,
                fg: "333333",
                bold: colNum === 19 || colNum === 27,
                align: colNum <= 4 ? "left" : "center",
                numFmt: moneyCols.has(colNum) ? money
                    : dateCols.has(colNum) ? "dd-mmm-yyyy"
                        : dayCols.has(colNum) ? dayFmt
                            : intFmt
            });
        });
    });

    /* ── Totals row ── */
    const totalRow = records.length + 4;
    ws.mergeCells(`A${totalRow}:P${totalRow}`);
    const tlCell = ws.getCell(`A${totalRow}`);
    tlCell.value = "TOTALS";
    style(tlCell, { bg: DARK_BLUE, bold: true, fg: WHITE, align: "center" });

    // Sum all money columns: Q(17)→U(21), V(22), W(23)→AA(27), AB(28), AC(29), AD(30)
    const totalCols = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
    totalCols.forEach(ci => {
        const col = ws.getColumn(ci).letter;
        const cell = ws.getCell(`${col}${totalRow}`);
        cell.value = { formula: `SUM(${col}4:${col}${totalRow - 1})` };
        style(cell, { bg: DARK_BLUE, bold: true, fg: WHITE, numFmt: money });
    });
    ws.getRow(totalRow).height = 22;

    /* ── Summary sheet ── */
    const ws2 = wb.addWorksheet("Summary");
    const totalGross = records.reduce((s, p) => s + (p.grossSalary ?? 0), 0);
    const totalNet = records.reduce((s, p) => s + (p.netSalary ?? 0), 0);
    const totalDed = records.reduce((s, p) => s + (p.totalDeductions ?? 0), 0);
    const totalLOP = records.reduce((s, p) => s + (p.lossOfPay?.lopAmount ?? 0), 0);
    const totalLOPDays = records.reduce((s, p) => s + (p.lossOfPay?.lopDays ?? 0), 0);

    const totalHourly = records.filter(r => r.payType === "hourly").length;
    const totalMonthly = records.filter(r => r.payType !== "hourly").length;

    const summaryRows = [
        ["Metric", "Value"],
        ["Pay Period", records[0]?.payPeriod?.label ?? ""],
        ["Total Employees", records.length],
        ["Monthly Employees", totalMonthly],
        ["Hourly Employees", totalHourly],
        ["Total Gross Salary", totalGross],
        ["Total Deductions", totalDed],
        ["Total Loss of Pay (LOP)", totalLOP],
        ["Total LOP Days", totalLOPDays],
        ["Total Net Payable", totalNet],
        ["Standard Days", STD_DAYS],
        ["PF Rate", "12%"],
        ["ESI Rate", "0.75%"],
        ["Gratuity Rate", "4.81%"],
    ];
    summaryRows.forEach(([k, v], ri) => {
        const r = ws2.getRow(ri + 1);
        const c1 = r.getCell(1); c1.value = k;
        const c2 = r.getCell(2); c2.value = v;
        const isHdr = ri === 0;
        style(c1, { bg: isHdr ? DARK_BLUE : "EBF2FA", fg: isHdr ? WHITE : "1F3864", bold: true });
        style(c2, {
            bg: isHdr ? DARK_BLUE : WHITE,
            fg: isHdr ? WHITE : "333333",
            numFmt: typeof v === "number" && ri > 2 ? money : undefined
        });
    });
    ws2.getColumn(1).width = 28;
    ws2.getColumn(2).width = 30;

    await wb.xlsx.writeFile(filePath);
}