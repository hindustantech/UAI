// src/controllers/faceAttendance.controller.js
//
// Two attendance entry points built on top of your existing
// src/services/faceApi.service.js helpers:
//
//   1) markAttendanceWithFaceVerify   -> 1:1  (verifySpecificEmployee)
//      - Caller already knows WHO they are (req.user._id -> Employee).
//      - Face image only PROVES it's really that employee.
//
//   2) markAttendanceWithFaceIdentify -> 1:N  (identifyFace)
//      - Caller only proves WHICH company (req.user -> companyId).
//      - Face image is used to FIND the employee inside that company
//        (e.g. a shared kiosk/tablet at the office door).
//
// Auth: both endpoints assume an upstream auth middleware has already
// populated req.user (e.g. verified session/JWT and attached the user doc),
// so companyId is resolved directly from it:
//   let companyId;
//   if (req.user.type === 'user') companyId = req.user.companyId;
//   else companyId = req.user.id;
//
// Everything AFTER identity is resolved (shift resolution, holiday check,
// geo-fence, punch-in/punch-out math, status calculation) is your
// original markFaceAttendance logic, untouched, and is now shared by both
// endpoints via processAttendanceForEmployee() so it isn't duplicated.
//
// -------------------------------------------------------------------
// FIX (this version): the routes use multer memoryStorage + upload.single,
// which means the request is multipart/form-data. With multipart bodies,
// EVERY field in req.body arrives as a plain STRING — including
// geoLocation and breaks, even if the client sends JSON-looking text for
// them. Only deviceInfo was being JSON-parsed before use; geoLocation and
// breaks were being validated/used as if they were already objects/arrays,
// which made geoLocation?.coordinates always undefined and produced the
// "GEOLOCATION_INVALID" error even when the client sent valid JSON.
//
// Fix applied: reuse the existing safe-parse helper (renamed to
// parseJsonField for clarity) on geoLocation and breaks as well, in BOTH
// markAttendanceWithFaceVerify and markAttendanceWithFaceIdentify, before
// any validation or use of those fields.
// -------------------------------------------------------------------
//
// Assumes your existing project already exports these (same imports your
// original controller used) — adjust paths to match your project:
//   Employee, Subscription, Shift, Holiday, Attendance (mongoose models)
//   abortAndRespond, getDistance, getPunchTimeIST, createDateTimeIST,
//   diffMinutes, isFlexibleShift, checkEarlyPunch, calculatePayableMinutes,
//   determineStatus, logger
//
// Route wiring assumption: multer memoryStorage single-file upload, so
// req.file = { buffer, originalname, mimetype } is available on both routes,
// and req.user is set by your existing auth middleware.
//   router.post('/attendance/face/verify',    auth, upload.single('file'), markAttendanceWithFaceVerify);
//   router.post('/attendance/face/identify',  auth, upload.single('file'), markAttendanceWithFaceIdentify);

import mongoose from 'mongoose';

import Employee from '../../models/Attandance/Employee.js';
import { Subscription } from '../../models/Attandance/subscration/Subscription.js';
import Shift from '../../models/Attandance/Shift.js';
import Holiday from '../../models/Attandance/Holiday.js';
import Attendance from '../../models/Attandance/Attendance.js';

import { abortAndRespond } from './Attandance.js'
import {
  getDistance,
  getPunchTimeIST,
  createDateTimeIST,
  diffMinutes,
  isFlexibleShift,
  checkEarlyPunch,
  calculatePayableMinutes,
  determineStatus
} from './Attandance.js'
import logger from '../../utils/logger.js';

import * as faceApi from '../../services/faceApi.service.js';


// Minimum similarity to accept a face match at the attendance layer.
// (The Face API also applies its own settings.FACE_MATCH_THRESHOLD server-side;
// this is a second, app-level guard you can tune independently.)
const FACE_VERIFY_MIN_SIMILARITY = Number(process.env.FACE_VERIFY_MIN_SIMILARITY ?? 0);
const FACE_IDENTIFY_MIN_SIMILARITY = Number(process.env.FACE_IDENTIFY_MIN_SIMILARITY ?? 0);

/* ================================================================== */
/* Small local helpers                                                */
/* ================================================================== */

function getUploadedFile(req) {
  // multer single-file upload
  if (!req.file) return null;
  return {
    fileBuffer: req.file.buffer,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype
  };
}

// Generic safe-JSON-parse helper for any multipart/form-data field that is
// expected to be an object/array (geoLocation, deviceInfo, breaks, ...).
// multipart bodies always deliver strings, so any field the client sends
// as JSON.stringify(...) MUST be parsed back before you touch its shape.
function parseJsonField(raw, fallback = {}) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'object') return raw; // already parsed (e.g. JSON request instead of multipart)
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Kept as an alias so nothing else that imports/uses parseDeviceInfo breaks.
const parseDeviceInfo = (raw) => parseJsonField(raw, {});

/* ================================================================== */
/* 1) 1:1 — VERIFY A KNOWN EMPLOYEE                                    */
/* ================================================================== */

export const markAttendanceWithFaceVerify = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    /* ---- 1. Auth + body validation ---- */
    const u_id = req.user._id;

    const {
      date,
      punchIn,
      punchOut,
      breaks: rawBreaks,
      geoLocation: rawGeoLocation,
      deviceInfo: rawDeviceInfo,
      remarks
    } = req.body;

    // Parse multipart string fields back into real objects/arrays.
    const geoLocation = parseJsonField(rawGeoLocation, null);
    const deviceInfo = parseJsonField(rawDeviceInfo, {});
    const breaks = Array.isArray(rawBreaks)
      ? rawBreaks
      : (parseJsonField(rawBreaks, []) || []);

    if (!date) {
      return abortAndRespond(session, res, 400, 'DATE_MISSING', 'Date is required');
    }
    if (!geoLocation?.coordinates || geoLocation.coordinates.length !== 2) {
      return abortAndRespond(session, res, 400, 'GEOLOCATION_INVALID', 'Valid geoLocation coordinates required');
    }
    if (!punchIn && !punchOut) {
      return abortAndRespond(session, res, 400, 'PUNCH_MISSING', 'Either punchIn or punchOut is required');
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

    /* ---- 3. Employee validation (identity is ALREADY known here) ---- */
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

    /* ---- 4. FACE STEP — prove this employee is who they claim to be ---- */

    // Optional but cheap: quick pre-check so we can give a fast, specific
    // error ("no face" / "multiple faces") before spending a full verify call.
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

    let verifyResult;
    try {
      verifyResult = await faceApi.verifySpecificEmployee({
        employeeId: String(employee.userId),
        companyId: String(companyId),
        purpose: punchOut && !punchIn ? 'punch_out' : 'punch_in',
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

    /* ---- 5. Hand off to the shared attendance logic ---- */
    return processAttendanceForEmployee({
      session, res, employee, companyId,
      date, punchIn, punchOut, breaks, geoLocation,
      deviceInfo,
      remarks,
      faceMeta: {
        verificationType: '1:1',
        matched: true,
        similarity: vData.similarity,
        confidence: vData.confidence,
        detScore: vData.det_score,
        thresholdUsed: vData.threshold_used
      }
    });

  } catch (error) {
    try {
      await session.abortTransaction();
    } catch (e) {
      console.error('Error aborting transaction:', e);
    } finally {
      session.endSession();
    }
    console.error('❌ Face-Verify Attendance Error:', error);
    return res.status(500).json({
      success: false,
      errorCode: 'ATTENDANCE_ERROR',
      message: 'Failed to process attendance',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/* ================================================================== */
/* 2) 1:N — IDENTIFY THE EMPLOYEE FROM THE FACE, WITHIN THE COMPANY   */
/* ================================================================== */

export const markAttendanceWithFaceIdentify = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    /* ---- 1. Body validation (note: NO u_id / employee here yet) ---- */
    const {
      date,
      punchIn,
      punchOut,
      breaks: rawBreaks,
      geoLocation: rawGeoLocation,
      deviceInfo: rawDeviceInfo,
      remarks
    } = req.body;

    // Parse multipart string fields back into real objects/arrays.
    const geoLocation = parseJsonField(rawGeoLocation, null);
    const deviceInfo = parseJsonField(rawDeviceInfo, {});
    const breaks = Array.isArray(rawBreaks)
      ? rawBreaks
      : (parseJsonField(rawBreaks, []) || []);

    if (!date) {
      return abortAndRespond(session, res, 400, 'DATE_MISSING', 'Date is required');
    }
    if (!geoLocation?.coordinates || geoLocation.coordinates.length !== 2) {
      return abortAndRespond(session, res, 400, 'GEOLOCATION_INVALID', 'Valid geoLocation coordinates required');
    }
    if (!punchIn && !punchOut) {
      return abortAndRespond(session, res, 400, 'PUNCH_MISSING', 'Either punchIn or punchOut is required');
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

    /* ---- 3. FACE STEP — figure out WHO this is, inside this company ---- */

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

    // Guard against ambiguous matches (two employees with near-identical scores)
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

    /* ---- 4. Hand off to the shared attendance logic ---- */
    return processAttendanceForEmployee({
      session, res, employee, companyId,
      date, punchIn, punchOut, breaks, geoLocation,
      deviceInfo,
      remarks,
      faceMeta: {
        verificationType: '1:N',
        matched: true,
        similarity: bestMatch.similarity,
        matchedEmployeeId,
        thresholdUsed: identifyResult?.data?.threshold_used,
        topMatches: matches
      }
    });

  } catch (error) {
    try {
      await session.abortTransaction();
    } catch (e) {
      console.error('Error aborting transaction:', e);
    } finally {
      session.endSession();
    }
    console.error('❌ Face-Identify Attendance Error:', error);
    return res.status(500).json({
      success: false,
      errorCode: 'ATTENDANCE_ERROR',
      message: 'Failed to process attendance',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/* ================================================================== */
/* SHARED CORE — Uses employee's assigned shift only, no external      */
/* shiftId parameter. Shift is always taken from employee.shift field  */
/* ================================================================== */

async function processAttendanceForEmployee({
  session, res, employee, companyId,
  date, punchIn, punchOut, breaks, geoLocation, deviceInfo, remarks,
  faceMeta = {}
}) {
  /* ===========================
     SHIFT RESOLUTION - ALWAYS FROM EMPLOYEE SCHEMA
  =========================== */

  let shiftData = null;

  // Always and only use the shift assigned to the employee
  if (!employee.shift) {
    return abortAndRespond(
      session, res, 400, 'NO_SHIFT_ASSIGNED',
      'No shift assigned to employee. Please assign a shift first.',
      { employeeId: employee._id, empCode: employee.empCode, action: 'Assign a shift to this employee' }
    );
  }

  shiftData = await Shift.findOne({
    _id: employee.shift,
    companyId,
    isDeleted: false
  }).session(session);

  if (!shiftData) {
    return abortAndRespond(
      session, res, 404, 'EMPLOYEE_SHIFT_NOT_FOUND',
      "Employee's assigned shift not found or has been deleted. Please update shift assignment.",
      {
        employeeId: employee._id,
        empCode: employee.empCode,
        assignedShiftId: employee.shift,
        action: 'Please reassign a valid shift to this employee'
      }
    );
  }

  console.log(`✓ Shift Resolved: ${shiftData.shiftName} (${shiftData.shiftCode}) for employee ${employee.empCode}`);

  /* ===========================
     NORMALIZE DATE & CHECK HOLIDAY
  =========================== */

  const attendanceDateIST = new Date(date);
  const dateString = attendanceDateIST.toISOString().split('T')[0];

  const holiday = await Holiday.findOne({ companyId, date: attendanceDateIST }).session(session);
  let baseStatus = holiday ? 'holiday' : 'present';

  /* ===========================
     GEO-FENCE VALIDATION
  =========================== */

  let geoVerified = false;

  if (employee.officeLocation?.coordinates && employee.officeLocation.coordinates.length === 2) {
    const [officeLng, officeLat] = employee.officeLocation.coordinates;
    const [userLng, userLat] = geoLocation.coordinates;

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

  /* ===========================
     FIND EXISTING ATTENDANCE
  =========================== */

  let attendance = await Attendance.findOne({
    companyId, employeeId: employee._id, date: attendanceDateIST
  }).session(session);

  /* ===========================
     CONVERT PUNCH TIMES TO IST
  =========================== */

  let punchInTimeIST = punchIn ? getPunchTimeIST(new Date(punchIn)) : null;
  let punchOutTimeIST = punchOut ? getPunchTimeIST(new Date(punchOut)) : null;

  /* ===========================
     SHIFT TIMES IN IST
  =========================== */

  const shiftStartTimeIST = createDateTimeIST(dateString, shiftData.startTime);
  const shiftEndTimeIST = createDateTimeIST(dateString, shiftData.endTime);
  const shiftDurationMinutes = diffMinutes(shiftStartTimeIST, shiftEndTimeIST);

  const isFlexible = isFlexibleShift(shiftData);
  const earlyPunchLimit = shiftData.earlyPunchLimit || 60;
  const afterAbsentMarkGrace = shiftData.gracePeriod?.afterAbsentMark || 30;

  /* ===========================
     EARLY PUNCH-IN VALIDATION (Regular shifts only)
  =========================== */

  if (punchInTimeIST && !isFlexible) {
    const earlyPunchCheck = checkEarlyPunch(punchInTimeIST, shiftStartTimeIST, earlyPunchLimit);
    if (!earlyPunchCheck.isValid) {
      return abortAndRespond(
        session, res, 400, 'EARLY_PUNCH_NOT_ALLOWED', earlyPunchCheck.message,
        {
          punchTime: punchInTimeIST,
          shiftStartTime: shiftStartTimeIST,
          minutesBeforeShift: earlyPunchCheck.minutesBeforeShift,
          allowedEarlyMinutes: earlyPunchLimit,
          suggestion: `Please punch in between ${shiftData.startTime} or maximum ${earlyPunchLimit} minutes before shift start`
        }
      );
    }
  }

  /* ===========================
     PUNCH IN (NEW ATTENDANCE)
  =========================== */

  if (!attendance) {
    if (!punchInTimeIST) {
      return abortAndRespond(session, res, 400, 'PUNCH_IN_REQUIRED', 'Punch In time is required for new attendance record');
    }

    const inTimeUTC = new Date(punchIn);
    const outTimeUTC = punchOut ? new Date(punchOut) : null;

    let finalStatus = baseStatus === 'holiday' ? 'holiday' : 'present';
    let totalMinutes = 0, overtimeMinutes = 0, earlyLeaveMinutes = 0, lateMinutes = 0, isSuspicious = false;
    let finalRemarks = remarks || '';

    if (isFlexible) {
      if (outTimeUTC) {
        totalMinutes = diffMinutes(inTimeUTC, outTimeUTC);
        if (punchOutTimeIST > shiftEndTimeIST) overtimeMinutes = diffMinutes(shiftEndTimeIST, punchOutTimeIST);
        if (punchOutTimeIST < shiftEndTimeIST) earlyLeaveMinutes = diffMinutes(punchOutTimeIST, shiftEndTimeIST);
      }
      if (!finalRemarks) finalRemarks = 'Flexible shift - Punch-in recorded';
    } else {
      const minutesAfterShiftStart = diffMinutes(shiftStartTimeIST, punchInTimeIST);

      if (minutesAfterShiftStart > afterAbsentMarkGrace) {
        return abortAndRespond(
          session, res, 400, 'PUNCH_TOO_LATE',
          `❌ You are too late! You are ${minutesAfterShiftStart} minutes late for your shift. Shift starts at ${shiftData.startTime}. Maximum allowed delay is ${afterAbsentMarkGrace} minutes. Please contact your manager.`,
          {
            minutesLate: minutesAfterShiftStart,
            maxAllowedDelay: afterAbsentMarkGrace,
            shiftStartTime: shiftData.startTime,
            shiftEndTime: shiftData.endTime,
            currentTime: punchInTimeIST,
            suggestion: 'Contact your manager or apply for leave'
          }
        );
      }

      const gracePeriodLate = shiftData.gracePeriod?.lateEntry || 10;
      lateMinutes = Math.max(0, minutesAfterShiftStart - gracePeriodLate);
      const lateRemarks = lateMinutes > 0 ? ` (Late by ${lateMinutes} minutes after ${gracePeriodLate}min grace)` : '';

      if (outTimeUTC) {
        totalMinutes = diffMinutes(inTimeUTC, outTimeUTC);

        if (punchOutTimeIST > shiftEndTimeIST) {
          const earlyExitGrace = shiftData.gracePeriod?.earlyExit || 10;
          const rawOvertime = diffMinutes(shiftEndTimeIST, punchOutTimeIST);
          overtimeMinutes = Math.max(0, rawOvertime - earlyExitGrace);
          const maxOvertimeMinutes = (shiftData.overtime?.maxHoursPerDay || 4) * 60;
          if (overtimeMinutes > maxOvertimeMinutes && !shiftData.overtime?.allowed) isSuspicious = true;
        }
        if (punchOutTimeIST < shiftEndTimeIST) {
          earlyLeaveMinutes = diffMinutes(punchOutTimeIST, shiftEndTimeIST);
        }

        const finalPayableMinutes = calculatePayableMinutes(totalMinutes, breaks || []);
        finalStatus = determineStatus(finalPayableMinutes, shiftDurationMinutes, baseStatus === 'holiday');
      }

      if (!finalRemarks) {
        finalRemarks = !outTimeUTC
          ? `Punch-in recorded at ${shiftData.startTime} shift start${lateRemarks}`
          : `Punch-in and punch-out completed${lateRemarks}`;
      }
    }

    attendance = new Attendance({
      companyId,
      employeeId: employee._id,
      date: attendanceDateIST,
      punchIn: inTimeUTC,
      punchOut: outTimeUTC,
      shift: {
        name: shiftData.shiftName,
        startTime: shiftData.startTime,
        endTime: shiftData.endTime,
        shiftMinutes: shiftDurationMinutes
      },
      breaks: breaks || [],
      status: finalStatus,
      geoLocation: {
        type: 'Point',
        coordinates: geoLocation.coordinates,
        accuracy: geoLocation.accuracy,
        verified: geoVerified,
        source: geoLocation.source || 'gps'
      },
      deviceInfo,
      workSummary: {
        totalMinutes: Math.max(0, totalMinutes),
        payableMinutes: Math.max(0, calculatePayableMinutes(totalMinutes, breaks || [])),
        overtimeMinutes: Math.max(0, overtimeMinutes),
        lateMinutes,
        earlyLeaveMinutes: Math.max(0, earlyLeaveMinutes)
      },
      lateByMinutes: lateMinutes,
      totalWorkingHours: Math.max(0, totalMinutes / 60) || 0,
      remarks: finalRemarks,
      isSuspicious: outTimeUTC ? isSuspicious : false,
      faceVerification: faceMeta, // NEW: audit trail of how identity was established
      punchHistory: outTimeUTC ? [{
        punchOut: outTimeUTC,
        geoLocation: {
          type: 'Point', coordinates: geoLocation.coordinates, accuracy: geoLocation.accuracy,
          verified: geoVerified, source: geoLocation.source || 'gps'
        },
        deviceInfo,
        source: deviceInfo?.source || 'mobile'
      }] : [],
      lastPunchAt: outTimeUTC || inTimeUTC,
      approvalStatus: 'pending'
    });

    await attendance.save({ session });
    await session.commitTransaction();
    session.endSession();

    const punchInISTResponse = attendance.punchIn ? getPunchTimeIST(attendance.punchIn) : null;
    const punchOutISTResponse = attendance.punchOut ? getPunchTimeIST(attendance.punchOut) : null;

    const responseMessage = !outTimeUTC
      ? 'Punch-in recorded successfully. Final status will be updated on punch-out.'
      : `Attendance marked as ${finalStatus} successfully`;

    return res.status(201).json({
      success: true,
      message: responseMessage,
      data: {
        attendanceId: attendance._id,
        employeeId: employee._id,
        employeeCode: employee.empCode,
        employeeName: employee.user_name,
        date: attendanceDateIST,
        status: attendance.status,
        punchIn: punchInISTResponse,
        punchOut: punchOutISTResponse,
        shift: { name: attendance.shift.name, startTime: attendance.shift.startTime, endTime: attendance.shift.endTime },
        workSummary: attendance.workSummary,
        geoVerified: attendance.geoLocation?.verified,
        isSuspicious: attendance.isSuspicious,
        approvalStatus: attendance.approvalStatus,
        remarks: attendance.remarks,
        faceVerification: attendance.faceVerification
      }
    });
  }

  /* ===========================
     PUNCH OUT (EXISTING ATTENDANCE)
  =========================== */

  if (!punchOutTimeIST) {
    let errorMessage = 'Punch Out time is required';
    let errorDetails = {};

    if (attendance.status === 'holiday') {
      errorMessage = 'Cannot punch out on a holiday. This day is already marked as holiday.';
      errorDetails = { date: dateString, status: attendance.status, action: 'Holiday detected - No punch-out required' };
    } else if (attendance.status === 'weekly_off') {
      errorMessage = 'Cannot punch out on a weekly off. This day is already marked as weekly off.';
      errorDetails = { date: dateString, status: attendance.status, action: 'Weekly off detected - No punch-out required' };
    } else if (attendance.punchIn && !attendance.punchOut) {
      errorMessage = 'Punch Out time is required to complete your attendance';
      errorDetails = {
        punchInTime: attendance.punchIn,
        currentStatus: 'pending_punch_out',
        suggestion: 'Please provide punchOut time to mark attendance as complete'
      };
    }

    return abortAndRespond(session, res, 400, 'PUNCH_OUT_REQUIRED', errorMessage, errorDetails);
  }

  const outTimeUTC = new Date(punchOut);

  const lastPunch = attendance.punchHistory?.[attendance.punchHistory.length - 1];
  if (lastPunch && lastPunch.punchOut) {
    const lastPunchTimeIST = getPunchTimeIST(new Date(lastPunch.punchOut));
    const gap = diffMinutes(lastPunchTimeIST, punchOutTimeIST);
    if (gap < 3) {
      return abortAndRespond(
        session, res, 429, 'PUNCH_TOO_FREQUENT',
        'Punch registered too soon. Please wait 3 minutes before trying again.',
        { lastPunchTime: lastPunch.punchOut, minimumGapMinutes: 3, currentGapMinutes: gap }
      );
    }
  }

  attendance.punchHistory.push({
    punchOut: outTimeUTC,
    geoLocation: {
      type: 'Point', coordinates: geoLocation.coordinates, accuracy: geoLocation.accuracy,
      verified: geoVerified, source: geoLocation.source || 'gps'
    },
    deviceInfo,
    source: deviceInfo?.source || 'mobile',
    createdAt: new Date()
  });

  attendance.lastPunchAt = outTimeUTC;
  attendance.punchOut = outTimeUTC;
  // Keep a record of the face check that authorized THIS punch-out too.
  attendance.faceVerification = faceMeta;

  const inTimeUTC = new Date(attendance.punchIn);
  const inTimeIST = getPunchTimeIST(inTimeUTC);
  let totalMinutes = diffMinutes(inTimeUTC, outTimeUTC);
  let isSuspicious = attendance.isSuspicious || false;

  if (isFlexible) {
    let overtimeMinutes = 0, earlyLeaveMinutes = 0;
    if (punchOutTimeIST > shiftEndTimeIST) overtimeMinutes = diffMinutes(shiftEndTimeIST, punchOutTimeIST);
    if (punchOutTimeIST < shiftEndTimeIST) earlyLeaveMinutes = diffMinutes(punchOutTimeIST, shiftEndTimeIST);

    const payableMinutes = calculatePayableMinutes(totalMinutes, attendance.breaks);
    const finalStatus = totalMinutes > 0 ? 'present' : 'absent';

    attendance.status = finalStatus;
    attendance.workSummary = {
      totalMinutes: Math.max(0, totalMinutes),
      payableMinutes: Math.max(0, payableMinutes),
      overtimeMinutes: Math.max(0, overtimeMinutes),
      lateMinutes: 0,
      earlyLeaveMinutes: Math.max(0, earlyLeaveMinutes)
    };
    attendance.lateByMinutes = 0;
    attendance.totalWorkingHours = Math.max(0, totalMinutes / 60);
    attendance.remarks = `Punch-out completed. Total work: ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
  } else {
    const minutesAfterShiftStart = diffMinutes(shiftStartTimeIST, inTimeIST);
    const gracePeriodLate = shiftData.gracePeriod?.lateEntry || 10;
    const lateMinutes = Math.max(0, minutesAfterShiftStart - gracePeriodLate);

    let overtimeMinutes = 0, earlyLeaveMinutes = 0;

    if (punchOutTimeIST > shiftEndTimeIST) {
      const earlyExitGrace = shiftData.gracePeriod?.earlyExit || 10;
      const rawOvertime = diffMinutes(shiftEndTimeIST, punchOutTimeIST);
      overtimeMinutes = Math.max(0, rawOvertime - earlyExitGrace);
      const maxOvertimeMinutes = (shiftData.overtime?.maxHoursPerDay || 4) * 60;
      if (overtimeMinutes > maxOvertimeMinutes && !shiftData.overtime?.allowed) isSuspicious = true;
    }
    if (punchOutTimeIST < shiftEndTimeIST) {
      earlyLeaveMinutes = diffMinutes(punchOutTimeIST, shiftEndTimeIST);
    }

    const payableMinutes = calculatePayableMinutes(totalMinutes, attendance.breaks);
    const percentageWorked = (payableMinutes / shiftDurationMinutes) * 100;

    let finalStatus;
    if (punchOutTimeIST >= shiftEndTimeIST) finalStatus = 'present';
    else if (percentageWorked >= 50) finalStatus = 'present';
    else if (percentageWorked > 0) finalStatus = 'half_day';
    else finalStatus = 'absent';

    const workDurationStr = `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
    let statusRemark;
    if (finalStatus === 'half_day') {
      statusRemark = `Half day - Worked ${percentageWorked.toFixed(1)}% of shift (${workDurationStr} / ${Math.floor(shiftDurationMinutes / 60)}h ${shiftDurationMinutes % 60}m)`;
    } else if (finalStatus === 'present' && punchOutTimeIST < shiftEndTimeIST) {
      statusRemark = `Present - Left early (${workDurationStr} worked)`;
    } else if (finalStatus === 'present' && punchOutTimeIST >= shiftEndTimeIST) {
      statusRemark = `Present - Completed full shift (${workDurationStr})`;
    } else {
      statusRemark = `Punch-out completed. Total work: ${workDurationStr}`;
    }
    if (lateMinutes > 0) statusRemark += ` (Late by ${lateMinutes} minutes)`;

    attendance.remarks = statusRemark;
    attendance.status = finalStatus;
    attendance.workSummary = {
      totalMinutes: Math.max(0, totalMinutes),
      payableMinutes: Math.max(0, payableMinutes),
      overtimeMinutes: Math.max(0, overtimeMinutes),
      lateMinutes: Math.max(0, lateMinutes),
      earlyLeaveMinutes: Math.max(0, earlyLeaveMinutes)
    };
    attendance.lateByMinutes = Math.max(0, lateMinutes);
    attendance.totalWorkingHours = Math.max(0, totalMinutes / 60);

    if (
      attendance.deviceInfo?.deviceId &&
      deviceInfo?.deviceId &&
      attendance.deviceInfo.deviceId !== deviceInfo.deviceId
    ) {
      isSuspicious = true;
    }
    attendance.isSuspicious = isSuspicious;
  }

  await attendance.save({ session });
  await session.commitTransaction();
  session.endSession();

  const savedAttendance = await Attendance.findById(attendance._id).lean();

  const punchInISTResponse = savedAttendance.punchIn ? getPunchTimeIST(savedAttendance.punchIn) : null;
  const punchOutISTResponse = savedAttendance.punchOut ? getPunchTimeIST(savedAttendance.punchOut) : null;

  let successMessage = 'Punch-out recorded successfully. ';
  if (savedAttendance.status === 'half_day') {
    successMessage += 'Marked as HALF DAY because you worked less than 50% of shift duration.';
  } else if (savedAttendance.status === 'present') {
    successMessage += 'Marked as PRESENT.';
  }

  return res.status(201).json({
    success: true,
    message: successMessage,
    data: {
      attendanceId: savedAttendance._id,
      employeeId: employee._id,
      employeeCode: employee.empCode,
      employeeName: employee.user_name,
      date: attendanceDateIST,
      status: savedAttendance.status,
      punchIn: punchInISTResponse,
      punchOut: punchOutISTResponse,
      shift: { name: savedAttendance.shift?.name, startTime: savedAttendance.shift?.startTime, endTime: savedAttendance.shift?.endTime },
      workSummary: savedAttendance.workSummary,
      geoVerified: savedAttendance.geoLocation?.verified,
      isSuspicious: savedAttendance.isSuspicious,
      approvalStatus: savedAttendance.approvalStatus,
      remarks: savedAttendance.remarks,
      faceVerification: savedAttendance.faceVerification
    }
  });
}

export default {
  markAttendanceWithFaceVerify,
  markAttendanceWithFaceIdentify
};