export function absentWhatsApp({ employeeName, date, companyName }) {
  return {
    message: `Alert: ${employeeName || 'Employee'} was marked ABSENT for ${date || 'today'}. — UAI Attendance`,
    params: [employeeName || 'Employee', date || 'today'],
  };
}
