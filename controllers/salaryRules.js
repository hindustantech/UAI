// controllers/salaryRule.controller.js

import SalaryRule from "../models/salaryRules.js";
import mongoose from "mongoose";
import { logApiAction, logApiError } from "../utils/apiLogger.js";

/**
 * Create or Update Company Salary Rule
 */
export const createSalaryRule = async (req, res) => {
    try {
        const companyId = req.user.type === 'partner' ? req.user.id : req.user.companyId;

        const before = await SalaryRule.findOne({ companyId });
        const salaryRule = await SalaryRule.findOneAndUpdate(
            { companyId },
            req.body,
            { new: true, runValidators: true }
        );

        logApiAction({
            level: "info",
            action: "CREATE",
            model: "SalaryRule",
            req,
            resourceId: salaryRule?._id,
            before,
            after: salaryRule,
        });

        return res.status(201).json({
            success: true,
            message: "Salary rule created successfully",
            data: salaryRule
        });

    } catch (error) {
        logApiError("CREATE", "SalaryRule", error, req);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};



export const getSalaryRuleById = async (req, res) => {
    try {
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid salary rule ID"
            });
        }

        const salaryRule = await SalaryRule.findOne({
            _id: id,
            companyId
        });

        if (!salaryRule) {
            return res.status(404).json({
                success: false,
                message: "Salary rule not found"
            });
        }

        logApiAction({
            level: "info",
            action: "GET",
            model: "SalaryRule",
            req,
            resourceId: salaryRule._id,
            after: salaryRule,
        });

        return res.status(200).json({
            success: true,
            data: salaryRule
        });

    } catch (error) {
        logApiError("GET", "SalaryRule", error, req);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
/**
 * Get Company Salary Rule
 */
export const getCompanySalaryRule = async (req, res) => {
    try {
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }

        const salaryRule = await SalaryRule.findOne({ companyId });

        logApiAction({
            level: "info",
            action: "GET_COMPANY",
            model: "SalaryRule",
            req,
            after: salaryRule,
        });

        return res.status(200).json({
            success: true,
            data: salaryRule || null
        });

    } catch (error) {
        logApiError("GET_COMPANY", "SalaryRule", error, req);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Update Company Salary Rule
 */
export const updateSalaryRule = async (req, res) => {
    try {
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }

        const before = await SalaryRule.findOne({ companyId });
        const salaryRule = await SalaryRule.findOneAndUpdate(
            { companyId },
            req.body,
            {
                new: true,
                runValidators: true
            }
        );

        if (!salaryRule) {
            return res.status(404).json({
                success: false,
                message: "Salary rule not found"
            });
        }

        logApiAction({
            level: "info",
            action: "UPDATE",
            model: "SalaryRule",
            req,
            resourceId: salaryRule._id,
            before,
            after: salaryRule,
        });

        return res.status(200).json({
            success: true,
            message: "Salary rule updated successfully",
            data: salaryRule
        });

    } catch (error) {
        logApiError("UPDATE", "SalaryRule", error, req);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Delete Company Salary Rule
 */
export const deleteSalaryRule = async (req, res) => {
    try {
        const companyId = req.user._id;

        const before = await SalaryRule.findOne({ companyId });
        const salaryRule = await SalaryRule.findOneAndDelete({ companyId });

        if (!salaryRule) {
            return res.status(404).json({
                success: false,
                message: "Salary rule not found"
            });
        }

        logApiAction({
            level: "info",
            action: "DELETE",
            model: "SalaryRule",
            req,
            resourceId: salaryRule._id,
            before,
        });

        return res.status(200).json({
            success: true,
            message: "Salary rule deleted successfully"
        });

    } catch (error) {
        logApiError("DELETE", "SalaryRule", error, req);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Admin Only - Get All Salary Rules
 */
export const getAllSalaryRules = async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;  
        const limit = Number(req.query.limit) || 20;

        const skip = (page - 1) * limit;

        const [salaryRules, total] = await Promise.all([
            SalaryRule.find()
                .populate("companyId", "name email")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),

            SalaryRule.countDocuments()
        ]);

        logApiAction({
            level: "info",
            action: "GET_LIST",
            model: "SalaryRule",
            req,
            extra: { count: salaryRules.length, totalRecords: total, page }
        });

        return res.status(200).json({
            success: true,
            page,
            totalPages: Math.ceil(total / limit),
            totalRecords: total,
            data: salaryRules
        });

    } catch (error) {
        logApiError("GET_LIST", "SalaryRule", error, req);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};