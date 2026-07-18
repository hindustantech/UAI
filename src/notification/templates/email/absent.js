export function absentEmail({ employeeName, date, companyName }) {
  return {
    subject: `Absent Notification — ${employeeName || 'Employee'}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Absent Notification</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.badge{display:inline-block;background:#d73a49;color:#fff;padding:6px 14px;border-radius:4px;font-weight:bold}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <div class="badge">ABSENT</div>
  <h2>Attendance Alert</h2>
  <p>Hello ${companyName || 'Team'},</p>
  <p><strong>${employeeName || 'An employee'}</strong> was marked absent for <strong>${date || 'today'}</strong>.</p>
  <div class="footer">This is an automated notification from UAI.</div>
</div>
</body>
</html>`,
  };
}
