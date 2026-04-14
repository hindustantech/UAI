// middleware/attendanceValidation.js

import { body, param, query, validationResult } from "express-validator";
import logger from "../../utils/logger.js";

/**
 * ========================================
 * FIELD VALIDATORS
 * ========================================
 */

/**
 * Validate ISO 8601 Date
 */
export const validateISODate = (fieldName) => {
    return body(fieldName)
        .notEmpty()
        .withMessage(`${fieldName} is required`)
        .isISO8601()
        .withMessage(`${fieldName} must be a valid ISO 8601 date`);
};

/**
 * Validate MongoDB ObjectId
 */
export const validateObjectId = (fieldName) => {
    return body(fieldName)
        .notEmpty()
        .withMessage(`${fieldName} is required`)
        .isMongoId()
        .withMessage(`${fieldName} must be a valid MongoDB ID`);
};

/**
 * Validate Geolocation
 */
export const validateGeoLocation = body("geoLocation")
    .optional()
    .custom((value) => {
        if (!value) return true;

        if (typeof value !== "object") {
            throw new Error("GeoLocation must be an object");
        }

        if (value.type && value.type !== "Point") {
            throw new Error("GeoLocation type must be Point");
        }

        if (!Array.isArray(value.coordinates)) {
            throw new Error("GeoLocation coordinates must be an array");
        }

        if (value.coordinates.length !== 2) {
            throw new Error("GeoLocation coordinates must have exactly 2 values [longitude, latitude]");
        }

        const [lon, lat] = value.coordinates;

        if (typeof lon !== "number" || typeof lat !== "number") {
            throw new Error("Coordinates must be numbers");
        }

        if (lon < -180 || lon > 180) {
            throw new Error("Longitude must be between -180 and 180");
        }

        if (lat < -90 || lat > 90) {
            throw new Error("Latitude must be between -90 and 90");
        }

        if (value.accuracy && typeof value.accuracy !== "number") {
            throw new Error("Accuracy must be a number");
        }

        if (value.source && !["gps", "network", "manual"].includes(value.source)) {
            throw new Error("Source must be gps, network, or manual");
        }

        return true;
    });

/**
 * Validate Device Info
 */
export const validateDeviceInfo = body("deviceInfo")
    .optional()
    .custom((value) => {
        if (!value) return true;

        if (typeof value !== "object") {
            throw new Error("DeviceInfo must be an object");
        }

        if (value.deviceId && typeof value.deviceId !== "string") {
            throw new Error("Device ID must be a string");
        }

        if (value.platform && !["android", "ios", "web"].includes(value.platform)) {
            throw new Error("Platform must be android, ios, or web");
        }

        if (value.ip && typeof value.ip !== "string") {
            throw new Error("IP must be a string");
        }

        if (value.appVersion && typeof value.appVersion !== "string") {
            throw new Error("App version must be a string");
        }

        return true;
    });

/**
 * Validate Breaks Array
 */
export const validateBreaks = body("breaks")
    .optional()
    .isArray()
    .withMessage("Breaks must be an array")
    .custom((value) => {
        if (!Array.isArray(value)) return true;

        for (let i = 0; i < value.length; i++) {
            const breakItem = value[i];

            if (typeof breakItem !== "object") {
                throw new Error(`Break ${i} must be an object`);
            }

            if (breakItem.start) {
                try {
                    new Date(breakItem.start);
                    if (isNaN(new Date(breakItem.start))) {
                        throw new Error(`Break ${i} start must be a valid date`);
                    }
                } catch (e) {
                    throw new Error(`Break ${i} start must be a valid date`);
                }
            }

            if (breakItem.end) {
                try {
                    new Date(breakItem.end);
                    if (isNaN(new Date(breakItem.end))) {
                        throw new Error(`Break ${i} end must be a valid date`);
                    }
                } catch (e) {
                    throw new Error(`Break ${i} end must be a valid date`);
                }
            }

            if (breakItem.start && breakItem.end) {
                const start = new Date(breakItem.start);
                const end = new Date(breakItem.end);
                if (end <= start) {
                    throw new Error(`Break ${i} end time must be after start time`);
                }
            }

            if (breakItem.reason && typeof breakItem.reason !== "string") {
                throw new Error(`Break ${i} reason must be a string`);
            }
        }

        return true;
    });

/**
 * ========================================
 * VALIDATION RULE SETS
 * ========================================
 */

/**
 * Mark Attendance Validation Rules
 */
export const validateMarkAttendanceRules = [
    body("date")
        .notEmpty()
        .withMessage("Date is required")
        .isISO8601()
        .withMessage("Date must be a valid ISO 8601 date"),

    body("token")
        .notEmpty()
        .withMessage("Token is required")
        .isString()
        .withMessage("Token must be a string")
        .trim()
        .notEmpty()
        .withMessage("Token cannot be empty"),

    body("punchIn")
        .optional()
        .isISO8601()
        .withMessage("Punch in must be a valid ISO 8601 datetime"),

    body("punchOut")
        .optional()
        .isISO8601()
        .withMessage("Punch out must be a valid ISO 8601 datetime"),

    body("shiftId")
        .optional()
        .isMongoId()
        .withMessage("Shift ID must be a valid MongoDB ID"),

    validateGeoLocation,
    validateDeviceInfo,
    validateBreaks,

    body("remarks")
        .optional()
        .isString()
        .withMessage("Remarks must be a string")
        .trim()
        .isLength({ max: 500 })
        .withMessage("Remarks must be less than 500 characters")
];

/**
 * Get Attendance Validation Rules
 */
export const validateGetAttendanceRules = [
    param("attendanceId")
        .notEmpty()
        .withMessage("Attendance ID is required")
        .isMongoId()
        .withMessage("Attendance ID must be a valid MongoDB ID")
];

/**
 * Attendance Report Validation Rules
 */
export const validateAttendanceReportRules = [
    query("employeeId")
        .notEmpty()
        .withMessage("Employee ID is required")
        .isMongoId()
        .withMessage("Employee ID must be a valid MongoDB ID"),

    query("startDate")
        .notEmpty()
        .withMessage("Start date is required")
        .isISO8601()
        .withMessage("Start date must be a valid ISO 8601 date"),

    query("endDate")
        .notEmpty()
        .withMessage("End date is required")
        .isISO8601()
        .withMessage("End date must be a valid ISO 8601 date"),

    query("status")
        .optional()
        .isIn(["present", "absent", "leave", "holiday", "half_day", "week_off", "pending_approval", "rejected"])
        .withMessage("Invalid status value")
];

/**
 * Correct Attendance Validation Rules
 */
export const validateCorrectAttendanceRules = [
    param("attendanceId")
        .notEmpty()
        .withMessage("Attendance ID is required")
        .isMongoId()
        .withMessage("Attendance ID must be a valid MongoDB ID"),

    body("reason")
        .notEmpty()
        .withMessage("Reason is required")
        .isString()
        .withMessage("Reason must be a string")
        .trim()
        .isLength({ min: 5, max: 500 })
        .withMessage("Reason must be between 5 and 500 characters"),

    body("punchIn")
        .optional()
        .isISO8601()
        .withMessage("Punch in must be a valid ISO 8601 datetime"),

    body("punchOut")
        .optional()
        .isISO8601()
        .withMessage("Punch out must be a valid ISO 8601 datetime"),

    body("status")
        .optional()
        .isIn(["present", "absent", "leave", "holiday", "half_day", "week_off"])
        .withMessage("Invalid status value"),

    validateBreaks
];

/**
 * Delete Attendance Validation Rules
 */
export const validateDeleteAttendanceRules = [
    param("attendanceId")
        .notEmpty()
        .withMessage("Attendance ID is required")
        .isMongoId()
        .withMessage("Attendance ID must be a valid MongoDB ID")
];

/**
 * ========================================
 * ERROR HANDLING MIDDLEWARE
 * ========================================
 */

/**
 * Validation Error Handler
 * Extracts and formats validation errors
 */
export const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const formattedErrors = errors.array().map(err => ({
            field: err.param || err.location,
            message: err.msg,
            value: err.value !== undefined ? err.value : null
        }));

        logger.warn("[VALIDATION_ERROR]", {
            method: req.method,
            path: req.path,
            errors: formattedErrors,
            ip: req.ip
        });

        return res.status(422).json({
            success: false,
            error: "VALIDATION_ERROR",
            message: "Request validation failed",
            details: formattedErrors
        });
    }

    next();
};

/**
 * ========================================
 * CUSTOM VALIDATORS
 * ========================================
 */

/**
 * Validate Date Range (startDate before endDate)
 */
export const validateDateRange = (startDateField, endDateField) => {
    return async (req, res, next) => {
        try {
            const startDate = new Date(req.query[startDateField] || req.body[startDateField]);
            const endDate = new Date(req.query[endDateField] || req.body[endDateField]);

            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                return res.status(422).json({
                    success: false,
                    error: "VALIDATION_ERROR",
                    message: "Invalid date format",
                    details: [
                        {
                            field: startDateField,
                            message: "Must be a valid date"
                        }
                    ]
                });
            }

            if (startDate > endDate) {
                return res.status(422).json({
                    success: false,
                    error: "VALIDATION_ERROR",
                    message: `${startDateField} must be before ${endDateField}`,
                    details: [
                        {
                            field: startDateField,
                            message: `Must be before ${endDateField}`
                        }
                    ]
                });
            }

            next();
        } catch (error) {
            logger.error("[DATE_RANGE_VALIDATION_ERROR]", error);
            return res.status(500).json({
                success: false,
                error: "VALIDATION_ERROR",
                message: "Date validation failed"
            });
        }
    };
};

/**
 * Validate Punch Times (punch in before punch out)
 */
export const validatePunchTimesMiddleware = (req, res, next) => {
    const { punchIn, punchOut } = req.body;

    if (punchIn && punchOut) {
        const inTime = new Date(punchIn);
        const outTime = new Date(punchOut);

        if (isNaN(inTime.getTime()) || isNaN(outTime.getTime())) {
            return res.status(422).json({
                success: false,
                error: "VALIDATION_ERROR",
                message: "Invalid punch time format",
                details: [
                    {
                        field: "punchIn/punchOut",
                        message: "Must be valid ISO 8601 dates"
                    }
                ]
            });
        }

        if (outTime <= inTime) {
            return res.status(422).json({
                success: false,
                error: "VALIDATION_ERROR",
                message: "Punch out time must be after punch in time",
                details: [
                    {
                        field: "punchOut",
                        message: "Must be after punchIn"
                    }
                ]
            });
        }
    }

    next();
};

/**
 * ========================================
 * USAGE IN ROUTES
 * ========================================
 */

// Example usage in routes:

// router.post(
//     "/mark",
//     authenticate,
//     validateMarkAttendanceRules,
//     validatePunchTimesMiddleware,
//     handleValidationErrors,
//     markAttendance
// );
