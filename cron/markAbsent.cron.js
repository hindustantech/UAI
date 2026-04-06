// crons/markAbsent.cron.js
import cron from "node-cron";
import Employee from "../models/Attandance/Employee.js";
import Attendance from "../models/Attandance/Attendance.js";




cron.schedule("0 0,4,8,12,16,20 * * *", async () => {
    console.log("🕐 [CRON] markAbsentCron started:", new Date().toISOString());

    try {
        const now = new Date();
        const dayName = now.toLocaleDateString("en-US", { weekday: "long" });

        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        const employees = await Employee.find({ employmentStatus: "active" }).populate("shift");

        let markedCount = 0;

        for (const emp of employees) {
            try {
                const shift = emp.shift;

                // ─── 1. No shift → fallback mark absent after 20:00 ─────────
                if (!shift) {
                    console.warn(`⚠️  No shift for employee ${emp._id}, checking 20:00 fallback.`);

                    const fallbackTime = new Date(
                        now.getFullYear(), now.getMonth(), now.getDate(),
                        20, 0, 0
                    );

                    if (now < fallbackTime) {
                        console.log(`⏳ Before 20:00, skipping no-shift emp ${emp._id}`);
                        continue;
                    }

                    const existing = await Attendance.findOne({
                        companyId: emp.companyId,
                        employeeId: emp._id,
                        date: { $gte: startOfDay, $lte: endOfDay }
                    });

                    if (existing) continue;

                    await Attendance.create({
                        companyId: emp.companyId,
                        employeeId: emp._id,
                        userId: emp.userId,
                        date: startOfDay,
                        status: "absent",
                        shiftId: null,
                        isAutoMarked: true,
                        remarks: "Auto-marked absent. No shift assigned, fallback 20:00"
                    });

                    markedCount++;
                    console.log(`✅ Marked absent (no shift fallback): emp ${emp._id}`);
                    continue;
                }

                // ─── 2. Skip if today is a weekly off ───────────────────────
                const weeklyOffs = emp.weeklyOff?.length
                    ? emp.weeklyOff
                    : shift.weeklyOff || [];

                if (weeklyOffs.includes(dayName)) {
                    await Attendance.findOneAndUpdate(
                        {
                            companyId: emp.companyId,
                            employeeId: emp._id,
                            date: { $gte: startOfDay, $lte: endOfDay }
                        },
                        {
                            $setOnInsert: {
                                companyId: emp.companyId,
                                employeeId: emp._id,
                                userId: emp.userId,
                                date: startOfDay,
                                status: "weekly_off",
                                shiftId: shift._id,
                                isAutoMarked: true,
                                remarks: "Auto-marked weekly off"
                            }
                        },
                        { upsert: true, new: true }
                    );
                    continue;
                }

                // ─── 3. Check if shift end time has passed ──────────────────
                const [endHour, endMin] = shift.endTime.split(":").map(Number);

                let shiftEndDateTime = new Date(
                    now.getFullYear(), now.getMonth(), now.getDate(),
                    endHour, endMin, 0
                );

                if (shift.isNightShift) {
                    const [startHour, startMin] = shift.startTime.split(":").map(Number);
                    if (endHour < startHour || (endHour === startHour && endMin < startMin)) {
                        shiftEndDateTime.setDate(shiftEndDateTime.getDate() + 1);
                    }
                }

                const gracePeriodMinutes = shift.gracePeriod?.earlyExit || 0;
                shiftEndDateTime = new Date(shiftEndDateTime.getTime() + gracePeriodMinutes * 60 * 1000);

                if (now < shiftEndDateTime) {
                    console.log(`⏳ Shift not ended yet for emp ${emp._id} (ends ${shift.endTime}), skipping.`);
                    continue;
                }

                // ─── 4. Skip if attendance already exists ───────────────────
                const existing = await Attendance.findOne({
                    companyId: emp.companyId,
                    employeeId: emp._id,
                    date: { $gte: startOfDay, $lte: endOfDay }
                });

                if (existing) continue;

                // ─── 5. Mark as absent ──────────────────────────────────────
                await Attendance.create({
                    companyId: emp.companyId,
                    employeeId: emp._id,
                    userId: emp.userId,
                    date: startOfDay,
                    status: "absent",
                    shiftId: shift._id,
                    isAutoMarked: true,
                    remarks: `Auto-marked absent. Shift ${shift.shiftCode} ended at ${shift.endTime}`
                });

                markedCount++;
                console.log(`✅ Marked absent: emp ${emp._id} | shift ${shift.shiftCode} ended at ${shift.endTime}`);

            } catch (empErr) {
                console.error(`❌ Error processing employee ${emp._id}:`, empErr.message);
            }
        }

        console.log(`✅ [CRON] Done. Total marked absent: ${markedCount}`);

    } catch (err) {
        console.error("❌ [CRON] markAbsentCron failed:", err);
    }
});