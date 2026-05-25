// cron/markpunchout.cron.js

import cron from "node-cron";
import PunchAutomationCron from "../controllers/attandance/crons/punchAutomationCron.js";

cron.schedule("*/5 * * * *", async () => {
    console.log("Running Mark PunchOut Cron Every 5 Minutes");

    try {
        await PunchAutomationCron.processPunchOutAutomation();
    } catch (error) {
        console.error("Mark PunchOut Cron Error:", error);
    }
});