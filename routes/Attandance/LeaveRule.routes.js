import express from "express";
import mongoose from "mongoose";

import {
    createLeaveType,
    getLeaveTypes,
    updateLeaveType,
    deleteLeaveType
} from "../../controllers/attandance/LeaveRule.controller.js";
import {
    createLeavePolicy,
    getLeavePolicies,
    getLeavePolicyResolved,
    updateLeavePolicy,
    deleteLeavePolicy,
    assignPolicyToEmployee
} from "../../controllers/attandance/LeavePolicy.controller.js";
import authMiddleware from "../../middlewares/authMiddleware.js";
import { checkPermission } from "../../middlewares/checkPermission.js";
import Employee from "../../models/Attandance/Employee.js";
import LeaveBalance from "../../models/Attandance/LeaveBalance.js";
import LeaveLedger from "../../models/Attandance/LeaveLedger.js";

const router = express.Router();

const resolveCompanyId = (req) =>
    req.user.type === "partner" ? req.user.id : req.user.companyId;

/*====================================
  LEAVE TYPES (catalog)
  ================================*/

// All routes require authentication
router.use(authMiddleware);

// CRUD on LeaveType catalog (company-level)
router.post("/", checkPermission("leave.create"), createLeaveType);
router.get("/", checkPermission("leave.read"), getLeaveTypes);
router.put("/:id", checkPermission("leave.update"), updateLeaveType);
router.delete("/:id", checkPermission("leave.delete"), deleteLeaveType);

/*====================================
  LEAVE POLICIES
  ================================*/

router.post("/policies", checkPermission("policy.create"), createLeavePolicy);
router.get("/policies", checkPermission("policy.read"), getLeavePolicies);
router.get("/policies/:id/resolved", checkPermission("policy.read"), getLeavePolicyResolved);
router.put("/policies/:id", checkPermission("policy.update"), updateLeavePolicy);
router.delete("/policies/:id", checkPermission("policy.delete"), deleteLeavePolicy);
router.post(
    "/policies/:id/assign",
    checkPermission("policy.assign"),
    assignPolicyToEmployee
);

/*====================================
  BALANCE & ACCRUAL (employee-facing)
  ================================*/

// Employee sees their own balance (plain auth; no extra permission needed)
router.get("/balances/me", async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const companyId = resolveCompanyId(req);
        const year = Number(req.query.year) || new Date().getFullYear();

        const employee = await Employee.findOne({ userId, companyId });
        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        const balances = await LeaveBalance.find({
            employeeId: employee._id,
            year,
        })
            .populate("leaveTypeId", "name code category paid")
            .lean();

        const total = balances.reduce((sum, b) => sum + (b.balance || 0), 0);
        return res.json({ success: true, data: balances, balance: total });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Admin can credit/debit manually. Positive days = credit, negative = debit.
router.post("/balances/:employeeId/adjust", checkPermission("balance.adjust"), async (req, res) => {
    try {
        const { leaveTypeId, days, reason } = req.body;
        const employeeId = req.params.employeeId;
        const companyId = resolveCompanyId(req);
        const year = Number(req.body.year) || new Date().getFullYear();
        const month = new Date().getMonth() + 1;

        if (!mongoose.Types.ObjectId.isValid(employeeId) ||
            !mongoose.Types.ObjectId.isValid(leaveTypeId)) {
            return res.status(400).json({ success: false, message: "Invalid employeeId or leaveTypeId" });
        }

        const numericDays = Number(days);
        if (!Number.isFinite(numericDays) || numericDays === 0) {
            return res.status(400).json({ success: false, message: "days must be a non-zero number" });
        }

        const employee = await Employee.findOne({ _id: employeeId, companyId });
        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        const inc = { adjusted: numericDays, balance: numericDays };
        if (numericDays > 0) {
            inc.allocated = numericDays;
        } else {
            inc.used = -numericDays;
        }

        const doc = await LeaveBalance.findOneAndUpdate(
            { employeeId, leaveTypeId, year },
            {
                $inc: inc,
                $setOnInsert: {
                    companyId,
                    employeeId,
                    leaveTypeId,
                    year,
                    policyId: employee.leavePolicy?.policyId,
                },
            },
            { upsert: true, new: true }
        );

        await LeaveLedger.create({
            companyId,
            employeeId,
            leaveTypeId,
            year,
            month,
            type: numericDays > 0 ? "credit" : "debit",
            days: Math.abs(numericDays),
            reason: reason || `Manual ${numericDays > 0 ? "credit" : "debit"}`,
            balanceAfter: doc.balance,
            createdBy: req.user.id || req.user._id,
            source: "user",
        });

        return res.json({ success: true, balance: doc.balance, data: doc });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
