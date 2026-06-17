import express from "express";
import {
    createSalaryRule,
    getAllSalaryRules,
    getSalaryRuleById,
    updateSalaryRule,
    deleteSalaryRule,
    getCompanySalaryRule
} from "../controllers/salaryRules.js";

import authMiddleware from "../middlewares/authMiddleware.js";
const router = express.Router();

router.post("/",authMiddleware, createSalaryRule);

router.get("/",authMiddleware, getAllSalaryRules);

router.get("/:id", getSalaryRuleById);
router.get('/getCompanySalaryRule', authMiddleware, getCompanySalaryRule)

router.put("/:id", updateSalaryRule);

router.delete("/:id", deleteSalaryRule);

export default router;