export function visitReminderWhatsApp({ salesPerson, clientName, address, time }) {
  return {
    message: `Visit Reminder: You have a visit scheduled to "${clientName || 'Client'}" at ${time || 'N/A'}${address ? ` (${address})` : ''}. — UAI Sales`,
    params: [clientName || 'Client', time || 'N/A', address || ''],
  };
}
