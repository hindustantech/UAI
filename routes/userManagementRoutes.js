// routes/userRoutes.js
import express from 'express';
import {
    getAllUsers,
    exportUsers,
    getUserAnalytics,
    getUserProfile,
    changeUserRole,
    toggleUserBlock,
    createUser
} from '../controllers/Usermanagement.js';
import { getme } from "../controllers/getUser.js";
import authMiddleware from '../middlewares/authMiddleware.js';
import { checkPermission } from '../middlewares/checkPermission.js';
// Assume auth middleware if needed, e.g., const auth = require('../middleware/auth');
// router.use(auth);
  
const router = express.Router();

// User management routes
router.get("/getme", authMiddleware, getme);
router.get('/', getAllUsers); // All users with filters/pagination
router.post('/', createUser); // Add user
router.get('/export', authMiddleware, checkPermission('user.export'), exportUsers); // Export users
router.get('/analytics', getUserAnalytics); // Analytics
router.get('/:id', getUserProfile); // View profile
router.put('/:id/role', authMiddleware, checkPermission('user.update'), changeUserRole); // Change role
router.put('/:id/block', authMiddleware, checkPermission('user.update'), toggleUserBlock); // Block/unblock

export default router;