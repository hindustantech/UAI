import express from 'express';
import { startBreakController, endBreakController } from '../../controllers/BreakController.js';
import authMiddleware from '../../middlewares/authMiddleware.js';
const router = express.Router();

router.post('/start', authMiddleware, startBreakController);
router.post('/end', authMiddleware, endBreakController);



export default router;
