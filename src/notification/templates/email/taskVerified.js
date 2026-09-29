export function taskVerifiedEmail({ taskId, taskNumber, taskTitle, actorName, message }) {
  return {
    subject: `Task Verified: ${taskNumber || ''} ${taskTitle || ''}`.trim(),
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Task Verified</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.badge{display:inline-block;background:#2ea44f;color:#fff;padding:6px 14px;border-radius:4px;font-weight:bold}.info-row{margin:8px 0;padding:8px 0;border-bottom:1px solid #e1e4e8}.info-row:last-child{border-bottom:none}.label{font-weight:bold;color:#586069}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <div class="badge">VERIFIED</div>
  <h2>Task Verified</h2>
  <p>Hello,</p>
  <p><strong>${actorName || 'A reviewer'}</strong> has verified a task. Great work!</p>
  ${taskNumber ? `<div class="info-row"><span class="label">Task Number:</span> ${taskNumber}</div>` : ''}
  ${taskTitle ? `<div class="info-row"><span class="label">Task Title:</span> ${taskTitle}</div>` : ''}
  ${message ? `<div class="info-row"><span class="label">Details:</span> ${message}</div>` : ''}
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
