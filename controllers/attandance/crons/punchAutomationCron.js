// services/cronJobs/punchAutomationCron.js

import cron from "node-cron";
import mongoose from "mongoose";
import Attendance from "../../../models/Attandance/Attendance.js";
import Shift from "../../../models/Attandance/Shift.js";
import Employee from "../../../models/Attandance/Employee.js";
import { logCronExecution } from "../../../config/cronLogger.js";

/**
 * ============================================
 * PUNCH AUTOMATION CRON JOB
 * ============================================
 *
 * LOGIC:
 * 1. Find all employees with active punch-in (no punch-out)
 * 2. Check employee's shift type (flexible/fixed)
 * 3. If flexible: Auto punch-out after 12 hours of punch-in
 * 4. If fixed: Auto punch-out after shift end time + grace period
 * 5. Only mark punch-out for users who manually punched-in
 * 6. Mark status as "present" and add to punchHistory
 *
 * SAFETY:
 * - Lock guard prevents overlapping cron runs
 * - Employees processed in batches of 10 to avoid blocking the event loop
 * - Each employee is processed in its own transaction (failures are isolated)
 * - Missed executions are warned via node-cron built-in
 */

const BATCH_SIZE = 10; // Process N employees at a time

class PunchAutomationCron {
    // Prevents two cron runs from overlapping
    static #isRunning = false;

    // ============================================
    // INITIALIZE CRON
    // ============================================
    static initializeCron() {
        cron.schedule(
            "*/5 * * * *",
            () => {
                // setImmediate yields control back to the event loop
                // before starting heavy work, preventing cron thread blocking
                setImmediate(() => this.#runWithLock());
            },
            {
                scheduled: true,
                timezone: "Asia/Kolkata", // Set to your server timezone
            }
        );

        console.log("✅ Punch Automation Cron Initialized");
    }

    // ============================================
    // LOCK GUARD — prevents overlapping runs
    // ============================================
    static async #runWithLock() {
        if (this.#isRunning) {
            console.warn(
                "[PUNCH CRON] ⚠️  Previous run still in progress — skipping this cycle."
            );
            return;
        }

        this.#isRunning = true;
        const startTime = Date.now();
        console.log(
            `[PUNCH CRON] Execution started at ${new Date().toISOString()}`
        );

        try {
            await this.processPunchOutAutomation();
        } catch (error) {
            console.error("[PUNCH CRON] ❌ Fatal error during cron run:", error);
            logCronExecution("PunchAutomation", "FAILED", error.message);
        } finally {
            this.#isRunning = false;
            console.log(
                `[PUNCH CRON] Execution finished in ${Date.now() - startTime}ms`
            );
        }
    }

    // ============================================
    // MAIN PROCESSING LOGIC
    // ============================================
    static async processPunchOutAutomation() {
        // Fetch today's date range
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

        // Fetch active punch-ins WITHOUT a session (read-only, no need to block)
        const activePunchIns = await Attendance.find({
            date: { $gte: todayStart, $lt: todayEnd },
            punchIn: { $ne: null },
            punchOut: null,
        })
            .populate("employeeId")
            .populate("companyId")
            .lean(); // .lean() returns plain JS objects — faster, less memory

        console.log(
            `[PUNCH CRON] Found ${activePunchIns.length} active punch-ins to process`
        );

        if (activePunchIns.length === 0) return;

        let successCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        // Process in batches to avoid blocking the event loop
        for (let i = 0; i < activePunchIns.length; i += BATCH_SIZE) {
            const batch = activePunchIns.slice(i, i + BATCH_SIZE);

            // Process batch concurrently
            const results = await Promise.allSettled(
                batch.map((attendance) =>
                    this.#processOneEmployee(attendance)
                )
            );

            // Tally results
            for (const result of results) {
                if (result.status === "fulfilled") {
                    if (result.value === "punched_out") successCount++;
                    else if (result.value === "skipped") skippedCount++;
                } else {
                    failedCount++;
                    // Individual failures are already logged inside #processOneEmployee
                }
            }

            // Yield to event loop between batches — prevents blocking node-cron
            await new Promise((resolve) => setImmediate(resolve));
        }

        const summary = `Processed ${activePunchIns.length} punch-ins | ✅ PunchedOut: ${successCount} | ⏳ Skipped: ${skippedCount} | ❌ Failed: ${failedCount}`;
        console.log(`[PUNCH CRON] ${summary}`);
        logCronExecution("PunchAutomation", "SUCCESS", summary);
    }

    // ============================================
    // PROCESS ONE EMPLOYEE (own transaction)
    // ============================================
    static async #processOneEmployee(attendance) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const result = await this.#evaluateAndMarkPunchOut(
                attendance,
                session
            );
            await session.commitTransaction();
            return result; // "punched_out" | "skipped"
        } catch (error) {
            await session.abortTransaction();
            console.error(
                `[PUNCH CRON] ❌ Failed for attendance ${attendance._id} (emp ${attendance.employeeId?._id}):`,
                error.message
            );
            throw error; // Let Promise.allSettled capture it
        } finally {
            await session.endSession();
        }
    }

    // ============================================
    // EVALUATE WHETHER TO PUNCH OUT
    // ============================================
    static async #evaluateAndMarkPunchOut(attendance, session) {
        const employee = attendance.employeeId;

        if (!employee) {
            console.warn(
                `[PUNCH CRON] ⚠️  No employee populated for attendance ${attendance._id}, skipping.`
            );
            return "skipped";
        }

        // Fetch shift (within transaction session for consistency)
        const shift = await Shift.findById(employee.shift).session(session).lean();

        if (!shift) {
            console.warn(
                `[PUNCH CRON] ⚠️  No shift found for employee ${employee._id}, skipping.`
            );
            return "skipped";
        }

        const punchInTime = new Date(attendance.punchIn);
        const currentTime = new Date();

        let shouldPunchOut = false;
        let punchOutTime = null;
        let reason = "";

        // ==========================================
        // FLEXIBLE SHIFT — punch-out after 12 hrs
        // ==========================================
        if (shift.shiftType === "flexible" || shift.isFlexible?.()) {
            const twelveHoursLater = new Date(
                punchInTime.getTime() + 12 * 60 * 60 * 1000
            );

            if (currentTime >= twelveHoursLater) {
                shouldPunchOut = true;
                punchOutTime = twelveHoursLater;
                reason = "Auto punch-out: 12 hours completed (flexible shift)";
            } else {
                const remaining = Math.round(
                    (twelveHoursLater - currentTime) / 60000
                );
                console.log(
                    `⏳ Flexible shift: emp ${employee._id} — ${remaining} min remaining, skipping.`
                );
            }
        }
        // ==========================================
        // FIXED SHIFT — punch-out after shift end + grace
        // ==========================================
        else {
            const [shiftEndHour, shiftEndMin] = shift.endTime
                .split(":")
                .map(Number);

            const shiftEndDateTime = new Date(attendance.date);
            shiftEndDateTime.setHours(shiftEndHour, shiftEndMin, 0, 0);

            const gracePeriodMs =
                (shift.gracePeriod?.earlyExit || 10) * 60 * 1000;
            const effectiveShiftEnd = new Date(
                shiftEndDateTime.getTime() + gracePeriodMs
            );

            if (currentTime >= effectiveShiftEnd) {
                shouldPunchOut = true;
                punchOutTime = effectiveShiftEnd;
                reason = `Auto punch-out: Shift ended at ${shift.endTime} (fixed shift)`;
            } else {
                console.log(
                    `⏳ Shift not ended yet for emp ${employee._id} (ends ${shift.endTime}), skipping.`
                );
            }
        }

        // ==========================================
        // EXECUTE PUNCH-OUT IF CONDITIONS MET
        // ==========================================
        if (shouldPunchOut && punchOutTime) {
            await this.#executePunchOut(
                attendance,
                shift,
                punchOutTime,
                reason,
                session
            );
            return "punched_out";
        }

        return "skipped";
    }

    // ============================================
    // EXECUTE PUNCH-OUT & UPDATE ATTENDANCE
    // ============================================
    static async #executePunchOut(
        attendance,
        shift,
        punchOutTime,
        reason,
        session
    ) {
        const employee = attendance.employeeId;

        // RULE: Auto punch-out results in zero working hours
        const punchInTime = new Date(attendance.punchIn);
        const workDuration = Math.round(
            (punchOutTime.getTime() - punchInTime.getTime()) / (1000 * 60)
        );
        const workHours = Math.floor(workDuration / 60);
        const workMins = workDuration % 60;

        // ---- Persist to DB — working hours zeroed, status stays present ----
        await Attendance.findByIdAndUpdate(
            attendance._id,
            {
                punchOut: punchOutTime,
                lastPunchAt: punchOutTime,
                status: "present",
                isAutoMarked: true,
                totalWorkingHours: 0,
                workSummary: {
                    totalMinutes: 0,
                    payableMinutes: 0,
                    overtimeMinutes: 0,
                    lateMinutes: attendance.workSummary?.lateMinutes || 0,
                    earlyLeaveMinutes: 0,
                },
                $push: {
                    punchHistory: {
                        type: "out",
                        time: punchOutTime,
                        source: "system_auto",
                        createdAt: new Date(),
                    },
                },
                remarks: `${reason} — Working hours counted as 0 per auto-punch-out policy`,
            },
            { session, new: true }
        );

        console.log(
            `✅ [PUNCH CRON] Punch-out marked for emp ${employee._id} | Auto-punched at ${workHours}h ${workMins}m elapsed | Working hours set to 0`
        );
    }

    // ============================================
    // MANUAL TRIGGER (for testing/admin use)
    // ============================================
    static async triggerNow() {
        console.log("[PUNCH CRON] 🔧 Manual trigger initiated");
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

export default PunchAutomationCron;