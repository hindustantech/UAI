import PayrollRule from "../models/PayrollRuleSchema.js";

/**
 * Create Payroll Rule
 */
export const createPayrollRule = async (req, res) => {
    try {
        const { companyId, deductions } = req.body;

        const existingRule = await PayrollRule.findOne({ companyId });

        if (existingRule) {
            return res.status(400).json({
                success: false,
                message: "Payroll rule already exists for this company",
            });
        }

        const payrollRule = await PayrollRule.create({
            companyId,
            deductions,
        });

        return res.status(201).json({
            success: true,
            message: "Payroll rule created successfully",
            data: payrollRule,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * Get All Payroll Rules
 */
export const getAllPayrollRules = async (req, res) => {
    try {
        const payrollRules = await PayrollRule.find()
            .populate("companyId", "name email");

        return res.status(200).json({
            success: true,
            count: payrollRules.length,
            data: payrollRules,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * Get Payroll Rule By ID
 */
export const getPayrollRuleById = async (req, res) => {
    try {
        const payrollRule = await PayrollRule.findById(req.params.id)
            .populate("companyId", "name email");

        if (!payrollRule) {
            return res.status(404).json({
                success: false,
                message: "Payroll rule not found",
            });
        }

        return res.status(200).json({
            success: true,
            data: payrollRule,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * Get Payroll Rule By Company ID
 */
export const getPayrollRuleByCompany = async (req, res) => {
    try {
        const { companyId } = req.params;

        const payrollRule = await PayrollRule.findOne({ companyId })
            .populate("companyId", "name email");

        if (!payrollRule) {
            return res.status(404).json({
                success: false,
                message: "Payroll rule not found",
            });
        }

        return res.status(200).json({
            success: true,
            data: payrollRule,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * Update Payroll Rule
 */
export const updatePayrollRule = async (req, res) => {
    try {
        const payrollRule = await PayrollRule.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                new: true,
                runValidators: true,
            }
        );

        if (!payrollRule) {
            return res.status(404).json({
                success: false,
                message: "Payroll rule not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Payroll rule updated successfully",
            data: payrollRule,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * Delete Payroll Rule
 */
export const deletePayrollRule = async (req, res) => {
    try {
        const payrollRule = await PayrollRule.findByIdAndDelete(req.params.id);

        if (!payrollRule) {
            return res.status(404).json({
                success: false,
                message: "Payroll rule not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Payroll rule deleted successfully",
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * Toggle Active Status
 */
export const togglePayrollRuleStatus = async (req, res) => {
    try {
        const payrollRule = await PayrollRule.findById(req.params.id);

        if (!payrollRule) {
            return res.status(404).json({
                success: false,
                message: "Payroll rule not found",
            });
        }

        payrollRule.isActive = !payrollRule.isActive;

        await payrollRule.save();

        return res.status(200).json({
            success: true,
            message: `Payroll rule ${payrollRule.isActive ? "activated" : "deactivated"
                } successfully`,
            data: payrollRule,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};