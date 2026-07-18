export function subscriptionExpiredWhatsApp({ companyName, planName, endDate }) {
  return {
    message: `Hello ${companyName || 'Valued Customer'}, your ${planName} subscription has EXPIRED (ended ${endDate || 'N/A'}). Please renew to restore full access.`,
    params: [companyName || 'Valued Customer', planName || 'Plan', endDate || 'N/A'],
  };
}
