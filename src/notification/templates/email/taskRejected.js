export function taskRejectedEmail({ taskId, taskNumber, taskTitle, actorName, reason, message }) {
  return {
    subject: `Task Rejected: ${taskNumber || ''} ${taskTitle || ''}`.trim(),
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Task Rejected</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.badge{display:inline-block;background:#d73a49;color:#fff;padding:6px 14px;border-radius:4px;font-weight:bold}.info-row{margin:8px 0;padding:8px 0;border-bottom:1px solid #e1e4e8}.info-row:last-child{border-bottom:none}.label{font-weight:bold;color:#586069}.reason-box{background:#ffeef0;border:1px solid #fdaeb7;border-radius:4px;padding:12px;margin:12px 0}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <div class="badge">REJECTED</div>
  <h2>Task Rejected</h2>
  <p>Hello,</p>
  <p><strong>${actorName || 'A reviewer'}</strong> has rejected a task.</p>
  ${taskNumber ? `<div class="info-row"><span class="label">Task Number:</span> ${taskNumber}</div>` : ''}
  ${taskTitle ? `<div class="info-row"><span class="label">Task Title:</span> ${taskTitle}</div>` : ''}
  ${reason ? `<div class="reason-box"><strong>Reason:</strong> ${reason}</div>` : ''}
  ${message && !reason ? `<div class="info-row"><span class="label">Details:</span> ${message}</div>` : ''}
  <p>Please make the necessary changes and resubmit the task.</p>
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
