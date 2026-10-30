import cron from "node-cron";
import Employee from "../../../models/Attandance/Employee.js";
import { runYearlyAllocation } from "../../../services/leave/leaveAccrual.service.js";
import { logCronExecution } from "../../../config/cronLogger.js";

const processYearlyAllocation = async () => {
    const year = new Date().getFullYear();

    const employees = await Employee.find({
        employmentStatus: "active",
        "leavePolicy.policyId": { $exists: true, $ne: null },
    }).select("_id").lean();

    let allocated = 0;
    for (const employee of employees) {
        try {
            const result = await runYearlyAllocation(employee._id, year);
            allocated += result.allocated || 0;
        } catch (error) {
            logCronExecution("leaveYearlyAllocationCron", "FAILED", `Employee ${employee._id}: ${error.message}`);
        }
    }

    return allocated;
};

export const initializeCron = () => {
    // Runs daily; the service is idempotent and allocates once per financial year
    cron.schedule("0 1 * * *", async () => {
        logCronExecution("leaveYearlyAllocationCron", "STARTED", new Date().toISOString());
        try {
            const allocated = await processYearlyAllocation();
            logCronExecution("leaveYearlyAllocationCron", "SUCCESS", `Allocated ${allocated} day(s)`);
        } catch (error) {
            logCronExecution("leaveYearlyAllocationCron", "FAILED", error.message);
        }
    });

    console.log("🗓️ Leave Yearly Allocation Cron initialized");
};

export { processYearlyAllocation };
export default { initializeCron, processYearlyAllocation };
