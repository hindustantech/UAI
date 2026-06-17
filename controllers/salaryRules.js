// controllers/salaryRule.controller.js

import SalaryRule from "../models/salaryRules.js";
import mongoose from "mongoose";

/**
 * Create or Update Company Salary Rule
 */
export const createSalaryRule = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.user._id;

        let salaryRule = await SalaryRule.findOne({ companyId });

        if (salaryRule) {
            salaryRule = await SalaryRule.findOneAndUpdate(
                { companyId },
                req.body,
                {
                    new: true,
                    runValidators: true
                }
            );

            return res.status(200).json({
                success: true,
                message: "Salary rule updated successfully",
                data: salaryRule
            });
        }

        salaryRule = await SalaryRule.create({
            companyId,
            ...req.body
        });

        return res.status(201).json({
            success: true,
            message: "Salary rule created successfully",
            data: salaryRule
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};



export const getSalaryRuleById = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.user._id;
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

        return res.status(200).json({
            success: true,
            data: salaryRule
        });

    } catch (error) {
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
        const companyId = req.user.companyId || req.user._id;

        const salaryRule = await SalaryRule.findOne({ companyId });

        return res.status(200).json({
            success: true,
            data: salaryRule || null
        });

    } catch (error) {
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
        const companyId = req.user.companyId || req.user._id;

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

        return res.status(200).json({
            success: true,
            message: "Salary rule updated successfully",
            data: salaryRule
        });

    } catch (error) {
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
        const companyId = req.user.companyId || req.user._id;

        const salaryRule = await SalaryRule.findOneAndDelete({
            companyId
        });

        if (!salaryRule) {
            return res.status(404).json({
                success: false,
                message: "Salary rule not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Salary rule deleted successfully"
        });

    } catch (error) {
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

        return res.status(200).json({
            success: true,
            page,
            totalPages: Math.ceil(total / limit),
            totalRecords: total,
            data: salaryRules
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};