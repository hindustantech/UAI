// controllers/payrollController.js

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

import Payroll from "../models/Attandance/Payroll.js";
import Employee from "../models/Attandance/Employee.js";
import SalaryRule from "../models/salaryRules.js";
import PayrollRule from "../models/PayrollRuleSchema.js";
import { buildAttendanceLedger } from "../services/payroll/attendanceLedger.service.js";
import { calculateSalary } from "../services/salaryCalculator.js";
import { generatePayrollExcel } from "../services/excelGenerator.js";
import { generateSalarySlipPDF } from "../services/pdfGenerator.js";
import { Subscription } from "../models/Attandance/subscration/Subscription.js";
import logger from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, "../tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });



/**
 * Check if a company has an active subscription and what plan they're on.
 *
 * @param {string|ObjectId} companyId
 * @returns {Promise<{
 *   isActive: boolean,
 *   planType: string|null,       // "FREE" | "BASIC" | "STANDARD" | "PREMIUM" | "ENTERPRISE" | null
 *   isFree: boolean,
 *   plan: object|null,           // full planSnapshot if active
 *   subscription: object|null    // full subscription doc if active
 * }>}
 */
export const getCompanySubscriptionStatus = async (companyId) => {
    const now = new Date();

    const subscription = await Subscription.findOne({
        company: companyId,
        status: "ACTIVE",
        isActive: true,
        startDate: { $lte: now },
        endDate: { $gte: now },
    })
        .populate("plan")   // pulls in the full Plan doc
        .lean();

    // No active subscription found
    if (!subscription) {
        return {
            isActive: false,
            planType: null,
            isFree: false,
            plan: null,
            subscription: null,
        };
    }

    const plan = subscription.plan;  // populated Plan doc

    return {
        isActive: true,
        planType: plan?.planType ?? subscription.planSnapshot?.name?.toUpperCase() ?? null,
        isFree: plan?.isfree ?? false,
        plan,
        subscription,
    };
}



/* ─────────────────────────────────────────
   GET /api/payroll/company/:companyId
   Get ALL payroll records for a company
   (optionally filter by month/year/status via query params)
───────────────────────────────────────── */
export const getAllPayrollByCompany = async (req, res) => {
    try {
        const { companyId } = req.params;
        const { month, year, status } = req.query;

        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({ success: false, message: "Invalid companyId" });
        }

        const filter = { companyId };
        if (month) filter["payPeriod.month"] = Number(month);
        if (year) filter["payPeriod.year"] = Number(year);
        if (status) filter.status = status;

        const payrolls = await Payroll.find(filter)
            .populate("employeeId", "name empCode designation department") // adjust fields as per Employee schema
            .sort({ "payPeriod.year": -1, "payPeriod.month": -1 });

        return res.status(200).json({
            success: true,
            count: payrolls.length,
            data: payrolls
        });
    } catch (error) {
        console.error("getAllPayrollByCompany error:", error);
        return res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/* ─────────────────────────────────────────
   GET /api/payroll/company/:companyId/employee/:employeeId
   Get payroll record(s) for a particular employee
   within a particular company
   (optionally filter by month/year via query params)
───────────────────────────────────────── */
export const getPayrollByEmployeeAndCompany = async (req, res) => {
    try {
        const { companyId, employeeId } = req.params; // employeeId is actually userId from User model
        const { month, year } = req.query;

        if (!mongoose.Types.ObjectId.isValid(companyId) || !mongoose.Types.ObjectId.isValid(employeeId)) {
            return res.status(400).json({ success: false, message: "Invalid companyId or userId" });
        }

        // First, find the Employee document by userId and companyId
        const employee = await Employee.findOne({
            userId: employeeId,
            companyId: companyId
        });

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found for this user in the specified company"
            });
        }

        // Now use the Employee's _id for payroll queries
        const filter = {
            companyId,
            employeeId: employee._id // Use Employee document _id
        };

        if (month) filter["payPeriod.month"] = Number(month);
        if (year) filter["payPeriod.year"] = Number(year);

        // If month+year given -> expect a single unique record (per schema's unique index)
        if (month && year) {
            const payroll = await Payroll.findOne(filter)
                .populate({
                    path: "employeeId",
                    populate: {
                        path: "userId",
                        model: "User",
                        select: "name email phone profileImage"
                    }
                });

            if (!payroll) {
                return res.status(404).json({
                    success: false,
                    message: "Payroll record not found for this period"
                });
            }
            return res.status(200).json({ success: true, data: payroll });
        }

        // Otherwise return all payroll history for that employee in that company
        const payrolls = await Payroll.find(filter)
            .populate({
                path: "employeeId",
                populate: {
                    path: "userId",
                    model: "User",
                    select: "name email phone profileImage"
                }
            })
            .sort({ "payPeriod.year": -1, "payPeriod.month": -1 });

        return res.status(200).json({
            success: true,
            count: payrolls.length,
            data: payrolls
        });
    } catch (error) {
        console.error("getPayrollByEmployeeAndCompany error:", error);
        return res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/* ═══════════════════════════════════════════════════════════════
   1.  POST /api/payroll/generate
       Generate & save payroll for ONE employee
═══════════════════════════════════════════════════════════════ */
export const generatePayroll = async (req, res) => {
    try {
        const { employeeId, month, year, payDate, overrideAttendance, force } = req.body;
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }

        if (!employeeId || !month || !year) {
            return res.status(400).json({ success: false, message: "employeeId, month, and year are required." });
        }

        const m = Number(month);
        const y = Number(year);
        if (m < 1 || m > 12) {
            return res.status(400).json({ success: false, message: "month must be 1–12." });
        }

        const exists = await Payroll.findOne({
            companyId, employeeId,
            "payPeriod.month": m, "payPeriod.year": y
        });

        if (exists && !force) {
            return res.status(409).json({
                success: false,
                message: `Payroll for ${m}/${y} already exists. Pass force=true to regenerate a draft, or use the recalculate endpoint.`,
                payrollId: exists._id
            });
        }

        if (exists && force && exists.status !== "draft") {
            return res.status(400).json({
                success: false,
                message: "Only draft payroll can be regenerated. Cancel or create an adjustment instead.",
                payrollId: exists._id
            });
        }

        const employee = await Employee.findOne({ _id: employeeId, companyId }).lean();
        if (!employee) return res.status(404).json({ success: false, message: "Employee not found." });
        if (!employee.salaryStructure?.basic && !employee.salaryStructure?.perHour && !employee.salaryStructure?.perDay) {
            return res.status(400).json({ success: false, message: "Employee salary structure is not configured." });
        }

        /* ── Rules are OPTIONAL — null is fine ── */
        const [salaryRule, payrollRule] = await Promise.all([
            SalaryRule.findOne({ companyId }).lean(),
            PayrollRule.findOne({ companyId, isActive: true }).lean()
        ]);

        const attendance = overrideAttendance ?? await buildAttendanceLedger({
            employee,
            month: m,
            year: y,
        });

        if (!overrideAttendance && attendance.employmentCalendarDays <= 0) {
            return res.status(400).json({
                success: false,
                message: "Employee was not employed during the selected pay period.",
            });
        }

        const monthLabel = new Date(y, m - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
        const startDate = new Date(y, m - 1, 1);
        const endDate = new Date(y, m, 0);

        const payrollData = calculateSalary({
            employee, attendance, salaryRule, payrollRule,
            payPeriod: { month: m, year: y, label: monthLabel, startDate, endDate },
            payDate: payDate ? new Date(payDate) : endDate,
            generatedBy: req.user._id
        });

        if (exists) {
            const updated = await Payroll.findByIdAndUpdate(
                exists._id,
                {
                    $set: payrollData,
                    $push: {
                        editLogs: {
                            editedBy: req.user._id,
                            reason: "Payroll regenerated (force)",
                            oldValue: {
                                netSalary: exists.netSalary,
                                lopDays: exists.lossOfPay?.lopDays,
                                lopAmount: exists.lossOfPay?.lopAmount,
                            },
                            newValue: {
                                netSalary: payrollData.netSalary,
                                lopDays: payrollData.lossOfPay?.lopDays,
                                lopAmount: payrollData.lossOfPay?.lopAmount,
                            },
                        },
                    },
                },
                { new: true, runValidators: true }
            );

            return res.status(200).json({
                success: true,
                message: "Draft payroll regenerated successfully.",
                data: updated,
            });
        }

        const payroll = await Payroll.create(payrollData);
        return res.status(201).json({ success: true, message: "Payroll generated successfully.", data: payroll });

    } catch (err) {
        console.error("[generatePayroll]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   HELPER — generate (create if missing) payroll records for ALL
   active employees of a company for a given month/year.
   Existing records are left untouched.
   Used by: generateBulkPayroll, downloadCompanyExcel
   Returns: { created: [], skipped: [], failed: [] }
═══════════════════════════════════════════════════════════════ */
async function generatePayrollsForCompany({ companyId, month, year, payDate, generatedBy }) {
    const m = Number(month);
    const y = Number(year);

    const monthLabel = new Date(y, m - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
    const startDate = new Date(y, m - 1, 1);
    const endDate = new Date(y, m, 0);
    const resolvedPayDate = payDate ? new Date(payDate) : endDate;

    // Active employees plus anyone who exited during this pay period, so
    // their final settlement is generated.
    const employees = await Employee.find({
        companyId,
        $or: [
            { employmentStatus: "active" },
            { deactivatedAt: { $gte: startDate, $lte: new Date(y, m, 0, 23, 59, 59, 999) } },
        ],
    }).lean();

    if (!employees.length) {
        return { created: [], skipped: [], failed: [], message: "No active employees found." };
    }

    /* ── Rules are OPTIONAL ── */
    const [salaryRule, payrollRule] = await Promise.all([
        SalaryRule.findOne({ companyId }).lean(),
        PayrollRule.findOne({ companyId, isActive: true }).lean()
    ]);

    const results = { created: [], skipped: [], failed: [] };

    for (const employee of employees) {
        try {
            const exists = await Payroll.exists({
                companyId, employeeId: employee._id,
                "payPeriod.month": m, "payPeriod.year": y
            });
            if (exists) {
                results.skipped.push({ employeeId: employee._id, empCode: employee.empCode, reason: "Already exists" });
                continue;
            }
            const salaryStructure = employee.salaryStructure || {};
            if (!salaryStructure.basic && !salaryStructure.perHour && !salaryStructure.perDay) {
                results.failed.push({ employeeId: employee._id, empCode: employee.empCode, reason: "No salary structure" });
                continue;
            }

            const attendance = await buildAttendanceLedger({ employee, month: m, year: y });

            if (attendance.employmentCalendarDays <= 0) {
                results.skipped.push({
                    employeeId: employee._id,
                    empCode: employee.empCode,
                    reason: "Not employed during this pay period",
                });
                continue;
            }

            const payrollData = calculateSalary({
                employee, attendance, salaryRule, payrollRule,
                payPeriod: { month: m, year: y, label: monthLabel, startDate, endDate },
                payDate: resolvedPayDate,
                generatedBy
            });

            const payroll = await Payroll.create(payrollData);
            results.created.push({ employeeId: employee._id, empCode: employee.empCode, payrollId: payroll._id, netSalary: payroll.netSalary });

        } catch (empErr) {
            results.failed.push({ employeeId: employee._id, empCode: employee.empCode, reason: empErr.message });
        }
    }

    return results;
}


/* ═══════════════════════════════════════════════════════════════
   2.  POST /api/payroll/generate-bulk
       Generate & save payroll for ALL active employees
═══════════════════════════════════════════════════════════════ */
export const generateBulkPayroll = async (req, res) => {
    try {
        const { month, year, payDate } = req.body;
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }

        if (!month || !year) {
            return res.status(400).json({ success: false, message: "month and year are required." });
        }

        const results = await generatePayrollsForCompany({
            companyId, month: Number(month), year: Number(year), payDate, generatedBy: req.user._id
        });

        if (!results.created.length && !results.failed.length && !results.skipped.length) {
            return res.status(404).json({ success: false, message: results.message || "No active employees found." });
        }

        return res.status(200).json({
            success: true,
            message: `Bulk payroll complete. Created: ${results.created.length}, Skipped: ${results.skipped.length}, Failed: ${results.failed.length}`,
            data: results
        });

    } catch (err) {
        console.error("[generateBulkPayroll]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   2b. POST /api/payroll/preview
       Calculate salary + LOP for one employee WITHOUT saving.
       Body: { employeeId, month, year, payDate? }
═══════════════════════════════════════════════════════════════ */
export const previewPayroll = async (req, res) => {
    try {
        const { employeeId, month, year, payDate } = req.body || {};
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }

        if (!employeeId || !month || !year) {
            return res.status(400).json({ success: false, message: "employeeId, month and year are required." });
        }

        const m = Number(month);
        const y = Number(year);
        if (m < 1 || m > 12) {
            return res.status(400).json({ success: false, message: "month must be 1–12." });
        }

        const employee = await Employee.findOne({ _id: employeeId, companyId }).lean();
        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found." });
        }
        if (!employee.salaryStructure?.basic && !employee.salaryStructure?.perHour && !employee.salaryStructure?.perDay) {
            return res.status(400).json({ success: false, message: "Employee salary structure is not configured." });
        }

        const [salaryRule, payrollRule] = await Promise.all([
            SalaryRule.findOne({ companyId }).lean(),
            PayrollRule.findOne({ companyId, isActive: true }).lean()
        ]);

        const attendance = await buildAttendanceLedger({ employee, month: m, year: y });
        if (attendance.employmentCalendarDays <= 0) {
            return res.status(400).json({
                success: false,
                message: "Employee was not employed during the selected pay period.",
                attendance,
            });
        }

        const monthLabel = new Date(y, m - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
        const startDate = new Date(y, m - 1, 1);
        const endDate = new Date(y, m, 0);

        const payroll = calculateSalary({
            employee, attendance, salaryRule, payrollRule,
            payPeriod: { month: m, year: y, label: monthLabel, startDate, endDate },
            payDate: payDate ? new Date(payDate) : endDate,
            generatedBy: req.user._id,
        });

        return res.status(200).json({ success: true, data: { attendance, payroll } });
    } catch (err) {
        console.error("[previewPayroll]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   2c. POST /api/payroll/:payrollId/recalculate
       Recompute a DRAFT payroll from current attendance/leave.
═══════════════════════════════════════════════════════════════ */
export const recalculatePayroll = async (req, res) => {
    try {
        const { payrollId } = req.params;
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }

        if (!mongoose.Types.ObjectId.isValid(payrollId)) {
            return res.status(400).json({ success: false, message: "Invalid payrollId." });
        }

        const payroll = await Payroll.findOne({ _id: payrollId, companyId });
        if (!payroll) {
            return res.status(404).json({ success: false, message: "Payroll not found." });
        }
        if (payroll.status !== "draft") {
            return res.status(400).json({
                success: false,
                message: `Only draft payroll can be recalculated. Current status: ${payroll.status}.`
            });
        }

        const employee = await Employee.findOne({ _id: payroll.employeeId, companyId }).lean();
        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found." });
        }

        const m = Number(payroll.payPeriod.month);
        const y = Number(payroll.payPeriod.year);

        const [salaryRule, payrollRule] = await Promise.all([
            SalaryRule.findOne({ companyId }).lean(),
            PayrollRule.findOne({ companyId, isActive: true }).lean()
        ]);

        const attendance = await buildAttendanceLedger({ employee, month: m, year: y });

        const monthLabel = new Date(y, m - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
        const startDate = new Date(y, m - 1, 1);
        const endDate = new Date(y, m, 0);

        const payrollData = calculateSalary({
            employee, attendance, salaryRule, payrollRule,
            payPeriod: { month: m, year: y, label: monthLabel, startDate, endDate },
            payDate: payroll.payDate || endDate,
            generatedBy: req.user._id,
        });

        const oldNet = payroll.netSalary;
        const oldLop = payroll.lossOfPay?.lopAmount ?? 0;

        const updated = await Payroll.findByIdAndUpdate(
            payroll._id,
            {
                $set: payrollData,
                $push: {
                    editLogs: {
                        editedBy: req.user._id,
                        reason: "Payroll recalculated from attendance",
                        oldValue: { netSalary: oldNet, lopAmount: oldLop },
                        newValue: {
                            netSalary: payrollData.netSalary,
                            lopAmount: payrollData.lossOfPay?.lopAmount,
                        },
                    },
                },
            },
            { new: true, runValidators: true }
        );

        return res.status(200).json({
            success: true,
            message: "Payroll recalculated successfully.",
            data: { payroll: updated, attendance },
        });
    } catch (err) {
        console.error("[recalculatePayroll]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   3.  GET /api/payroll/employee/:employeeId
═══════════════════════════════════════════════════════════════ */
export const getEmployeePayroll = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { month, year, page = 1, limit = 12 } = req.query;
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }

        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
            return res.status(400).json({ success: false, message: "Invalid employeeId." });
        }

        if (month && year) {
            const payroll = await Payroll.findOne({
                companyId, employeeId,
                "payPeriod.month": Number(month), "payPeriod.year": Number(year)
            }).lean();
            if (!payroll) {
                return res.status(404).json({ success: false, message: `No payroll found for ${month}/${year}.` });
            }
            return res.status(200).json({ success: true, data: payroll });
        }

        const skip = (Number(page) - 1) * Number(limit);
        const query = { companyId, employeeId };
        if (year) query["payPeriod.year"] = Number(year);

        const [records, total] = await Promise.all([
            Payroll.find(query).sort({ "payPeriod.year": -1, "payPeriod.month": -1 }).skip(skip).limit(Number(limit)).lean(),
            Payroll.countDocuments(query)
        ]);

        return res.status(200).json({
            success: true, data: records,
            pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) }
        });

    } catch (err) {
        console.error("[getEmployeePayroll]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   4.  GET /api/payroll/company
═══════════════════════════════════════════════════════════════ */
export const getCompanyPayroll = async (req, res) => {
    try {
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }
        const { month, year, department, status, page = 1, limit = 50 } = req.query;

        if (!month || !year) {
            return res.status(400).json({ success: false, message: "month and year are required." });
        }

        const query = {
            companyId,
            "payPeriod.month": Number(month),
            "payPeriod.year": Number(year)
        };
        if (status) query.status = status;
        if (department) query["employeeSnapshot.department"] = department;

        const skip = (Number(page) - 1) * Number(limit);
        const [records, total] = await Promise.all([
            Payroll.find(query).sort({ "employeeSnapshot.name": 1 }).skip(skip).limit(Number(limit)).lean(),
            Payroll.countDocuments(query)
        ]);

        const summary = records.reduce((acc, p) => {
            acc.totalGross += p.grossSalary ?? 0;
            acc.totalDeductions += p.totalDeductions ?? 0;
            acc.totalNet += p.netSalary ?? 0;
            acc.totalPF += p.statutoryDeductions?.pf ?? 0;
            acc.totalESI += p.statutoryDeductions?.esi ?? 0;
            acc.totalLOP += p.lossOfPay?.lopAmount ?? 0;
            return acc;
        }, { totalGross: 0, totalDeductions: 0, totalNet: 0, totalPF: 0, totalESI: 0, totalLOP: 0 });

        return res.status(200).json({
            success: true, data: records, summary,
            pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) }
        });

    } catch (err) {
        console.error("[getCompanyPayroll]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   5.  PATCH /api/payroll/:payrollId/status
═══════════════════════════════════════════════════════════════ */
export const updatePayrollStatus = async (req, res) => {
    try {
        const { payrollId } = req.params;
        const { status, remarks } = req.body;
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }

        const ALLOWED = ["approved", "paid", "cancelled"];
        if (!ALLOWED.includes(status)) {
            return res.status(400).json({ success: false, message: `status must be one of: ${ALLOWED.join(", ")}.` });
        }

        const payroll = await Payroll.findOne({ _id: payrollId, companyId });
        if (!payroll) return res.status(404).json({ success: false, message: "Payroll not found." });
        if (payroll.status === "cancelled") {
            return res.status(400).json({ success: false, message: "Cancelled payroll cannot be updated." });
        }

        const oldStatus = payroll.status;
        payroll.status = status;
        if (remarks) payroll.remarks = remarks;
        if (status === "approved") payroll.approvedBy = req.user._id;
        if (status === "paid") { payroll.paidAt = new Date(); payroll.paidBy = req.user._id; }

        payroll.editLogs.push({
            editedBy: req.user._id,
            reason: remarks ?? `Status changed: ${oldStatus} → ${status}`,
            oldValue: { status: oldStatus },
            newValue: { status }
        });

        await payroll.save();
        return res.status(200).json({ success: true, message: `Payroll marked as ${status}.`, data: payroll });

    } catch (err) {
        console.error("[updatePayrollStatus]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   HELPER — write payroll records to an Excel file and stream it
═══════════════════════════════════════════════════════════════ */
async function sendExcel(records, month, year, res) {
    const fileName = `payroll_${year}_${String(month).padStart(2, "0")}.xlsx`;
    const filePath = path.join(TMP_DIR, fileName);

    await generatePayrollExcel(records, filePath);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on("end", () => fs.unlink(filePath, () => { }));
}


/* ═══════════════════════════════════════════════════════════════
   6.  GET /api/payroll/download/excel/:companyId
═══════════════════════════════════════════════════════════════ */
export const downloadCompanyExcel = async (req, res) => {
    logger.info(" Payroll controller [downloadCompanyExcel] Request received with params:", req.params, "and query:", req.query);
    try {
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }
        const { month, year } = req.query;
        // Basic check


        const records = await Payroll.find({
            companyId,
            "payPeriod.month": Number(month),
            "payPeriod.year": Number(year)
        }).sort({ "employeeSnapshot.name": 1 }).lean();

        if (!records.length) {
            // Auto-generate salary records for the period first, then export them
            const generated = await generatePayrollsForCompany({
                companyId,
                month: Number(month),
                year: Number(year),
                generatedBy: req.user._id
            });

            if (!generated.created.length && !generated.skipped.length) {
                return res.status(404).json({ success: false, message: generated.failed[0]?.reason || "No payroll records could be generated for this period." });
            }

            const recordsAfterGenerate = await Payroll.find({
                companyId,
                "payPeriod.month": Number(month),
                "payPeriod.year": Number(year)
            }).sort({ "employeeSnapshot.name": 1 }).lean();

            if (!recordsAfterGenerate.length) {
                return res.status(404).json({ success: false, message: "No payroll records found for this period." });
            }

            return sendExcel(recordsAfterGenerate, month, year, res);
        }

        return sendExcel(records, month, year, res);

    } catch (err) {
        console.error("[downloadCompanyExcel]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   7.  GET /api/payroll/download/pdf/:payrollId
═══════════════════════════════════════════════════════════════ */
export const downloadSalarySlipPDF = async (req, res) => {
    try {
        const { payrollId } = req.params;
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }

        // Basic check



        if (!mongoose.Types.ObjectId.isValid(payrollId)) {
            return res.status(400).json({ success: false, message: "Invalid payrollId." });
        }

        const payroll = await Payroll.findOne({ _id: payrollId, companyId }).lean();
        if (!payroll) return res.status(404).json({ success: false, message: "Payroll not found." });

        const emp = payroll.employeeSnapshot;
        const fileName = `salary_slip_${emp?.empCode ?? payrollId}_${payroll.payPeriod.year}_${String(payroll.payPeriod.month).padStart(2, "0")}.pdf`;
        const filePath = path.join(TMP_DIR, fileName);

        await generateSalarySlipPDF(payroll, filePath);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        stream.on("end", () => fs.unlink(filePath, () => { }));

    } catch (err) {
        console.error("[downloadSalarySlipPDF]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};




// Add these to your existing payrollController.js

/* ═══════════════════════════════════════════════════════════════
   8.  DELETE /api/payroll/:payrollId
       Delete a single payroll record
═══════════════════════════════════════════════════════════════ */
export const deletePayroll = async (req, res) => {
    try {
        const { payrollId } = req.params;
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }

        if (!mongoose.Types.ObjectId.isValid(payrollId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payrollId."
            });
        }

        const payroll = await Payroll.findOne({
            _id: payrollId,
            companyId
        });

        if (!payroll) {
            return res.status(404).json({
                success: false,
                message: "Payroll record not found."
            });
        }

        // Optional: Prevent deletion of paid/approved payrolls
        if (payroll.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: "Cannot delete a paid payroll record. Consider cancelling it instead."
            });
        }

        await Payroll.findByIdAndDelete(payrollId);

        return res.status(200).json({
            success: true,
            message: "Payroll record deleted successfully.",
            data: {
                deletedPayrollId: payrollId,
                employeeName: payroll.employeeSnapshot?.name,
                period: `${payroll.payPeriod.month}/${payroll.payPeriod.year}`
            }
        });

    } catch (err) {
        console.error("[deletePayroll]", err);
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

/* ═══════════════════════════════════════════════════════════════
   9.  DELETE /api/payroll/company/:companyId
       Delete ALL payroll records for a company
       (with optional filters for month/year/status)
═══════════════════════════════════════════════════════════════ */
export const deleteAllPayrollByCompany = async (req, res) => {
    try {
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }
        const { month, year, status } = req.query;

        // Build filter
        const filter = { companyId };
        if (month) filter["payPeriod.month"] = Number(month);
        if (year) filter["payPeriod.year"] = Number(year);
        if (status) filter.status = status;

        // First, get count of records to be deleted
        const count = await Payroll.countDocuments(filter);

        if (count === 0) {
            return res.status(404).json({
                success: false,
                message: "No payroll records found matching the criteria."
            });
        }

        // Delete the records
        const result = await Payroll.deleteMany(filter);

        return res.status(200).json({
            success: true,
            message: `Successfully deleted ${result.deletedCount} payroll record(s).`,
            data: {
                deletedCount: result.deletedCount,
                filters: {
                    companyId,
                    month: month || 'all',
                    year: year || 'all',
                    status: status || 'all'
                }
            }
        });

    } catch (err) {
        console.error("[deleteAllPayrollByCompany]", err);
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

/* ═══════════════════════════════════════════════════════════════
   10. DELETE /api/payroll/company/:companyId/employee/:employeeId
       Delete all payroll records for a specific employee
       (with optional month/year filters)
═══════════════════════════════════════════════════════════════ */
export const deleteEmployeePayroll = async (req, res) => {
    try {
        const { companyId, employeeId } = req.params;
        const { month, year } = req.query;

        if (!mongoose.Types.ObjectId.isValid(companyId) ||
            !mongoose.Types.ObjectId.isValid(employeeId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid companyId or employeeId."
            });
        }

        // Find the employee first
        const employee = await Employee.findOne({
            userId: employeeId,
            companyId
        });

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found in this company."
            });
        }

        // Build filter
        const filter = {
            companyId,
            employeeId: employee._id
        };
        if (month) filter["payPeriod.month"] = Number(month);
        if (year) filter["payPeriod.year"] = Number(year);

        // Get count before deletion
        const count = await Payroll.countDocuments(filter);

        if (count === 0) {
            return res.status(404).json({
                success: false,
                message: "No payroll records found for this employee."
            });
        }

        // Delete records
        const result = await Payroll.deleteMany(filter);

        return res.status(200).json({
            success: true,
            message: `Successfully deleted ${result.deletedCount} payroll record(s) for ${employee.name || employee.empCode}.`,
            data: {
                deletedCount: result.deletedCount,
                employee: {
                    id: employee._id,
                    name: employee.name,
                    empCode: employee.empCode
                },
                filters: {
                    month: month || 'all',
                    year: year || 'all'
                }
            }
        });

    } catch (err) {
        console.error("[deleteEmployeePayroll]", err);
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};