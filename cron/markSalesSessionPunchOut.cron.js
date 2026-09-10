// cron/markSalesSessionPunchOut.cron.js

import SalesSessionAutoPunchOutCron from "../controllers/attandance/crons/salesSessionAutoPunchOutCron.js";
import { logCronExecution } from "../config/cronLogger.js";

SalesSessionAutoPunchOutCron.initializeCron();
