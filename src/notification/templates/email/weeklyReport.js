export function weeklyReportEmail({ companyName, weekStart, weekEnd, summary }) {
  return {
    subject: `Weekly Report — ${weekStart || 'N/A'} to ${weekEnd || 'N/A'}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Weekly Report</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <h2>Weekly Report</h2>
  <p>Hello ${companyName || 'Team'},</p>
  <p>Here is your weekly summary for <strong>${weekStart || 'N/A'}</strong> to <strong>${weekEnd || 'N/A'}</strong>.</p>
  <pre style="background:#f6f8fa;padding:16px;border-radius:4px;overflow-x:auto;">${JSON.stringify(summary || {}, null, 2)}</pre>
  <div class="footer">This is an automated report from UAI.</div>
</div>
</body>
</html>`,
  };
}
