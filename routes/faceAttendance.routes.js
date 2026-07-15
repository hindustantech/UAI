// src/routes/faceAttendance.routes.js

import express from "express";
import multer from "multer";

import authmiddleware from "../middlewares/authMiddleware.js";
import {
    markAttendanceWithFaceVerify,
    markAttendanceWithFaceIdentify,
} from "../controllers/attandance/faceAttendance.controller.js";

const router = express.Router();

// Store uploaded image in memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB
    },
});

/**
 * 1:1 Face Verification
 * Employee is already logged in.
 * Face is verified against that employee.
 */
router.post(
    "/attendance/face/verify",
    authmiddleware,
    upload.single("file"),
    markAttendanceWithFaceVerify
);

/**
 * 1:N Face Identification
 * Used for kiosk/shared device.
 * Finds employee from face within company.
 */
router.post(
    "/attendance/face/identify",
    authmiddleware  ,
    upload.single("file"),
    markAttendanceWithFaceIdentify
);

export default router;