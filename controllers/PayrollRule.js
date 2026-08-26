import PayrollRule from "../models/PayrollRuleSchema.js";
import { logApiAction, logApiError } from "../utils/apiLogger.js";

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

        logApiAction({
            level: "info",
            action: "CREATE",
            model: "PayrollRule",
            req,
            resourceId: payrollRule._id,
            after: payrollRule,
        });

        return res.status(201).json({
            success: true,
            message: "Payroll rule created successfully",
            data: payrollRule,
        });
    } catch (error) {
        logApiError("CREATE", "PayrollRule", error, req);
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

        logApiAction({
            level: "info",
            action: "GET_LIST",
            model: "PayrollRule",
            req,
            extra: { count: payrollRules.length },
        });

        return res.status(200).json({
            success: true,
            count: payrollRules.length,
            data: payrollRules,
        });
    } catch (error) {
        logApiError("GET_LIST", "PayrollRule", error, req);
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

        logApiAction({
            level: "info",
            action: "GET",
            model: "PayrollRule",
            req,
            resourceId: payrollRule._id,
            after: payrollRule,
        });

        return res.status(200).json({
            success: true,
            data: payrollRule,
        });
    } catch (error) {
        logApiError("GET", "PayrollRule", error, req);
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
        const before = await PayrollRule.findById(req.params.id);
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

        logApiAction({
            level: "info",
            action: "UPDATE",
            model: "PayrollRule",
            req,
            resourceId: payrollRule._id,
            before,
            after: payrollRule,
        });

        return res.status(200).json({
            success: true,
            message: "Payroll rule updated successfully",
            data: payrollRule,
        });
    } catch (error) {
        logApiError("UPDATE", "PayrollRule", error, req);
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
        const before = await PayrollRule.findById(req.params.id);
        const payrollRule = await PayrollRule.findByIdAndDelete(req.params.id);

        if (!payrollRule) {
            return res.status(404).json({
                success: false,
                message: "Payroll rule not found",
            });
        }

        logApiAction({
            level: "info",
            action: "DELETE",
            model: "PayrollRule",
            req,
            resourceId: req.params.id,
            before,
        });

        return res.status(200).json({
            success: true,
            message: "Payroll rule deleted successfully",
        });
    } catch (error) {
        logApiError("DELETE", "PayrollRule", error, req);
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
        const before = await PayrollRule.findById(req.params.id);

        if (!before) {
            return res.status(404).json({
                success: false,
                message: "Payroll rule not found",
            });
        }

        before.isActive = !before.isActive;
        await before.save();

        const after = await PayrollRule.findById(req.params.id);

        logApiAction({
            level: "info",
            action: "TOGGLE_STATUS",
            model: "PayrollRule",
            req,
            resourceId: req.params.id,
            before,
            after,
        });

        return res.status(200).json({
            success: true,
            message: `Payroll rule ${after.isActive ? "activated" : "deactivated"} successfully`,
            data: after,
        });
    } catch (error) {
        logApiError("TOGGLE_STATUS", "PayrollRule", error, req);
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};