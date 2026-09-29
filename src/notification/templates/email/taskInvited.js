export function taskInvitedEmail({ taskId, taskNumber, taskTitle, actorName, message }) {
  return {
    subject: `Task Invitation: ${taskNumber || ''} ${taskTitle || ''}`.trim(),
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Task Invitation</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.badge{display:inline-block;background:#6f42c1;color:#fff;padding:6px 14px;border-radius:4px;font-weight:bold}.info-row{margin:8px 0;padding:8px 0;border-bottom:1px solid #e1e4e8}.info-row:last-child{border-bottom:none}.label{font-weight:bold;color:#586069}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <div class="badge">INVITATION</div>
  <h2>You've Been Invited to a Task</h2>
  <p>Hello,</p>
  <p>${actorName || 'Someone'} has invited you to collaborate on a task.</p>
  ${taskNumber ? `<div class="info-row"><span class="label">Task Number:</span> ${taskNumber}</div>` : ''}
  ${taskTitle ? `<div class="info-row"><span class="label">Task Title:</span> ${taskTitle}</div>` : ''}
  ${message ? `<div class="info-row"><span class="label">Message:</span> ${message}</div>` : ''}
  <p>Please respond to the invitation from your dashboard.</p>
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
