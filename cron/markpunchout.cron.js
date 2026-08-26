// cron/markpunchout.cron.js

import cron from "node-cron";
import PunchAutomationCron from "../controllers/attandance/crons/punchAutomationCron.js";
import { logCronExecution } from "../config/cronLogger.js";

cron.schedule("*/5 * * * *", async () => {
    logCronExecution("markpunchoutCron", "STARTED", new Date().toISOString());

    try {
        await PunchAutomationCron.processPunchOutAutomation();
        logCronExecution("markpunchoutCron", "SUCCESS", "Punch out automation completed");
    } catch (error) {
        logCronExecution("markpunchoutCron", "FAILED", error.message);
    }
});