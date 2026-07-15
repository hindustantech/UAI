// src/routes/faceTraining.routes.js
import express from 'express';
import * as faceTrainingController from '../../controllers/face/faceTraining.controller.js';
import { uploadSingle, uploadBatch } from '../../middlewares/upload.middleware.js';

const router = express.Router();

// Optional: router.use(requireAuth)

router.post('/train/single', uploadSingle, faceTrainingController.trainSingle);
router.post('/train/batch', uploadBatch, faceTrainingController.trainBatch);
router.get('/train/status/:employeeId', faceTrainingController.getStatus);
router.delete('/train/deleteImage', faceTrainingController.deleteImage);
router.delete('/train/all', faceTrainingController.deleteAll);
export default router;
