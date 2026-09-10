// controllers/attandance/crons/salesSessionAutoPunchOutCron.js

import cron from "node-cron";
import mongoose from "mongoose";
import { SalesSession } from "../../../models/Attandance/Salses/Salses.js";
import Attendance from "../../../models/Attandance/Attendance.js";
import { logCronExecution } from "../../../config/cronLogger.js";

/**
 * ============================================
 * SALES SESSION AUTO PUNCH-OUT CRON JOB
 * ============================================
 *
 * LOGIC:
 * 1. Find all SalesSessions with status "in_progress" and no punch-out
 * 2. If punchInTime is older than 12 hours, auto-close the session
 * 3. Close all open visitLogs (punchIn without punchOut)
 * 4. Set punchOutTime = punchInTime + 12 hours (capped at 12hrs)
 * 5. Set punchOutLocation = punchInLocation (no GPS at auto-time)
 * 6. Duration = 43200 seconds (12 hours)
 * 7. Update corresponding Attendance record
 *
 * SAFETY:
 * - Lock guard prevents overlapping cron runs
 * - Sessions processed in batches of 10
 * - Each session processed in its own transaction
 * - formCompleted stays false (user didn't complete form)
 */

const BATCH_SIZE = 10;
const AUTO_PUNCH_OUT_HOURS = 12;
const AUTO_PUNCH_OUT_MS = AUTO_PUNCH_OUT_HOURS * 60 * 60 * 1000;

class SalesSessionAutoPunchOutCron {
    static #isRunning = false;

    // ============================================
    // INITIALIZE CRON
    // ============================================
    static initializeCron() {
        cron.schedule(
            "*/5 * * * *",
            () => {
                setImmediate(() => this.#runWithLock());
            },
            {
                scheduled: true,
                timezone: "Asia/Kolkata",
            }
        );

        console.log("✅ Sales Session Auto Punch-Out Cron Initialized");
    }

    // ============================================
    // LOCK GUARD
    // ============================================
    static async #runWithLock() {
        if (this.#isRunning) {
            console.warn(
                "[SALES SESSION CRON] Previous run still in progress, skipping."
            );
            return;
        }

        this.#isRunning = true;
        const startTime = Date.now();
        console.log(
            `[SALES SESSION CRON] Execution started at ${new Date().toISOString()}`
        );

        try {
            await this.processAutoPunchOut();
        } catch (error) {
            console.error(
                "[SALES SESSION CRON] Fatal error:",
                error
            );
            logCronExecution(
                "SalesSessionAutoPunchOut",
                "FAILED",
                error.message
            );
        } finally {
            this.#isRunning = false;
            console.log(
                `[SALES SESSION CRON] Execution finished in ${Date.now() - startTime}ms`
            );
        }
    }

    // ============================================
    // MAIN PROCESSING LOGIC
    // ============================================
    static async processAutoPunchOut() {
        const twelveHoursAgo = new Date(Date.now() - AUTO_PUNCH_OUT_MS);

        // Find all stuck in_progress sessions
        const stuckSessions = await SalesSession.find({
            status: "in_progress",
            punchInTime: { $ne: null, $lt: twelveHoursAgo },
            punchOutTime: null,
        })
            .populate("employeeId", "name email")
            .populate("companyId", "companyName")
            .lean();

        console.log(
            `[SALES SESSION CRON] Found ${stuckSessions.length} stuck sessions to process`
        );

        if (stuckSessions.length === 0) return;

        let successCount = 0;
        let failedCount = 0;

        // Process in batches
        for (let i = 0; i < stuckSessions.length; i += BATCH_SIZE) {
            const batch = stuckSessions.slice(i, i + BATCH_SIZE);

            const results = await Promise.allSettled(
                batch.map((session) => this.#processOneSession(session))
            );

            for (const result of results) {
                if (result.status === "fulfilled") {
                    successCount++;
                } else {
                    failedCount++;
                }
            }

            // Yield to event loop between batches
            await new Promise((resolve) => setImmediate(resolve));
        }

        const summary = `Processed ${stuckSessions.length} sessions | Closed: ${successCount} | Failed: ${failedCount}`;
        console.log(`[SALES SESSION CRON] ${summary}`);
        logCronExecution("SalesSessionAutoPunchOut", "SUCCESS", summary);
    }

    // ============================================
    // PROCESS ONE SESSION (own transaction)
    // ============================================
    static async #processOneSession(sessionDoc) {
        const dbSession = await mongoose.startSession();
        dbSession.startTransaction();

        try {
            await this.#executeAutoPunchOut(sessionDoc, dbSession);
            await dbSession.commitTransaction();

            console.log(
                `[SALES SESSION CRON] Closed session ${sessionDoc.sessionId} (employee: ${sessionDoc.employeeId?._id || "N/A"})`
            );
        } catch (error) {
            await dbSession.abortTransaction();
            console.error(
                `[SALES SESSION CRON] Failed to close session ${sessionDoc.sessionId}:`,
                error.message
            );
            throw error;
        } finally {
            await dbSession.endSession();
        }
    }

    // ============================================
    // EXECUTE AUTO PUNCH-OUT
    // ============================================
    static async #executeAutoPunchOut(sessionDoc, dbSession) {
        const punchInTime = new Date(sessionDoc.punchInTime);
        const autoPunchOutTime = new Date(
            punchInTime.getTime() + AUTO_PUNCH_OUT_MS
        );
        const punchOutLocation = sessionDoc.punchInLocation;

        // Duration = 12 hours in seconds
        const durationSeconds = 43200;

        // Find ALL open visitLogs (punchIn without punchOut)
        const openVisitLogIndexes = sessionDoc.visitLogs
            .map((log, index) => ({ log, index }))
            .filter(({ log }) => log.punchInTime && !log.punchOutTime);

        // Build $set for each open visitLog
        const setFields = {
            status: "completed",
            punchOutTime: autoPunchOutTime,
            punchOutLocation: punchOutLocation,
            duration: durationSeconds,
            lastPunchAt: autoPunchOutTime,
        };

        // Close all open visitLogs
        for (const { index } of openVisitLogIndexes) {
            setFields[`visitLogs.${index}.punchOutTime`] = autoPunchOutTime;
            setFields[`visitLogs.${index}.punchOutLocation`] = punchOutLocation;
        }

        await SalesSession.findOneAndUpdate(
            { _id: sessionDoc._id, status: "in_progress" },
            { $set: setFields },
            { session: dbSession, new: true }
        );

        // Update corresponding Attendance record if exists
        await this.#updateAttendance(sessionDoc, autoPunchOutTime, dbSession);
    }

    // ============================================
    // UPDATE ATTENDANCE RECORD
    // ============================================
    static async #updateAttendance(sessionDoc, autoPunchOutTime, dbSession) {
        try {
            const employeeId = sessionDoc.employeeId?._id || sessionDoc.employeeId;
            const companyId = sessionDoc.companyId?._id || sessionDoc.companyId;

            if (!employeeId || !companyId) {
                console.warn(
                    `[SALES SESSION CRON] No employee or company for session ${sessionDoc.sessionId}, skipping attendance update`
                );
                return;
            }

            // Find today's attendance record
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const attendance = await Attendance.findOne({
                companyId,
                employeeId,
                date: today,
            }).session(dbSession);

            if (!attendance) {
                console.warn(
                    `[SALES SESSION CRON] No attendance record for session ${sessionDoc.sessionId}`
                );
                return;
            }

            // Only update if attendance has no punch-out yet
            if (attendance.punchOut) {
                return;
            }

            const punchInTime = new Date(attendance.punchIn);
            const totalMinutes = Math.max(
                0,
                Math.floor((autoPunchOutTime - punchInTime) / 60000)
            );

            await Attendance.updateOne(
                { _id: attendance._id },
                {
                    $set: {
                        punchOut: autoPunchOutTime,
                        lastPunchAt: autoPunchOutTime,
                        status: "present",
                        totalWorkingHours: totalMinutes / 60,
                        isAutoMarked: true,
                    },
                    $push: {
                        punchHistory: {
                            type: "out",
                            time: autoPunchOutTime,
                            source: "system_auto",
                            createdAt: new Date(),
                        },
                    },
                },
                { session: dbSession }
            );
        } catch (error) {
            console.error(
                `[SALES SESSION CRON] Error updating attendance for session ${sessionDoc.sessionId}:`,
                error.message
            );
            // Don't throw - attendance update is secondary
        }
    }

    // ============================================
    // MANUAL TRIGGER (for testing/admin)
    // ============================================
    static async triggerNow() {
        console.log("[SALES SESSION CRON] Manual trigger initiated");
        if (this.#isRunning) {
            return {
                success: false,
                message: "Cron is already running. Try again shortly.",
            };
        }
        try {
            await this.#runWithLock();
            return { success: true, message: "Cron executed successfully" };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
}

export default SalesSessionAutoPunchOutCron;
