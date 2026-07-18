export function followupReminderWhatsApp({ salesPerson, clientName, notes }) {
  return {
    message: `Follow-up reminder: Client "${clientName || 'Client'}" needs attention.${notes ? ` Notes: ${notes}` : ''} — UAI Sales`,
    params: [clientName || 'Client', notes || ''],
  };
}
