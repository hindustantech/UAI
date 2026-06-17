import salaryRules from "../models/salaryRules.js";


/**
 * Create Salary Rule
 */
export const createSalaryRule = async (req, res) => {
    try {
        const salaryRule = await SalaryRule.create(req.body);

        return res.status(201).json({
            success: true,
            message: "Salary rule created successfully",
            data: salaryRule,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * Get All Salary Rules
 */
export const getAllSalaryRules = async (req, res) => {
    try {
        const salaryRules = await SalaryRule.find().sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: salaryRules.length,
            data: salaryRules,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * Get Salary Rule By ID
 */
export const getSalaryRuleById = async (req, res) => {
    try {
        const salaryRule = await SalaryRule.findById(req.params.id);

        if (!salaryRule) {
            return res.status(404).json({
                success: false,
                message: "Salary rule not found",
            });
        }

        return res.status(200).json({
            success: true,
            data: salaryRule,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * Update Salary Rule
 */
export const updateSalaryRule = async (req, res) => {
    try {
        const salaryRule = await SalaryRule.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                new: true,
                runValidators: true,
            }
        );

        if (!salaryRule) {
            return res.status(404).json({
                success: false,
                message: "Salary rule not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Salary rule updated successfully",
            data: salaryRule,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * Delete Salary Rule
 */
export const deleteSalaryRule = async (req, res) => {
    try {
        const salaryRule = await SalaryRule.findByIdAndDelete(req.params.id);

        if (!salaryRule) {
            return res.status(404).json({
                success: false,
                message: "Salary rule not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Salary rule deleted successfully",
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};