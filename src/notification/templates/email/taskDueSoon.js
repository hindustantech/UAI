export function taskDueSoonEmail({ taskId, taskNumber, taskTitle, dueDate, message }) {
  const formattedDate = dueDate
    ? new Date(dueDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'N/A';
  return {
    subject: `Task Due Soon: ${taskNumber || ''} ${taskTitle || ''}`.trim(),
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Task Due Soon</title>
<style>body{font-family:Arial,sans-serif;background:#f6f8fa;margin:0;padding:0}.container{max-width:600px;margin:30px auto;background:#fff;padding:24px;border-radius:6px;border:1px solid #e1e4e8}h2{color:#24292e;margin-top:0}.badge{display:inline-block;background:#dbab09;color:#fff;padding:6px 14px;border-radius:4px;font-weight:bold}.info-row{margin:8px 0;padding:8px 0;border-bottom:1px solid #e1e4e8}.info-row:last-child{border-bottom:none}.label{font-weight:bold;color:#586069}.due-box{background:#fff8c5;border:1px solid #f9d779;border-radius:4px;padding:12px;margin:12px 0}.footer{margin-top:24px;font-size:12px;color:#6a737d}</style>
</head>
<body>
<div class="container">
  <div class="badge">DUE SOON</div>
  <h2>Task Due Soon</h2>
  <p>Hello,</p>
  <p>A task assigned to you is due soon. Please ensure it is completed on time.</p>
  ${taskNumber ? `<div class="info-row"><span class="label">Task Number:</span> ${taskNumber}</div>` : ''}
  ${taskTitle ? `<div class="info-row"><span class="label">Task Title:</span> ${taskTitle}</div>` : ''}
  <div class="due-box"><strong>Due Date:</strong> ${formattedDate}</div>
  ${message ? `<div class="info-row"><span class="label">Details:</span> ${message}</div>` : ''}
  <div class="footer">This is an automated message from UAI. Please do not reply.</div>
</div>
</body>
</html>`,
  };
}
