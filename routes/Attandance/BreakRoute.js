import express from 'express';
import multer from 'multer';
import {
  startBreakController,
  endBreakController,
  startFaceBreakController,
  endFaceBreakController,
  startFaceBreakIdentifyController,
  endFaceBreakIdentifyController
} from '../../controllers/BreakController.js';
import authMiddleware from '../../middlewares/authMiddleware.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.post('/start', authMiddleware, startBreakController);
router.post('/end', authMiddleware, endBreakController);

router.post('/face_start',  authMiddleware, upload.single('file'), startFaceBreakController);
router.post('/face_end',    authMiddleware, upload.single('file'), endFaceBreakController);

router.post('/face_identify_start', authMiddleware, upload.single('file'), startFaceBreakIdentifyController);
router.post('/face_identify_end',   authMiddleware, upload.single('file'), endFaceBreakIdentifyController);

export default router;
