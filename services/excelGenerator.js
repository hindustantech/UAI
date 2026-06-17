// services/excelGenerator.js
// Generates the company-wide payroll register Excel file.
// Called by downloadCompanyExcel controller — writes to filePath, returns void.


// ─── swap the import above to: ───────────────────────────────────────────────
import ExcelJS from "exceljs";
// ─────────────────────────────────────────────────────────────────────────────

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

    const money = '"₹"#,##0.00';
    const intFmt = "0";
    const dayFmt = "0.00";

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

    /* ── Row 1: Company name ── */
    ws.mergeCells("A1:AB1");
    const companyCell = ws.getCell("A1");
    const companyName = records[0]?.employeeSnapshot?.company ?? "Company Payroll Register";
    const period      = records[0]?.payPeriod?.label ?? "";
    companyCell.value = `${companyName}  —  Payroll Register  |  ${period}  |  Standard Month: ${STD_DAYS} Days`;
    style(companyCell, { bg: DARK_BLUE, bold: true, fg: WHITE });
    ws.getRow(1).height = 26;

    /* ── Row 2: Group headers ── */
    const groups = [
        ["A2:D2", "Employee Info",       DARK_BLUE],
        ["E2:F2", "Pay Period",          MED_BLUE],
        ["G2:L2", "Attendance",          "2E4057"],
        ["M2:M2", "Payable Days",        "37474F"],
        ["N2:R2", "Earnings",            "1B5E20"],
        ["S2:S2", "Gross",              "004D40"],
        ["T2:X2", "Deductions",          "B71C1C"],
        ["Y2:Y2", "Total Ded.",          "7B1FA2"],
        ["Z2:Z2", "Net Salary",          "1A237E"],
        ["AA2:AB2","Rule Cuts",          "4A148C"],
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
        "Emp Code", "Emp Name", "Department", "Designation",
        "Pay Period", "Pay Date",
        "Std Days", "Present", "Absent", "Leave", "Half Days", "Late Days",
        "Payable Days",
        "Basic", "HRA", "DA", "Bonus", "Other Allow.",
        "Gross Salary",
        "PF (12%)", "ESI (0.75%)", "Gratuity (4.81%)", "Income Tax", "Prof. Tax",
        "Total Ded.", "Net Salary",
        "Late Cut (days)", "Half-Day Cut (days)"
    ];
    const hRow = ws.getRow(3);
    hRow.height = 30;
    headers.forEach((h, i) => {
        const c = hRow.getCell(i + 1);
        c.value = h;
        style(c, { bg: LIGHT_BLUE, fg: DARK_BLUE, bold: true, align: "center" });
    });

    /* ── Column widths ── */
    const widths = [10,22,16,18,13,12,9,9,9,9,10,10,13,
                    12,12,12,12,13,14,12,14,16,12,10,14,16,17,19];
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    /* ── Data rows ── */
    records.forEach((p, idx) => {
        const att = p.attendance ?? {};
        const ear = p.earnings  ?? {};
        const std = p.statutoryDeductions ?? {};
        const oth = p.otherDeductions     ?? {};
        const rul = p.salaryRuleDeductions ?? {};
        const bg  = idx % 2 === 0 ? "F5F5F5" : WHITE;

        const rowNum = idx + 4;
        const row = ws.getRow(rowNum);
        row.height = 18;

        const vals = [
            p.employeeSnapshot?.empCode,
            p.employeeSnapshot?.name,
            p.employeeSnapshot?.department,
            p.employeeSnapshot?.designation,
            p.payPeriod?.label,
            p.payDate ? new Date(p.payDate) : null,
            att.standardDays  ?? STD_DAYS,
            att.presentDays   ?? 0,
            att.absentDays    ?? 0,
            att.leaveDays     ?? 0,
            att.halfDays      ?? 0,
            att.lateDays      ?? 0,
            p.payableDays     ?? 0,
            ear.basic  ?? 0, ear.hra ?? 0, ear.da ?? 0, ear.bonus ?? 0,
            (ear.otherAllowances ?? []).reduce((s, a) => s + a.amount, 0),
            p.grossSalary     ?? 0,
            std.pf  ?? 0, std.esi ?? 0, std.gratuity ?? 0,
            oth.incomeTax ?? 0, oth.professionalTax ?? 0,
            p.totalDeductions ?? 0,
            p.netSalary       ?? 0,
            rul.lateCutDays   ?? 0,
            rul.halfDayCutDays ?? 0
        ];

        // money columns (1-indexed): 14–26
        const moneyCols = new Set([14,15,16,17,18,19,20,21,22,23,24,25,26]);
        const dateCols  = new Set([6]);
        const dayCols   = new Set([13,27,28]);

        vals.forEach((v, i) => {
            const colNum = i + 1;
            const c = row.getCell(colNum);
            c.value = v;

            let cellBg = bg;
            if (colNum === 19) cellBg = YELLOW_BG;   // Gross
            if (colNum === 26) cellBg = GREEN_BG;    // Net
            if (colNum >= 20 && colNum <= 25) cellBg = RED_BG; // Deductions

            style(c, {
                bg:     cellBg,
                fg:     "333333",
                bold:   colNum === 19 || colNum === 26,
                align:  colNum <= 4 ? "left" : "center",
                numFmt: moneyCols.has(colNum) ? money
                      : dateCols.has(colNum)  ? "dd-mmm-yyyy"
                      : dayCols.has(colNum)   ? dayFmt
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

    const totalCols = [14,15,16,17,18,19,20,21,22,23,24,25,26];
    totalCols.forEach(ci => {
        const col  = ws.getColumn(ci).letter;
        const cell = ws.getCell(`${col}${totalRow}`);
        cell.value = { formula: `SUM(${col}4:${col}${totalRow - 1})` };
        style(cell, { bg: DARK_BLUE, bold: true, fg: WHITE, numFmt: money });
    });
    ws.getRow(totalRow).height = 22;

    /* ── Summary sheet ── */
    const ws2 = wb.addWorksheet("Summary");
    const totalGross = records.reduce((s, p) => s + (p.grossSalary ?? 0), 0);
    const totalNet   = records.reduce((s, p) => s + (p.netSalary   ?? 0), 0);
    const totalDed   = records.reduce((s, p) => s + (p.totalDeductions ?? 0), 0);

    const summaryRows = [
        ["Metric", "Value"],
        ["Pay Period",         records[0]?.payPeriod?.label ?? ""],
        ["Total Employees",    records.length],
        ["Total Gross Salary", totalGross],
        ["Total Deductions",   totalDed],
        ["Total Net Payable",  totalNet],
        ["Standard Days",      STD_DAYS],
        ["PF Rate",            "12%"],
        ["ESI Rate",           "0.75%"],
        ["Gratuity Rate",      "4.81%"],
    ];
    summaryRows.forEach(([k, v], ri) => {
        const r = ws2.getRow(ri + 1);
        const c1 = r.getCell(1); c1.value = k;
        const c2 = r.getCell(2); c2.value = v;
        const isHdr = ri === 0;
        style(c1, { bg: isHdr ? DARK_BLUE : "EBF2FA", fg: isHdr ? WHITE : "1F3864", bold: true });
        style(c2, { bg: isHdr ? DARK_BLUE : WHITE, fg: isHdr ? WHITE : "333333",
                    numFmt: typeof v === "number" && ri > 2 ? money : undefined });
    });
    ws2.getColumn(1).width = 22;
    ws2.getColumn(2).width = 30;

    await wb.xlsx.writeFile(filePath);
}
