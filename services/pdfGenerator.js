// services/pdfGenerator.js
// Generates a professional PDF salary slip from a Payroll document.
// Uses pdfkit (npm i pdfkit) — no Python dependency.

import PDFDocument from "pdfkit";
import fs from "fs";

const INR = (v) => `Rs. ${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STD_DAYS = 30;

/**
 * @param {Object} payroll  - Payroll lean document
 * @param {string} filePath - Absolute path to write PDF
 */
export async function generateSalarySlipPDF(payroll, filePath) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);
        stream.on("finish", resolve);
        stream.on("error", reject);

        const PAGE_W  = doc.page.width  - 80;   // usable width
        const LEFT    = 40;
        const DARK    = "#1F3864";
        const MED     = "#2F5496";
        const GREEN   = "#1B5E20";
        const RED     = "#C62828";
        const NAVY    = "#1A237E";
        const LBLUE   = "#EBF5FB";
        const LGRAY   = "#F5F5F5";
        const WHITE   = "#FFFFFF";

        const emp = payroll.employeeSnapshot ?? {};
        const att = payroll.attendance        ?? {};
        const ear = payroll.earnings          ?? {};
        const std = payroll.statutoryDeductions ?? {};
        const oth = payroll.otherDeductions     ?? {};
        const rul = payroll.salaryRuleDeductions ?? {};
        const per = payroll.payPeriod            ?? {};

        /* ───── HEADER BANNER ───── */
        doc.rect(LEFT, 40, PAGE_W, 60).fill(DARK);
        doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(14)
           .text(emp.company ?? "Company Name", LEFT, 52, { width: PAGE_W, align: "center" });
        doc.font("Helvetica").fontSize(9)
           .text(`SALARY SLIP  —  ${per.label ?? ""}   |   Pay Date: ${payroll.payDate ? new Date(payroll.payDate).toLocaleDateString("en-IN") : ""}`,
                LEFT, 72, { width: PAGE_W, align: "center" });

        let y = 115;

        /* ───── EMPLOYEE INFO + PAY PERIOD (2 columns) ───── */
        const colW  = PAGE_W / 2 - 5;
        const empFields = [
            ["Emp Code",       emp.empCode],
            ["Employee Name",  emp.name],
            ["Designation",    emp.designation],
            ["Department",     emp.department],
            ["Grade",          emp.grade],
            ["Date of Joining",emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString("en-IN") : "—"],
            ["Bank / A/C No.", emp.bankName ? `${emp.bankName} / ${emp.bankAccount ?? ""}` : "—"],
        ];
        const payFields = [
            ["Pay Period",      per.label],
            ["Pay Date",        payroll.payDate ? new Date(payroll.payDate).toLocaleDateString("en-IN") : "—"],
            ["Standard Days",   STD_DAYS],
            ["Present Days",    att.presentDays],
            ["Absent Days",     att.absentDays],
            ["Leave Days",      att.leaveDays],
            ["Holidays",        att.holidays],
            ["Half Days",       att.halfDays],
            ["Late Days",       att.lateDays],
        ];

        const drawInfoTable = (fields, x, startY, width) => {
            let ty = startY;
            const rowH = 18;
            fields.forEach(([label, val], i) => {
                const bg = i % 2 === 0 ? LGRAY : WHITE;
                doc.rect(x, ty, width, rowH).fill(bg);
                doc.fillColor(DARK).font("Helvetica-Bold").fontSize(8)
                   .text(label, x + 5, ty + 5, { width: width * 0.45 });
                doc.fillColor("#333333").font("Helvetica").fontSize(8)
                   .text(String(val ?? "—"), x + width * 0.47, ty + 5, { width: width * 0.5 });
                ty += rowH;
            });
            return ty;
        };

        const leftBottom  = drawInfoTable(empFields, LEFT,           y, colW);
        const rightBottom = drawInfoTable(payFields,  LEFT + colW + 10, y, colW);
        y = Math.max(leftBottom, rightBottom) + 10;

        /* ───── SALARY RULE APPLIED ───── */
        doc.rect(LEFT, y, PAGE_W, 18).fill(MED);
        doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9)
           .text("Salary Rule Applied", LEFT + 5, y + 4, { width: PAGE_W });
        y += 18;

        doc.rect(LEFT, y, PAGE_W, 24).fill(LBLUE);
        const ruleText =
            `Late Rule: Every ${3} lates = 0.5 day cut  ▸  ${att.lateDays ?? 0} late(s) → ${rul.lateCutDays ?? 0} day(s) cut     ` +
            `Half-Day Rule: Every 2 half-days = 1 day cut  ▸  ${att.halfDays ?? 0} half-day(s) → ${rul.halfDayCutDays ?? 0} day(s) cut     ` +
            `Total Cut: ${rul.totalCutDays ?? 0} day(s)   |   Payable Days: ${payroll.payableDays ?? 0}`;
        doc.fillColor(DARK).font("Helvetica").fontSize(7.5)
           .text(ruleText, LEFT + 5, y + 7, { width: PAGE_W - 10 });
        y += 32;

        /* ───── EARNINGS / DEDUCTIONS TABLE ───── */
        const halfW   = PAGE_W / 2 - 3;
        const earW    = halfW;
        const dedW    = halfW;
        const earX    = LEFT;
        const dedX    = LEFT + halfW + 6;
        const rowH    = 17;

        // Section headers
        doc.rect(earX, y, earW, 18).fill("#1B5E20");
        doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9)
           .text("EARNINGS", earX + 5, y + 5, { width: earW * 0.6 })
           .text("Amount", earX + earW * 0.6, y + 5, { width: earW * 0.38, align: "right" });

        doc.rect(dedX, y, dedW, 18).fill(RED);
        doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9)
           .text("DEDUCTIONS", dedX + 5, y + 5, { width: dedW * 0.6 })
           .text("Amount", dedX + dedW * 0.6, y + 5, { width: dedW * 0.38, align: "right" });
        y += 18;

        const earnRows = [
            ["Basic",   ear.basic],
            ["HRA",     ear.hra],
            ["DA",      ear.da],
            ["Bonus",   ear.bonus],
            ...(ear.otherAllowances ?? []).map(a => [a.name, a.amount]),
            ["Overtime", ear.overtime ?? 0],
        ].filter(([, v]) => (v ?? 0) > 0);

        const dedRows = [
            ["PF (12%)",            std.pf],
            ["ESI (0.75%)",         std.esi],
            ["Gratuity (4.81%)",    std.gratuity],
            ["Income Tax",          oth.incomeTax],
            ["Professional Tax",    oth.professionalTax],
            ...(oth.additionalLines ?? []).map(d => [d.name, d.amount]),
        ].filter(([, v]) => (v ?? 0) > 0);

        const maxR = Math.max(earnRows.length, dedRows.length);

        const drawRow = (label, val, x, w, rowY, i, isTotal = false) => {
            const bg = isTotal ? (x === earX ? "#C8E6C9" : "#FFCDD2") : (i % 2 === 0 ? WHITE : LGRAY);
            doc.rect(x, rowY, w, rowH).fill(bg);
            const color = isTotal ? (x === earX ? GREEN : RED) : "#333333";
            const fw = isTotal ? "Helvetica-Bold" : "Helvetica";
            doc.fillColor(color).font(fw).fontSize(8)
               .text(label, x + 5, rowY + 5, { width: w * 0.58 });
            doc.text(INR(val ?? 0), x + w * 0.6, rowY + 5, { width: w * 0.38, align: "right" });
        };

        for (let i = 0; i < maxR; i++) {
            const rowY = y + i * rowH;
            if (earnRows[i]) drawRow(earnRows[i][0], earnRows[i][1], earX, earW, rowY, i);
            else             { doc.rect(earX, rowY, earW, rowH).fill(i % 2 === 0 ? WHITE : LGRAY); }
            if (dedRows[i])  drawRow(dedRows[i][0],  dedRows[i][1],  dedX, dedW, rowY, i);
            else             { doc.rect(dedX, rowY, dedW, rowH).fill(i % 2 === 0 ? WHITE : LGRAY); }
        }
        y += maxR * rowH;

        // Gross + Total Deductions rows
        drawRow("Gross Salary", payroll.grossSalary, earX, earW, y, 0, true);
        drawRow("Total Deductions", payroll.totalDeductions, dedX, dedW, y, 0, true);
        y += rowH + 8;

        /* ───── NET SALARY BANNER ───── */
        doc.rect(LEFT, y, PAGE_W, 36).fill(NAVY);
        doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(14)
           .text(`NET SALARY PAYABLE :  ${INR(payroll.netSalary)}`, LEFT, y + 11,
                 { width: PAGE_W, align: "center" });
        y += 44;

        /* ───── FOOTER ───── */
        doc.moveTo(LEFT, y).lineTo(LEFT + PAGE_W, y).strokeColor("#AAAAAA").stroke();
        y += 6;
        doc.fillColor("#888888").font("Helvetica").fontSize(7)
           .text("* This is a computer-generated salary slip and does not require a physical signature.",
                LEFT, y, { width: PAGE_W / 2 });
        doc.fillColor(DARK).font("Helvetica-Bold").fontSize(8)
           .text("Authorised Signatory", LEFT + PAGE_W / 2, y,
                { width: PAGE_W / 2, align: "right" });

        doc.end();
    });
}
