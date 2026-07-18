export function loginAlertEmail({ name, ip, location, device, timestamp }) {
  return {
    subject: 'New Login Detected',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Login Alert</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.footer{margin-top:24px;font-size:12px;color:#6a737d}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:left;padding:8px;border:1px solid #e1e4e8}th{background:#f6f8fa}</style>
</head>
<body>
<div class="container">
  <h2>New Login Detected</h2>
  <p>Hello ${name || 'there'},</p>
  <p>A new login was detected on your account.</p>
  <table>
    <tr><th>Time</th><td>${timestamp || 'N/A'}</td></tr>
    <tr><th>IP Address</th><td>${ip || 'N/A'}</td></tr>
    <tr><th>Location</th><td>${location || 'N/A'}</td></tr>
    <tr><th>Device</th><td>${device || 'N/A'}</td></tr>
  </table>
  <p>If this was you, no action is needed. If not, please secure your account.</p>
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
