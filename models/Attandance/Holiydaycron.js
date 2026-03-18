// jobs/attendanceHolidayCron.js

import cron from "node-cron";
import moment from "moment";
import Holiday from "./Holiday.js";
import Employee from "./Employee.js";
import Attendance from "./Attendance.js";

/**
 * ENTERPRISE CRON:
 * - No wrapper (runs on import)
 * - BulkWrite (high performance)
 * - Idempotent (safe re-run)
 * - Multi-tenant support
 */

// Run daily at 12:05 AM
cron.schedule("5 0 * * *", async () => {
  console.log("🟡 Holiday Auto Mark Cron Started");

  try {
    const todayStart = moment().startOf("day").toDate();
    const todayEnd = moment().endOf("day").toDate();

    // 1. Fetch today's holidays
    const holidays = await Holiday.find({
      date: { $gte: todayStart, $lte: todayEnd }
    }).lean();

    if (!holidays.length) {
      console.log("⚪ No holidays today");
      return;
    }

    // 2. Process each company holiday
    for (const holiday of holidays) {
      const { companyId, applicableTo, isPaid } = holiday;

      // Employee filter
      let employeeFilter = {
        companyId,
        employmentStatus: "active"
      };

      if (applicableTo?.departments?.length) {
        employeeFilter["jobInfo.department"] = {
          $in: applicableTo.departments
        };
      }

      if (applicableTo?.roles?.length) {
        employeeFilter["role"] = {
          $in: applicableTo.roles
        };
      }

      // 3. Fetch employees (lean for performance)
      const employees = await Employee.find(employeeFilter)
        .select("_id")
        .lean();

      if (!employees.length) continue;

      console.log(`🏢 Company ${companyId} → ${employees.length} employees`);

      // 4. Bulk operation (UPSERT → no duplicates)
      const bulkOps = employees.map((emp) => ({
        updateOne: {
          filter: {
            companyId,
            employeeId: emp._id,
            date: todayStart
          },
          update: {
            $setOnInsert: {
              companyId,
              employeeId: emp._id,
              date: todayStart,

              shift: {
                name: "Holiday",
                startTime: "00:00",
                endTime: "00:00",
                shiftMinutes: 0
              },

              status: "holiday",
              isAutoMarked: true,

              workSummary: {
                totalMinutes: 0,
                payableMinutes: isPaid ? 480 : 0,
                overtimeMinutes: 0,
                lateMinutes: 0,
                earlyLeaveMinutes: 0
              }
            }
          },
          upsert: true
        }
      }));

      // 5. Execute bulk write
      await Attendance.bulkWrite(bulkOps, { ordered: false });
    }

    console.log("🟢 Holiday Auto Mark Completed");

  } catch (error) {
    console.error("🔴 Holiday Cron Error:", error);
  }
});