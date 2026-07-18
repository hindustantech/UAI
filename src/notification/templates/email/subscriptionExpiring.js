export function subscriptionExpiringEmail({ companyName, planName, endDate, daysLeft }) {
  return {
    subject: `Subscription Expiring Soon — ${daysLeft || ''} Day${daysLeft !== 1 ? 's' : ''} Left`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Subscription Expiring Soon</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.badge{display:inline-block;background:#ffa500;color:#fff;padding:6px 14px;border-radius:4px;font-weight:bold}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <div class="badge">EXPIRING SOON</div>
  <h2>Subscription Expiring Soon</h2>
  <p>Hello ${companyName || 'Valued Customer'},</p>
  <p>Your <strong>${planName}</strong> subscription will expire on <strong>${endDate || 'N/A'}</strong>.</p>
  <p>That's only <strong>${daysLeft || 'a few'} day${daysLeft !== 1 ? 's' : ''}</strong> away.</p>
  <p>Renew now to avoid any interruption in service.</p>
  <p><a href="#" style="display:inline-block;background:#2ea44f;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;">Renew Now</a></p>
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
