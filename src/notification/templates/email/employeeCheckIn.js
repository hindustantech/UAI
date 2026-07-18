export function employeeCheckInEmail({ employeeName, companyName, time, type }) {
  const label = type === 'check_out' ? 'checked out' : 'checked in';
  return {
    subject: `${employeeName || 'Employee'} ${label}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Attendance Update</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <h2>Attendance Update</h2>
  <p>Hello ${companyName || 'Team'},</p>
  <p><strong>${employeeName || 'An employee'}</strong> has ${label} at <strong>${time || 'N/A'}</strong>.</p>
  <div class="footer">This is an automated notification from UAI.</div>
</div>
</body>
</html>`,
  };
}
