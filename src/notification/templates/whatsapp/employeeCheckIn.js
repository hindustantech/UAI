export function employeeCheckInWhatsApp({ employeeName, time, type }) {
  const label = type === 'check_out' ? 'checked out' : 'checked in';
  return {
    message: `${employeeName || 'Employee'} has ${label} at ${time || 'N/A'}. — UAI Attendance`,
    params: [employeeName || 'Employee', label, time || 'N/A'],
  };
}
