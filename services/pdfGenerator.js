// services/pdfGenerator.js
// Generates a professional, modern PDF salary slip from a Payroll document.
// Uses pdfkit (npm i pdfkit) — no Python dependency.

import PDFDocument from "pdfkit";
import fs from "fs";

const INR = (v) =>
  `Rs. ${Number(v ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const STD_DAYS = 30;

/**
 * @param {Object} payroll  - Payroll lean document
 * @param {string} filePath - Absolute path to write PDF
 */
export async function generateSalarySlipPDF(payroll, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);

    /* ───────────────────────── PALETTE ───────────────────────── */
    const INK       = "#16203C"; // near-black navy for headings
    const SLATE     = "#5B667A"; // muted body text
    const FAINT     = "#8A93A6"; // captions / labels
    const LINE      = "#E4E7EE"; // hairlines
    const PANEL     = "#F7F8FA"; // subtle panel background
    const ACCENT    = "#2453FF"; // primary brand accent (blue)
    const ACCENT_BG = "#EEF2FF";
    const GOOD      = "#0E8A4B"; // earnings green
    const GOOD_BG   = "#EAF8F0";
    const WARN      = "#B7791F"; // LOP amber
    const WARN_BG   = "#FBF3E4";
    const BAD       = "#C53030"; // deductions red
    const BAD_BG    = "#FBEDED";
    const WHITE     = "#FFFFFF";
    const TEAL      = "#00695C"; // overtime
    const TEAL_BG   = "#E0F2F1";
    const PURPLE    = "#6A1B9A"; // break deductions
    const PURPLE_BG = "#F3E5F5";

    const PAGE_W = doc.page.width;     // 595.28
    const MARGIN = 48;
    const CW = PAGE_W - MARGIN * 2;    // content width
    let y = 0;

    /* ───────────────────────── HEADER ───────────────────────── */
    const emp = payroll.employeeSnapshot     ?? {};
    const att = payroll.attendance           ?? {};
    const ear = payroll.earnings             ?? {};
    const std = payroll.statutoryDeductions  ?? {};
    const oth = payroll.otherDeductions      ?? {};
    const rul = payroll.salaryRuleDeductions ?? {};
    const lop = payroll.lossOfPay            ?? {};
    const per = payroll.payPeriod            ?? {};
    const ot  = payroll.overtime             ?? {};
    const brk = payroll.breakDeductions      ?? {};
    const rates = payroll.ratesUsed          ?? {};

    const fmtDate = (d) =>
      d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

    // Top accent bar
    doc.rect(0, 0, PAGE_W, 6).fill(ACCENT);

    y = 34;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(18)
       .text(emp.company ?? "Company Name", MARGIN, y);
    doc.fillColor(FAINT).font("Helvetica").fontSize(8.5)
       .text("PAYSLIP", MARGIN, y + 24, { characterSpacing: 1.5 });

    // Right-aligned meta block
    const metaW = 220;
    const metaX = PAGE_W - MARGIN - metaW;
    doc.fillColor(FAINT).font("Helvetica").fontSize(8)
       .text("PAY PERIOD", metaX, y, { width: metaW, align: "right", characterSpacing: 0.5 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11)
       .text(per.label ?? "—", metaX, y + 11, { width: metaW, align: "right" });
    doc.fillColor(FAINT).font("Helvetica").fontSize(8)
       .text(`Pay date: ${fmtDate(payroll.payDate)}`, metaX, y + 27, { width: metaW, align: "right" });

    y += 56;
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 22;

    /* ───────────────── EMPLOYEE / PAY SUMMARY (2-col, no borders) ───────────────── */
    const colGap = 28;
    const colW = (CW - colGap) / 2;

    const empFields = [
      ["Employee name", emp.name],
      ["Employee code", emp.empCode],
      ["Designation", emp.designation || "—"],
      ["Department", emp.department || "—"],
      ["Date of joining", emp.joiningDate ? fmtDate(emp.joiningDate) : "—"],
      ["Bank account", emp.bankName ? `${emp.bankName} •••• ${String(emp.bankAccount ?? "").slice(-4)}` : "—"],
    ];
    const payFields = [
      ["Standard days", STD_DAYS],
      ["Payable days", payroll.payableDays ?? "—"],
      ["Present days", att.presentDays ?? "—"],
      ["Absent days", att.absentDays ?? "—"],
      ["Leave / Holidays", `${att.leaveDays ?? 0} / ${att.holidays ?? 0}`],
      ["Half days / Late days", `${att.halfDays ?? 0} / ${att.lateDays ?? 0}`],
    ];

    const drawKV = (fields, x, startY, width) => {
      let ty = startY;
      fields.forEach(([label, val]) => {
        doc.fillColor(FAINT).font("Helvetica").fontSize(8)
           .text(label, x, ty, { width: width * 0.55 });
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5)
           .text(String(val ?? "—"), x, ty, { width: width, align: "right" });
        ty += 20;
      });
      return ty;
    };

    const bottomL = drawKV(empFields, MARGIN, y, colW);
    const bottomR = drawKV(payFields, MARGIN + colW + colGap, y, colW);
    // vertical divider between the two columns
    doc.moveTo(MARGIN + colW + colGap / 2, y - 4)
       .lineTo(MARGIN + colW + colGap / 2, Math.max(bottomL, bottomR) - 8)
       .strokeColor(LINE).lineWidth(1).stroke();

    y = Math.max(bottomL, bottomR) + 14;

    /* ───────────────────── SALARY TYPE & RATES STRIP ───────────────────── */
    const rateH = 52;
    doc.roundedRect(MARGIN, y, CW, rateH, 6).fill(PANEL);
    
    let salaryTypeLabel = "Monthly Salary (30-Day Standard)";
    if (rates.salaryType === 'per_day') salaryTypeLabel = "Per Day Rate";
    if (rates.salaryType === 'per_hour') salaryTypeLabel = "Per Hour Rate";
    
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5)
       .text("SALARY CALCULATION BASIS", MARGIN + 14, y + 8, { characterSpacing: 0.5 });
    doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(10)
       .text(salaryTypeLabel, MARGIN + 14, y + 22);
    
    doc.fillColor(SLATE).font("Helvetica").fontSize(8)
       .text(
         `Per Day Rate: ${INR(rates.perDayRate ?? 0)}  |  ` +
         `Per Hour Rate: ${INR(rates.perHourRate ?? 0)}  |  ` +
         `Standard: ${rates.standardDays ?? STD_DAYS} days / ${rates.standardHours ?? 8} hrs`,
         MARGIN + 14, y + 36, { width: CW - 28 }
       );
    y += rateH + 12;

    /* ───────────────────── SALARY RULE STRIP ───────────────────── */
    const ruleH = 40;
    doc.roundedRect(MARGIN, y, CW, ruleH, 6).fill(PANEL);
    doc.fillColor(SLATE).font("Helvetica-Bold").fontSize(7.5)
       .text("ATTENDANCE RULE ADJUSTMENTS", MARGIN + 14, y + 8, { characterSpacing: 0.4 });
    doc.fillColor(SLATE).font("Helvetica").fontSize(8)
       .text(
         `Late arrivals: ${att.lateDays ?? 0} → ${rul.lateCutDays ?? 0} day(s) cut   ·   ` +
         `Half days: ${att.halfDays ?? 0} → ${rul.halfDayCutDays ?? 0} day(s) cut   ·   ` +
         `Total cut: ${rul.totalCutDays ?? 0} day(s)`,
         MARGIN + 14, y + 21, { width: CW - 28 }
       );
    y += ruleH + 12;

    /* ───────────────────── LOSS OF PAY STRIP ───────────────────── */
    const lopDays = lop.lopDays ?? 0;
    const lopAmount = lop.lopAmount ?? 0;
    if (lopDays > 0 || lopAmount > 0) {
      const lopH = 30;
      doc.roundedRect(MARGIN, y, CW, lopH, 6).fill(WARN_BG);
      doc.fillColor(WARN).font("Helvetica-Bold").fontSize(8.5)
         .text(`Loss of Pay`, MARGIN + 14, y + 10);
      doc.fillColor(WARN).font("Helvetica").fontSize(8.5)
         .text(`${lopDays} absent day(s) × ${INR(rates.perDayRate ?? 0)}/day`, MARGIN + 90, y + 10.5);
      doc.fillColor(WARN).font("Helvetica-Bold").fontSize(9)
         .text(INR(lopAmount), MARGIN, y + 9.5, { width: CW - 14, align: "right" });
      y += lopH + 14;
    } else {
      y += 2;
    }

    /* ───────────────────── OVERTIME STRIP ───────────────────── */
    if (ot.hours > 0 && ot.amount > 0) {
      const otH = 30;
      doc.roundedRect(MARGIN, y, CW, otH, 6).fill(TEAL_BG);
      doc.fillColor(TEAL).font("Helvetica-Bold").fontSize(8.5)
         .text("OVERTIME EARNED", MARGIN + 14, y + 10);
      doc.fillColor(TEAL).font("Helvetica").fontSize(8.5)
         .text(
           `${ot.hours} hrs × ${INR(ot.rate ?? 0)}/hr (${ot.calculationType === 'custom_rate' ? 'Custom Rate' : 'Standard Rate'})`,
           MARGIN + 130, y + 10.5
         );
      doc.fillColor(TEAL).font("Helvetica-Bold").fontSize(9)
         .text(INR(ot.amount), MARGIN, y + 9.5, { width: CW - 14, align: "right" });
      y += otH + 14;
    }

    /* ───────────────────── BREAK DEDUCTIONS STRIP ───────────────────── */
    if (brk.hours > 0 && brk.amount > 0) {
      const brkH = 30;
      doc.roundedRect(MARGIN, y, CW, brkH, 6).fill(PURPLE_BG);
      doc.fillColor(PURPLE).font("Helvetica-Bold").fontSize(8.5)
         .text("UNPAID BREAK DEDUCTIONS", MARGIN + 14, y + 10);
      doc.fillColor(PURPLE).font("Helvetica").fontSize(8.5)
         .text(
           `${brk.hours} hrs × ${INR(rates.perHourRate ?? 0)}/hr`,
           MARGIN + 160, y + 10.5
         );
      doc.fillColor(PURPLE).font("Helvetica-Bold").fontSize(9)
         .text(INR(brk.amount), MARGIN, y + 9.5, { width: CW - 14, align: "right" });
      y += brkH + 14;
    }

    /* ───────────────── EARNINGS / DEDUCTIONS TABLE ───────────────── */
    const halfGap = 20;
    const halfW = (CW - halfGap) / 2;
    const earX = MARGIN;
    const dedX = MARGIN + halfW + halfGap;
    const rowH = 19;
    const headH = 24;

    const sectionHeader = (label, x, w, color, bg) => {
      doc.roundedRect(x, y, w, headH, 5).fill(bg);
      doc.fillColor(color).font("Helvetica-Bold").fontSize(8.5)
         .text(label, x + 12, y + 8, { characterSpacing: 0.6 });
    };
    sectionHeader("EARNINGS", earX, halfW, GOOD, GOOD_BG);
    sectionHeader("DEDUCTIONS", dedX, halfW, BAD, BAD_BG);
    const tableTop = y + headH + 6;

    const earnRows = [
      ["Basic", ear.basic],
      ["HRA", ear.hra],
      ["DA", ear.da],
      ["Bonus", ear.bonus],
      ...(ear.otherAllowances ?? []).map((a) => [a.name, a.amount]),
      ["Overtime", ear.overtime ?? 0],
    ].filter(([, v]) => (v ?? 0) > 0);

    const dedRows = [
      ["Provident Fund (12%)", std.pf],
      ["ESI (0.75%)", std.esi],
      ["Gratuity (4.81%)", std.gratuity],
      ["Income Tax", oth.incomeTax],
      ["Professional Tax", oth.professionalTax],
      ...(oth.additionalLines ?? []).map((d) => [d.name, d.amount]),
      ...(lopAmount > 0 ? [[`Loss of Pay (${lopDays}d)`, lopAmount]] : []),
      ...(brk.amount > 0 ? [[`Unpaid Breaks (${brk.hours}hrs)`, brk.amount]] : []),
    ].filter(([, v]) => (v ?? 0) > 0);

    const drawLineRow = (label, val, x, w, rowY, isSpecial = false, specialColor = WARN) => {
      const isLOP = String(label).startsWith("Loss of Pay");
      const isBreak = String(label).startsWith("Unpaid Breaks");
      const textColor = isLOP ? WARN : (isBreak ? PURPLE : (isSpecial ? specialColor : SLATE));
      
      doc.fillColor(textColor).font("Helvetica").fontSize(9)
         .text(label, x + 12, rowY + 5, { width: w * 0.6 });
      doc.fillColor(isLOP || isBreak ? textColor : INK)
         .font(isLOP || isBreak ? "Helvetica-Bold" : "Helvetica").fontSize(9)
         .text(INR(val ?? 0), x + 12, rowY + 5, { width: w - 24, align: "right" });
      doc.moveTo(x + 12, rowY + rowH - 1).lineTo(x + w - 12, rowY + rowH - 1)
         .strokeColor(LINE).lineWidth(0.5).stroke();
    };

    const maxR = Math.max(earnRows.length, dedRows.length);
    for (let i = 0; i < maxR; i++) {
      const rowY = tableTop + i * rowH;
      if (earnRows[i]) {
        const isOT = String(earnRows[i][0]) === "Overtime";
        drawLineRow(earnRows[i][0], earnRows[i][1], earX, halfW, rowY, isOT, TEAL);
      }
      if (dedRows[i]) {
        drawLineRow(dedRows[i][0], dedRows[i][1], dedX, halfW, rowY);
      }
    }
    let tableBottom = tableTop + maxR * rowH;

    // Totals row for each column
    const totalRowY = tableBottom + 6;
    doc.roundedRect(earX, totalRowY, halfW, 26, 5).fill(GOOD_BG);
    doc.fillColor(GOOD).font("Helvetica-Bold").fontSize(9)
       .text("Gross Earnings", earX + 12, totalRowY + 8, { width: halfW * 0.55 });
    doc.fillColor(GOOD).font("Helvetica-Bold").fontSize(9.5)
       .text(INR(payroll.grossSalary), earX + 12, totalRowY + 8, { width: halfW - 24, align: "right" });

    doc.roundedRect(dedX, totalRowY, halfW, 26, 5).fill(BAD_BG);
    doc.fillColor(BAD).font("Helvetica-Bold").fontSize(9)
       .text("Total Deductions", dedX + 12, totalRowY + 8, { width: halfW * 0.55 });
    doc.fillColor(BAD).font("Helvetica-Bold").fontSize(9.5)
       .text(INR(payroll.totalDeductions), dedX + 12, totalRowY + 8, { width: halfW - 24, align: "right" });

    y = totalRowY + 26 + 20;

    /* ───────────────────── NET PAY BANNER ───────────────────── */
    const netH = 58;
    doc.roundedRect(MARGIN, y, CW, netH, 8).fill(INK);
    doc.fillColor("#AAB4D4").font("Helvetica").fontSize(8.5)
       .text("NET PAY", MARGIN + 20, y + 13, { characterSpacing: 1 });
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(22)
       .text(INR(payroll.netSalary), MARGIN, y + 13, { width: CW - 20, align: "right" });
    doc.fillColor("#AAB4D4").font("Helvetica").fontSize(7.5)
       .text(`Gross ${INR(payroll.grossSalary)}  −  Deductions ${INR(payroll.totalDeductions)}`,
             MARGIN + 20, y + 36);

    y += netH + 22;

    /* ───────────────────── SALARY TYPE FOOTNOTE ───────────────────── */
    const footnoteH = 24;
    doc.roundedRect(MARGIN, y, CW, footnoteH, 6).fill(PANEL);
    doc.fillColor(FAINT).font("Helvetica").fontSize(7.5)
       .text(
         `Salary calculated on: ${salaryTypeLabel} | ` +
         `Per Day: ${INR(rates.perDayRate ?? 0)} | ` +
         `Per Hour: ${INR(rates.perHourRate ?? 0)}`,
         MARGIN + 14, y + 8, { width: CW - 28 }
       );
    y += footnoteH + 12;

    /* ───────────────────────── FOOTER ───────────────────────── */
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 14;
    doc.fillColor(FAINT).font("Helvetica").fontSize(7.5)
       .text("This is a system-generated payslip and does not require a physical signature.",
             MARGIN, y, { width: CW * 0.6 });
    doc.fillColor(SLATE).font("Helvetica-Bold").fontSize(8.5)
       .text("Authorised Signatory", MARGIN, y, { width: CW, align: "right" });

    doc.end();
  });
}