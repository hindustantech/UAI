// models/Payroll.js
import mongoose from "mongoose";

/* ─────────────────────────────────────────
   Sub-schema: individual deduction line
───────────────────────────────────────── */
const DeductionLineSchema = new mongoose.Schema({
    name: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 }
}, { _id: false });

/* ─────────────────────────────────────────
   Sub-schema: individual allowance line
───────────────────────────────────────── */
const AllowanceLineSchema = new mongoose.Schema({
    name: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 }
}, { _id: false });

/* ─────────────────────────────────────────
   Main Payroll Schema
───────────────────────────────────────── */
const PayrollSchema = new mongoose.Schema(
    {
        /* ── Identifiers ── */
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        employeeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
            required: true,
            index: true
        },

        /* ── Pay Period ── */
        payPeriod: {
            month: { type: Number, required: true, min: 1, max: 12 },   // 1-12
            year: { type: Number, required: true },                     // 2025
            label: { type: String },                                     // "June 2025"
            startDate: { type: Date },
            endDate: { type: Date }
        },
        payDate: { type: Date },   // actual disbursement date

        /* ── Employee snapshot (denormalised for PDF permanence) ── */
        employeeSnapshot: {
            empCode: String,
            name: String,
            designation: String,
            department: String,
            grade: String,
            bankAccount: String,
            bankName: String,
            ifsc: String,
            joiningDate: Date
        },

        /* ── Attendance Summary ── */
        attendance: {
            standardDays: { type: Number, default: 30 },   // always 30
            weeklyOffDays: { type: Number, default: 0 },
            holidays: { type: Number, default: 0 },
            leaveDays: { type: Number, default: 0 },
            absentDays: { type: Number, default: 0 },
            lateDays: { type: Number, default: 0 },    // attendance "late" count
            halfDays: { type: Number, default: 0 },
            presentDays: { type: Number, default: 0 },    // payable working days
        },

        /* ── Salary Rule Deductions (from SalaryRule model) ── */
        salaryRuleDeductions: {
            lateCutDays: { type: Number, default: 0 },   // days deducted due to late rule
            halfDayCutDays: { type: Number, default: 0 },   // days deducted due to half-day rule
            totalCutDays: { type: Number, default: 0 }    // sum
        },

        /* ── Payable Days ── */
        payableDays: { type: Number, default: 0 },  // presentDays - totalCutDays

        /* ── Earnings ── */
        earnings: {
            basic: { type: Number, default: 0 },
            hra: { type: Number, default: 0 },
            da: { type: Number, default: 0 },
            bonus: { type: Number, default: 0 },
            overtime: { type: Number, default: 0 },
            otherAllowances: { type: [AllowanceLineSchema], default: [] }
        },
        grossSalary: { type: Number, default: 0 },   // sum of all earnings

        /* ── Statutory Deductions (from PayrollRule model) ── */
        statutoryDeductions: {
            pf: { type: Number, default: 0 },
            esi: { type: Number, default: 0 },
            gratuity: { type: Number, default: 0 }
        },

        /* ── Other Deductions ── */
        otherDeductions: {
            incomeTax: { type: Number, default: 0 },
            professionalTax: { type: Number, default: 0 },
            additionalLines: { type: [DeductionLineSchema], default: [] }
        },

        totalDeductions: { type: Number, default: 0 },  // all deductions combined

        /* ── Net Salary ── */
        netSalary: { type: Number, default: 0 },   // grossSalary - totalDeductions
        lossOfPay: {
            lopDays: { type: Number, default: 0 },
            lopAmount: { type: Number, default: 0 }
        },
        /* ── Per-unit rates used (for transparency) ── */
        ratesUsed: {
            perDayRate: { type: Number, default: 0 },
            perHourRate: { type: Number, default: 0 }
        },

        /* ── Status ── */
        status: {
            type: String,
            enum: ["draft", "approved", "paid", "cancelled"],
            default: "draft"
        },
        paidAt: { type: Date, default: null },
        paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        remarks: { type: String, default: "" },

        /* ── Audit ── */
        generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        editLogs: [
            {
                editedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                reason: String,
                oldValue: Object,
                newValue: Object,
                editedAt: { type: Date, default: Date.now }
            }
        ]
    },
    { timestamps: true }
);

/* ── Indexes ── */
// One payroll record per employee per month/year per company
PayrollSchema.index(
    { companyId: 1, employeeId: 1, "payPeriod.month": 1, "payPeriod.year": 1 },
    { unique: true }
);
PayrollSchema.index({ companyId: 1, "payPeriod.year": 1, "payPeriod.month": 1 });
PayrollSchema.index({ status: 1 });

export default mongoose.model("Payroll", PayrollSchema);