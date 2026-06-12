import express from 'express';
// Make sure path is correct
import {
    createPlan,
    updatePlan,
    deletePlan,
    togglePlanStatus,
    getAllPlans,
    getPlanById,
    getAlladminPlans,
    toggleAutoCheckout
} from '../controllers/attandance/Subscriptions/Plan.js';
import { checkPermission } from '../middlewares/checkPermission.js'
import authMiddleware from '../middlewares/authMiddleware.js';
const router = express.Router();
    // all
// Plan Routes
router.post('/', authMiddleware, checkPermission('plans.create'), createPlan);                    // Create Plan
router.get('/', getAllPlans);                    // Get All Plans (with pagination & filters)
router.get('/getAlladminPlans', getAlladminPlans);                    // Get All Plans (with pagination & filters)
router.get('/:id', getPlanById);                 // Get Single Plan
router.put('/:id', authMiddleware, checkPermission('plans.update'), updatePlan);                  // Update Plan
router.delete('/:id', authMiddleware, checkPermission('plans.delete'), deletePlan);               // Delete Plan
router.patch('/toggle/:id', authMiddleware, checkPermission('plans.update'), togglePlanStatus);   // Toggle Active/Inactive
// Toggle Active/Inactive
router.patch('/auto-checkout/:planId', authMiddleware, checkPermission('plans.update'), toggleAutoCheckout); // Toggle Auto Check-Out
export default router;