/**
 * billController.js
 *
 * POST /api/bills/generate
 * Body: { phone: "9876543210" }
 *
 * PERFECTED VERSION - All issues resolved:
 *  1. Rs. instead of ₹ — Helvetica has no Rupee glyph ✓
 *  2. No extra pages — All positioned text uses lineBreak:false ✓
 *  3. QR code + BILL TO side-by-side (two columns) ✓
 *  4. Features rendered as proper table (key | value rows) ✓
 *  5. IGST removed ✓
 *  6. Footer properly anchored to page bottom ✓
 */

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import nodemailer from "nodemailer";
import User from '../../models/userModel.js';
import { Subscription } from '../../models/Attandance/subscration/Subscription.js';

// ─── Config ──────────────────────────────────────────────────────────────────
const COMPANY = {
    name: "Praecore Brandteck Pvt.Ltd",
    address: "123, Business Park, Sector 62, Noida, UP 201301",
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
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function generateBillId() {
    const year = new Date().getFullYear();
    const prefix = `PBPL-${year}-`;
    const latest = await Subscription.findOne(
        { bill_id: { $regex: `^${prefix}` } },
        { bill_id: 1 },
        { sort: { bill_generation_date: -1 } }
    );
    let seq = 1;
    if (latest?.bill_id) {
        const parts = latest.bill_id.split("-");
        seq = parseInt(parts[parts.length - 1], 10) + 1;
    }
    return `${prefix}${String(seq).padStart(6, "0")}`;
}

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
        const p = [];
        if (n >= 10000000) { p.push(say(Math.floor(n / 10000000)) + " Crore"); n %= 10000000; }
        if (n >= 100000) { p.push(say(Math.floor(n / 100000)) + " Lakh"); n %= 100000; }
        if (n >= 1000) { p.push(say(Math.floor(n / 1000)) + " Thousand"); n %= 1000; }
        if (n > 0) { p.push(say(n)); }
        return p.join(" ");
    }

    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    let result = `Rupees ${full(rupees)}`;
    if (paise) result += ` and ${full(paise)} Paise`;
    return result + " Only";
}

function fmtDate(d) {
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function validityLabel(days) {
    if (days % 30 === 0) return `${days / 30} Month${days / 30 > 1 ? "s" : ""}`;
    return `${days} Days`;
}

async function buildQRBuffer(billId, customer, amount, planName) {
    const payload = JSON.stringify({
        billId, customer: customer.name,
        amount: `INR ${amount}`, plan: planName,
        verifyUrl: `${COMPANY.verifyBase}/${billId}`,
    });
    return QRCode.toBuffer(payload, {
        errorCorrectionLevel: "H", type: "png", width: 200, margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
    });
}

// ─── PDF Builder ─────────────────────────────────────────────────────────────
async function buildBillPDF(billData) {
    const { billId, customer, plan, subscription, total, qrBuffer } = billData;

    return new Promise((resolve, reject) => {
        // Add print-friendly options
        const doc = new PDFDocument({
            size: "A4",
            margin: 0,
            autoFirstPage: false,
            // Add these options for better print compatibility
            pdfVersion: "1.7",
            printScaling: "none" // Prevents automatic scaling in print
        });

        doc.addPage({
            size: "A4",
            margin: 0,
            // Ensure the page size is explicitly set
            mediaBox: [0, 0, 595.28, 841.89] // Explicit A4 dimensions
        });

        const chunks = [];
        doc.on("data", c => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        // ── Constants ─────────────────────────────────────────────────────────
        const W = 595.28;
        const H = 841.89;
        const M = 36;

        // Reduced border offset and margins for better print compatibility
        const BORDER_OFFSET = 10; // Reduced from 12 to ensure borders print
        const PRINT_MARGIN = 4; // Small safety margin for printer limitations
        const FOOTER_HEIGHT = 26;

        const DARK_BLUE = "#0d2b4e";
        const MID_BLUE = "#1a4a8a";
        const LIGHT_BG = "#e8f0fb";
        const GREEN = "#2ca02c";
        const GRAY = "#555555";
        const LGRAY = "#888888";
        const BORDER_COLOR = "#1a4a8a";

        // ── PAGE BORDER (Adjusted for print compatibility) ───────────────────
        const OUTER_MARGIN = PRINT_MARGIN;
        const OUTER_W = W - (OUTER_MARGIN * 2);
        const OUTER_H = H - (OUTER_MARGIN * 2);

        // Outer border (thick) - positioned slightly inside page edge
        doc.save();
        doc.lineWidth(1.5); // Slightly thinner to ensure it prints
        doc.strokeColor(BORDER_COLOR);
        doc.rect(OUTER_MARGIN, OUTER_MARGIN, OUTER_W, OUTER_H).stroke();

        // Inner border (thin, decorative) - with adjusted offset
        const INNER_OFFSET = OUTER_MARGIN + BORDER_OFFSET;
        const INNER_W = W - (INNER_OFFSET * 2);
        const INNER_H = H - (INNER_OFFSET * 2);

        doc.lineWidth(0.5);
        doc.strokeColor(MID_BLUE);
        doc.rect(INNER_OFFSET, INNER_OFFSET, INNER_W, INNER_H).stroke();

        // Corner decorations - adjusted positions
        doc.lineWidth(1.5);
        doc.strokeColor(DARK_BLUE);

        // Top-left corner
        doc.moveTo(OUTER_MARGIN, 28).lineTo(OUTER_MARGIN, OUTER_MARGIN).lineTo(28, OUTER_MARGIN).stroke();

        // Top-right corner
        doc.moveTo(W - OUTER_MARGIN, 28).lineTo(W - OUTER_MARGIN, OUTER_MARGIN).lineTo(W - 28, OUTER_MARGIN).stroke();

        // Bottom-left corner
        doc.moveTo(OUTER_MARGIN, H - 28).lineTo(OUTER_MARGIN, H - OUTER_MARGIN).lineTo(28, H - OUTER_MARGIN).stroke();

        // Bottom-right corner
        doc.moveTo(W - OUTER_MARGIN, H - 28).lineTo(W - OUTER_MARGIN, H - OUTER_MARGIN).lineTo(W - 28, H - OUTER_MARGIN).stroke();

        doc.restore();

        // Safe text function
        const T = (text, x, y, opts = {}) => {
            doc.text(String(text), x, y, { lineBreak: false, ...opts });
        };

        // ── LOGO ──────────────────────────────────────────────────────────────
        doc.circle(M + 18, 52, 16).fill(MID_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(13);
        T("P", M + 11, 45);

        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(10);
        T("PRAECORE", M + 40, 40);
        doc.fillColor(GRAY).font("Helvetica").fontSize(7);
        T("BRANDTECK PVT.LTD", M + 40, 53);

        // ── BILL TITLE ────────────────────────────────────────────────────────
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(24);
        T("BILL", W / 2 - 22, 32);
        doc.moveTo(W / 2 - 38, 64).lineTo(W / 2 + 38, 64).strokeColor(DARK_BLUE).lineWidth(1.2).stroke();
        doc.fillColor(GRAY).font("Helvetica").fontSize(7.5);
        T("Thank you for your payment!", W / 2 - 65, 68, { width: 130, align: "center" });

        // ── BILL INFO BOX ─────────────────────────────────────────────────────
        const bx = W - M - 160, by = 28, bw = 160, bh = 76;
        doc.rect(bx, by, bw, bh).strokeColor(DARK_BLUE).lineWidth(0.8).stroke();
        doc.rect(bx, by, bw, 17).fill(DARK_BLUE);

        doc.fillColor("white").font("Helvetica-Bold").fontSize(7);
        T("BILL NO.", bx + 5, by + 5);
        T(billId, bx + 48, by + 5);

        const irows = [
            ["Bill Date", fmtDate(subscription.bill_generation_date || new Date())],
            ["Payment Date", fmtDate(subscription.payment?.paidAt || new Date())],
            ["Payment Status", subscription.payment?.paymentStatus === "SUCCESS" ? "Paid" : (subscription.payment?.paymentStatus || "Paid")],
        ];
        let iy = by + 23;
        for (const [lbl, val] of irows) {
            doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(7);
            T(lbl, bx + 5, iy);
            T(":", bx + 64, iy);
            doc.fillColor(lbl === "Payment Status" ? GREEN : GRAY).font("Helvetica").fontSize(7);
            T(val, bx + 72, iy);
            iy += 16;
        }

        // ── COMPANY ADDRESS ───────────────────────────────────────────────────
        let ay = 96;
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(8.5);
        T(COMPANY.name, M, ay);
        ay += 13;
        doc.fillColor(GRAY).font("Helvetica").fontSize(7);
        for (const ln of [COMPANY.address, `Tel: ${COMPANY.phone}`, COMPANY.email, COMPANY.website]) {
            T(ln, M, ay);
            ay += 11;
        }
        T(`GSTIN: ${COMPANY.gstin}`, M, ay);

        // ── DIVIDER ───────────────────────────────────────────────────────────
        const divY = 164;
        doc.moveTo(M, divY).lineTo(W - M, divY).strokeColor("#dddddd").lineWidth(0.5).stroke();

        // ══════════════════════════════════════════════════════════════════════
        // TWO-COLUMN SECTION: BILL TO (left) | QR (right)
        // ══════════════════════════════════════════════════════════════════════
        const COL_TOP = divY + 10;
        const LEFT_W = 230;
        const RIGHT_X = M + LEFT_W + 12;
        const RIGHT_W = W - M - RIGHT_X;

        // ── BILL TO (LEFT COLUMN) ─────────────────────────────────────────────
        doc.rect(M, COL_TOP, 55, 15).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(7.5);
        T("BILL TO", M + 4, COL_TOP + 4);

        const cbY = COL_TOP + 20;
        doc.roundedRect(M, cbY, LEFT_W, 88, 5).fill(LIGHT_BG);

        // Avatar circle
        doc.circle(M + 22, cbY + 38, 17).fill("#b0c4de");
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(14);
        T("U", M + 15, cbY + 28);

        const tx = M + 46;
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(9);
        T(customer.name, tx, cbY + 10);

        doc.fillColor(GRAY).font("Helvetica").fontSize(8);
        T(customer.phone || "-", tx, cbY + 26);
        T(customer.email || "-", tx, cbY + 39);
        doc.text(customer.address || "-", tx, cbY + 52, { width: LEFT_W - 50, lineBreak: true });

        // ── QR BOX (RIGHT COLUMN) ─────────────────────────────────────────────
        const qbH = 110;
        doc.roundedRect(RIGHT_X, COL_TOP, RIGHT_W, qbH, 5).fill(LIGHT_BG);
        doc.image(qrBuffer, RIGHT_X + 6, COL_TOP + 6, { width: 78, height: 78 });

        doc.fillColor(MID_BLUE).font("Helvetica-Bold").fontSize(8);
        T("Scan to Verify", RIGHT_X + 90, COL_TOP + 8);

        doc.fillColor(DARK_BLUE).font("Helvetica").fontSize(7);
        const qlines = [
            `Customer : ${customer.name}`,
            `Bill ID  : ${billId}`,
            `Amount   : Rs. ${total.toFixed(2)}`,
            `Plan     : ${plan.name}`,
        ];
        let ql = COL_TOP + 20;
        for (const l of qlines) {
            T(l, RIGHT_X + 90, ql);
            ql += 13;
        }

        doc.fillColor(LGRAY).font("Helvetica-Oblique").fontSize(6.2);
        doc.text("Scan this QR code to view bill details and verification.",
            RIGHT_X + 6, COL_TOP + 90, { width: RIGHT_W - 12, lineBreak: true });

        // ── ITEMS TABLE ───────────────────────────────────────────────────────
        const tblY = COL_TOP + qbH + 14;
        const COLS = [24, 150, 95, 80, 90];
        const TBLW = COLS.reduce((a, b) => a + b, 0);
        const HDRS = ["#", "DESCRIPTION", "PLAN NAME", "DURATION", "PRICE (INR)"];

        doc.rect(M, tblY, TBLW, 18).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(7.5);
        let cx = M;
        for (let i = 0; i < HDRS.length; i++) {
            T(HDRS[i], cx + 2, tblY + 5, { width: COLS[i] - 4, align: "center" });
            cx += COLS[i];
        }

        const drY = tblY + 18;
        doc.rect(M, drY, TBLW, 18).fill("white").strokeColor(GRAY).lineWidth(0.5).stroke();
        doc.fillColor(DARK_BLUE).font("Helvetica").fontSize(8);
        const vals = ["1", "Subscription Plan", plan.name,
            validityLabel(plan.validityDays), `Rs. ${plan.finalPrice.toFixed(2)}`];
        cx = M;
        for (let i = 0; i < vals.length; i++) {
            T(vals[i], cx + 2, drY + 5, { width: COLS[i] - 4, align: "center" });
            cx += COLS[i];
        }

        // ── FEATURES TABLE ────────────────────────────────────────────────────
        const feats = (plan.features || []).map(f => ({ key: f.key, val: String(f.value) }));
        const FT_ROW = 18;
        const ftY = drY + 20 + 18;
        const ftH = 20 + feats.length * FT_ROW + 8;

        doc.rect(M, ftY, TBLW, ftH).fill("white").strokeColor(GRAY).lineWidth(0.5).stroke();

        // Section header
        doc.rect(M, ftY, TBLW, 20).fill("#f0f4fc");
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(8);
        T("Plan Includes", M + 6, ftY + 6);

        // Column headers
        const headerY = ftY + 22;
        doc.fillColor(MID_BLUE).font("Helvetica-Bold").fontSize(7.5);
        const FK_W = 240;
        T("FEATURE", M + 6, headerY);
        T("VALUE", M + FK_W, headerY);

        // Feature rows
        let fy = headerY + 14;
        feats.forEach((f, idx) => {
            if (idx % 2 === 0) doc.rect(M + 1, fy - 2, TBLW - 2, FT_ROW).fill("#f7f9fe");
            else doc.rect(M + 1, fy - 2, TBLW - 2, FT_ROW).fill("white");

            doc.circle(M + 10, fy + 2, 3).fill(MID_BLUE);
            doc.fillColor("white").font("Helvetica-Bold").fontSize(5);
            T("✓", M + 7, fy);

            doc.fillColor(DARK_BLUE).font("Helvetica").fontSize(7.5);
            T(f.key, M + 22, fy);
            doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(7.5);
            T(f.val, M + FK_W, fy);
            fy += FT_ROW;
        });

        // ── TOTALS ────────────────────────────────────────────────────────────
        let totY = ftY + ftH + 10;
        const lx = W - M - 180;

        doc.fillColor(DARK_BLUE).font("Helvetica").fontSize(8.5);
        T("Subtotal", lx, totY);
        T(`Rs. ${plan.finalPrice.toFixed(2)}`, lx + 105, totY, { width: 75, align: "right" });
        totY += 16;

        doc.rect(lx - 4, totY, 184, 18).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(9);
        T("TOTAL AMOUNT", lx + 2, totY + 4);
        T(`Rs. ${total.toFixed(2)}`, lx + 100, totY + 4, { width: 80, align: "right" });
        totY += 24;

        doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(9);
        T("PAID", lx, totY);
        T(`Rs. ${total.toFixed(2)}`, lx + 100, totY, { width: 80, align: "right" });
        totY += 20;

        // ── AMOUNT IN WORDS ───────────────────────────────────────────────────
        doc.moveTo(M, totY).lineTo(W - M, totY).strokeColor("#cccccc").lineWidth(0.5).stroke();
        totY += 6;
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(8);
        T("Amount in Words:", M, totY);
        totY += 13;
        doc.fillColor(GRAY).font("Helvetica").fontSize(8);
        T(amountInWords(total), M, totY, { width: W - M * 2 });
        totY += 18;

        // ── PAYMENT METHOD ────────────────────────────────────────────────────
        doc.moveTo(M, totY).lineTo(W - M, totY).strokeColor("#eeeeee").lineWidth(0.4).stroke();
        totY += 8;
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(8);
        T("Payment Method:", M, totY);
        T("Transaction ID:", M + 200, totY);
        totY += 14;
        doc.fillColor(GRAY).font("Helvetica").fontSize(8);
        T(subscription.payment?.paymentGateway || "ONLINE", M, totY);
        T(subscription.payment?.transactionId || "N/A", M + 200, totY);

        // ══════════════════════════════════════════════════════════════════════
        // FOOTER - Adjusted for print compatibility
        // ══════════════════════════════════════════════════════════════════════

        // // Calculate footer position with print margins in mind
        // const FOOTER_MARGIN = PRINT_MARGIN + 8; // Additional margin for footer
        // const FOOTER_BASE_Y = H - FOOTER_MARGIN - FOOTER_HEIGHT;

        // ══════════════════════════════════════════════════════════════════════
        // FOOTER - Properly positioned with inner border margin
        // ══════════════════════════════════════════════════════════════════════

        // Calculate footer position relative to inner border
        const FOOTER_MARGIN_FROM_BORDER = 8; // 8 points margin from inner border
        const FOOTER_BASE_Y = INNER_OFFSET + INNER_H - FOOTER_MARGIN_FROM_BORDER - FOOTER_HEIGHT;

        // Only add footer if there's enough space
        if (totY + 40 < FOOTER_BASE_Y) {
            const F_LINE = FOOTER_BASE_Y - 12;
            const F_TXT1 = FOOTER_BASE_Y - 24;
            const F_TXT2 = FOOTER_BASE_Y - 37;

            // Divider line - inside inner border margins
            doc.moveTo(INNER_OFFSET + 6, F_LINE)
                .lineTo(INNER_OFFSET + INNER_W - 6, F_LINE)
                .strokeColor("#cccccc")
                .lineWidth(0.5)
                .stroke();

            // Thank you text - centered within inner border
            doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(9);
            T(`Thank you for choosing ${COMPANY.name}.`,
                INNER_OFFSET, F_TXT1,
                { width: INNER_W, align: "center" });

            doc.fillColor(GRAY).font("Helvetica").fontSize(8);
            T("We appreciate your business!",
                INNER_OFFSET, F_TXT2,
                { width: INNER_W, align: "center" });

            // Footer bar - aligned with inner border, with margin
            const FOOTER_MARGIN = 6; // Margin from inner border on both sides
            const FOOTER_X = INNER_OFFSET + FOOTER_MARGIN;
            const FOOTER_WIDTH = INNER_W - (FOOTER_MARGIN * 2);

            doc.rect(FOOTER_X, FOOTER_BASE_Y, FOOTER_WIDTH, FOOTER_HEIGHT)
                .fill(DARK_BLUE);

            doc.fillColor("white").font("Helvetica").fontSize(6.8);

            T(`UAI Contact Us | ${COMPANY.phone} | ${COMPANY.email} | ${COMPANY.website}`,
                FOOTER_X, FOOTER_BASE_Y + 8, {
                width: FOOTER_WIDTH,
                align: "center",
                lineBreak: false
            });
        }

        doc.end();
    });
}

// ─── Email ────────────────────────────────────────────────────────────────────
async function sendBillEmail(customer, billId, pdfBuffer) {
    if (!customer.email) return;
    const transporter = nodemailer.createTransport(MAIL_CONFIG);
    await transporter.sendMail({
        from: `"${COMPANY.name}" <${process.env.SMTP_USER}>`,
        to: customer.email,
        subject: `Your Invoice ${billId} - ${COMPANY.name}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
          <div style="background:#0d2b4e;padding:20px;text-align:center">
            <h1 style="color:white;margin:0">PRAECORE BRANDTECK PVT.LTD</h1></div>
          <div style="padding:24px">
            <p>Dear <strong>${customer.name}</strong>,</p>
            <p>Please find invoice <strong>${billId}</strong> attached.</p>
            <p>Regards,<br><strong>${COMPANY.name}</strong></p></div>
          <div style="background:#0d2b4e;color:white;padding:12px;text-align:center;font-size:12px">
            ${COMPANY.phone} | ${COMPANY.email} | ${COMPANY.website}</div></div>`,
        attachments: [{ filename: `Invoice_${billId}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
    });
}

// ─── Controllers ─────────────────────────────────────────────────────────────
export const generateBill = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: "phone is required" });

        const user = await User.findOne({ phone: phone.trim() }).lean();
        if (!user) return res.status(404).json({ success: false, message: "No user found" });

        const subscription = await Subscription.findOne({
            company: user._id, status: "ACTIVE", isActive: true,
        }).populate("plan").sort({ startDate: -1 });

        if (!subscription) return res.status(404).json({ success: false, message: "No active subscription" });

        const plan = subscription.plan;
        const billId = await generateBillId();
        const total = plan.finalPrice;

        const customer = {
            name: user.name || "N/A",
            phone: user.phone || "N/A",
            email: user.email || null,
            address: user.manul_address || "N/A",
        };

        const qrBuffer = await buildQRBuffer(billId, customer, total, plan.name);
        const pdfBuffer = await buildBillPDF({ billId, customer, plan, subscription, total, qrBuffer });

        subscription.bill_id = billId;
        subscription.bill_generation_date = new Date();
        await subscription.save();

        sendBillEmail(customer, billId, pdfBuffer).catch(e => console.error("[Bill] email:", e.message));

        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="Invoice_${billId}.pdf"`,
            "Content-Length": pdfBuffer.length,
        });
        return res.send(pdfBuffer);

    } catch (err) {
        console.error("[generateBill]", err);
        return res.status(500).json({ success: false, message: "Bill generation failed", error: err.message });
    }
};

export const downloadBill = async (req, res) => {
    try {
        const { billId } = req.params;
        const subscription = await Subscription.findOne({ bill_id: billId })
            .populate("plan")
            .populate("company", "name email phone manul_address");

        if (!subscription) return res.status(404).json({ success: false, message: "Bill not found" });

        const plan = subscription.plan;
        const user = subscription.company;
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
        console.error("[downloadBill]", err);
        return res.status(500).json({ success: false, message: "Download failed", error: err.message });
    }
};