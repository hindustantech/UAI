/**
 * billController.js
 *
 * POST /api/bills/generate
 * Body: { phone: "9876543210" }
 *
 * Fixes applied:
 *  1. Replaced ₹ with Rs. — PDFKit built-in fonts (Helvetica) don't include
 *     the Rupee Unicode glyph (U+20B9), causing blank/missing characters.
 *  2. Fixed extra blank page — footer was pushing the cursor past the page
 *     boundary triggering PDFKit's auto page-add. Footer now uses fixed
 *     absolute Y coordinates and doc.end() is called only after all drawing.
 *  3. Removed IGST block completely (as requested).
 */

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import nodemailer from "nodemailer";
import path from "path";
import fs from "fs";
import { Readable } from "stream";
import User from '../../models/userModel.js';
import { Subscription } from '../../models/Attandance/subscration/Subscription.js';
import { sendEmail } from '../../utils/sendEmail.js';


// ─── Config (move to env) ────────────────────────────────────────────────────
const COMPANY = {
    name: "Praecore Brandteck Pvt.Ltd",
    address: "123, Business Park, Sector 62, Noida, Uttar Pradesh, 201301, India",
    phone: "+91 120 456 7890",
    email: "info@praecorebrandteck.com",
    website: "www.praecorebrandteck.com",
    gstin: "09ABCDE1234F1Z5",
    verifyBase: process.env.BILL_VERIFY_BASE_URL || "https://praecorebrandteck.com/verify",
};

const MAIL_CONFIG = {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate 6-digit numeric ID: PBPL-YYYY-000001 */
async function generateBillId() {
    const year = new Date().getFullYear();
    const prefix = `PBPL-${year}-`;

    const latestSub = await Subscription.findOne(
        { bill_id: { $regex: `^${prefix}` } },
        { bill_id: 1 },
        { sort: { bill_generation_date: -1 } }
    );

    let seq = 1;
    if (latestSub?.bill_id) {
        const parts = latestSub.bill_id.split("-");
        seq = parseInt(parts[parts.length - 1], 10) + 1;
    }

    return `${prefix}${String(seq).padStart(6, "0")}`;
}

/** Convert amount to Indian words */
function amountInWords(amount) {
    const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
        "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

    function say(n) {
        if (n === 0) return "";
        if (n < 20) return ones[n];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
        return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + say(n % 100) : "");
    }

    function full(n) {
        if (n === 0) return "Zero";
        const parts = [];
        if (n >= 10000000) { parts.push(say(Math.floor(n / 10000000)) + " Crore"); n %= 10000000; }
        if (n >= 100000) { parts.push(say(Math.floor(n / 100000)) + " Lakh"); n %= 100000; }
        if (n >= 1000) { parts.push(say(Math.floor(n / 1000)) + " Thousand"); n %= 1000; }
        if (n > 0) { parts.push(say(n)); }
        return parts.join(" ");
    }

    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    let result = `Rupees ${full(rupees)}`;
    if (paise) result += ` and ${full(paise)} Paise`;
    return result + " Only";
}

/** Format Date → "25 May 2024" */
function fmtDate(d) {
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/** Validity in months/days */
function validityLabel(days) {
    if (days % 30 === 0) return `${days / 30} Month${days / 30 > 1 ? "s" : ""}`;
    return `${days} Days`;
}

// ─── QR Code Generator ───────────────────────────────────────────────────────
async function buildQRBuffer(billId, customer, amount, planName) {
    const payload = JSON.stringify({
        billId,
        customer: customer.name,
        amount: `INR ${amount}`,
        plan: planName,
        verifyUrl: `${COMPANY.verifyBase}/${billId}`,
    });

    return QRCode.toBuffer(payload, {
        errorCorrectionLevel: "H",
        type: "png",
        width: 200,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
    });
}

// ─── PDF Builder ─────────────────────────────────────────────────────────────
async function buildBillPDF(billData) {
    const { billId, customer, plan, subscription, total, qrBuffer } = billData;

    return new Promise((resolve, reject) => {
        // FIX: Use autoFirstPage:false so PDFKit never auto-appends a second page.
        // We add the single page manually with a fixed A4 size.
        const PAGE_HEIGHT = 841.89; // A4 pt
        const doc = new PDFDocument({ size: "A4", margin: 40, autoFirstPage: false });
        doc.addPage({ size: "A4", margin: 40 });

        const chunks = [];
        doc.on("data", c => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const W = doc.page.width;   // 595.28
        const M = 40;

        // ── Colour palette ────────────────────────────────────────────────────
        const DARK_BLUE = "#0d2b4e";
        const MID_BLUE  = "#1a4a8a";
        const LIGHT_BG  = "#e8f0fb";
        const GREEN     = "#2ca02c";
        const GRAY      = "#555555";

        // ── Top bar ───────────────────────────────────────────────────────────
        doc.rect(0, 0, W, 22).fill(DARK_BLUE);

        // ── Logo circle ───────────────────────────────────────────────────────
        doc.circle(M + 20, 55, 18).fill(MID_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(14)
            .text("P", M + 12, 48, { width: 16, align: "center" });

        // Company name
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(11)
            .text("PRAECORE", M + 44, 43);
        doc.font("Helvetica").fontSize(7).fillColor(GRAY)
            .text("BRANDTECK PVT.LTD", M + 44, 56);

        // ── BILL title ────────────────────────────────────────────────────────
        doc.font("Helvetica-Bold").fontSize(26).fillColor(DARK_BLUE)
            .text("BILL", W / 2 - 30, 35, { width: 60, align: "center" });
        doc.moveTo(W / 2 - 40, 68).lineTo(W / 2 + 40, 68)
            .strokeColor(DARK_BLUE).lineWidth(1.5).stroke();
        doc.font("Helvetica").fontSize(8).fillColor(GRAY)
            .text("Thank you for your payment!", W / 2 - 70, 72, { width: 140, align: "center" });

        // ── Bill info box (right) ─────────────────────────────────────────────
        const bx = W - M - 165, by = 35, bw = 165, bh = 78;
        doc.rect(bx, by, bw, bh).stroke(DARK_BLUE);
        doc.rect(bx, by, bw, 18).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(7.5)
            .text("BILL NO.", bx + 5, by + 5);
        doc.text(billId, bx + 50, by + 5);

        const infoRows = [
            ["Bill Date",       fmtDate(subscription.bill_generation_date || new Date())],
            ["Payment Date",    fmtDate(subscription.payment?.paidAt || new Date())],
            ["Payment Status",  subscription.payment?.paymentStatus === "SUCCESS" ? "Paid" : subscription.payment?.paymentStatus],
        ];
        let iy = by + 24;
        for (const [label, val] of infoRows) {
            doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(7.5).text(label, bx + 5, iy);
            doc.text(":", bx + 68, iy);
            doc.fillColor(label === "Payment Status" ? GREEN : GRAY).font("Helvetica").fontSize(7.5)
                .text(val, bx + 78, iy);
            iy += 16;
        }

        // ── Company address (left) ────────────────────────────────────────────
        let cy = 100;
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(9).text(COMPANY.name, M, cy);
        cy += 14;
        doc.fillColor(GRAY).font("Helvetica").fontSize(7.5);
        for (const line of [COMPANY.address, `Tel: ${COMPANY.phone}`, COMPANY.email, COMPANY.website]) {
            doc.text(line, M, cy); cy += 12;
        }
        doc.text(`GSTIN: ${COMPANY.gstin}`, M, cy);

        // ── QR + Scan box ─────────────────────────────────────────────────────
        cy = 135;
        const qx = M, qy = cy + 10, qbw = 200, qbh = 95;
        doc.roundedRect(qx, qy, qbw, qbh, 5).fill(LIGHT_BG).stroke(DARK_BLUE);
        doc.image(qrBuffer, qx + 5, qy + 5, { width: 75, height: 75 });
        doc.fillColor(MID_BLUE).font("Helvetica-Bold").fontSize(8)
            .text("Scan to Verify", qx + 85, qy + 8);
        doc.fillColor(DARK_BLUE).font("Helvetica").fontSize(7);
        // FIX: Use Rs. instead of ₹ — Helvetica does not include Rupee glyph
        const qLines = [
            `Customer: ${customer.name}`,
            `Bill ID: ${billId}`,
            `Amount: Rs. ${total.toFixed(2)}`,
            `Plan: ${plan.name}`,
        ];
        let ql = qy + 20;
        for (const l of qLines) { doc.text(l, qx + 85, ql); ql += 12; }
        doc.fillColor(GRAY).fontSize(6).font("Helvetica-Oblique")
            .text("Scan this QR code to view bill details and verification.", qx + 5, qy + 84, { width: 190 });

        // ── BILL TO ───────────────────────────────────────────────────────────
        const billToY = qy + qbh + 12;
        doc.rect(M, billToY, 60, 16).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(7.5)
            .text("BILL TO", M + 4, billToY + 4);

        const cbY = billToY + 22, cbH = 72, cbW = 220;
        doc.roundedRect(M, cbY, cbW, cbH, 5).fill(LIGHT_BG);
        doc.circle(M + 22, cbY + 36, 18).fill("#b0c4de");
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(18)
            .text("U", M + 14, cbY + 26);        // plain U instead of emoji
        const tx = M + 48;
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(9)
            .text(customer.name, tx, cbY + 10);
        doc.fillColor(GRAY).font("Helvetica").fontSize(8);
        doc.text(customer.phone || "-", tx, cbY + 24);
        doc.text(customer.email || "-", tx, cbY + 36);
        doc.text(customer.address || "-", tx, cbY + 48, { width: 160 });

        // ── Items Table ───────────────────────────────────────────────────────
        const tblY = cbY + cbH + 12;
        const cols = [24, 145, 100, 80, 90];
        const tblW = cols.reduce((a, b) => a + b, 0);
        const hdrs = ["#", "DESCRIPTION", "PLAN NAME", "DURATION", "PRICE (INR)"];

        doc.rect(M, tblY, tblW, 18).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(7.5);
        let cx2 = M;
        for (let i = 0; i < hdrs.length; i++) {
            doc.text(hdrs[i], cx2 + 2, tblY + 5, { width: cols[i] - 4, align: "center" });
            cx2 += cols[i];
        }

        const drY = tblY + 18;
        doc.rect(M, drY, tblW, 18).stroke(GRAY);
        doc.fillColor(DARK_BLUE).font("Helvetica").fontSize(8);
        // FIX: Use Rs. instead of ₹
        const vals = ["1", "Subscription Plan", plan.name,
            validityLabel(plan.validityDays), `Rs. ${plan.finalPrice.toFixed(2)}`];
        let cx3 = M;
        for (let i = 0; i < vals.length; i++) {
            doc.text(vals[i], cx3 + 2, drY + 5, { width: cols[i] - 4, align: "center" });
            cx3 += cols[i];
        }

        // Features sub-row
        const ftY = drY + 18;
        const feats = (plan.features || []).map(f => `${f.key}: ${f.value}`);
        const ftH = 14 + Math.ceil(feats.length / 3) * 14 + 8;
        doc.rect(M, ftY, tblW, ftH).fill("white").stroke(GRAY);
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(7.5)
            .text("Plan Includes:", M + 6, ftY + 6);
        doc.font("Helvetica").fontSize(7.5).fillColor(GRAY);
        feats.forEach((f, idx) => {
            const col = idx % 3, row = Math.floor(idx / 3);
            const fx = M + 6 + col * 165, fy = ftY + 18 + row * 13;
            doc.circle(fx + 4, fy + 4, 3.5).fill(MID_BLUE);
            doc.fillColor("white").font("Helvetica-Bold").fontSize(5.5)
                .text("v", fx + 1.5, fy + 2);   // plain 'v' checkmark (no Unicode)
            doc.fillColor(GRAY).font("Helvetica").fontSize(7.5)
                .text(f, fx + 10, fy);
        });

        // ── Totals (IGST removed as requested) ───────────────────────────────
        let totY = ftY + ftH + 8;
        const lx = W - M - 175;
        doc.fillColor(DARK_BLUE).font("Helvetica").fontSize(8.5);
        doc.text("Subtotal", lx, totY);
        // FIX: Use Rs. instead of ₹
        doc.text(`Rs. ${plan.finalPrice.toFixed(2)}`, lx + 100, totY, { width: 75, align: "right" });
        totY += 14;

        // TOTAL row (no IGST line)
        doc.rect(lx - 4, totY, 175 + 4, 18).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(9)
            .text("TOTAL AMOUNT", lx, totY + 4);
        // FIX: Use Rs. instead of ₹
        doc.text(`Rs. ${total.toFixed(2)}`, lx + 95, totY + 4, { width: 80, align: "right" });
        totY += 24;

        doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(9)
            .text("PAID", lx, totY);
        // FIX: Use Rs. instead of ₹
        doc.text(`Rs. ${total.toFixed(2)}`, lx + 95, totY, { width: 80, align: "right" });

        // ── Amount in Words ───────────────────────────────────────────────────
        totY += 18;
        doc.moveTo(M, totY - 2).lineTo(W - M, totY - 2).strokeColor("#cccccc").lineWidth(0.5).stroke();
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(8)
            .text("Amount in Words:", M, totY + 4);
        doc.fillColor(GRAY).font("Helvetica").fontSize(8)
            .text(amountInWords(total), M, totY + 16, { width: W - M * 2 });

        // ── Payment method ────────────────────────────────────────────────────
        totY += 36;
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(8)
            .text("Payment Method:", M, totY)
            .text("Transaction ID:", M + 170, totY);
        doc.fillColor(GRAY).font("Helvetica").fontSize(8)
            .text(subscription.payment?.paymentGateway || "ONLINE", M, totY + 13)
            .text(subscription.payment?.transactionId || "N/A", M + 170, totY + 13);

        // ── Footer (FIX: absolute Y positions, no cursor-driven positioning) ──
        // Using fixed coordinates from the bottom of the A4 page (841.89 pt).
        // This prevents PDFKit from auto-appending a blank second page.
        const FOOTER_LINE_Y  = PAGE_HEIGHT - 58;
        const FOOTER_TEXT1_Y = PAGE_HEIGHT - 50;
        const FOOTER_TEXT2_Y = PAGE_HEIGHT - 36;
        const FOOTER_BAR_Y   = PAGE_HEIGHT - 22;

        doc.moveTo(M, FOOTER_LINE_Y).lineTo(W - M, FOOTER_LINE_Y)
            .strokeColor("#cccccc").lineWidth(0.5).stroke();

        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(9)
            .text(`Thank you for choosing ${COMPANY.name}.`, M, FOOTER_TEXT1_Y,
                  { width: W - M * 2, align: "center" });

        doc.fillColor(GRAY).font("Helvetica").fontSize(8)
            .text("We appreciate your business!", M, FOOTER_TEXT2_Y,
                  { width: W - M * 2, align: "center" });

        doc.rect(0, FOOTER_BAR_Y, W, 22).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica").fontSize(7)
            .text("If you have any questions, feel free to contact us.", M, FOOTER_BAR_Y + 5);
        doc.text(`${COMPANY.phone}  |  ${COMPANY.email}  |  ${COMPANY.website}`,
            W / 2 - 120, FOOTER_BAR_Y + 5, { width: 300, align: "center" });

        doc.end();
    });
}


// ─── Email Sender ─────────────────────────────────────────────────────────────
async function sendBillEmail(customer, billId, pdfBuffer) {
    if (!customer.email) return;

    const transporter = nodemailer.createTransport(MAIL_CONFIG);

    await transporter.sendMail({
        from: `"${COMPANY.name}" <${process.env.SMTP_USER}>`,
        to: customer.email,
        subject: `Your Invoice ${billId} – ${COMPANY.name}`,
        html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <div style="background:#0d2b4e;padding:20px;text-align:center">
          <h1 style="color:white;margin:0">PRAECORE BRANDTECK PVT.LTD</h1>
        </div>
        <div style="padding:24px">
          <p>Dear <strong>${customer.name}</strong>,</p>
          <p>Thank you for your subscription. Please find your invoice <strong>${billId}</strong> attached.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr style="background:#e8f0fb">
              <td style="padding:8px;font-weight:bold;color:#0d2b4e">Bill ID</td>
              <td style="padding:8px">${billId}</td>
            </tr>
            <tr>
              <td style="padding:8px;font-weight:bold;color:#0d2b4e">Date</td>
              <td style="padding:8px">${fmtDate(new Date())}</td>
            </tr>
          </table>
          <p>You can also verify your bill at:<br>
             <a href="${COMPANY.verifyBase}/${billId}">${COMPANY.verifyBase}/${billId}</a>
          </p>
          <p>Regards,<br><strong>${COMPANY.name}</strong></p>
        </div>
        <div style="background:#0d2b4e;color:white;padding:12px;text-align:center;font-size:12px">
          ${COMPANY.phone} | ${COMPANY.email} | ${COMPANY.website}
        </div>
      </div>`,
        attachments: [{
            filename: `Invoice_${billId}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
        }],
    });
}

// ─── Main Controller ──────────────────────────────────────────────────────────
export const generateBill = async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ success: false, message: "phone is required" });
        }

        const user = await User.findOne({ phone: phone.trim() }).lean();
        if (!user) {
            return res.status(404).json({ success: false, message: "No user found with this phone number" });
        }

        const subscription = await Subscription.findOne({
            company: user._id,
            status: "ACTIVE",
            isActive: true,
        })
            .populate("plan")
            .sort({ startDate: -1 });

        if (!subscription) {
            return res.status(404).json({ success: false, message: "No active subscription found for this user" });
        }

        const plan = subscription.plan;
        const billId = await generateBillId();

        // IGST removed: total = plan price directly
        const total = plan.finalPrice;

        const customer = {
            name: user.name || "N/A",
            phone: user.phone || "N/A",
            email: user.email || null,
            address: user.manul_address || "N/A",
        };

        const qrBuffer = await buildQRBuffer(billId, customer, total, plan.name);
        const pdfBuffer = await buildBillPDF({
            billId,
            customer,
            plan,
            subscription,
            total,
            qrBuffer,
        });

        subscription.bill_id = billId;
        subscription.bill_generation_date = new Date();
        await subscription.save();

        sendBillEmail(customer, billId, pdfBuffer).catch(err =>
            console.error("[Bill] Email failed:", err.message)
        );

        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="Invoice_${billId}.pdf"`,
            "Content-Length": pdfBuffer.length,
        });
        return res.send(pdfBuffer);

    } catch (err) {
        console.error("[generateBill] Error:", err);
        return res.status(500).json({ success: false, message: "Bill generation failed", error: err.message });
    }
};

export const downloadBill = async (req, res) => {
    try {
        const { billId } = req.params;

        const subscription = await Subscription.findOne({ bill_id: billId })
            .populate("plan")
            .populate("company", "name email phone manul_address");

        if (!subscription) {
            return res.status(404).json({ success: false, message: "Bill not found" });
        }

        const plan = subscription.plan;
        const user = subscription.company;

        // IGST removed
        const total = plan.finalPrice;
        const customer = {
            name: user.name || "N/A",
            phone: user.phone || "N/A",
            email: user.email || null,
            address: user.manul_address || "N/A",
        };

        const qrBuffer = await buildQRBuffer(billId, customer, total, plan.name);
        const pdfBuffer = await buildBillPDF({ billId, customer, plan, subscription, total, qrBuffer });

        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="Invoice_${billId}.pdf"`,
            "Content-Length": pdfBuffer.length,
        });
        return res.send(pdfBuffer);

    } catch (err) {
        console.error("[downloadBill] Error:", err);
        return res.status(500).json({ success: false, message: "Download failed", error: err.message });
    }
};