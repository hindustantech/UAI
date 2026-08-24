import Attendance from "../../models/Attandance/Attendance.js";
import dayjs from "dayjs";
import cron from "node-cron";
// jobs/autoCloseAttendance.js


export const autoCloseAttendance = async () => {
    try {
        const now = dayjs();
        const startOfToday = now.startOf("day");

        console.log("Running Attendance Auto-Close Job:", new Date());

        const openAttendances = await Attendance.find({
            punchIn: { $exists: true },
            punchOut: null,
            date: { $lt: startOfToday.toDate() }
        });

        if (!openAttendances.length) {
            console.log("No open attendance found.");
            return;
        }

        const bulkOps = openAttendances.map(att => {

            const autoPunchOutTime = dayjs(att.date)
                .endOf("day")
                .add(2, "minute")
                .toDate();

            // RULE: Auto punch-out (midnight) results in zero working hours
            return {
                updateOne: {
                    filter: { _id: att._id },
                    update: {
                        $set: {
                            punchOut: autoPunchOutTime,
                            lastPunchAt: autoPunchOutTime,
                            isAutoMarked: true,
                            totalWorkingHours: 0,
                            "workSummary.totalMinutes": 0,
                            "workSummary.payableMinutes": 0,
                            "workSummary.overtimeMinutes": 0,
                            remarks: "System Auto Punch-Out at 00:02 AM — Working hours counted as 0 per auto-punch-out policy"
                        },
                        $push: {
                            punchHistory: {
                                punchOut: autoPunchOutTime,
                                source: "system",
                                deviceInfo: { system: true },
                                geoLocation: { system: true }
                            },
                            editLogs: {
                                reason: "AUTO_PUNCH_OUT_MIDNIGHT_POLICY",
                                oldValue: { punchOut: null },
                                newValue: { punchOut: autoPunchOutTime }
                            }
                        }
                    }
                }
            };
        });

        await Attendance.bulkWrite(bulkOps);

        console.log(`Auto-closed ${bulkOps.length} attendance records`);
    } catch (error) {
        console.error("Auto Close Attendance Error:", error);
    }
};


/**
 * Runs daily at 00:02 AM
 * Format: second minute hour day month dayOfWeek
 */
export const startAttendanceCron = () => {

    let isRunning = false;

    cron.schedule("0 2 0 * * *", async () => {
        // cron.schedule("* * * * *", async () => {
        if (isRunning) return;
        isRunning = true;

        try {
            await autoCloseAttendance();
        } catch (err) {
            console.error("Cron Error:", err);
        } finally {
            isRunning = false;
        }
    }, {
        timezone: "Asia/Kolkata"
    });

};