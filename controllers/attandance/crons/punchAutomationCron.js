// services/cronJobs/punchAutomationCron.js

import cron from "node-cron";
import mongoose from "mongoose";
import Attendance from "../../../models/Attandance/Attendance.js"
import Shift from '../../../models/Attandance/Shift.js';
import Employee from '../../../models/Attandance/Employee.js';
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
 * 4. If fixed: Auto punch-out after shift end time
 * 5. Only mark punch-out for users who manually punched-in
 * 6. Mark status as "present" and add to punchHistory
 */

class PunchAutomationCron {
    /**
     * Initialize cron job
     */
    static initializeCron() {
        // Run every 5 minutes
        cron.schedule("*/5 * * * *", async () => {
            console.log(`[PUNCH CRON] Execution started at ${new Date().toISOString()}`);

            try {
                await this.processPunchOutAutomation();
            } catch (error) {
                console.error("[PUNCH CRON] Error:", error);
                logCronExecution("PunchAutomation", "FAILED", error.message);
            }
        });

        console.log("✅ Punch Automation Cron Initialized");
    }

    /**
     * Main processing logic
     */
    static async processPunchOutAutomation() {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Step 1: Find all active punch-ins for today
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const activePunchIns = await Attendance.find({
                date: {
                    $gte: today,
                    $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                },
                punchIn: { $ne: null },
                punchOut: null, // No punch-out yet
                status: "present"
            })
                .populate("employeeId")
                .populate("companyId")
                .session(session);

            console.log(
                `[PUNCH CRON] Found ${activePunchIns.length} active punch-ins to process`
            );

            // Step 2: Process each punch-in
            for (const attendance of activePunchIns) {
                await this.evaluateAndMarkPunchOut(attendance, session);
            }

            await session.commitTransaction();

            logCronExecution(
                "PunchAutomation",
                "SUCCESS",
                `Processed ${activePunchIns.length} punch-ins`
            );
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Evaluate and mark punch-out based on shift type
     */
    static async evaluateAndMarkPunchOut(attendance, session) {
        try {
            const employee = attendance.employeeId;
            const punchInTime = new Date(attendance.punchIn);
            const currentTime = new Date();

            // Get employee's shift
            const shift = await Shift.findById(employee.shift).session(session);

            if (!shift) {
                console.warn(
                    `[PUNCH CRON] No shift found for employee ${employee._id}`
                );
                return;
            }

            let shouldPunchOut = false;
            let punchOutTime = null;
            let reason = "";

            // ==========================================
            // FLEXIBLE SHIFT: Auto punch-out after 12 hrs
            // ==========================================
            if (shift.isFlexible()) {
                const twelveHoursLater = new Date(
                    punchInTime.getTime() + 13 * 60 * 60 * 1000
                );

                if (currentTime >= twelveHoursLater) {
                    shouldPunchOut = true;
                    punchOutTime = twelveHoursLater;
                    reason = "Auto punch-out: 12 hours completed (flexible shift)";
                }
            }
            // ==========================================
            // FIXED SHIFT: Auto punch-out after shift end
            // ==========================================
            else {
                const [shiftEndHour, shiftEndMin] = shift.endTime.split(":").map(Number);

                let shiftEndDateTime = new Date(attendance.date);
                shiftEndDateTime.setHours(shiftEndHour, shiftEndMin, 0, 0);

                // Add grace period for early exit
                const gracePeriodMs = (shift.gracePeriod?.earlyExit || 10) * 60 * 1000;
                const effectiveShiftEnd = new Date(shiftEndDateTime.getTime() + gracePeriodMs);

                if (currentTime >= effectiveShiftEnd) {
                    shouldPunchOut = true;
                    punchOutTime = effectiveShiftEnd;
                    reason = `Auto punch-out: Shift ended at ${shift.endTime} (fixed shift)`;
                }
            }

            // ==========================================
            // Execute punch-out if conditions met
            // ==========================================
            if (shouldPunchOut && punchOutTime) {
                await this.executePunchOut(attendance, punchOutTime, reason, session);
            }
        } catch (error) {
            console.error(
                `[PUNCH CRON] Error processing punch for attendance ${attendance._id}:`,
                error
            );
        }
    }

    /**
     * Execute punch-out and update attendance record
     */
    static async executePunchOut(attendance, punchOutTime, reason, session) {
        try {
            const punchInTime = new Date(attendance.punchIn);
            const employee = attendance.employeeId;
            const shift = await Shift.findById(employee.shift).session(session);

            // ==========================================
            // CALCULATE WORK DURATION
            // ==========================================
            const totalWorkMinutes = Math.round(
                (punchOutTime.getTime() - punchInTime.getTime()) / (1000 * 60)
            );

            const workHours = Math.floor(totalWorkMinutes / 60);
            const workMins = totalWorkMinutes % 60;
            const totalWorkingHours = parseFloat(
                (totalWorkMinutes / 60).toFixed(2)
            );

            // ==========================================
            // CALCULATE BREAKS (if any)
            // ==========================================
            const totalBreakMinutes = (attendance.breaks || []).reduce(
                (sum, brk) => sum + (brk.durationMinutes || 0),
                0
            );

            // ==========================================
            // CALCULATE PAYABLE MINUTES
            // ==========================================
            const shiftMinutes = shift.shiftMinutes || 480; // Default 8 hours
            let payableMinutes = totalWorkMinutes - totalBreakMinutes;
            let overtimeMinutes = 0;

            if (payableMinutes > shiftMinutes) {
                overtimeMinutes = payableMinutes - shiftMinutes;
                if (!shift.overtime?.allowed) {
                    payableMinutes = shiftMinutes; // Cap at shift duration
                }
            }

            // ==========================================
            // UPDATE ATTENDANCE RECORD
            // ==========================================
            const updatedAttendance = await Attendance.findByIdAndUpdate(
                attendance._id,
                {
                    punchOut: punchOutTime,
                    lastPunchAt: punchOutTime,
                    status: "present",
                    totalWorkingHours,
                    workSummary: {
                        totalMinutes: totalWorkMinutes,
                        payableMinutes,
                        overtimeMinutes,
                        lateMinutes: attendance.workSummary?.lateMinutes || 0,
                        earlyLeaveMinutes: 0
                    },
                    $push: {
                        punchHistory: {
                            type: "out",
                            time: punchOutTime,
                            source: "system_auto",
                            createdAt: new Date()
                        }
                    },
                    remarks: reason
                },
                { session, new: true }
            );

            console.log(
                `✅ [PUNCH CRON] Punch-out marked for employee ${employee._id}`
            );
            console.log(
                `   Total Work: ${workHours}h ${workMins}m | Payable: ${payableMinutes}m | OT: ${overtimeMinutes}m`
            );

            return updatedAttendance;
        } catch (error) {
            console.error("[PUNCH CRON] Error executing punch-out:", error);
            throw error;
        }
    }

    /**
     * Manual trigger for testing
     */
    static async triggerNow() {
        console.log("[PUNCH CRON] Manual trigger initiated");
        try {
            await this.processPunchOutAutomation();
            return { success: true, message: "Cron executed successfully" };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
}

export default PunchAutomationCron;