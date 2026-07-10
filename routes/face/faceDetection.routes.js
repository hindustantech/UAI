// src/routes/faceDetection.routes.js
import express from 'express';
import * as faceDetectionController from '../../controllers/face/faceDetection.controller.js';
import { uploadSingle } from '../../middlewares/upload.middleware.js';

const router = express.Router();

// Optional: router.use(requireAuth)

router.post('/detect', uploadSingle, faceDetectionController.detect);

export default router;
