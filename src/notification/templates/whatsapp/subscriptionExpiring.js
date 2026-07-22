export function subscriptionExpiringWhatsApp({ companyName, planName, endDate, daysLeft }) {
  return {
    message: `Hello ${companyName || 'Valued Customer'}, your ${planName} subscription is expiring in ${daysLeft || 'a few'} days (${endDate || 'N/A'}). Renew now to avoid interruption.`,
    params: [companyName || 'Valued Customer', planName || 'Plan', String(daysLeft ?? 'a few'), endDate || 'N/A'],
  };
}
