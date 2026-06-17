
import express from "express";

import {
    createPayrollRule,
    getAllPayrollRules,
    getPayrollRuleById,
    getPayrollRuleByCompany,
    updatePayrollRule,
    deletePayrollRule,
    togglePayrollRuleStatus,
} from "../controllers/PayrollRule.js";

const router = express.Router();

router.post("/", createPayrollRule);

router.get("/", getAllPayrollRules);

router.get("/:id", getPayrollRuleById);

router.get("/company/:companyId", getPayrollRuleByCompany);

router.put("/:id", updatePayrollRule);

router.delete("/:id", deletePayrollRule);

router.patch("/:id/toggle-status", togglePayrollRuleStatus);

export default router;