// config/cronJobs.js

import LeaveMonthlyAccrualCron from '../controllers/attandance/crons/leaveMonthlyAccrual.cron.js';
import LeaveYearlyAllocationCron from '../controllers/attandance/crons/leaveYearlyAllocation.cron.js';
import LeaveEarnedAccrualCron from '../controllers/attandance/crons/leaveEarnedAccrual.cron.js';

/**
 * Initialize all cron jobs.
 * NOTE: Punch automation is already scheduled from cron/markpunchout.cron.js,
 * so it is intentionally not scheduled here to avoid duplicates.
 */
export const initializeCronJobs = () => {
  console.log("🔄 Initializing Cron Jobs...");

  // Initialize Leave Cron Jobs
  LeaveMonthlyAccrualCron.initializeCron();
  LeaveYearlyAllocationCron.initializeCron();
  LeaveEarnedAccrualCron.initializeCron();

  console.log("✅ All Cron Jobs Initialized Successfully");
};

export default { initializeCronJobs };
