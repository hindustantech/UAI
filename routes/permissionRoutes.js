import express from 'express';
import {     assignPermission,
    removePermission,
    getUserPermissions,
    createPermission,
    getAllPermissions,
    getPermission,
    updatePermission,
    deletePermission } from '../controllers/permissionController.js';
import {
    checkPermission
} from '../middlewares/checkPermission.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();





// Permission CRUD
router.post('/', authMiddleware, checkPermission('permission.create'), createPermission);
router.get('/', authMiddleware, checkPermission('permission.read'), getAllPermissions);
router.put('/:id', authMiddleware, checkPermission('permission.update'), updatePermission);
router.delete('/:id', authMiddleware, checkPermission('permission.delete'), deletePermission);

// Only admins can assign/remove permissions
router.post('/assign', authMiddleware, checkPermission('permission.assign'), assignPermission);
router.post('/remove', authMiddleware, checkPermission('permission.assign'), removePermission);
// Any admin can view
router.get('/getUserPermissions', authMiddleware, getUserPermissions);

export default router;
