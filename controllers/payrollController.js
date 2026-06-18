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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, "../tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });


/* ═══════════════════════════════════════════════════════════════
   HELPER — build attendance summary from Attendance collection
   for a given employee + month + year
═══════════════════════════════════════════════════════════════ */
async function getAttendanceSummary(employeeId, month, year) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);   // last day of month

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


/* ═══════════════════════════════════════════════════════════════
   1.  POST /api/payroll/generate
       Generate & save payroll for ONE employee
═══════════════════════════════════════════════════════════════ */
export const generatePayroll = async (req, res) => {
    try {
        const { employeeId, month, year, payDate, overrideAttendance } = req.body;
        const companyId = req.user.companyId || req.user.id;                 // from auth middleware

        /* ── Validate required fields ── */
        if (!employeeId || !month || !year) {
            return res.status(400).json({
                success: false,
                message: "employeeId, month, and year are required."
            });
        }
        if (month < 1 || month > 12) {
            return res.status(400).json({ success: false, message: "month must be 1–12." });
        }

        /* ── Prevent duplicate ── */
        const exists = await Payroll.findOne({
            companyId,
            employeeId,
            "payPeriod.month": month,
            "payPeriod.year": year
        });
        if (exists) {
            return res.status(409).json({
                success: false,
                message: `Payroll for ${month}/${year} already exists for this employee. Use the update endpoint to modify it.`,
                payrollId: exists._id
            });
        }

        /* ── Fetch employee ── */
        const employee = await Employee.findOne({ _id: employeeId, companyId }).lean();
        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found." });
        }
        if (employee.employmentStatus === "inactive") {
            return res.status(400).json({ success: false, message: "Employee is inactive. Cannot generate payroll." });
        }
        if (!employee.salaryStructure?.basic) {
            return res.status(400).json({ success: false, message: "Employee salary structure is not configured." });
        }

        /* ── Fetch rules ── */
        const [salaryRule, payrollRule] = await Promise.all([
            SalaryRule.findOne({ companyId }).lean(),
            PayrollRule.findOne({ companyId, isActive: true }).lean()
        ]);
        if (!salaryRule) return res.status(400).json({ success: false, message: "SalaryRule is not configured." });
        if (!payrollRule) return res.status(400).json({ success: false, message: "PayrollRule is not configured for this company." });

        /* ── Attendance summary ── */
        // Caller can pass overrideAttendance for manual corrections
        const attendance = overrideAttendance
            ?? await getAttendanceSummary(employeeId, month, year);

        /* ── Calculate ── */
        const monthLabel = new Date(year, month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        const payrollData = calculateSalary({
            employee,
            attendance,
            salaryRule,
            payrollRule,
            payPeriod: { month, year, label: monthLabel, startDate, endDate },
            payDate: payDate ? new Date(payDate) : endDate,
            generatedBy: req.user._id
        });

        /* ── Save ── */
        const payroll = await Payroll.create(payrollData);

        return res.status(201).json({
            success: true,
            message: "Payroll generated successfully.",
            data: payroll
        });

    } catch (err) {
        console.error("[generatePayroll]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   2.  POST /api/payroll/generate-bulk
       Generate & save payroll for ALL active employees of a company
═══════════════════════════════════════════════════════════════ */
export const generateBulkPayroll = async (req, res) => {
    try {
        const { month, year, payDate } = req.body;
        const companyId = req.user.companyId || req.user.id;

        if (!month || !year) {
            return res.status(400).json({ success: false, message: "month and year are required." });
        }

        /* ── Fetch all active employees ── */
        const employees = await Employee.find({ companyId, employmentStatus: "active" }).lean();
        if (!employees.length) {
            return res.status(404).json({ success: false, message: "No active employees found." });
        }

        /* ── Fetch rules once ── */
        const [salaryRule, payrollRule] = await Promise.all([
            SalaryRule.findOne({ companyId }).lean(),
            PayrollRule.findOne({ companyId, isActive: true }).lean()
        ]);
        if (!salaryRule) return res.status(400).json({ success: false, message: "SalaryRule not configured." });
        if (!payrollRule) return res.status(400).json({ success: false, message: "PayrollRule not configured." });

        const monthLabel = new Date(year, month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        const resolvedPayDate = payDate ? new Date(payDate) : endDate;

        const results = { created: [], skipped: [], failed: [] };

        for (const employee of employees) {
            try {
                /* Skip if already generated */
                const exists = await Payroll.exists({
                    companyId,
                    employeeId: employee._id,
                    "payPeriod.month": month,
                    "payPeriod.year": year
                });
                if (exists) {
                    results.skipped.push({ employeeId: employee._id, empCode: employee.empCode, reason: "Already exists" });
                    continue;
                }

                /* Skip if no salary structure */
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
       Get single employee payroll — specific month or list
       Query: ?month=6&year=2025
═══════════════════════════════════════════════════════════════ */
export const getEmployeePayroll = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { month, year, page = 1, limit = 12 } = req.query;
        const companyId = req.user.companyId || req.user.id;

        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
            return res.status(400).json({ success: false, message: "Invalid employeeId." });
        }

        /* ── Specific month ── */
        if (month && year) {
            const payroll = await Payroll.findOne({
                companyId,
                employeeId,
                "payPeriod.month": Number(month),
                "payPeriod.year": Number(year)
            }).lean();

            if (!payroll) {
                return res.status(404).json({
                    success: false,
                    message: `No payroll found for ${month}/${year}.`
                });
            }

            return res.status(200).json({ success: true, data: payroll });
        }

        /* ── All months (paginated) ── */
        const skip = (Number(page) - 1) * Number(limit);
        const query = { companyId, employeeId };

        if (year) query["payPeriod.year"] = Number(year);

        const [records, total] = await Promise.all([
            Payroll.find(query)
                .sort({ "payPeriod.year": -1, "payPeriod.month": -1 })
                .skip(skip)
                .limit(Number(limit))
                .lean(),
            Payroll.countDocuments(query)
        ]);

        return res.status(200).json({
            success: true,
            data: records,
            pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) }
        });

    } catch (err) {
        console.error("[getEmployeePayroll]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   4.  GET /api/payroll/company
       Get all employees' payroll for a company
       Query: ?month=6&year=2025&department=Engineering&status=draft
═══════════════════════════════════════════════════════════════ */
export const getCompanyPayroll = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.user.id;
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

        /* Filter by department via employeeSnapshot */
        if (department) query["employeeSnapshot.department"] = department;

        const skip = (Number(page) - 1) * Number(limit);

        const [records, total] = await Promise.all([
            Payroll.find(query)
                .sort({ "employeeSnapshot.name": 1 })
                .skip(skip)
                .limit(Number(limit))
                .lean(),
            Payroll.countDocuments(query)
        ]);

        /* ── Aggregate summary ── */
        const summary = records.reduce((acc, p) => {
            acc.totalGross += p.grossSalary;
            acc.totalDeductions += p.totalDeductions;
            acc.totalNet += p.netSalary;
            acc.totalPF += p.statutoryDeductions?.pf ?? 0;
            acc.totalESI += p.statutoryDeductions?.esi ?? 0;
            return acc;
        }, { totalGross: 0, totalDeductions: 0, totalNet: 0, totalPF: 0, totalESI: 0 });

        return res.status(200).json({
            success: true,
            data: records,
            summary,
            pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) }
        });

    } catch (err) {
        console.error("[getCompanyPayroll]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   5.  PATCH /api/payroll/:payrollId/status
       Approve / Mark as Paid / Cancel payroll
       Body: { status: "approved" | "paid" | "cancelled", remarks }
═══════════════════════════════════════════════════════════════ */
export const updatePayrollStatus = async (req, res) => {
    try {
        const { payrollId } = req.params;
        const { status, remarks } = req.body;
        const companyId = req.user.companyId;

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
        if (status === "paid") payroll.paidAt = new Date(), payroll.paidBy = req.user._id;

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
       Download Excel — all employees for a month
       Query: ?month=6&year=2025
═══════════════════════════════════════════════════════════════ */
export const downloadCompanyExcel = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.user.id;
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({ success: false, message: "month and year are required." });
        }

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
        stream.on("end", () => fs.unlink(filePath, () => { }));   // clean up tmp

    } catch (err) {
        console.error("[downloadCompanyExcel]", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};


/* ═══════════════════════════════════════════════════════════════
   7.  GET /api/payroll/download/pdf/:payrollId
       Download PDF salary slip for one employee
═══════════════════════════════════════════════════════════════ */
export const downloadSalarySlipPDF = async (req, res) => {
    try {
        const { payrollId } = req.params;
        const companyId = req.user.companyId || req.user.id;

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