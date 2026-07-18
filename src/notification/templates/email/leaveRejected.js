export function leaveRejectedEmail({ employeeName, leaveType, startDate, endDate, reason, approver }) {
  return {
    subject: 'Leave Request Update',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Leave Request</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.badge{display:inline-block;background:#d73a49;color:#fff;padding:6px 14px;border-radius:4px;font-weight:bold}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <div class="badge">NOT APPROVED</div>
  <h2>Leave Request Not Approved</h2>
  <p>Hello ${employeeName || 'Employee'},</p>
  <p>Your ${leaveType || 'leave'} request (${startDate || 'N/A'} — ${endDate || 'N/A'}) was not approved.</p>
  ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
  <p>Please contact ${approver || 'your manager'} for more details.</p>
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
