// helpers/attendanceHelper.js

import logger from "../../utils/logger";

export const normalizeDate = (date) => {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
};

export const diffMinutes = (start, end) =>
    Math.max(0, Math.floor((end - start) / (1000 * 60)));

export const createDateTime = (dateStr, timeStr) => {
    const [h, m] = timeStr.split(":").map(Number);
    const d = new Date(dateStr);
    d.setHours(h, m, 0, 0);
    return d;
};

export const validatePunch = (punchIn, punchOut) => {
    if (punchIn && punchOut) {
        if (new Date(punchOut) <= new Date(punchIn)) {
            throw new Error("INVALID_PUNCH");
        }
    }
};

export const checkJoiningDate = (employee, attendanceDate) => {
    if (employee.jobInfo?.joiningDate) {
        const joining = normalizeDate(employee.jobInfo.joiningDate);
        if (attendanceDate < joining) {
            throw new Error("BEFORE_JOINING_DATE");
        }
    }
};

export const checkWeeklyOff = (employee, shift, attendanceDate) => {
    const day = attendanceDate.toLocaleDateString("en-US", { weekday: "long" });

    const weeklyOff = employee.weeklyOff?.length
        ? employee.weeklyOff
        : shift.weeklyOff;

    if (weeklyOff.includes(day)) {
        throw new Error("WEEKLY_OFF");
    }
};

export const buildShiftWindow = (shift, dateStr) => {
    const start = createDateTime(dateStr, shift.startTime);
    let end = createDateTime(dateStr, shift.endTime);

    if (shift.isNightShift && end <= start) {
        end.setDate(end.getDate() + 1);
    }

    const early = shift.gracePeriod?.earlyEntry || 30;
    const late = shift.gracePeriod?.lateEntry || 10;
    const absentAfter = shift.gracePeriod?.afterAbsentMark || 30;

    return {
        shiftStart: start,
        shiftEnd: end,
        allowedStart: new Date(start.getTime() - early * 60000),
        allowedEnd: new Date(start.getTime() + late * 60000),
        absentThreshold: new Date(start.getTime() + absentAfter * 60000),
        lateGrace: late
    };
};

export const validateShiftWindow = (currentTime, window) => {
    if (currentTime < window.allowedStart) {
    logger.warn(`Punch attempt too early: ${currentTime} < ${window.allowedStart}`);
        throw new Error("TOO_EARLY");
    }

    if (currentTime >= window.absentThreshold) {
        return "absent";
    }

    return "present";
};

export const calculateWork = (inTime, outTime, breaks = []) => {
    if (!inTime || !outTime || outTime <= inTime) return 0;

    let total = diffMinutes(inTime, outTime);

    for (const b of breaks || []) {
        if (b.start && b.end) {
            total -= diffMinutes(new Date(b.start), new Date(b.end));
        }
    }

    return Math.max(0, total);
};

export const calculateLate = (inTime, shiftStart, lateGrace) => {
    if (inTime <= shiftStart) return 0;

    const delay = diffMinutes(shiftStart, inTime);
    return delay > lateGrace ? delay - lateGrace : 0;
};