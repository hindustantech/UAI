import cron from "node-cron";
import Employee from "../../../models/Attandance/Employee.js";
import { runEarnedAccrual } from "../../../services/leave/leaveAccrual.service.js";
import { logCronExecution } from "../../../config/cronLogger.js";

const processEarnedAccrual = async () => {
    const year = new Date().getFullYear();

    const employees = await Employee.find({
        employmentStatus: "active",
        "leavePolicy.policyId": { $exists: true, $ne: null },
    }).select("_id").lean();

    let credited = 0;
    for (const employee of employees) {
        try {
            const result = await runEarnedAccrual(employee._id, year);
            credited += result.credited || 0;
        } catch (error) {
            logCronExecution("leaveEarnedAccrualCron", "FAILED", `Employee ${employee._id}: ${error.message}`);
        }
    }

    return credited;
};

export const initializeCron = () => {
    // Runs daily to credit earned leave from qualifying attendance
    cron.schedule("0 2 * * *", async () => {
        logCronExecution("leaveEarnedAccrualCron", "STARTED", new Date().toISOString());
        try {
            const credited = await processEarnedAccrual();
            logCronExecution("leaveEarnedAccrualCron", "SUCCESS", `Credited ${credited} day(s)`);
        } catch (error) {
            logCronExecution("leaveEarnedAccrualCron", "FAILED", error.message);
        }
    });

    console.log("🍃 Leave Earned Accrual Cron initialized");
};

export { processEarnedAccrual };
export default { initializeCron, processEarnedAccrual };
