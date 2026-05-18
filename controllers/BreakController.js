import mongoose from 'mongoose';
import Attendance from '../models/Attandance/Attendance.js';
import Employee from '../models/Attandance/Employee.js';
import Shift from '../models/Attandance/Shift.js';
import { convertMinutesToHHMM } from '../config/timehh.js';
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';

/**
 * HELPER: Abort Transaction + Response
 */
const abortAndRespond = async (
    session,
    res,
    statusCode,
    errorCode,
    message,
    data = null
) => {

    try {

        if (session?.inTransaction()) {
            await session.abortTransaction();
        }

    } catch (e) {

        console.error("Transaction Abort Error:", e);

    } finally {

        if (session) {
            session.endSession();
        }
    }

    return res.status(statusCode).json({
        success: false,
        errorCode,
        message,
        ...(data && { data })
    });
};

/**
 * HELPER: Distance Calculation
 */
const getDistance = (lat1, lng1, lat2, lng2) => {

    const R = 6371000;

    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

/* =========================================================
    START BREAK CONTROLLER
========================================================= */

export const startBreakController = async (req, res) => {

    const session = await mongoose.startSession();

    try {

        session.startTransaction();

        let geoVerified = false;

        const { breakType, token, Lat, Lng } = req.body;

        const employeeId = req.user._id;

        /**
         * VALIDATION
         */
        if (!breakType) {

            return abortAndRespond(
                session,
                res,
                400,
                "BREAK_TYPE_REQUIRED",
                "Break type is required"
            );
        }

        /**
         * VERIFY JWT
         */
        let decoded;

        try {

            decoded = jwt.verify(
                token,
                process.env.JWT_SECRET
            );

        } catch (err) {

            return abortAndRespond(
                session,
                res,
                401,
                "TOKEN_INVALID",
                "Invalid or expired token"
            );
        }

        if (!decoded?.userId) {

            return abortAndRespond(
                session,
                res,
                401,
                "TOKEN_PAYLOAD_INVALID",
                "Invalid token payload"
            );
        }

        /**
         * FIND COMPANY USER
         */
        const companyUser = await User.findById(decoded.userId)
            .select("-password -otp -__v")
            .session(session);

        if (!companyUser) {

            return abortAndRespond(
                session,
                res,
                404,
                "USER_NOT_FOUND",
                "Company user not found"
            );
        }

        const companyId = companyUser._id;

        /**
         * FIND EMPLOYEE
         */
        const employee = await Employee.findById(employeeId)
            .populate("shiftId")
            .session(session);

        if (!employee) {

            return abortAndRespond(
                session,
                res,
                404,
                "EMPLOYEE_NOT_FOUND",
                "Employee not found"
            );
        }

        /**
         * SHIFT VALIDATION
         */
        const shift = employee.shiftId;

        if (!shift) {

            return abortAndRespond(
                session,
                res,
                400,
                "SHIFT_NOT_ASSIGNED",
                "Shift not assigned"
            );
        }

        /**
         * BREAK VALIDATION
         */
        const shiftBreak = shift.breaks.find(
            item =>
                item.name.toLowerCase() ===
                breakType.toLowerCase()
        );

        if (!shiftBreak) {

            return abortAndRespond(
                session,
                res,
                400,
                "BREAK_NOT_ALLOWED",
                "Break not allowed"
            );
        }

        /**
         * FIND TODAY ATTENDANCE
         */
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const attendance = await Attendance.findOne({
            employeeId,
            companyId,
            date: {
                $gte: startOfDay,
                $lte: endOfDay
            }
        }).session(session);

        if (!attendance) {

            return abortAndRespond(
                session,
                res,
                404,
                "ATTENDANCE_NOT_FOUND",
                "Attendance not found"
            );
        }

        /**
         * ACTIVE BREAK CHECK
         */
        const activeBreak = attendance.breaks.find(
            item => item.status === "active"
        );

        if (activeBreak) {

            return abortAndRespond(
                session,
                res,
                400,
                "BREAK_ALREADY_ACTIVE",
                "Another break already active"
            );
        }

        /**
         * GEO VALIDATION
         */
        if (
            employee.officeLocation?.coordinates &&
            employee.officeLocation.coordinates.length === 2
        ) {

            const [officeLng, officeLat] =
                employee.officeLocation.coordinates;

            const userLng = parseFloat(Lng);
            const userLat = parseFloat(Lat);

            const distance = getDistance(
                officeLat,
                officeLng,
                userLat,
                userLng
            );

            const allowedRadius =
                employee.officeLocation.radius || 500;

            if (distance > allowedRadius) {

                return abortAndRespond(
                    session,
                    res,
                    403,
                    "OUTSIDE_OFFICE_RADIUS",
                    `You are outside the allowed office location range (${Math.round(distance)}m from office).`,
                    {
                        allowedRadius,
                        currentDistance: Math.round(distance),
                        unit: "meters"
                    }
                );
            }

            geoVerified = true;

            console.log(
                `✓ Geo Verified: ${Math.round(distance)}m`
            );

        } else {

            console.log(
                "⚠ No office location configured"
            );
        }

        /**
         * CREATE BREAK
         */
        attendance.breaks.push({

            type: breakType.toLowerCase(),

            breakName: shiftBreak.name,

            startTime: new Date(),

            allowedMinutes: shiftBreak.duration,

            isPaid: shiftBreak.isPaid,

            geoVerified,

            status: "active"
        });

        await attendance.save({ session });

        /**
         * COMMIT
         */
        await session.commitTransaction();

        session.endSession();

        return res.status(200).json({
            success: true,
            message: "Break started successfully"
        });

    } catch (error) {

        console.error("START BREAK ERROR:", error);

        return abortAndRespond(
            session,
            res,
            500,
            "INTERNAL_SERVER_ERROR",
            error.message
        );
    }
};

/* =========================================================
    END BREAK CONTROLLER
========================================================= */

export const endBreakController = async (req, res) => {

    const session = await mongoose.startSession();

    try {

        session.startTransaction();

        let geoVerified = false;

        const { token, Lat, Lng } = req.body;

        const employeeId = req.user._id;

        /**
         * VERIFY TOKEN
         */
        let decoded;

        try {

            decoded = jwt.verify(
                token,
                process.env.JWT_SECRET
            );

        } catch (err) {

            return abortAndRespond(
                session,
                res,
                401,
                "TOKEN_INVALID",
                "Invalid or expired token"
            );
        }

        if (!decoded?.userId) {

            return abortAndRespond(
                session,
                res,
                401,
                "TOKEN_PAYLOAD_INVALID",
                "Invalid token payload"
            );
        }

        /**
         * COMPANY USER
         */
        const companyUser = await User.findById(decoded.userId)
            .select("-password -otp -__v")
            .session(session);

        if (!companyUser) {

            return abortAndRespond(
                session,
                res,
                404,
                "USER_NOT_FOUND",
                "Company user not found"
            );
        }

        const companyId = companyUser._id;

        /**
         * FIND EMPLOYEE
         */
        const employee = await Employee.findById(employeeId)
            .session(session);

        if (!employee) {

            return abortAndRespond(
                session,
                res,
                404,
                "EMPLOYEE_NOT_FOUND",
                "Employee not found"
            );
        }

        /**
         * FIND ATTENDANCE
         */
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const attendance = await Attendance.findOne({
            employeeId,
            companyId,
            date: {
                $gte: startOfDay,
                $lte: endOfDay
            }
        }).session(session);

        if (!attendance) {

            return abortAndRespond(
                session,
                res,
                404,
                "ATTENDANCE_NOT_FOUND",
                "Attendance not found"
            );
        }

        /**
         * GEO VALIDATION
         */
        if (
            employee.officeLocation?.coordinates &&
            employee.officeLocation.coordinates.length === 2
        ) {

            const [officeLng, officeLat] =
                employee.officeLocation.coordinates;

            const userLng = parseFloat(Lng);
            const userLat = parseFloat(Lat);

            const distance = getDistance(
                officeLat,
                officeLng,
                userLat,
                userLng
            );

            const allowedRadius =
                employee.officeLocation.radius || 500;

            if (distance > allowedRadius) {

                return abortAndRespond(
                    session,
                    res,
                    403,
                    "OUTSIDE_OFFICE_RADIUS",
                    `You are outside the allowed office location range (${Math.round(distance)}m from office).`,
                    {
                        allowedRadius,
                        currentDistance: Math.round(distance),
                        unit: "meters"
                    }
                );
            }

            geoVerified = true;

            console.log(
                `✓ Geo Verified: ${Math.round(distance)}m`
            );

        } else {

            console.log(
                "⚠ No office location configured"
            );
        }

        /**
         * FIND ACTIVE BREAK
         */
        const activeBreak = attendance.breaks.find(
            item => item.status === "active"
        );

        if (!activeBreak) {

            return abortAndRespond(
                session,
                res,
                400,
                "NO_ACTIVE_BREAK",
                "No active break found"
            );
        }

        /**
         * END BREAK
         */
        activeBreak.endTime = new Date();

        /**
         * CALCULATE DURATION
         */
        const durationMinutes = Math.floor(
            (
                activeBreak.endTime -
                activeBreak.startTime
            ) / (1000 * 60)
        );

        activeBreak.durationMinutes =
            durationMinutes;

        activeBreak.durationHHMM =
            convertMinutesToHHMM(durationMinutes);

        activeBreak.exceededMinutes =
            Math.max(
                0,
                durationMinutes -
                activeBreak.allowedMinutes
            );

        activeBreak.geoVerified =
            geoVerified;

        activeBreak.status = "completed";

        /**
         * TOTAL BREAK MINUTES
         */
        attendance.workSummary.totalBreakMinutes =
            attendance.breaks.reduce(
                (total, item) => {

                    return total +
                        (item.durationMinutes || 0);

                },
                0
            );

        await attendance.save({ session });

        /**
         * COMMIT
         */
        await session.commitTransaction();

        session.endSession();

        return res.status(200).json({
            success: true,
            message: "Break ended successfully",
            data: activeBreak
        });

    } catch (error) {

        console.error("END BREAK ERROR:", error);

        return abortAndRespond(
            session,
            res,
            500,
            "INTERNAL_SERVER_ERROR",
            error.message
        );
    }
};