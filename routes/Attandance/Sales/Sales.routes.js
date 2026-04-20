import express from "express";
import multer from "multer";

import {
  punchIn,
  completeSalesForm,
  punchOut,
  getSessions,
  getSessionDetails,
  getTodaySessions,
  updateRoute,
  getSessionRoute
} from "../../../controllers/attandance/Sales/Sales.js";

import authMiddleware from "../../../middlewares/authMiddleware.js";

const router = express.Router();

// Configure multer for memory storage (files stay in buffer for Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and GIF are allowed.'));
    }
  }
});

// ============================================
// SESSION MANAGEMENT ROUTES
// ============================================

// 1. PUNCH IN - Start a new session
router.post(
  "/punch-in", 
  authMiddleware, 
  upload.single('punchInPhoto'), 
  punchIn
);

// 2. UPDATE ROUTE - Real-time location tracking (optional)
router.put(
  "/route/:sessionId", 
  authMiddleware, 
  updateRoute
);

// 3. COMPLETE SALES FORM - Fill customer and sales details
router.put(
  "/complete-form/:sessionId", 
  authMiddleware, 
  upload.fields([
    { name: 'shopPhoto', maxCount: 1 },     // Shop/business photo
    { name: 'visitPhoto', maxCount: 1 }     // Visit evidence photo
  ]), 
  completeSalesForm
);

// 4. PUNCH OUT - End session
router.put(
  "/punch-out", 
  authMiddleware, 
  upload.single('punchOutPhoto'), 
  punchOut
);

// 5. GET SESSION DETAILS - Get single session with all details
router.get(
  "/session/:sessionId", 
  authMiddleware, 
  getSessionDetails
);

// 6. GET SESSION ROUTE - Get route path for a session
router.get(
  "/session/:sessionId/route", 
  authMiddleware, 
  getSessionRoute
);

// 7. GET ALL SESSIONS - With filters and pagination
router.get(
  "/sessions", 
  authMiddleware, 
  getSessions
);

// 8. GET TODAY'S SESSIONS - Quick view of today's visits
router.get(
  "/today", 
  authMiddleware, 
  getTodaySessions
);

export default router;