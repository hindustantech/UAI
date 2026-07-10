// src/routes/faceRecognition.routes.js
import express from 'express';
import * as faceRecognitionController from '../../controllers/face/faceRecognition.controller.js';
import { uploadSingle } from '../../middlewares/upload.middleware.js';

const router = express.Router();

// Optional: router.use(requireAuth)

router.post('/verify', uploadSingle, faceRecognitionController.verify);
router.post('/identify', uploadSingle, faceRecognitionController.identify);

export default router;
