export function subscriptionActivatedWhatsApp({ companyName, planName, startDate, endDate }) {
  return {
    message: `Hello ${companyName || 'Valued Customer'}, your ${planName} subscription is now ACTIVE. Start Date: ${startDate || 'N/A'}, End Date: ${endDate || 'N/A'}. Thank you for choosing UAI.`,
    params: [companyName || 'Valued Customer', planName || 'Plan', startDate || 'N/A', endDate || 'N/A'],
  };
}
