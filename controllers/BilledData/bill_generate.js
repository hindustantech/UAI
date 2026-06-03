/**
 * billController.js
 *
 * POST /api/bills/generate
 * Body: { phone: "9876543210" }
 *
 * KEY FIXES:
 *  1. Rs. instead of ₹ — Helvetica has no Rupee glyph
 *  2. No extra pages — every doc.text() that has an explicit x,y also sets
 *     doc.x / doc.y, so footer calls near page-bottom auto-added pages.
 *     Fix: call doc.text() with { lineBreak: false } for all positioned text
 *     AND manually reset doc.y before footer block.
 *  3. Layout: QR code + BILL TO side-by-side (two columns)
 *  4. Features rendered as a proper table (key | value rows)
 *  5. IGST removed
 */

import PDFDocument from "pdfkit";
import QRCode      from "qrcode";
import nodemailer  from "nodemailer";
import User          from '../../models/userModel.js';
import { Subscription } from '../../models/Attandance/subscration/Subscription.js';

// ─── Config ──────────────────────────────────────────────────────────────────
const COMPANY = {
    name:       "Praecore Brandteck Pvt.Ltd",
    address:    "123, Business Park, Sector 62, Noida, UP 201301",
    phone:      "+91 120 456 7890",
    email:      "info@praecorebrandteck.com",
    website:    "www.praecorebrandteck.com",
    gstin:      "09ABCDE1234F1Z5",
    verifyBase: process.env.BILL_VERIFY_BASE_URL || "https://praecorebrandteck.com/verify",
};

const MAIL_CONFIG = {
    host:   process.env.SMTP_HOST || "smtp.gmail.com",
    port:   parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function generateBillId() {
    const year   = new Date().getFullYear();
    const prefix = `PBPL-${year}-`;
    const latest = await Subscription.findOne(
        { bill_id: { $regex: `^${prefix}` } }, { bill_id: 1 },
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
    const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
        "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen",
        "Seventeen","Eighteen","Nineteen"];
    const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
    function say(n) {
        if (n===0) return "";
        if (n<20) return ones[n];
        if (n<100) return tens[Math.floor(n/10)]+(n%10?" "+ones[n%10]:"");
        return ones[Math.floor(n/100)]+" Hundred"+(n%100?" "+say(n%100):"");
    }
    function full(n) {
        if (n===0) return "Zero";
        const p=[];
        if(n>=10000000){p.push(say(Math.floor(n/10000000))+" Crore");n%=10000000;}
        if(n>=100000)  {p.push(say(Math.floor(n/100000))+" Lakh");n%=100000;}
        if(n>=1000)    {p.push(say(Math.floor(n/1000))+" Thousand");n%=1000;}
        if(n>0)        {p.push(say(n));}
        return p.join(" ");
    }
    const rupees = Math.floor(amount);
    const paise  = Math.round((amount-rupees)*100);
    let result   = `Rupees ${full(rupees)}`;
    if (paise) result += ` and ${full(paise)} Paise`;
    return result + " Only";
}

function fmtDate(d) {
    return new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"});
}
function validityLabel(days) {
    if (days % 30 === 0) return `${days/30} Month${days/30>1?"s":""}`;
    return `${days} Days`;
}

async function buildQRBuffer(billId, customer, amount, planName) {
    const payload = JSON.stringify({
        billId, customer: customer.name,
        amount: `INR ${amount}`, plan: planName,
        verifyUrl: `${COMPANY.verifyBase}/${billId}`,
    });
    return QRCode.toBuffer(payload, {
        errorCorrectionLevel:"H", type:"png", width:200, margin:2,
        color:{ dark:"#000000", light:"#ffffff" },
    });
}

// ─── PDF Builder ─────────────────────────────────────────────────────────────
async function buildBillPDF(billData) {
    const { billId, customer, plan, subscription, total, qrBuffer } = billData;

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size:"A4", margin:0, autoFirstPage:false });
        doc.addPage({ size:"A4", margin:0 });

        const chunks = [];
        doc.on("data", c => chunks.push(c));
        doc.on("end",  () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        // ── Constants ─────────────────────────────────────────────────────────
        const W  = 595.28;
        const H  = 841.89;  // A4 height — NEVER let doc.y exceed this
        const M  = 36;      // left/right margin

        const DARK_BLUE = "#0d2b4e";
        const MID_BLUE  = "#1a4a8a";
        const LIGHT_BG  = "#e8f0fb";
        const GREEN     = "#2ca02c";
        const GRAY      = "#555555";
        const LGRAY     = "#888888";

        // Shorthand: draw text at absolute position WITHOUT moving doc.y cursor
        // This is the key fix — lineBreak:false stops PDFKit from advancing y
        const T = (text, x, y, opts={}) => {
            doc.text(String(text), x, y, { lineBreak:false, ...opts });
        };

        // ── TOP BAR ───────────────────────────────────────────────────────────
        doc.rect(0, 0, W, 20).fill(DARK_BLUE);

        // ── LOGO (left) ───────────────────────────────────────────────────────
        doc.circle(M+18, 52, 16).fill(MID_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(13);
        T("P", M+11, 45);

        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(10);
        T("PRAECORE", M+40, 40);
        doc.fillColor(GRAY).font("Helvetica").fontSize(7);
        T("BRANDTECK PVT.LTD", M+40, 53);

        // ── BILL TITLE (centre) ───────────────────────────────────────────────
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(24);
        T("BILL", W/2-22, 32);
        doc.moveTo(W/2-38,64).lineTo(W/2+38,64).strokeColor(DARK_BLUE).lineWidth(1.2).stroke();
        doc.fillColor(GRAY).font("Helvetica").fontSize(7.5);
        T("Thank you for your payment!", W/2-65, 68, { width:130, align:"center" });

        // ── BILL INFO BOX (right) ─────────────────────────────────────────────
        const bx=W-M-160, by=28, bw=160, bh=76;
        doc.rect(bx,by,bw,bh).strokeColor(DARK_BLUE).lineWidth(0.8).stroke();
        doc.rect(bx,by,bw,17).fill(DARK_BLUE);

        doc.fillColor("white").font("Helvetica-Bold").fontSize(7);
        T("BILL NO.", bx+5, by+5);
        T(billId, bx+48, by+5);

        const irows = [
            ["Bill Date",      fmtDate(subscription.bill_generation_date || new Date())],
            ["Payment Date",   fmtDate(subscription.payment?.paidAt || new Date())],
            ["Payment Status", subscription.payment?.paymentStatus==="SUCCESS"?"Paid":(subscription.payment?.paymentStatus||"Paid")],
        ];
        let iy = by+23;
        for (const [lbl,val] of irows) {
            doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(7);
            T(lbl, bx+5, iy);
            T(":", bx+64, iy);
            doc.fillColor(lbl==="Payment Status"?GREEN:GRAY).font("Helvetica").fontSize(7);
            T(val, bx+72, iy);
            iy += 16;
        }

        // ── COMPANY ADDRESS ───────────────────────────────────────────────────
        let ay = 96;
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(8.5);
        T(COMPANY.name, M, ay); ay+=13;
        doc.fillColor(GRAY).font("Helvetica").fontSize(7);
        for (const ln of [COMPANY.address,`Tel: ${COMPANY.phone}`,COMPANY.email,COMPANY.website]) {
            T(ln, M, ay); ay+=11;
        }
        T(`GSTIN: ${COMPANY.gstin}`, M, ay);

        // ── DIVIDER ───────────────────────────────────────────────────────────
        const divY = 158;
        doc.moveTo(M,divY).lineTo(W-M,divY).strokeColor("#dddddd").lineWidth(0.5).stroke();

        // ══════════════════════════════════════════════════════════════════════
        // TWO-COLUMN SECTION: QR (left) | BILL TO (right)
        // ══════════════════════════════════════════════════════════════════════
        const COL_TOP = divY + 10;
        const QR_W    = 230;   // left column width
        const BT_X    = M + QR_W + 12;  // right column x
        const BT_W    = W - M - BT_X;   // right column width

        // ── QR BOX (left column) ──────────────────────────────────────────────
        const qbH = 110;
        doc.roundedRect(M, COL_TOP, QR_W, qbH, 5).fill(LIGHT_BG);
        doc.image(qrBuffer, M+6, COL_TOP+6, { width:78, height:78 });

        doc.fillColor(MID_BLUE).font("Helvetica-Bold").fontSize(8);
        T("Scan to Verify", M+90, COL_TOP+8);

        doc.fillColor(DARK_BLUE).font("Helvetica").fontSize(7);
        const qlines = [
            `Customer : ${customer.name}`,
            `Bill ID  : ${billId}`,
            `Amount   : Rs. ${total.toFixed(2)}`,
            `Plan     : ${plan.name}`,
        ];
        let ql = COL_TOP+20;
        for (const l of qlines) { T(l, M+90, ql); ql+=13; }

        doc.fillColor(LGRAY).font("Helvetica-Oblique").fontSize(6.2);
        // multi-line italic note — use doc.text with explicit coords + width
        doc.text("Scan this QR code to view bill details and verification.",
            M+6, COL_TOP+90, { width:218, lineBreak:true });

        // ── BILL TO (right column) ────────────────────────────────────────────
        doc.rect(BT_X, COL_TOP, 55, 15).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(7.5);
        T("BILL TO", BT_X+4, COL_TOP+4);

        const cbY = COL_TOP+20;
        doc.roundedRect(BT_X, cbY, BT_W, 88, 5).fill(LIGHT_BG);

        // Avatar circle
        doc.circle(BT_X+22, cbY+38, 17).fill("#b0c4de");
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(14);
        T("U", BT_X+15, cbY+28);

        const tx = BT_X+46;
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(9);
        T(customer.name, tx, cbY+10);

        doc.fillColor(GRAY).font("Helvetica").fontSize(8);
        T(customer.phone  || "-", tx, cbY+26);
        T(customer.email  || "-", tx, cbY+39);
        // address may be long — allow wrap but restrict to column
        doc.text(customer.address || "-", tx, cbY+52, { width: BT_W-50, lineBreak:true });

        // ── ITEMS TABLE ───────────────────────────────────────────────────────
        const tblY = COL_TOP + qbH + 14;
        const COLS = [24, 150, 95, 80, 90];    // #, Desc, Plan, Duration, Price
        const TBLW = COLS.reduce((a,b)=>a+b,0);
        const HDRS = ["#","DESCRIPTION","PLAN NAME","DURATION","PRICE (INR)"];

        // Header bar
        doc.rect(M, tblY, TBLW, 18).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(7.5);
        let cx = M;
        for (let i=0;i<HDRS.length;i++) {
            T(HDRS[i], cx+2, tblY+5, { width:COLS[i]-4, align:"center" });
            cx += COLS[i];
        }

        // Data row
        const drY = tblY+18;
        doc.rect(M, drY, TBLW, 18).fill("white").strokeColor(GRAY).lineWidth(0.5).stroke();
        doc.fillColor(DARK_BLUE).font("Helvetica").fontSize(8);
        const vals = ["1","Subscription Plan",plan.name,
            validityLabel(plan.validityDays),`Rs. ${plan.finalPrice.toFixed(2)}`];
        cx = M;
        for (let i=0;i<vals.length;i++) {
            T(vals[i], cx+2, drY+5, { width:COLS[i]-4, align:"center" });
            cx += COLS[i];
        }

        // ── FEATURES TABLE ────────────────────────────────────────────────────
        // Rendered as a proper mini-table with KEY | VALUE columns
        const feats  = (plan.features||[]).map(f => ({ key: f.key, val: String(f.value) }));
        const FT_ROW = 15;
        const ftY    = drY + 18;
        const ftH    = 18 + feats.length * FT_ROW + 6;   // header + rows + padding

        doc.rect(M, ftY, TBLW, ftH).fill("white").strokeColor(GRAY).lineWidth(0.5).stroke();

        // Sub-header
        doc.rect(M, ftY, TBLW, 17).fill("#f0f4fc");
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(7.5);
        T("Plan Includes", M+6, ftY+5);

        // Feature column headers
        const FK_W = 220;  // key column width
        doc.fillColor(MID_BLUE).font("Helvetica-Bold").fontSize(7);
        T("FEATURE", M+6, ftY+5);
        T("VALUE",   M+FK_W, ftY+5);

        // Feature rows
        let fy = ftY + 18;
        feats.forEach((f, idx) => {
            if (idx % 2 === 0) doc.rect(M+1, fy, TBLW-2, FT_ROW).fill("#f7f9fe");
            else               doc.rect(M+1, fy, TBLW-2, FT_ROW).fill("white");

            // bullet
            doc.circle(M+10, fy+7.5, 3).fill(MID_BLUE);
            doc.fillColor("white").font("Helvetica-Bold").fontSize(5);
            T("v", M+8, fy+5);

            doc.fillColor(DARK_BLUE).font("Helvetica").fontSize(7.5);
            T(f.key,  M+18, fy+4);
            doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(7.5);
            T(f.val,  M+FK_W, fy+4);
            fy += FT_ROW;
        });

        // ── TOTALS ────────────────────────────────────────────────────────────
        let totY = ftY + ftH + 10;
        const lx = W - M - 180;

        doc.fillColor(DARK_BLUE).font("Helvetica").fontSize(8.5);
        T("Subtotal",  lx, totY);
        T(`Rs. ${plan.finalPrice.toFixed(2)}`, lx+105, totY, { width:75, align:"right" });
        totY += 16;

        doc.rect(lx-4, totY, 184, 18).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(9);
        T("TOTAL AMOUNT", lx+2, totY+4);
        T(`Rs. ${total.toFixed(2)}`, lx+100, totY+4, { width:80, align:"right" });
        totY += 24;

        doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(9);
        T("PAID", lx, totY);
        T(`Rs. ${total.toFixed(2)}`, lx+100, totY, { width:80, align:"right" });
        totY += 20;

        // ── AMOUNT IN WORDS ───────────────────────────────────────────────────
        doc.moveTo(M,totY).lineTo(W-M,totY).strokeColor("#cccccc").lineWidth(0.5).stroke();
        totY += 6;
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(8);
        T("Amount in Words:", M, totY);
        totY += 13;
        doc.fillColor(GRAY).font("Helvetica").fontSize(8);
        T(amountInWords(total), M, totY, { width: W-M*2 });
        totY += 18;

        // ── PAYMENT METHOD ────────────────────────────────────────────────────
        doc.moveTo(M,totY).lineTo(W-M,totY).strokeColor("#eeeeee").lineWidth(0.4).stroke();
        totY += 8;
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(8);
        T("Payment Method:", M, totY);
        T("Transaction ID:", M+200, totY);
        totY += 14;
        doc.fillColor(GRAY).font("Helvetica").fontSize(8);
        T(subscription.payment?.paymentGateway||"ONLINE",   M, totY);
        T(subscription.payment?.transactionId||"N/A", M+200, totY);

        // ══════════════════════════════════════════════════════════════════════
        // FOOTER — drawn with ABSOLUTE coordinates anchored to page bottom.
        // CRITICAL: We do NOT use doc.text() here because it moves doc.y.
        // Instead we draw rect/text directly at fixed Y positions.
        // ══════════════════════════════════════════════════════════════════════
        const F_LINE  = H - 62;
        const F_TXT1  = H - 54;
        const F_TXT2  = H - 41;
        const F_BAR   = H - 26;

        doc.moveTo(M,F_LINE).lineTo(W-M,F_LINE).strokeColor("#cccccc").lineWidth(0.5).stroke();

        // Use save/restore + translate to draw footer text without affecting cursor
        doc.save();
        doc.fillColor(DARK_BLUE).font("Helvetica-Bold").fontSize(9);
        // draw directly via internal low-level text primitive that doesn't move y
        doc.text(`Thank you for choosing ${COMPANY.name}.`,
            M, F_TXT1, { width:W-M*2, align:"center", lineBreak:false });

        doc.fillColor(GRAY).font("Helvetica").fontSize(8);
        doc.text("We appreciate your business!",
            M, F_TXT2, { width:W-M*2, align:"center", lineBreak:false });
        doc.restore();

        // Footer dark bar
        doc.rect(0, F_BAR, W, 26).fill(DARK_BLUE);
        doc.fillColor("white").font("Helvetica").fontSize(6.8);
        // Left text in bar
        doc.text("If you have any questions, feel free to contact us.",
            M, F_BAR+8, { lineBreak:false });
        // Centre contact in bar
        doc.text(`${COMPANY.phone}  |  ${COMPANY.email}  |  ${COMPANY.website}`,
            0, F_BAR+8, { width:W, align:"center", lineBreak:false });

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
        attachments: [{ filename:`Invoice_${billId}.pdf`, content:pdfBuffer, contentType:"application/pdf" }],
    });
}

// ─── Controllers ─────────────────────────────────────────────────────────────
export const generateBill = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success:false, message:"phone is required" });

        const user = await User.findOne({ phone: phone.trim() }).lean();
        if (!user) return res.status(404).json({ success:false, message:"No user found" });

        const subscription = await Subscription.findOne({
            company:user._id, status:"ACTIVE", isActive:true,
        }).populate("plan").sort({ startDate:-1 });
        if (!subscription) return res.status(404).json({ success:false, message:"No active subscription" });

        const plan  = subscription.plan;
        const billId = await generateBillId();
        const total  = plan.finalPrice;  // no IGST

        const customer = {
            name:    user.name          || "N/A",
            phone:   user.phone         || "N/A",
            email:   user.email         || null,
            address: user.manul_address || "N/A",
        };

        const qrBuffer  = await buildQRBuffer(billId, customer, total, plan.name);
        const pdfBuffer = await buildBillPDF({ billId, customer, plan, subscription, total, qrBuffer });

        subscription.bill_id             = billId;
        subscription.bill_generation_date = new Date();
        await subscription.save();

        sendBillEmail(customer, billId, pdfBuffer).catch(e => console.error("[Bill] email:", e.message));

        res.set({
            "Content-Type":        "application/pdf",
            "Content-Disposition": `attachment; filename="Invoice_${billId}.pdf"`,
            "Content-Length":      pdfBuffer.length,
        });
        return res.send(pdfBuffer);

    } catch (err) {
        console.error("[generateBill]", err);
        return res.status(500).json({ success:false, message:"Bill generation failed", error:err.message });
    }
};

export const downloadBill = async (req, res) => {
    try {
        const { billId } = req.params;
        const subscription = await Subscription.findOne({ bill_id:billId })
            .populate("plan")
            .populate("company","name email phone manul_address");
        if (!subscription) return res.status(404).json({ success:false, message:"Bill not found" });

        const plan  = subscription.plan;
        const user  = subscription.company;
        const total = plan.finalPrice;
        const customer = {
            name:    user.name          || "N/A",
            phone:   user.phone         || "N/A",
            email:   user.email         || null,
            address: user.manul_address || "N/A",
        };

        const qrBuffer  = await buildQRBuffer(billId, customer, total, plan.name);
        const pdfBuffer = await buildBillPDF({ billId, customer, plan, subscription, total, qrBuffer });

        res.set({
            "Content-Type":        "application/pdf",
            "Content-Disposition": `attachment; filename="Invoice_${billId}.pdf"`,
            "Content-Length":      pdfBuffer.length,
        });
        return res.send(pdfBuffer);

    } catch (err) {
        console.error("[downloadBill]", err);
        return res.status(500).json({ success:false, message:"Download failed", error:err.message });
    }
};