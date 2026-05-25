// config/cronJobs.js

import PunchAutomationcron from '../controllers/attandance/cron/punchAutomationCron.js';
/**
 * Initialize all cron jobs
 * Call this in your main app.js or server.js file
 */
export const initializeCronJobs = () => {
  console.log("🔄 Initializing Cron Jobs...");

  // Initialize Punch Automation Cron
  PunchAutomationCron.initializeCron();

  // Add more cron jobs here as needed
  // Example: EmployeeLeaveProcessingCron.initializeCron();

  console.log("✅ All Cron Jobs Initialized Successfully");
};

export default { initializeCronJobs };