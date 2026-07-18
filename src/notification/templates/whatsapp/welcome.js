export function welcomeWhatsApp({ name, companyName }) {
  return {
    message: `Hello ${name || 'there'}! Welcome${companyName ? ` to ${companyName}` : ''} 🎉 We're excited to have you on board. Start exploring the UAI dashboard to manage your team.`,
    params: [name || 'there', companyName || 'UAI'],
  };
}
