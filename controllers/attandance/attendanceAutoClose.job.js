import Attendance from "../../models/Attandance/Attendance.js";
import dayjs from "dayjs";
import cron from "node-cron";
import { logCronExecution } from "../../config/cronLogger.js";
import { resolveAutoPunchOutStatus, buildAutoPunchOutRemarks } from "./autoPunchOutStatus.js";
// jobs/autoCloseAttendance.js


export const autoCloseAttendance = async () => {
    logCronExecution("attendanceAutoClose", "STARTED", new Date().toISOString());

    try {
        const now = dayjs();
        const startOfToday = now.startOf("day");

        console.log("Running Attendance Auto-Close Job:", new Date());

        const openAttendances = await Attendance.find({
            punchIn: { $exists: true },
            punchOut: null,
            date: { $lt: startOfToday.toDate() }
        })
            .populate({
                path: "employeeId",
                select: "weeklyOff weeklyOffHalfDay shift",
                populate: { path: "shift", select: "weeklyOff weeklyOffHalfDay" }
            })
            .lean();

        if (!openAttendances.length) {
            console.log("No open attendance found.");
            logCronExecution("attendanceAutoClose", "SUCCESS", "No open attendance found.");
            return;
        }

        const bulkOps = openAttendances.map(att => {

            const autoPunchOutTime = dayjs(att.date)
                .endOf("day")
                .add(2, "minute")
                .toDate();

            const employee = att.employeeId;
            const shift = employee?.shift;
            const status = resolveAutoPunchOutStatus(employee, shift, att.date);

            // RULE: Auto punch-out (midnight) zeroes working hours. If the day
            // is the employee's weekly off it is marked weekly_off, else absent.
            return {
                updateOne: {
                    filter: { _id: att._id },
                    update: {
                        $set: {
                            punchOut: autoPunchOutTime,
                            lastPunchAt: autoPunchOutTime,
                            status,
                            isAutoMarked: true,
                            totalWorkingHours: 0,
                            "workSummary.totalMinutes": 0,
                            "workSummary.payableMinutes": 0,
                            "workSummary.overtimeMinutes": 0,
                            "workSummary.totalBreakMinutes": 0,
                            "workSummary.totalBreakExceededMinutes": 0,
                            remarks: buildAutoPunchOutRemarks(
                                status,
                                "System Auto Punch-Out at 00:02 AM"
                            )
                        },
                        $push: {
                            punchHistory: {
                                type: "out",
                                time: autoPunchOutTime,
                                source: "system_auto",
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
        logCronExecution("attendanceAutoClose", "SUCCESS", `Auto-closed ${bulkOps.length} attendance records`);
    } catch (error) {
        console.error("Auto Close Attendance Error:", error);
        logCronExecution("attendanceAutoClose", "FAILED", error.message);
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