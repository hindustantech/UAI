import express from 'express';
// Make sure path is correct
import {
    createPlan,
    updatePlan,
    deletePlan,
    togglePlanStatus,
    getAllPlans,
    getPlanById,
    toggleAutoCheckout
} from '../controllers/attandance/Subscriptions/Plan.js';
import { checkPermission } from '../middlewares/checkPermission.js';
const router = express.Router();

// Plan Routes
router.post('/', checkPermission('plans.create'), createPlan);                    // Create Plan
router.get('/', getAllPlans);                    // Get All Plans (with pagination & filters)
router.get('/:id', getPlanById);                 // Get Single Plan
router.put('/:id', checkPermission('plans.update'), updatePlan);                  // Update Plan
router.delete('/:id', checkPermission('plans.delete'), deletePlan);               // Delete Plan
router.patch('/toggle/:id', checkPermission('plans.update'), togglePlanStatus);   // Toggle Active/Inactive
// Toggle Active/Inactive
router.patch('/auto-checkout/:planId', checkPermission('plans.update'), toggleAutoCheckout); // Toggle Auto Check-Out
export default router;