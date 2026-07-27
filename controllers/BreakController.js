import mongoose from 'mongoose';
import Attendance from '../models/Attandance/Attendance.js';
import Employee from '../models/Attandance/Employee.js';
import Shift from '../models/Attandance/Shift.js';
import { convertMinutesToHHMM } from '../config/timehh.js';
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';


import logger from '../utils/logger.js';


import * as faceApi from '../services/faceApi.service.js';


// Minimum similarity to accept a face match at the attendance layer.
// (The Face API also applies its own settings.FACE_MATCH_THRESHOLD server-side;
// this is a second, app-level guard you can tune independently.)
const FACE_VERIFY_MIN_SIMILARITY = Number(process.env.FACE_VERIFY_MIN_SIMILARITY ?? 0);
const FACE_IDENTIFY_MIN_SIMILARITY = Number(process.env.FACE_IDENTIFY_MIN_SIMILARITY ?? 0);

/* ================================================================== */
/* Shared helpers (mirrors faceAttendance.controller.js)              */
/* ================================================================== */

function getUploadedFile(req) {
  if (!req.file) return null;
  return {
    fileBuffer: req.file.buffer,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype
  };
}

function parseJsonField(raw, fallback = {}) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

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

/* ================================================================== */
/* Break-config helpers                                               */
/* ================================================================== */

function resolveBreakConfig(shift, breakType) {
  if (!shift?.breaks?.length) return null;
  const type = breakType.toLowerCase();
  return shift.breaks.find(
    b => b.name?.toLowerCase().includes(type) || type.includes(b.name?.toLowerCase())
  ) || null;
}

function getConsumedBreakMinutes(attendance) {
  return (attendance.breaks || [])
    .filter(b => b.status === 'completed')
    .reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
}

function getTotalAllowedBreakMinutes(shift) {
  return (shift.breaks || []).reduce((sum, b) => sum + (b.duration || 0), 0);
}

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
        const employee = await Employee.findOne({ userId: employeeId })
            .populate("shift")
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
        const shift = employee.shift;

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
         * RESOLVE BREAK CONFIG FROM SHIFT
         */
        const breakConfig = resolveBreakConfig(shift, breakType);
        if (!breakConfig) {
            return abortAndRespond(
                session, res, 400, 'BREAK_CONFIG_NOT_FOUND',
                `Break type "${breakType}" not found in shift "${shift.shiftName}" configuration.`,
                { availableBreaks: shift.breaks?.map(b => b.name) }
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
            employeeId: employee._id,
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
         * TOTAL BREAK LIMIT CHECK
         */
        const consumedMinutes = getConsumedBreakMinutes(attendance);
        const totalAllowed = getTotalAllowedBreakMinutes(shift);
        const thisBreakDuration = breakConfig.duration || 30;

        if (consumedMinutes + thisBreakDuration > totalAllowed) {
            return abortAndRespond(
                session, res, 400, 'BREAK_LIMIT_EXCEEDED',
                `Your shift allows ${totalAllowed} min total break time. Already used ${consumedMinutes} min. Cannot take another ${thisBreakDuration} min break.`,
                { consumedMinutes, requestedDuration: thisBreakDuration, totalAllowed }
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

                geoVerified = false;

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

            breakName: breakConfig.name,

            startTime: new Date(),

            allowedMinutes: thisBreakDuration,

            isPaid: breakConfig.isPaid,

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
        const employee = await Employee.findOne({ userId: employeeId })
            .populate("shift")
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
            employeeId: employee._id,
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

                geoVerified = false
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


/* =========================================================
  Face 1:1 VERIFY — START BREAK
========================================================= */

export const startFaceBreakController = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    /* ---- 1. Auth + body validation ---- */
    const u_id = req.user._id;

    const {
      breakType,
      Lat, Lng,
      geoLocation: rawGeoLocation,
      deviceInfo: rawDeviceInfo
    } = req.body;

    const geoLocation = parseJsonField(rawGeoLocation, null);
    const deviceInfo = parseJsonField(rawDeviceInfo, {});

    if (!breakType) {
      return abortAndRespond(session, res, 400, 'BREAK_TYPE_REQUIRED', 'Break type is required');
    }

    const uploaded = getUploadedFile(req);
    if (!uploaded) {
      return abortAndRespond(session, res, 400, 'FACE_IMAGE_MISSING', 'A face image (file) is required');
    }

    /* ---- 2. Resolve companyId from the authenticated req.user ---- */
    let companyId;
    if (req.user.type === 'user') {
      companyId = req.user.companyId;
    } else {
      companyId = req.user.id;
    }

    const subscription = await Subscription.findOne({
      company: companyId,
      status: 'ACTIVE',
      isActive: true,
      endDate: { $gte: new Date() }
    });
    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'No active subscription',
        error: 'No active subscription found for this company'
      });
    }

    /* ---- 3. Employee validation ---- */
    const employee = await Employee.findOne({
      userId: u_id,
      employmentStatus: 'active'
    }).session(session);

    if (!employee) {
      return abortAndRespond(session, res, 404, 'EMPLOYEE_NOT_FOUND', 'Active employee not found');
    }
    if (employee.companyId.toString() !== companyId.toString()) {
      return abortAndRespond(session, res, 403, 'UNAUTHORIZED_COMPANY', 'Unauthorized company access');
    }

    /* ---- 4. Shift validation ---- */
    const shift = employee.shift;
    if (!shift) {
      return abortAndRespond(session, res, 400, 'SHIFT_NOT_ASSIGNED', 'Shift not assigned');
    }

    /* ---- 5. Find today attendance ---- */
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const attendance = await Attendance.findOne({
      employeeId: employee._id,
      companyId,
      date: { $gte: startOfDay, $lte: endOfDay }
    }).session(session);

    if (!attendance) {
      return abortAndRespond(session, res, 404, 'ATTENDANCE_NOT_FOUND', 'Attendance not found');
    }

    /* ---- 6. Active break check ---- */
    const activeBreak = attendance.breaks.find(item => item.status === 'active');
    if (activeBreak) {
      return abortAndRespond(session, res, 400, 'BREAK_ALREADY_ACTIVE', 'Another break already active');
    }

    /* ---- 7. Resolve break config from shift ---- */
    const breakConfig = resolveBreakConfig(shift, breakType);
    if (!breakConfig) {
      return abortAndRespond(
        session, res, 400, 'BREAK_CONFIG_NOT_FOUND',
        `Break type "${breakType}" not found in shift "${shift.shiftName}" configuration.`,
        { availableBreaks: shift.breaks?.map(b => b.name) }
      );
    }

    /* ---- 8. Total break limit check ---- */
    const consumedMinutes = getConsumedBreakMinutes(attendance);
    const totalAllowed = getTotalAllowedBreakMinutes(shift);
    const thisBreakDuration = breakConfig.duration || 30;

    if (consumedMinutes + thisBreakDuration > totalAllowed) {
      return abortAndRespond(
        session, res, 400, 'BREAK_LIMIT_EXCEEDED',
        `Your shift allows ${totalAllowed} min total break time. Already used ${consumedMinutes} min. Cannot take another ${thisBreakDuration} min break.`,
        { consumedMinutes, requestedDuration: thisBreakDuration, totalAllowed }
      );
    }

    /* ---- 9. FACE DETECTION ---- */
    let detection;
    try {
      detection = await faceApi.detectFace({
        fileBuffer: uploaded.fileBuffer,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        checkSpoofing: true,
        companyId: String(companyId),
        employeeId: String(employee.userId)
      });
    } catch (err) {
      return abortAndRespond(session, res, err.statusCode || 502, 'FACE_DETECT_FAILED', err.message);
    }

    const faceCount = detection?.data?.face_count ?? 0;
    if (faceCount === 0) {
      return abortAndRespond(session, res, 400, 'NO_FACE_DETECTED', 'No face detected in the image');
    }
    if (faceCount > 1) {
      return abortAndRespond(session, res, 400, 'MULTIPLE_FACES_DETECTED', 'Multiple faces detected. Only one face allowed.');
    }
    if (detection?.data?.spoofing && detection.data.spoofing.is_real === false) {
      return abortAndRespond(session, res, 403, 'SPOOF_DETECTED', 'Spoofing detected. Please use a real face.');
    }

    /* ---- 10. FACE VERIFICATION (1:1) ---- */
    let verifyResult;
    try {
      verifyResult = await faceApi.verifySpecificEmployee({
        employeeId: String(employee.userId),
        companyId: String(companyId),
        purpose: 'break_start',
        fileBuffer: uploaded.fileBuffer,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        deviceInfo
      });
    } catch (err) {
      return abortAndRespond(session, res, err.statusCode || 502, 'FACE_VERIFY_FAILED', err.message);
    }

    const vData = verifyResult?.data || {};
    if (!vData.matched || vData.similarity < FACE_VERIFY_MIN_SIMILARITY) {
      return abortAndRespond(
        session, res, 403, 'FACE_NOT_MATCHED',
        'Face verification failed. This does not look like the enrolled employee.',
        {
          employeeId: employee.userId,
          similarity: vData.similarity ?? 0,
          confidence: vData.confidence ?? 0,
          thresholdUsed: vData.threshold_used
        }
      );
    }

    console.log(`✓ Face verified 1:1 for ${employee.empCode} (similarity=${vData.similarity})`);

    /* ---- 11. Geo validation ---- */
    let geoVerified = false;
    if (employee.officeLocation?.coordinates && employee.officeLocation.coordinates.length === 2) {
      const [officeLng, officeLat] = employee.officeLocation.coordinates;
      const userLng = parseFloat(Lng ?? geoLocation?.coordinates?.[0]);
      const userLat = parseFloat(Lat ?? geoLocation?.coordinates?.[1]);

      const distance = getDistance(officeLat, officeLng, userLat, userLng);
      const allowedRadius = employee.officeLocation.radius || 500;

      if (distance > allowedRadius) {
        return abortAndRespond(
          session, res, 403, 'OUTSIDE_OFFICE_RADIUS',
          `You are outside the allowed office location range (${Math.round(distance)}m from office).`,
          { allowedRadius, currentDistance: Math.round(distance), unit: 'meters' }
        );
      }
      geoVerified = true;
    }

    /* ---- 12. Create break ---- */
    attendance.breaks.push({
      type: breakType.toLowerCase(),
      breakName: breakConfig.name,
      startTime: new Date(),
      allowedMinutes: thisBreakDuration,
      isPaid: breakConfig.isPaid,
      geoVerified,
      status: 'active',
      faceVerification: {
        verificationType: '1:1',
        matched: true,
        similarity: vData.similarity,
        confidence: vData.confidence,
        detScore: vData.det_score,
        thresholdUsed: vData.threshold_used
      }
    });

    await attendance.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: 'Face-verified break started successfully'
    });

  } catch (error) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
    } catch (e) {
      console.error('Error aborting transaction:', e);
    } finally {
      session.endSession();
    }
    console.error('❌ START FACE BREAK ERROR:', error);
    return res.status(500).json({
      success: false,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to start face break',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/* =========================================================
  Face 1:1 VERIFY — END BREAK
========================================================= */

export const endFaceBreakController = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    /* ---- 1. Auth + body validation ---- */
    const u_id = req.user._id;

    const {
      Lat, Lng,
      geoLocation: rawGeoLocation,
      deviceInfo: rawDeviceInfo
    } = req.body;

    const geoLocation = parseJsonField(rawGeoLocation, null);
    const deviceInfo = parseJsonField(rawDeviceInfo, {});

    const uploaded = getUploadedFile(req);
    if (!uploaded) {
      return abortAndRespond(session, res, 400, 'FACE_IMAGE_MISSING', 'A face image (file) is required');
    }

    /* ---- 2. Resolve companyId from the authenticated req.user ---- */
    let companyId;
    if (req.user.type === 'user') {
      companyId = req.user.companyId;
    } else {
      companyId = req.user.id;
    }

    const subscription = await Subscription.findOne({
      company: companyId,
      status: 'ACTIVE',
      isActive: true,
      endDate: { $gte: new Date() }
    });
    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'No active subscription',
        error: 'No active subscription found for this company'
      });
    }

    /* ---- 3. Employee validation ---- */
    const employee = await Employee.findOne({
      userId: u_id,
      employmentStatus: 'active'
    }).session(session);

    if (!employee) {
      return abortAndRespond(session, res, 404, 'EMPLOYEE_NOT_FOUND', 'Active employee not found');
    }
    if (employee.companyId.toString() !== companyId.toString()) {
      return abortAndRespond(session, res, 403, 'UNAUTHORIZED_COMPANY', 'Unauthorized company access');
    }

    /* ---- 4. Find today attendance ---- */
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const attendance = await Attendance.findOne({
      employeeId: employee._id,
      companyId,
      date: { $gte: startOfDay, $lte: endOfDay }
    }).session(session);

    if (!attendance) {
      return abortAndRespond(session, res, 404, 'ATTENDANCE_NOT_FOUND', 'Attendance not found');
    }

    /* ---- 5. Find active break ---- */
    const activeBreak = attendance.breaks.find(item => item.status === 'active');
    if (!activeBreak) {
      return abortAndRespond(session, res, 400, 'NO_ACTIVE_BREAK', 'No active break found');
    }

    /* ---- 6. FACE DETECTION ---- */
    let detection;
    try {
      detection = await faceApi.detectFace({
        fileBuffer: uploaded.fileBuffer,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        checkSpoofing: true,
        companyId: String(companyId),
        employeeId: String(employee.userId)
      });
    } catch (err) {
      return abortAndRespond(session, res, err.statusCode || 502, 'FACE_DETECT_FAILED', err.message);
    }

    const faceCount = detection?.data?.face_count ?? 0;
    if (faceCount === 0) {
      return abortAndRespond(session, res, 400, 'NO_FACE_DETECTED', 'No face detected in the image');
    }
    if (faceCount > 1) {
      return abortAndRespond(session, res, 400, 'MULTIPLE_FACES_DETECTED', 'Multiple faces detected. Only one face allowed.');
    }
    if (detection?.data?.spoofing && detection.data.spoofing.is_real === false) {
      return abortAndRespond(session, res, 403, 'SPOOF_DETECTED', 'Spoofing detected. Please use a real face.');
    }

    /* ---- 7. FACE VERIFICATION (1:1) ---- */
    let verifyResult;
    try {
      verifyResult = await faceApi.verifySpecificEmployee({
        employeeId: String(employee.userId),
        companyId: String(companyId),
        purpose: 'break_end',
        fileBuffer: uploaded.fileBuffer,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        deviceInfo
      });
    } catch (err) {
      return abortAndRespond(session, res, err.statusCode || 502, 'FACE_VERIFY_FAILED', err.message);
    }

    const vData = verifyResult?.data || {};
    if (!vData.matched || vData.similarity < FACE_VERIFY_MIN_SIMILARITY) {
      return abortAndRespond(
        session, res, 403, 'FACE_NOT_MATCHED',
        'Face verification failed. This does not look like the enrolled employee.',
        {
          employeeId: employee.userId,
          similarity: vData.similarity ?? 0,
          confidence: vData.confidence ?? 0,
          thresholdUsed: vData.threshold_used
        }
      );
    }

    console.log(`✓ Face verified 1:1 for ${employee.empCode} (similarity=${vData.similarity})`);

    /* ---- 8. Geo validation ---- */
    let geoVerified = false;
    if (employee.officeLocation?.coordinates && employee.officeLocation.coordinates.length === 2) {
      const [officeLng, officeLat] = employee.officeLocation.coordinates;
      const userLng = parseFloat(Lng ?? geoLocation?.coordinates?.[0]);
      const userLat = parseFloat(Lat ?? geoLocation?.coordinates?.[1]);

      const distance = getDistance(officeLat, officeLng, userLat, userLng);
      const allowedRadius = employee.officeLocation.radius || 500;

      if (distance > allowedRadius) {
        return abortAndRespond(
          session, res, 403, 'OUTSIDE_OFFICE_RADIUS',
          `You are outside the allowed office location range (${Math.round(distance)}m from office).`,
          { allowedRadius, currentDistance: Math.round(distance), unit: 'meters' }
        );
      }
      geoVerified = true;
    }

    /* ---- 9. End break ---- */
    activeBreak.endTime = new Date();
    const durationMinutes = Math.floor((activeBreak.endTime - activeBreak.startTime) / (1000 * 60));

    activeBreak.durationMinutes = durationMinutes;
    activeBreak.durationHHMM = convertMinutesToHHMM(durationMinutes);
    activeBreak.exceededMinutes = Math.max(0, durationMinutes - activeBreak.allowedMinutes);
    activeBreak.geoVerified = geoVerified;
    activeBreak.status = 'completed';
    activeBreak.faceVerification = {
      verificationType: '1:1',
      matched: true,
      similarity: vData.similarity,
      confidence: vData.confidence,
      detScore: vData.det_score,
      thresholdUsed: vData.threshold_used
    };

    attendance.workSummary.totalBreakMinutes = attendance.breaks.reduce(
      (total, item) => total + (item.durationMinutes || 0), 0
    );

    await attendance.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: 'Face-verified break ended successfully',
      data: activeBreak
    });

  } catch (error) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
    } catch (e) {
      console.error('Error aborting transaction:', e);
    } finally {
      session.endSession();
    }
    console.error('❌ END FACE BREAK ERROR:', error);
    return res.status(500).json({
      success: false,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to end face break',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/* =========================================================
  Face 1:N IDENTIFY — START BREAK (kiosk/shared device)
========================================================= */

export const startFaceBreakIdentifyController = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      breakType,
      Lat, Lng,
      geoLocation: rawGeoLocation,
      deviceInfo: rawDeviceInfo
    } = req.body;

    const geoLocation = parseJsonField(rawGeoLocation, null);
    const deviceInfo = parseJsonField(rawDeviceInfo, {});

    if (!breakType) {
      return abortAndRespond(session, res, 400, 'BREAK_TYPE_REQUIRED', 'Break type is required');
    }

    const uploaded = getUploadedFile(req);
    if (!uploaded) {
      return abortAndRespond(session, res, 400, 'FACE_IMAGE_MISSING', 'A face image (file) is required');
    }

    let companyId;
    if (req.user.type === 'user') {
      companyId = req.user.companyId;
    } else {
      companyId = req.user.id;
    }

    const subscription = await Subscription.findOne({
      company: companyId,
      status: 'ACTIVE',
      isActive: true,
      endDate: { $gte: new Date() }
    });
    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'No active subscription',
        error: 'No active subscription found for this company'
      });
    }

    let detection;
    try {
      detection = await faceApi.detectFaceForCompany({
        companyId: String(companyId),
        fileBuffer: uploaded.fileBuffer,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        checkSpoofing: true
      });
    } catch (err) {
      return abortAndRespond(session, res, err.statusCode || 502, 'FACE_DETECT_FAILED', err.message);
    }

    const faceCount = detection?.data?.face_count ?? 0;
    if (faceCount === 0) {
      return abortAndRespond(session, res, 400, 'NO_FACE_DETECTED', 'No face detected in the image');
    }
    if (faceCount > 1) {
      return abortAndRespond(session, res, 400, 'MULTIPLE_FACES_DETECTED', 'Multiple faces detected. Only one face allowed.');
    }
    if (detection?.data?.spoofing && detection.data.spoofing.is_real === false) {
      return abortAndRespond(session, res, 403, 'SPOOF_DETECTED', 'Spoofing detected. Please use a real face.');
    }

    let identifyResult;
    try {
      identifyResult = await faceApi.identifyFace({
        companyId: String(companyId),
        fileBuffer: uploaded.fileBuffer,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        maxResults: 5
      });
    } catch (err) {
      return abortAndRespond(session, res, err.statusCode || 502, 'FACE_IDENTIFY_FAILED', err.message);
    }

    const matches = identifyResult?.data?.matches || [];
    const bestMatch = matches[0];

    if (!bestMatch || bestMatch.similarity < FACE_IDENTIFY_MIN_SIMILARITY) {
      return abortAndRespond(
        session, res, 404, 'NO_EMPLOYEE_MATCHED',
        'Could not identify a matching employee for this company.',
        { topMatches: matches }
      );
    }

    const runnerUp = matches[1];
    const isAmbiguous = runnerUp && (bestMatch.similarity - runnerUp.similarity) < 0.02;
    if (isAmbiguous) {
      return abortAndRespond(
        session, res, 409, 'AMBIGUOUS_FACE_MATCH',
        'Multiple employees closely match this face. Please use 1:1 verification instead.',
        { topMatches: matches }
      );
    }

    const matchedEmployeeId = bestMatch.employee_id;

    const employee = await Employee.findOne({
      userId: matchedEmployeeId,
      companyId,
      employmentStatus: 'active'
    }).session(session);

    if (!employee) {
      return abortAndRespond(
        session, res, 404, 'EMPLOYEE_NOT_FOUND',
        'Identified face does not correspond to an active employee in this company',
        { matchedEmployeeId }
      );
    }

    console.log(`✓ Face identified 1:N as ${employee.empCode} (similarity=${bestMatch.similarity})`);

    const shift = employee.shift;
    if (!shift) {
      return abortAndRespond(session, res, 400, 'SHIFT_NOT_ASSIGNED', 'Shift not assigned');
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const attendance = await Attendance.findOne({
      employeeId: employee._id,
      companyId,
      date: { $gte: startOfDay, $lte: endOfDay }
    }).session(session);

    if (!attendance) {
      return abortAndRespond(session, res, 404, 'ATTENDANCE_NOT_FOUND', 'Attendance not found');
    }

    const activeBreak = attendance.breaks.find(item => item.status === 'active');
    if (activeBreak) {
      return abortAndRespond(session, res, 400, 'BREAK_ALREADY_ACTIVE', 'Another break already active');
    }

    /* ---- Resolve break config from shift ---- */
    const breakConfig = resolveBreakConfig(shift, breakType);
    if (!breakConfig) {
      return abortAndRespond(
        session, res, 400, 'BREAK_CONFIG_NOT_FOUND',
        `Break type "${breakType}" not found in shift "${shift.shiftName}" configuration.`,
        { availableBreaks: shift.breaks?.map(b => b.name) }
      );
    }

    /* ---- Total break limit check ---- */
    const consumedMinutes = getConsumedBreakMinutes(attendance);
    const totalAllowed = getTotalAllowedBreakMinutes(shift);
    const thisBreakDuration = breakConfig.duration || 30;

    if (consumedMinutes + thisBreakDuration > totalAllowed) {
      return abortAndRespond(
        session, res, 400, 'BREAK_LIMIT_EXCEEDED',
        `Your shift allows ${totalAllowed} min total break time. Already used ${consumedMinutes} min. Cannot take another ${thisBreakDuration} min break.`,
        { consumedMinutes, requestedDuration: thisBreakDuration, totalAllowed }
      );
    }

    let geoVerified = false;
    if (employee.officeLocation?.coordinates && employee.officeLocation.coordinates.length === 2) {
      const [officeLng, officeLat] = employee.officeLocation.coordinates;
      const userLng = parseFloat(Lng ?? geoLocation?.coordinates?.[0]);
      const userLat = parseFloat(Lat ?? geoLocation?.coordinates?.[1]);

      const distance = getDistance(officeLat, officeLng, userLat, userLng);
      const allowedRadius = employee.officeLocation.radius || 500;

      if (distance > allowedRadius) {
        return abortAndRespond(
          session, res, 403, 'OUTSIDE_OFFICE_RADIUS',
          `You are outside the allowed office location range (${Math.round(distance)}m from office).`,
          { allowedRadius, currentDistance: Math.round(distance), unit: 'meters' }
        );
      }
      geoVerified = true;
    }

    attendance.breaks.push({
      type: breakType.toLowerCase(),
      breakName: breakConfig.name,
      startTime: new Date(),
      allowedMinutes: thisBreakDuration,
      isPaid: breakConfig.isPaid,
      geoVerified,
      status: 'active',
      faceVerification: {
        verificationType: '1:N',
        matched: true,
        similarity: bestMatch.similarity,
        matchedEmployeeId,
        thresholdUsed: identifyResult?.data?.threshold_used,
        topMatches: matches
      }
    });

    await attendance.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: 'Face-identified break started successfully',
      data: { employeeCode: employee.empCode, employeeName: employee.user_name }
    });

  } catch (error) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
    } catch (e) {
      console.error('Error aborting transaction:', e);
    } finally {
      session.endSession();
    }
    console.error('❌ START FACE IDENTIFY BREAK ERROR:', error);
    return res.status(500).json({
      success: false,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to start face-identified break',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/* =========================================================
  Face 1:N IDENTIFY — END BREAK (kiosk/shared device)
========================================================= */

export const endFaceBreakIdentifyController = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      Lat, Lng,
      geoLocation: rawGeoLocation,
      deviceInfo: rawDeviceInfo
    } = req.body;

    const geoLocation = parseJsonField(rawGeoLocation, null);
    const deviceInfo = parseJsonField(rawDeviceInfo, {});

    const uploaded = getUploadedFile(req);
    if (!uploaded) {
      return abortAndRespond(session, res, 400, 'FACE_IMAGE_MISSING', 'A face image (file) is required');
    }

    let companyId;
    if (req.user.type === 'user') {
      companyId = req.user.companyId;
    } else {
      companyId = req.user.id;
    }

    const subscription = await Subscription.findOne({
      company: companyId,
      status: 'ACTIVE',
      isActive: true,
      endDate: { $gte: new Date() }
    });
    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'No active subscription',
        error: 'No active subscription found for this company'
      });
    }

    let detection;
    try {
      detection = await faceApi.detectFaceForCompany({
        companyId: String(companyId),
        fileBuffer: uploaded.fileBuffer,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        checkSpoofing: true
      });
    } catch (err) {
      return abortAndRespond(session, res, err.statusCode || 502, 'FACE_DETECT_FAILED', err.message);
    }

    const faceCount = detection?.data?.face_count ?? 0;
    if (faceCount === 0) {
      return abortAndRespond(session, res, 400, 'NO_FACE_DETECTED', 'No face detected in the image');
    }
    if (faceCount > 1) {
      return abortAndRespond(session, res, 400, 'MULTIPLE_FACES_DETECTED', 'Multiple faces detected. Only one face allowed.');
    }
    if (detection?.data?.spoofing && detection.data.spoofing.is_real === false) {
      return abortAndRespond(session, res, 403, 'SPOOF_DETECTED', 'Spoofing detected. Please use a real face.');
    }

    let identifyResult;
    try {
      identifyResult = await faceApi.identifyFace({
        companyId: String(companyId),
        fileBuffer: uploaded.fileBuffer,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        maxResults: 5
      });
    } catch (err) {
      return abortAndRespond(session, res, err.statusCode || 502, 'FACE_IDENTIFY_FAILED', err.message);
    }

    const matches = identifyResult?.data?.matches || [];
    const bestMatch = matches[0];

    if (!bestMatch || bestMatch.similarity < FACE_IDENTIFY_MIN_SIMILARITY) {
      return abortAndRespond(
        session, res, 404, 'NO_EMPLOYEE_MATCHED',
        'Could not identify a matching employee for this company.',
        { topMatches: matches }
      );
    }

    const runnerUp = matches[1];
    const isAmbiguous = runnerUp && (bestMatch.similarity - runnerUp.similarity) < 0.02;
    if (isAmbiguous) {
      return abortAndRespond(
        session, res, 409, 'AMBIGUOUS_FACE_MATCH',
        'Multiple employees closely match this face. Please use 1:1 verification instead.',
        { topMatches: matches }
      );
    }

    const matchedEmployeeId = bestMatch.employee_id;

    const employee = await Employee.findOne({
      userId: matchedEmployeeId,
      companyId,
      employmentStatus: 'active'
    }).session(session);

    if (!employee) {
      return abortAndRespond(
        session, res, 404, 'EMPLOYEE_NOT_FOUND',
        'Identified face does not correspond to an active employee in this company',
        { matchedEmployeeId }
      );
    }

    console.log(`✓ Face identified 1:N as ${employee.empCode} (similarity=${bestMatch.similarity})`);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const attendance = await Attendance.findOne({
      employeeId: employee._id,
      companyId,
      date: { $gte: startOfDay, $lte: endOfDay }
    }).session(session);

    if (!attendance) {
      return abortAndRespond(session, res, 404, 'ATTENDANCE_NOT_FOUND', 'Attendance not found');
    }

    const activeBreak = attendance.breaks.find(item => item.status === 'active');
    if (!activeBreak) {
      return abortAndRespond(session, res, 400, 'NO_ACTIVE_BREAK', 'No active break found');
    }

    let geoVerified = false;
    if (employee.officeLocation?.coordinates && employee.officeLocation.coordinates.length === 2) {
      const [officeLng, officeLat] = employee.officeLocation.coordinates;
      const userLng = parseFloat(Lng ?? geoLocation?.coordinates?.[0]);
      const userLat = parseFloat(Lat ?? geoLocation?.coordinates?.[1]);

      const distance = getDistance(officeLat, officeLng, userLat, userLng);
      const allowedRadius = employee.officeLocation.radius || 500;

      if (distance > allowedRadius) {
        return abortAndRespond(
          session, res, 403, 'OUTSIDE_OFFICE_RADIUS',
          `You are outside the allowed office location range (${Math.round(distance)}m from office).`,
          { allowedRadius, currentDistance: Math.round(distance), unit: 'meters' }
        );
      }
      geoVerified = true;
    }

    activeBreak.endTime = new Date();
    const durationMinutes = Math.floor((activeBreak.endTime - activeBreak.startTime) / (1000 * 60));

    activeBreak.durationMinutes = durationMinutes;
    activeBreak.durationHHMM = convertMinutesToHHMM(durationMinutes);
    activeBreak.exceededMinutes = Math.max(0, durationMinutes - activeBreak.allowedMinutes);
    activeBreak.geoVerified = geoVerified;
    activeBreak.status = 'completed';
    activeBreak.faceVerification = {
      verificationType: '1:N',
      matched: true,
      similarity: bestMatch.similarity,
      matchedEmployeeId,
      thresholdUsed: identifyResult?.data?.threshold_used,
      topMatches: matches
    };

    attendance.workSummary.totalBreakMinutes = attendance.breaks.reduce(
      (total, item) => total + (item.durationMinutes || 0), 0
    );

    await attendance.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: 'Face-identified break ended successfully',
      data: { ...activeBreak, employeeCode: employee.empCode, employeeName: employee.user_name }
    });

  } catch (error) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
    } catch (e) {
      console.error('Error aborting transaction:', e);
    } finally {
      session.endSession();
    }
    console.error('❌ END FACE IDENTIFY BREAK ERROR:', error);
    return res.status(500).json({
      success: false,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to end face-identified break',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};