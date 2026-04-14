// helpers/attendanceHelper.js

import logger from "../../utils/logger.js";

/**
 * ========================================
 * DATE & TIME UTILITIES
 * ========================================
 */

export const normalizeDate = (date) => {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
};

export const diffMinutes = (start, end) => {
    if (!start || !end) return 0;
    return Math.max(0, Math.floor((end - start) / (1000 * 60)));
};

export const createDateTime = (dateStr, timeStr) => {
    if (!timeStr || !dateStr) return null;

    const [h, m] = timeStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) {
        throw new Error("INVALID_TIME_FORMAT");
    }

    const d = new Date(dateStr);
    d.setHours(h, m, 0, 0);
    return d;
};

/**
 * ========================================
 * VALIDATION UTILITIES
 * ========================================
 */

export const validatePunch = (punchIn, punchOut) => {
    if (punchIn && punchOut) {
        const inTime = new Date(punchIn);
        const outTime = new Date(punchOut);

        if (outTime <= inTime) {
            throw new Error("PUNCH_OUT_BEFORE_IN");
        }
    }
};

export const validatePunchDates = (punchIn, punchOut, attendanceDate) => {
    const normalizedDate = normalizeDate(attendanceDate);

    if (punchIn) {
        const punchInDate = normalizeDate(punchIn);
        if (punchInDate.getTime() !== normalizedDate.getTime()) {
            throw new Error("PUNCH_DATE_MISMATCH");
        }
    }

    if (punchOut) {
        const punchOutDate = normalizeDate(punchOut);
        if (punchOutDate.getTime() !== normalizedDate.getTime()) {
            throw new Error("PUNCH_OUT_DATE_MISMATCH");
        }
    }
};

export const checkJoiningDate = (employee, attendanceDate) => {
    if (!employee || !employee.jobInfo || !employee.jobInfo.joiningDate) {
        return;
    }

    const joining = normalizeDate(employee.jobInfo.joiningDate);
    const normalized = normalizeDate(attendanceDate);

    if (normalized < joining) {
        throw new Error("ATTENDANCE_BEFORE_JOINING_DATE");
    }
};

export const checkWeeklyOff = (employee, shift, attendanceDate) => {
    if (!attendanceDate) {
        throw new Error("INVALID_DATE");
    }

    const day = attendanceDate.toLocaleDateString("en-US", { weekday: "long" });

    const weeklyOff = employee?.weeklyOff?.length
        ? employee.weeklyOff
        : shift?.weeklyOff || ["Sunday"];

    if (weeklyOff.includes(day)) {
        throw new Error("ATTENDANCE_ON_WEEKLY_OFF");
    }
};

export const checkHoliday = (attendanceDate, holidays = []) => {
    if (!holidays || holidays.length === 0) return;

    const normalizedDate = normalizeDate(attendanceDate);
    const isHoliday = holidays.some(holiday => {
        const holidayDate = normalizeDate(holiday);
        return holidayDate.getTime() === normalizedDate.getTime();
    });

    if (isHoliday) {
        throw new Error("ATTENDANCE_ON_HOLIDAY");
    }
};

/**
 * ========================================
 * SHIFT WINDOW CALCULATIONS
 * ========================================
 */

export const buildShiftWindow = (shift, dateStr) => {
    if (!shift || !dateStr) {
        throw new Error("SHIFT_AND_DATE_REQUIRED");
    }

    try {
        const start = createDateTime(dateStr, shift.startTime);
        let end = createDateTime(dateStr, shift.endTime);

        if (!start || !end) {
            throw new Error("INVALID_SHIFT_TIMES");
        }

        // Handle night shifts (end time before start time)
        if (shift.isNightShift && end <= start) {
            end.setDate(end.getDate() + 1);
        }

        const gracePeriod = shift.gracePeriod || {};
        const early = gracePeriod.earlyEntry || 30;
        const late = gracePeriod.lateEntry || 10;
        const absentAfter = gracePeriod.afterAbsentMark || 30;

        return {
            shiftStart: start,
            shiftEnd: end,
            allowedStart: new Date(start.getTime() - early * 60000),
            allowedEnd: new Date(start.getTime() + late * 60000),
            absentThreshold: new Date(start.getTime() + absentAfter * 60000),
            lateGrace: late,
            earlyEntry: early,
            afterAbsentMark: absentAfter
        };
    } catch (error) {
        throw new Error(`SHIFT_WINDOW_BUILD_FAILED: ${error.message}`);
    }
};

export const validateShiftWindow = (currentTime, window) => {
    if (!currentTime || !window) {
        throw new Error("INVALID_TIME_OR_WINDOW");
    }

    const current = new Date(currentTime);

    // 1. TOO EARLY
    if (current < window.allowedStart) {
        const minutesEarly = diffMinutes(current, window.allowedStart);

        const error = new Error("PUNCH_TOO_EARLY");
        error.details = {
            message: "Punch in too early",
            minutesEarly,
            allowedFrom: window.allowedStart
        };
        throw error;
    }

    // 2. LATE (after allowedEnd)
    if (current > window.allowedEnd && current < window.absentThreshold) {
        const minutesLate = diffMinutes(window.shiftStart, current);

        return {
            status: "late",
            minutesLate,
            punchTime: current.toISOString()
        };
    }

    // 3. ABSENT
    if (current >= window.absentThreshold) {
        return {
            status: "absent"
        };
    }

    // 4. ON TIME / WITHIN GRACE
    return {
        status: "present"
    };
};
/**
 * ========================================
 * WORK TIME CALCULATIONS
 * ========================================
 */

export const calculateWork = (inTime, outTime, breaks = []) => {
    if (!inTime || !outTime) return 0;

    const in_ms = new Date(inTime).getTime();
    const out_ms = new Date(outTime).getTime();

    if (out_ms <= in_ms) return 0;

    let totalMinutes = diffMinutes(inTime, outTime);

    // Subtract break durations
    if (Array.isArray(breaks)) {
        for (const breakItem of breaks) {
            if (breakItem.start && breakItem.end) {
                const breakStart = new Date(breakItem.start).getTime();
                const breakEnd = new Date(breakItem.end).getTime();

                if (breakEnd > breakStart) {
                    totalMinutes -= diffMinutes(breakStart, breakEnd);
                }
            }
        }
    }

    return Math.max(0, totalMinutes);
};

export const calculateLate = (inTime, shiftStart, lateGrace = 10) => {
    if (!inTime || !shiftStart) return 0;

    const in_ms = new Date(inTime).getTime();
    const shift_ms = new Date(shiftStart).getTime();

    if (in_ms <= shift_ms) return 0;

    const delayMinutes = diffMinutes(shiftStart, inTime);
    return delayMinutes > lateGrace ? delayMinutes - lateGrace : 0;
};

export const calculateEarlyLeave = (outTime, shiftEnd, earlyLeaveGrace = 10) => {
    if (!outTime || !shiftEnd) return 0;

    const out_ms = new Date(outTime).getTime();
    const shift_ms = new Date(shiftEnd).getTime();

    if (out_ms >= shift_ms) return 0;

    const earlyMinutes = diffMinutes(outTime, shiftEnd);
    return earlyMinutes > earlyLeaveGrace ? earlyMinutes - earlyLeaveGrace : 0;
};

export const calculateOvertime = (workMinutes, shiftMinutes, maxOvertime = 240) => {
    const overtimeMinutes = workMinutes - shiftMinutes;
    return Math.min(Math.max(0, overtimeMinutes), maxOvertime);
};

export const calculatePayableMinutes = (
    workMinutes,
    shiftMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    minimumHours = 4 * 60 // 4 hours minimum
) => {
    let payable = workMinutes - lateMinutes - earlyLeaveMinutes;

    // Apply minimum hours rule
    if (payable > 0 && payable < minimumHours) {
        // Less than minimum, might count as half day or full day depending on policy
        return 0;
    }

    return Math.max(0, payable);
};

/**
 * ========================================
 * ATTENDANCE STATUS LOGIC
 * ========================================
 */

export const determineAttendanceStatus = (
    baseStatus,
    workMinutes,
    shiftMinutes,
    minimumMinutes = 240 // 4 hours
) => {
    // If marked absent by system
    if (baseStatus === "absent") {
        return "absent";
    }

    // If no work logged
    if (workMinutes === 0) {
        return "absent";
    }

    // If worked less than minimum threshold
    if (workMinutes < minimumMinutes) {
        return "half_day";
    }

    return "present";
};

/**
 * ========================================
 * GEO-LOCATION VALIDATION
 * ========================================
 */

export const validateGeoLocation = (geoLocation, officeLocation, tolerance = 100) => {
    if (!geoLocation || !geoLocation.coordinates || geoLocation.coordinates.length !== 2) {
        throw new Error("INVALID_GEO_FORMAT");
    }

    if (!officeLocation || !officeLocation.coordinates || officeLocation.coordinates.length !== 2) {
        // No office location set - cannot validate
        return {
            verified: false,
            reason: "NO_OFFICE_LOCATION",
            distance: null
        };
    }

    const [empLng, empLat] = geoLocation.coordinates;
    const [officeLng, officeLat] = officeLocation.coordinates;

    const distance = calculateDistance(
        empLat,
        empLng,
        officeLat,
        officeLng
    );

    const radius = officeLocation.radius || tolerance;
    const verified = distance <= radius;

    return {
        verified,
        distance,
        radius,
        reason: verified ? "WITHIN_RANGE" : "OUTSIDE_RANGE"
    };
};

/**
 * Haversine formula: Calculate distance between two coordinates (meters)
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // distance in meters
};

/**
 * ========================================
 * DEVICE FRAUD DETECTION
 * ========================================
 */

export const checkDeviceFraud = (currentDevice, previousDevices = []) => {
    if (!currentDevice || !currentDevice.deviceId) {
        return {
            isSuspicious: false,
            reason: "NO_DEVICE_ID"
        };
    }

    // Check if same device is being used
    const sameDevice = previousDevices.some(
        d => d.deviceId === currentDevice.deviceId
    );

    if (!sameDevice && previousDevices.length > 0) {
        // Device changed
        return {
            isSuspicious: true,
            reason: "DEVICE_CHANGED",
            previousDeviceIds: previousDevices.map(d => d.deviceId)
        };
    }

    return {
        isSuspicious: false,
        reason: "DEVICE_CONSISTENT"
    };
};

/**
 * ========================================
 * DATA SANITIZATION
 * ========================================
 */

export const sanitizeAttendanceData = (data) => {
    const sanitized = {
        ...data
    };

    // Remove sensitive fields
    delete sanitized.remarks;
    delete sanitized.editLogs;

    return sanitized;
};

/**
 * ========================================
 * ERROR MESSAGE MAPPER
 * ========================================
 */

export const getErrorMessage = (errorCode) => {
    const messages = {
        "TOKEN_REQUIRED": "Authentication token is required",
        "DATE_REQUIRED": "Attendance date is required",
        "PUNCH_REQUIRED": "Punch in or punch out time is required",
        "PUNCH_IN_REQUIRED": "Punch in time is required for new attendance",
        "PUNCH_OUT_REQUIRED": "Punch out time is required to complete attendance",
        "COMPANY_NOT_FOUND": "Company/Organization not found",
        "EMPLOYEE_NOT_FOUND": "Employee record not found",
        "SHIFT_NOT_FOUND": "Shift configuration not found",
        "INVALID_PUNCH": "Punch out time must be after punch in time",
        "PUNCH_OUT_BEFORE_IN": "Punch out time cannot be before punch in time",
        "PUNCH_DATE_MISMATCH": "Punch in date does not match attendance date",
        "PUNCH_OUT_DATE_MISMATCH": "Punch out date does not match attendance date",
        "BEFORE_JOINING_DATE": "Attendance cannot be marked before joining date",
        "ATTENDANCE_BEFORE_JOINING_DATE": "Attendance cannot be marked before joining date",
        "WEEKLY_OFF": "Attendance cannot be marked on weekly off day",
        "ATTENDANCE_ON_WEEKLY_OFF": "Attendance cannot be marked on weekly off day",
        "HOLIDAY": "Attendance cannot be marked on holiday",
        "ATTENDANCE_ON_HOLIDAY": "Attendance cannot be marked on holiday",
        "TOO_EARLY": "Punch attempt is too early. Please try again later.",
        "PUNCH_TOO_EARLY": "Punch attempt is too early. Please try again later.",
        "INVALID_SHIFT_TIMES": "Shift start and end times are invalid",
        "SHIFT_WINDOW_BUILD_FAILED": "Failed to calculate shift window",
        "INVALID_TIME_FORMAT": "Invalid time format. Expected HH:MM",
        "INVALID_TIME_OR_WINDOW": "Invalid time or shift window",
        "INVALID_DATE": "Invalid attendance date",
        "INVALID_GEO_FORMAT": "Invalid geolocation format",
        "DUPLICATE_PUNCH_IN": "Attendance already marked for this date",
        "INVALID_TOKEN": "Invalid or expired authentication token",
        "UNAUTHORIZED": "You are not authorized to perform this action",
        "DATABASE_ERROR": "Database error occurred",
        "SHIFT_AND_DATE_REQUIRED": "Shift and date are required"
    };

    return messages[errorCode] || errorCode;
};

/**
 * ========================================
 * LOGGING UTILITIES
 * ========================================
 */

export const logAttendanceAction = (action, attendanceData, userId, details = {}) => {
    logger.info(`[ATTENDANCE] ${action}`, {
        employeeId: attendanceData?.employeeId,
        companyId: attendanceData?.companyId,
        date: attendanceData?.date,
        punchIn: attendanceData?.punchIn,
        punchOut: attendanceData?.punchOut,
        status: attendanceData?.status,
        performedBy: userId,
        ...details
    });
};

export const logAttendanceError = (errorCode, details = {}) => {
    logger.error(`[ATTENDANCE_ERROR] ${errorCode}`, details);
};