import Attendance from "../models/Attandance/Attendance.js";
import cron from "node-cron";
import { logCronExecution } from "../config/cronLogger.js";

export const fixInvalidPunch = async () => {
    try {
        const result = await Attendance.updateMany(
            {
                punchIn: null,
                punchOut: { $ne: null } // punchOut exists
            },
            {
                $set: {
                    punchOut: null
                }
            }
        );

        logCronExecution("fixInvalidPunch", "SUCCESS", `Fixed ${result.modifiedCount} invalid punch records`);
    } catch (error) {
        logCronExecution("fixInvalidPunch", "FAILED", error.message);
    }
};



// Run every hour (you can adjust)
cron.schedule("* * * * *", async () => {
    logCronExecution("fixInvalidPunch", "STARTED", new Date().toISOString());
    await fixInvalidPunch();
});