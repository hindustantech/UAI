import Attendance from "../models/Attandance/Attendance.js";
import cron from "node-cron";

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

        console.log(`Fixed ${result.modifiedCount} invalid punch records`);
    } catch (error) {
        console.error("FixInvalidPunch Error:", error);
    }
};



// Run every hour (you can adjust)
cron.schedule("* * * * *", async () => {
    console.log("Running punch fix cron...");
    await fixInvalidPunch();
});