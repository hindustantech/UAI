import cron from "node-cron";
import Employee from "../../../models/Attandance/Employee.js";
import { runMonthlyCredit } from "../../../services/leave/leaveAccrual.service.js";
import { logCronExecution } from "../../../config/cronLogger.js";

const processMonthlyCredit = async () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const employees = await Employee.find({
        employmentStatus: "active",
        "leavePolicy.policyId": { $exists: true, $ne: null },
    }).select("_id").lean();

    let credited = 0;
    for (const employee of employees) {
        try {
            const result = await runMonthlyCredit(employee._id, year, month);
            credited += result.credited || 0;
        } catch (error) {
            logCronExecution("leaveMonthlyAccrualCron", "FAILED", `Employee ${employee._id}: ${error.message}`);
        }
    }

    return credited;
};

export const initializeCron = () => {
    // Monthly credit runs on the 1st of each month at 00:10
    cron.schedule("10 0 1 * *", async () => {
        logCronExecution("leaveMonthlyAccrualCron", "STARTED", new Date().toISOString());
        try {
            const credited = await processMonthlyCredit();
            logCronExecution("leaveMonthlyAccrualCron", "SUCCESS", `Credited ${credited} day(s)`);
        } catch (error) {
            logCronExecution("leaveMonthlyAccrualCron", "FAILED", error.message);
        }
    });

    console.log("📅 Leave Monthly Accrual Cron initialized");
};

export { processMonthlyCredit };
export default { initializeCron, processMonthlyCredit };
