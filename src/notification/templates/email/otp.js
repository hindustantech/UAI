export function otpEmail({ name, code, expiryMinutes }) {
  return {
    subject: 'Your OTP Code',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>OTP Verification</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}.otp{font-size:32px;font-weight:bold;text-align:center;letter-spacing:8px;color:#24292e;padding:20px;background:#f6f8fa;border-radius:4px;margin:16px 0}h2{color:#24292e;margin-top:0}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <h2>OTP Verification</h2>
  <p>Hello ${name || 'there'},</p>
  <p>Your one-time password is:</p>
  <div class="otp">${code || '000000'}</div>
  <p>This code expires in ${expiryMinutes || '10'} minutes.</p>
  <p>If you did not request this, please ignore this email.</p>
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
