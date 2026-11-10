// controllers/attandance/autoPunchOutStatus.js

const WEEKDAY_OPTIONS = { weekday: "long" };

/**
 * Resolve the status an auto punch-out should write for an attendance day.
 *
 * Weekly off is read from the employee first, then the shift — the same
 * precedence used by checkWeeklyOff and cron/markAbsent.cron.js.
 *
 * @param {object|null} employee Employee document (needs weeklyOff)
 * @param {object|null} shift    Shift document (needs weeklyOff)
 * @param {Date|string} attendanceDate Day the punch-in belongs to
 * @returns {"weekly_off"|"absent"}
 */
export const resolveAutoPunchOutStatus = (employee, shift, attendanceDate) => {
    if (!attendanceDate) return "absent";

    const day = new Date(attendanceDate).toLocaleDateString(
        "en-US",
        WEEKDAY_OPTIONS
    );

    const weeklyOff = employee?.weeklyOff?.length
        ? employee.weeklyOff
        : (shift?.weeklyOff?.length ? shift.weeklyOff : []);

    return Array.isArray(weeklyOff) && weeklyOff.includes(day)
        ? "weekly_off"
        : "absent";
};

/**
 * Build the standard auto punch-out remark for a resolved status.
 *
 * @param {"weekly_off"|"absent"} status
 * @param {string} [reason] Prefix describing why the punch-out happened
 * @returns {string}
 */
export const buildAutoPunchOutRemarks = (status, reason) => {
    const prefix = reason ? `${reason} — ` : "";

    if (status === "weekly_off") {
        return `${prefix}Marked weekly_off (weekly off day); working hours counted as 0 per auto-punch-out policy`;
    }

    return `${prefix}Marked absent; working hours counted as 0 per auto-punch-out policy`;
};
