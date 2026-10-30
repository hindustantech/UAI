import mongoose from "mongoose";
import LeaveType from "../../models/Attandance/LeaveType.js";

const resolveCompanyId = (req) =>
    req.user.type === "partner" ? req.user.id : req.user.companyId;

// LeaveType CRUD
export const createLeaveType = async (req, res) => {
    try {
        const { name, code, category, paid, allowHalfDay } = req.body;
        const companyId = resolveCompanyId(req);

        if (!name || !code || !category) {
            return res.status(400).json({
                success: false,
                message: "name, code and category are required"
            });
        }

        const existing = await LeaveType.findOne({ companyId, code });
        if (existing) {
            return res.status(400).json({ success: false, message: "Leave type code already exists" });
        }

        const leaveType = await LeaveType.create({
            companyId,
            name,
            code,
            category,
            paid,
            allowHalfDay,
        });

        return res.status(201).json({ success: true, data: leaveType });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getLeaveTypes = async (req, res) => {
    try {
        const companyId = resolveCompanyId(req);
        const types = await LeaveType.find({ companyId, isActive: true });
        return res.json({ success: true, data: types });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const updateLeaveType = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = resolveCompanyId(req);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid ID" });
        }

        const updated = await LeaveType.findOneAndUpdate(
            { _id: id, companyId },
            req.body,
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ success: false, message: "Leave type not found" });
        }

        return res.json({ success: true, data: updated });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteLeaveType = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = resolveCompanyId(req);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid ID" });
        }

        const deleted = await LeaveType.findOneAndUpdate(
            { _id: id, companyId },
            { $set: { isActive: false } },
            { new: true }
        );
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Leave type not found" });
        }
        return res.json({ success: true, message: "Leave type deactivated" });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
