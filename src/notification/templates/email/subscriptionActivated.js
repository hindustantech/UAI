export function subscriptionActivatedEmail({ companyName, planName, startDate, endDate, features }) {
  return {
    subject: `Subscription Activated — ${planName} Plan`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Subscription Activated</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.badge{display:inline-block;background:#2ea44f;color:#fff;padding:6px 14px;border-radius:4px;font-weight:bold}.footer{margin-top:24px;font-size:12px;color:#6a737d}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:left;padding:8px;border:1px solid #e1e4e8}th{background:#f6f8fa}</style>
</head>
<body>
<div class="container">
  <div class="badge">ACTIVE</div>
  <h2>Subscription Activated</h2>
  <p>Hello ${companyName || 'Valued Customer'},</p>
  <p>Your <strong>${planName}</strong> subscription is now active.</p>
  <table>
    <tr><th>Start Date</th><td>${startDate || 'N/A'}</td></tr>
    <tr><th>End Date</th><td>${endDate || 'N/A'}</td></tr>
  </table>
  ${features ? `<p><strong>Features Included:</strong> ${features}</p>` : ''}
  <p>Thank you for choosing UAI.</p>
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
