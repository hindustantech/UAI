export function passwordResetEmail({ name, resetLink }) {
  return {
    subject: 'Password Reset Request',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Password Reset</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <h2>Password Reset</h2>
  <p>Hello ${name || 'there'},</p>
  <p>You requested a password reset. Click the button below to set a new password.</p>
  <p><a href="${resetLink || '#'}" style="display:inline-block;background:#2ea44f;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;">Reset Password</a></p>
  <p>If you did not request this, please ignore this email.</p>
  <p>This link expires in 1 hour.</p>
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
