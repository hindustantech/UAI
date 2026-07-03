// models/Payroll.js
import mongoose from "mongoose";

/* ── Sub-schemas ── */
const DeductionLineSchema = new mongoose.Schema({
    name: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 }
}, { _id: false });

const AllowanceLineSchema = new mongoose.Schema({
    name: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 }
}, { _id: false });

const PayrollSchema = new mongoose.Schema(
    {
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

        payPeriod: {
            month: { type: Number, required: true, min: 1, max: 12 },
            year: { type: Number, required: true },
            label: { type: String },
            startDate: { type: Date },
            endDate: { type: Date }
        },
        payDate: { type: Date },

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

        attendance: {
            standardDays: { type: Number, default: 30 },
            weeklyOffDays: { type: Number, default: 0 },
            holidays: { type: Number, default: 0 },
            leaveDays: { type: Number, default: 0 },
            absentDays: { type: Number, default: 0 },
            lateDays: { type: Number, default: 0 },
            halfDays: { type: Number, default: 0 },
            presentDays: { type: Number, default: 0 }
        },

        salaryRuleDeductions: {
            lateCutDays: { type: Number, default: 0 },
            halfDayCutDays: { type: Number, default: 0 },
            totalCutDays: { type: Number, default: 0 },
            salaryRuleCutAmount: { type: Number, default: 0 }
        },

        payableDays: { type: Number, default: 0 },

        earnings: {
            basic: { type: Number, default: 0 },
            hra: { type: Number, default: 0 },
            da: { type: Number, default: 0 },
            bonus: { type: Number, default: 0 },
            overtime: { type: Number, default: 0 },
            otherAllowances: { type: [AllowanceLineSchema], default: [] }
        },
        grossSalary: { type: Number, default: 0 },

        // NEW: Overtime details
        overtime: {
            hours: { type: Number, default: 0 },
            rate: { type: Number, default: 0 },
            amount: { type: Number, default: 0 },
            calculationType: { 
                type: String, 
                enum: ['standard_rate', 'custom_rate'],
                default: 'standard_rate'
            }
        },

        // NEW: Break deductions
        breakDeductions: {
            hours: { type: Number, default: 0 },
            amount: { type: Number, default: 0 }
        },

        statutoryDeductions: {
            pf: { type: Number, default: 0 },
            esi: { type: Number, default: 0 },
            gratuity: { type: Number, default: 0 }
        },

        otherDeductions: {
            incomeTax: { type: Number, default: 0 },
            professionalTax: { type: Number, default: 0 },
            additionalLines: { type: [DeductionLineSchema], default: [] }
        },

        totalDeductions: { type: Number, default: 0 },
        netSalary: { type: Number, default: 0 },

        lossOfPay: {
            lopDays: { type: Number, default: 0 },
            lopAmount: { type: Number, default: 0 }
        },

        // ENHANCED: Rates used
        ratesUsed: {
            salaryType: { 
                type: String, 
                enum: ['basic', 'per_day', 'per_hour'],
                default: 'basic'
            },
            perDayRate: { type: Number, default: 0 },
            perHourRate: { type: Number, default: 0 },
            standardDays: { type: Number, default: 30 },
            standardHours: { type: Number, default: 8 }
        },

        status: {
            type: String,
            enum: ["draft", "approved", "paid", "cancelled"],
            default: "draft"
        },
        paidAt: { type: Date, default: null },
        paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        remarks: { type: String, default: "" },

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
PayrollSchema.index(
    { companyId: 1, employeeId: 1, "payPeriod.month": 1, "payPeriod.year": 1 },
    { unique: true }
);
PayrollSchema.index({ companyId: 1, "payPeriod.year": 1, "payPeriod.month": 1 });
PayrollSchema.index({ status: 1 });

export default mongoose.model("Payroll", PayrollSchema);