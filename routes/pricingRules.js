import express from "express";
import {
    getAllPricingRules,
    getPricingRuleById,
    createPricingRule,
    updatePricingRule,
    deletePricingRule,
    getPricingByModule,
} from "../controllers/pricingRuleController.js";

const router = express.Router();

// Get all pricing rules
router.get("/", getAllPricingRules);

// Get pricing by module name
router.get("/module/:moduleName", getPricingByModule);

// Get single pricing rule by ID
router.get("/:id", getPricingRuleById);

// Create new pricing rule
router.post("/", createPricingRule);

// Update pricing rule
router.put("/:id", updatePricingRule);

// Delete pricing rule
router.delete("/:id", deletePricingRule);

export default router;
