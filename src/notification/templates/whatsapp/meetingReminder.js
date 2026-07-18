export function meetingReminderWhatsApp({ employeeName, meetingTitle, time, location }) {
  return {
    message: `Reminder: Meeting "${meetingTitle || 'Team Meeting'}" at ${time || 'N/A'}${location ? ` (${location})` : ''}. — UAI`,
    params: [meetingTitle || 'Team Meeting', time || 'N/A', location || ''],
  };
}
