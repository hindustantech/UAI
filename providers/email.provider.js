import nodemailer from "nodemailer";

/**
 * Create reusable transporter
 * Use ENV variables only (no hardcoding)
 */
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', // Correct hostname for Gmail's SMTP
    port: 465, // Port for secure connections
    secure: true,                       // true for 465
    auth: {
        user: process.env.SMTP_USER, // Your Gmail email
        pass: process.env.SMTP_PASS, // Your Gmail password or App Password
    },
});

/**
 * Send Email (Transactional)
 */
export async function sendEmail({ to, subject, html }) {
    try {
        const mailOptions = {
            from: `"Referral Program" <${process.env.EMAIL_FROM}>`,
            to,
            subject,
            html,
        };

        const info = await transporter.sendMail(mailOptions);

        console.log(`Email sent to ${to} | messageId=${info.messageId}`);
        return info;
    } catch (error) {
        console.error("Email send failed:", error);
        throw error;
    }
}
