import express from 'express';
import{getDocs,getHealthStatus}  from '../../controllers/face/docshelth.js';

const router = express.Router();
router.get('/health', getHealthStatus);
router.get('/docs', getDocs);

export default router;
