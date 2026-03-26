// models/Employee.js

import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema({

    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    shift: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Shift",
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    user_name: {
        type: String,
    },
    weeklyOff: [{
        type: String,
        enum: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        default: "Sunday"
    }],
    empCode: {
        type: String,

    },



    jobInfo: {
        designation: String,
        department: String,
        department_code: String,
        grade: String,
        grade_code: String,
        joiningDate: Date,
        reportingManager: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        }
    },

    role: {
        type: String,
        enum: ["employee", "manager", "hr", "admin", "super_admin"],
        default: "employee"
    },

    salaryStructure: {
        basic: Number,
        hra: Number,
        da: Number,
        bonus: Number,

        perDay: Number,
        perHour: Number,

        overtimeRate: Number
    },

    bankDetails: {
        accountNo: String,
        ifsc: String,
        bankName: String
    },
    officeLocation: {
        type: {
            type: String,
            enum: ["Point"],
            default: "Point"
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true
        },
        locationtype: {
            type: String,
            enum:['current','employee']
        },
        radius: {
            type: Number // meters
        },
        manual: {
            type: String,  
        }
    },
    employmentStatus: {
        type: String,
        enum: ["active", "suspended", "terminated", "resigned"],
        default: "active"
    }

}, {
    timestamps: true
});

employeeSchema.index({
    officeLocation: "2dsphere"
});
employeeSchema.index({ companyId: 1, userId: 1 }, { unique: true });
employeeSchema.index({ empCode: 1 }, { unique: true });
export default mongoose.model("Employee", employeeSchema);
