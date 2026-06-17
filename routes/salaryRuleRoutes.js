import express from "express";
import {
    createSalaryRule,
    getAllSalaryRules,
    getSalaryRuleById,
    updateSalaryRule,
    deleteSalaryRule,
} from "../controllers/salaryRules.js";


const router = express.Router();

router.post("/", createSalaryRule);

router.get("/", getAllSalaryRules);

router.get("/:id", getSalaryRuleById);

router.put("/:id", updateSalaryRule);

router.delete("/:id", deleteSalaryRule);

export default router;