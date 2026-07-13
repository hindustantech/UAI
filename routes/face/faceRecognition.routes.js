// src/routes/faceRecognition.routes.js
import express from 'express';
import * as faceRecognitionController from '../../controllers/face/faceRecognition.controller.js';
import { uploadSingle } from '../../middlewares/upload.middleware.js';

const router = express.Router();




// POST /api/face/verify - Supports both 1:1 and 1:N verification
router.post('/verify', uploadSingle, faceRecognitionController.verify);

// POST /api/face/verify-employee - Explicit 1:1 verification
router.post('/verify-employee', uploadSingle, faceRecognitionController.verifyEmployee);

// POST /api/face/identify - Identify face (top N matches)
router.post('/identify', uploadSingle, faceRecognitionController.identify);

// POST /api/face/search - Search employee by face (alias for identify)
router.post('/search', uploadSingle, faceRecognitionController.search);

// GET /api/face/health - Health check
router.get('/health', faceRecognitionController.health);
export default router;
