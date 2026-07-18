export function welcomeEmail({ name, companyName, email }) {
  return {
    subject: 'Welcome to UAI!',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Welcome to UAI</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <h2>Welcome to UAI!</h2>
  <p>Hello ${name || 'there'},</p>
  <p>Welcome${companyName ? ` to ${companyName}` : ''}! We're excited to have you on board.</p>
  <p>Get started by exploring the dashboard and setting up your team.</p>
  <p>If you have any questions, feel free to reach out to our support team.</p>
  <p>Regards,<br/><strong>The UAI Team</strong></p>
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
