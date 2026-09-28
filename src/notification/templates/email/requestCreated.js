export function requestCreatedEmail({ employeeName, requestType, reason, requestId, empCode }) {
  const typeLabel = requestType
    ? requestType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'Request';
  return {
    subject: `New ${typeLabel} Request from ${employeeName || 'Employee'}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>New Attendance Request</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.badge{display:inline-block;background:#0366d6;color:#fff;padding:6px 14px;border-radius:4px;font-weight:bold}.info-row{margin:8px 0;padding:8px 0;border-bottom:1px solid #e1e4e8}.info-row:last-child{border-bottom:none}.label{font-weight:bold;color:#586069}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <div class="badge">NEW REQUEST</div>
  <h2>New Attendance Request</h2>
  <p>Hello,</p>
  <p>A new <strong>${typeLabel}</strong> request has been submitted by <strong>${employeeName || 'an employee'}</strong>.</p>
  <div class="info-row"><span class="label">Employee:</span> ${employeeName || 'N/A'}</div>
  ${empCode ? `<div class="info-row"><span class="label">Employee Code:</span> ${empCode}</div>` : ''}
  <div class="info-row"><span class="label">Request Type:</span> ${typeLabel}</div>
  ${reason ? `<div class="info-row"><span class="label">Reason:</span> ${reason}</div>` : ''}
  ${requestId ? `<div class="info-row"><span class="label">Request ID:</span> ${requestId}</div>` : ''}
  <p>Please review and take action on this request at your earliest convenience.</p>
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
