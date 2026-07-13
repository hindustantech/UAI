// src/routes/index.js
import express from 'express';
import faceDetectionRoutes from './faceDetection.routes.js';
import faceTrainingRoutes from './faceTraining.routes.js';
import faceRecognitionRoutes from './faceRecognition.routes.js';
import docsHealthRoutes from './docshelth.js';
import errorHandler from '../../middlewares/errorHandler.middleware.js';

const router = express.Router();

router.use('/face', faceDetectionRoutes);
router.use('/face', faceTrainingRoutes);
router.use('/face', faceRecognitionRoutes);
router.use('/face', docsHealthRoutes);
router.use(errorHandler); // Global error handler for all routes
export default router;
