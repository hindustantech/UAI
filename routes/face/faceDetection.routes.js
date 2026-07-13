// src/routes/faceDetection.routes.js
import { Router } from 'express';
import multer from 'multer';
import * as faceDetectionController from '../../controllers/face/faceDetection.controller.js';
import { SUPPORTED_IMAGE_FORMATS, MAX_FILE_SIZE } from '../../config/faceApi.config.js';

const router = Router();

// Configure multer for memory storage with validation
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Validate file type
    if (SUPPORTED_IMAGE_FORMATS.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(`Unsupported file type: ${file.mimetype}. Supported formats: ${SUPPORTED_IMAGE_FORMATS.join(', ')}`),
        false
      );
    }
  },
});

// Configure multer for batch uploads (max 5 files)
const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5, // Max 5 files for batch
  },
  fileFilter: (req, file, cb) => {
    if (SUPPORTED_IMAGE_FORMATS.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(`Unsupported file type: ${file.mimetype}`),
        false
      );
    }
  },
});

// Error handling middleware for multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum 5 files allowed.',
      });
    }
    return res.status(400).json({
      success: false,
      message: `Upload error: ${err.message}`,
    });
  }
  if (err.message.includes('Unsupported file type')) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
  next(err);
};

// ==================== DETECTION ROUTES ====================

// POST /api/face/detect - Generic face detection (with optional context)
router.post(
  '/detect',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  faceDetectionController.detectFaces
);

// POST /api/face/detect/company - Company-specific detection
router.post(
  '/detect/company',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  faceDetectionController.detectForCompany
);

// POST /api/face/detect/employee - Employee-specific detection with quick match
router.post(
  '/detect/employee',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  faceDetectionController.detectForEmployee
);

// POST /api/face/detect/validate-enrollment - Validate image for enrollment
router.post(
  '/detect/validate-enrollment',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  faceDetectionController.validateEnrollment
);

// POST /api/face/detect/batch - Batch detection for multiple images
router.post(
  '/detect/batch',
  (req, res, next) => {
    batchUpload.array('files', 5)(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  faceDetectionController.batchDetect
);

// GET /api/face/detect/health - Health check
router.get('/detect/health', faceDetectionController.health);

export default router;