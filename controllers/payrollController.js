// controllers/payrollController.js

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

import Payroll from "../models/Attandance/Payroll.js";
import Employee from "../models/Attandance/Employee.js";
import SalaryRule from "../models/salaryRules.js";
import PayrollRule from "../models/PayrollRuleSchema.js";
import Attendance from "../models/Attandance/Attendance.js";
import { calculateSalary } from "../services/salaryCalculator.js";
import { generatePayrollExcel } from "../services/excelGenerator.js";
import { generateSalarySlipPDF } from "../services/pdfGenerator.js";
import { Subscription } from "../models/Attandance/subscration/Subscription.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, "../tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });


/* ═══════════════════════════════════════════════════════════════
   HELPER — build attendance summary from Attendance collection
   for a given employee + month + year
═══════════════════════════════════════════════════════════════ */
async function getAttendanceSummary(employeeId, month, year) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    const records = await Attendance.find({
        employeeId,
        date: { $gte: start, $lte: end }
    }).lean();

    let presentDays = 0;
    let absentDays = 0;
    let leaveDays = 0;
    let holidays = 0;
    let weeklyOffDays = 0;
    let halfDays = 0;
    let lateDays = 0;

    for (const rec of records) {
        switch (rec.status) {
            case "present":
                presentDays++;
                if (rec.workSummary?.lateMinutes > 0) lateDays++;
                break;
            case "half_day":
                halfDays++;
                presentDays += 0.5;
                break;
            case "absent": absentDays++; break;
            case "leave": leaveDays++; break;
            case "holiday": holidays++; break;
            case "week_off": weeklyOffDays++; break;
            default: break;
        }
    }

    return { presentDays, absentDays, leaveDays, holidays, weeklyOffDays, halfDays, lateDays };
}



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
        const { employeeId, month, year, payDate, overrideAttendance } = req.body;
        let companyId;
        if (req.user.type === 'partner') {
            companyId = req.user.id;
        } else {
            companyId = req.user.companyId;
        }

        if (!employeeId || !month || !year) {
            return res.status(400).json({ success: false, message: "employeeId, month, and year are required." });
        }
        if (month < 1 || month > 12) {
            return res.status(400).json({ success: false, message: "month must be 1–12." });
        }

        const exists = await Payroll.findOne({
            companyId, employeeId,
            "payPeriod.month": month, "payPeriod.year": year
        });
        if (exists) {
            return res.status(409).json({
                success: false,
                message: `Payroll for ${month}/${year} already exists. Use the update endpoint.`,
                payrollId: exists._id
            });
        }

        const employee = await Employee.findOne({ _id: employeeId, companyId }).lean();
        if (!employee) return res.status(404).json({ success: false, message: "Employee not found." });
        if (employee.employmentStatus === "inactive") {
            return res.status(400).json({ success: false, message: "Employee is inactive." });
        }
        if (!employee.salaryStructure?.basic) {
            return res.status(400).json({ success: false, message: "Employee salary structure is not configured." });
        }

        /* ── Rules are OPTIONAL — null is fine ── */
        const [salaryRule, payrollRule] = await Promise.all([
            SalaryRule.findOne({ companyId }).lean(),
            PayrollRule.findOne({ companyId, isActive: true }).lean()
        ]);

        const attendance = overrideAttendance ?? await getAttendanceSummary(employeeId, month, year);
        const monthLabel = new Date(year, month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        const payrollData = calculateSalary({
            employee, attendance, salaryRule, payrollRule,
            payPeriod: { month, year, label: monthLabel, startDate, endDate },
            payDate: payDate ? new Date(payDate) : endDate,
            generatedBy: req.user._id
        });

        const payroll = await Payroll.create(payrollData);
        return res.status(201).json({ success: true, message: "Payroll generated successfully.", data: payroll });

    } catch (err) {
        console.error("[generatePayroll]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


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

        const employees = await Employee.find({ companyId, employmentStatus: "active" }).lean();
        if (!employees.length) {
            return res.status(404).json({ success: false, message: "No active employees found." });
        }

        /* ── Rules are OPTIONAL ── */
        const [salaryRule, payrollRule] = await Promise.all([
            SalaryRule.findOne({ companyId }).lean(),
            PayrollRule.findOne({ companyId, isActive: true }).lean()
        ]);

        const monthLabel = new Date(year, month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        const resolvedPayDate = payDate ? new Date(payDate) : endDate;

        const results = { created: [], skipped: [], failed: [] };

        for (const employee of employees) {
            try {
                const exists = await Payroll.exists({
                    companyId, employeeId: employee._id,
                    "payPeriod.month": month, "payPeriod.year": year
                });
                if (exists) {
                    results.skipped.push({ employeeId: employee._id, empCode: employee.empCode, reason: "Already exists" });
                    continue;
                }
                if (!employee.salaryStructure?.basic) {
                    results.failed.push({ employeeId: employee._id, empCode: employee.empCode, reason: "No salary structure" });
                    continue;
                }

                const attendance = await getAttendanceSummary(employee._id, month, year);
                const payrollData = calculateSalary({
                    employee, attendance, salaryRule, payrollRule,
                    payPeriod: { month, year, label: monthLabel, startDate, endDate },
                    payDate: resolvedPayDate,
                    generatedBy: req.user._id
                });

                const payroll = await Payroll.create(payrollData);
                results.created.push({ employeeId: employee._id, empCode: employee.empCode, payrollId: payroll._id, netSalary: payroll.netSalary });

            } catch (empErr) {
                results.failed.push({ employeeId: employee._id, empCode: employee.empCode, reason: empErr.message });
            }
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
   6.  GET /api/payroll/download/excel/:companyId
═══════════════════════════════════════════════════════════════ */
export const downloadCompanyExcel = async (req, res) => {
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
            return res.status(404).json({ success: false, message: "No payroll records found for this period." });
        }

        const fileName = `payroll_${year}_${String(month).padStart(2, "0")}.xlsx`;
        const filePath = path.join(TMP_DIR, fileName);

        await generatePayrollExcel(records, filePath);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        stream.on("end", () => fs.unlink(filePath, () => { }));

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