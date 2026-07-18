export function subscriptionExpiredEmail({ companyName, planName, endDate }) {
  return {
    subject: 'Subscription Expired — Action Required',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Subscription Expired</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.badge{display:inline-block;background:#d73a49;color:#fff;padding:6px 14px;border-radius:4px;font-weight:bold}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <div class="badge">EXPIRED</div>
  <h2>Subscription Expired</h2>
  <p>Hello ${companyName || 'Valued Customer'},</p>
  <p>Your <strong>${planName}</strong> subscription expired on <strong>${endDate || 'N/A'}</strong>.</p>
  <p>Some features may be limited. Please renew to continue full access.</p>
  <p><a href="#" style="display:inline-block;background:#2ea44f;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;">Renew Now</a></p>
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
