// src/routes/index.js
import express from 'express';
import faceDetectionRoutes from './faceDetection.routes.js';
import faceTrainingRoutes from './faceTraining.routes.js';
import faceRecognitionRoutes from './faceRecognition.routes.js';
import errorHandler from '../../middlewares/errorHandler.middleware.js';
const router = express.Router();

// Final paths (mounted at /api in server.js):
//   POST /api/face/detect
//   POST /api/face/train/single
//   POST /api/face/train/batch
//   GET  /api/face/train/status/:employeeId
//   POST /api/face/verify
//   POST /api/face/identify
router.use('/face', faceDetectionRoutes);
router.use('/face', faceTrainingRoutes);
router.use('/face', faceRecognitionRoutes);
router.use(errorHandler); // Global error handler for all routes
export default router;
