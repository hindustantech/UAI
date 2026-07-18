export function monthlyReportEmail({ companyName, month, year, summary }) {
  return {
    subject: `Monthly Report — ${month || 'N/A'} ${year || ''}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Monthly Report</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <h2>Monthly Report</h2>
  <p>Hello ${companyName || 'Team'},</p>
  <p>Here is your monthly summary for <strong>${month || 'N/A'} ${year || ''}</strong>.</p>
  <pre style="background:#f6f8fa;padding:16px;border-radius:4px;overflow-x:auto;">${JSON.stringify(summary || {}, null, 2)}</pre>
  <div class="footer">This is an automated report from UAI.</div>
</div>
</body>
</html>`,
  };
}
