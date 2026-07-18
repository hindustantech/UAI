export function dailyReportWhatsApp({ companyName, date }) {
  return {
    message: `Daily report for ${companyName || 'your company'} on ${date || 'today'} is ready. Check your email for the full report. — UAI`,
    params: [companyName || 'your company', date || 'today'],
  };
}
