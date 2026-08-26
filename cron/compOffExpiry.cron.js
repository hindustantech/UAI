// cron/compOffExpiry.cron.js
import cron from "node-cron";
import Employee from "../models/Attandance/Employee.js";
import SalaryRule from "../models/salaryRules.js";
import { logCronExecution } from "../config/cronLogger.js";

cron.schedule("0 2 * * *", async () => {
    logCronExecution("compOffExpiryCron", "STARTED", new Date().toISOString());

    try {
        const rules = await SalaryRule.find({
            "compOff.enabled": true,
            "compOff.expireAfterDays": { $gt: 0 }
        }).lean();

        if (!rules.length) {
            logCronExecution("compOffExpiryCron", "SUCCESS", "No company rules with expiry configured");
            return;
        }

        let companiesProcessed = 0;

        for (const rule of rules) {
            const companyId = rule.companyId;
            if (!companyId) continue;

            const cutoff = new Date(Date.now() - rule.compOff.expireAfterDays * 86400000);

            await Employee.updateMany(
                { companyId },
                [
                    {
                        $set: {
                            "compOff.credits": {
                                $filter: {
                                    input: { $ifNull: ["$compOff.credits", []] },
                                    as: "c",
                                    cond: { $gte: ["$$c.earnedAt", cutoff] }
                                }
                            }
                        }
                    },
                    {
                        $set: {
                            "compOff.balance": {
                                $sum: {
                                    $map: {
                                        input: { $ifNull: ["$compOff.credits", []] },
                                        as: "c",
                                        in: { $ifNull: ["$$c.days", 0] }
                                    }
                                }
                            }
                        }
                    }
                ]
            );

            companiesProcessed++;
        }

        logCronExecution("compOffExpiryCron", "SUCCESS", `Companies processed: ${companiesProcessed}`);
    } catch (err) {
        logCronExecution("compOffExpiryCron", "FAILED", err.message);
    }
});
