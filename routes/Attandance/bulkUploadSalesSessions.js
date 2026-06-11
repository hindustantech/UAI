import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

import { 
  bulkUploadSalesSessions, 
  getBulkUploadTemplate,
  getUploaderInfo 
} from "../../controllers/bulkUploadSalesSessions.js";
import authMiddleware from "../../middlewares/authMiddleware.js";

const router = express.Router();

/* ============================================================
MULTER CONFIGURATION
============================================================ */

// Ensure upload directory exists
const uploadDir = 'uploads/bulk';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `bulk-upload-${uniqueSuffix}${extension}`);
  }
});

// File filter function
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv', // .csv
    'application/csv', // .csv
    'text/comma-separated-values' // .csv
  ];

  const allowedExtensions = ['.xlsx', '.xls', '.csv'];
  const fileExtension = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed types: ${allowedExtensions.join(', ')}`), false);
  }
};

// Multer upload instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 1 // Only 1 file at a time
  }
});

/* ============================================================
ERROR HANDLING MIDDLEWARE FOR MULTER
============================================================ */

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 10MB'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Please upload only one file at a time'
      });
    }
    return res.status(400).json({
      success: false,
      message: `Upload error: ${err.message}`
    });
  } else if (err) {
    // Other errors (like invalid file type)
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  next();
};

/* ============================================================
ROUTES
============================================================ */

// All routes require authentication
router.use(authMiddleware);

/**
 * @route   POST /api/sales-sessions/bulk-upload
 * @desc    Bulk upload sales sessions with customer details
 * @access  Private (Admin, Partner, Agency)
 */
router.post(
  '/bulk-upload',
  upload.single('file'),
  handleMulterError,
  bulkUploadSalesSessions
);

/**
 * @route   GET /api/sales-sessions/bulk-upload-template
 * @desc    Download bulk upload template
 * @access  Private (Authenticated users)
 */
router.get(
  '/bulk-upload-template',
  getBulkUploadTemplate
);

/**
 * @route   GET /api/sales-sessions/uploader-info
 * @desc    Get uploader's current information (location, company, etc.)
 * @access  Private (Authenticated users)
 */
router.get(
  '/uploader-info',
  getUploaderInfo
);





export default router;
