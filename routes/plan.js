import express from 'express';
// Make sure path is correct
import {
    createPlan,
    updatePlan,
    deletePlan,
    togglePlanStatus,
    getAllPlans,
    getPlanById,
} from '../controllers/attandance/Subscriptions/Plan.js';
const router = express.Router();

// Plan Routes
router.post('/', createPlan);                    // Create Plan
router.get('/', getAllPlans);                    // Get All Plans (with pagination & filters)
router.get('/:id', getPlanById);                 // Get Single Plan
router.put('/:id', updatePlan);                  // Update Plan
router.delete('/:id', deletePlan);               // Delete Plan
router.patch('/toggle/:id', togglePlanStatus);   // Toggle Active/Inactive

export default router;