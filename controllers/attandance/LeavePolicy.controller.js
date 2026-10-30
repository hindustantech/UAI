import mongoose from "mongoose";
import LeavePolicy from "../../models/Attandance/LeavePolicy.js";
import Employee from "../../models/Attandance/Employee.js";

const resolveCompanyId = (req) =>
    req.user.type === "partner" ? req.user.id : req.user.companyId;

// LeavePolicy CRUD
export const createLeavePolicy = async (req, res) => {
    try {
        const { name, description, financialYearStartMonth, leaveRules, isDefault } = req.body;
        const companyId = resolveCompanyId(req);

        if (!name) {
            return res.status(400).json({ success: false, message: "name is required" });
        }

        const policy = await LeavePolicy.create({
            companyId,
            name,
            description,
            financialYearStartMonth: financialYearStartMonth || 1,
            leaveRules: leaveRules || [],
            isDefault: !!isDefault,
        });

        return res.status(201).json({ success: true, data: policy });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getLeavePolicies = async (req, res) => {
    try {
        const companyId = resolveCompanyId(req);
        const policies = await LeavePolicy.find({ companyId, isActive: true })
            .populate("leaveRules.leaveTypeId", "name code category paid");
        return res.json({ success: true, data: policies });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getLeavePolicyResolved = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = resolveCompanyId(req);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid ID" });
        }

        const policy = await LeavePolicy.findOne({ _id: id, companyId })
            .populate("leaveRules.leaveTypeId", "name code category paid allowHalfDay");

        if (!policy) {
            return res.status(404).json({ success: false, message: "Policy not found" });
        }

        return res.json({ success: true, data: policy });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const updateLeavePolicy = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = resolveCompanyId(req);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid ID" });
        }

        const updated = await LeavePolicy.findOneAndUpdate(
            { _id: id, companyId },
            req.body,
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ success: false, message: "Policy not found" });
        }

        return res.json({ success: true, data: updated });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteLeavePolicy = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = resolveCompanyId(req);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid ID" });
        }

        const deleted = await LeavePolicy.findOneAndUpdate(
            { _id: id, companyId },
            { $set: { isActive: false } },
            { new: true }
        );
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Policy not found" });
        }
        return res.json({ success: true, message: "Policy deactivated" });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const assignPolicyToEmployee = async (req, res) => {
    try {
        const { id: policyId } = req.params;
        const { employeeIds } = req.body; // array of employee _ids
        const companyId = resolveCompanyId(req);

        if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
            return res.status(400).json({ success: false, message: "employeeIds array required" });
        }

        if (!mongoose.Types.ObjectId.isValid(policyId)) {
            return res.status(400).json({ success: false, message: "Invalid policy ID" });
        }

        const policy = await LeavePolicy.findOne({ _id: policyId, companyId });
        if (!policy) {
            return res.status(404).json({ success: false, message: "Policy not found" });
        }

        // Assign policy to employees and clear any previous overrides
        const result = await Employee.updateMany(
            { _id: { $in: employeeIds }, companyId },
            {
                $set: {
                    "leavePolicy.policyId": policyId,
                    "leavePolicy.overrides": [],
                },
            }
        );

        return res.json({
            success: true,
            message: "Policy assigned to employees",
            modified: result.modifiedCount,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
