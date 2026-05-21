// controllers/employeeController.js

import mongoose from "mongoose";
import Employee from "../../models/Attandance/Employee.js";
import User from "../../models/userModel.js";
import Shift from '../../models/Attandance/Shift.js'
import csv from "csv-parser";
import { Readable } from "stream";

// Helper function to parse CSV buffer with validation
const parseCSV = (buffer) => {
    return new Promise((resolve, reject) => {
        const results = [];
        const stream = Readable.from(buffer.toString());

        let headers = null;
        let rowCount = 0;

        stream
            .pipe(csv())
            .on("headers", (headersList) => {
                headers = headersList;
                // Validate minimum required headers
                const requiredHeaders = ['phone'];
                const missingHeaders = requiredHeaders.filter(h => !headersList.includes(h));
                if (missingHeaders.length > 0) {
                    reject(new Error(`Missing required headers: ${missingHeaders.join(', ')}`));
                }
            })
            .on("data", (data) => {
                rowCount++;
                // Skip empty rows
                if (Object.values(data).every(value => !value || value.trim() === '')) {
                    return;
                }
                results.push(data);
            })
            .on("end", () => {
                if (results.length === 0) {
                    reject(new Error("CSV file contains no valid data rows"));
                }
                resolve(results);
            })
            .on("error", (error) => {
                reject(new Error(`CSV parsing error: ${error.message}`));
            });
    });
};

// Validate phone number format
const validatePhoneNumber = (phone) => {
    if (!phone) return false;
    const phoneRegex = /^[0-9]{10}$|^[0-9]{10,15}$/;
    return phoneRegex.test(phone.toString().trim());
};

// Validate coordinates
const validateCoordinates = (lat, lng) => {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) return false;
    if (latitude < -90 || latitude > 90) return false;
    if (longitude < -180 || longitude > 180) return false;

    return true;
};

// Validate email format (if needed)
const validateEmail = (email) => {
    if (!email) return true; // Optional field
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Validate date format
const validateDate = (dateString) => {
    if (!dateString) return true;
    const date = new Date(dateString);
    return !isNaN(date.getTime());
};

// Sanitize and parse numeric values
const parseNumericValue = (value, defaultValue = 0) => {
    if (!value || value === '') return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
};

// Main controller function to create employees from CSV
export const createEmployeesFromCSV = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { partnerPhone } = req.body;
        const csvFile = req.file;

        // Validation for request body
        if (!req.body || Object.keys(req.body).length === 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: "Request body is empty",
                error: "Partner phone number is required in request body"
            });
        }

        if (!partnerPhone) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                error: "Partner phone number is required",
                requiredField: "partnerPhone"
            });
        }

        // Validate phone number format
        if (!validatePhoneNumber(partnerPhone)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                error: "Invalid partner phone number format. Must be 10-15 digits"
            });
        }

        if (!csvFile) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                error: "CSV file is required",
                requiredField: "csvFile"
            });
        }

        // Validate file type
        const allowedMimeTypes = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
        if (!allowedMimeTypes.includes(csvFile.mimetype) && !csvFile.originalname.endsWith('.csv')) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                error: "Invalid file type. Only CSV files are allowed"
            });
        }

        // Validate file size (max 5MB)
        const maxFileSize = 5 * 1024 * 1024; // 5MB
        if (csvFile.size > maxFileSize) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                error: `File size too large. Maximum size is ${maxFileSize / (1024 * 1024)}MB`
            });
        }

        if (csvFile.size === 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                error: "Uploaded file is empty"
            });
        }

        // Step 1: Find partner user by phone number
        let partnerUser;
        try {
            partnerUser = await User.findOne({
                phone: partnerPhone,
                type: { $in: ["admin", "super_admin", "partner"] }
            }).session(session);
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error("Database error while finding partner:", error);
            return res.status(500).json({
                success: false,
                message: "Database error",
                error: "Failed to search for partner user"
            });
        }

        if (!partnerUser) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: "Partner not found",
                error: `No partner found with phone number: ${partnerPhone}`,
                searchedPhone: partnerPhone
            });
        }

        const companyId = partnerUser._id;

        // Step 2: Find available shifts for this company
        let availableShifts;
        try {
            availableShifts = await Shift.find({
                companyId: companyId,
            }).session(session);
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error("Database error while finding shifts:", error);
            return res.status(500).json({
                success: false,
                message: "Database error",
                error: "Failed to fetch shift information"
            });
        }

        if (!availableShifts || availableShifts.length === 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: "No shifts available",
                error: "No active shifts found for this company. Please create a shift first.",
                companyId: companyId
            });
        }

        const defaultShiftId = availableShifts[0]._id;

        // Step 3: Parse CSV file
        let csvData;
        try {
            csvData = await parseCSV(csvFile.buffer);
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: "CSV Parsing Error",
                error: error.message,
                details: "Please ensure your CSV file has the correct format"
            });
        }

        const createdEmployees = [];
        const errors = [];
        const warnings = [];
        let successfulRows = 0;

        // Step 4: Process each row from CSV
        for (let index = 0; index < csvData.length; index++) {
            const row = csvData[index];
            const rowNumber = index + 1;

            try {
                // Skip completely empty rows
                if (!row || Object.keys(row).length === 0 || Object.values(row).every(v => !v || v.trim() === '')) {
                    warnings.push({
                        row: rowNumber,
                        warning: "Skipped empty row"
                    });
                    continue;
                }

                // Extract phone number with multiple fallback options
                const userPhone = (row.phone || row.user_phone || row.mobile || row.phoneNumber || "").toString().trim();

                if (!userPhone) {
                    errors.push({
                        row: rowNumber,
                        error: "Phone number is required",
                        data: row
                    });
                    continue;
                }

                // Validate phone number format
                if (!validatePhoneNumber(userPhone)) {
                    errors.push({
                        row: rowNumber,
                        phone: userPhone,
                        error: "Invalid phone number format. Must be 10-15 digits",
                        data: row
                    });
                    continue;
                }

                // Step 5: Find user by phone number
                let user;
                try {
                    user = await User.findOne({ phone: userPhone }).session(session);
                } catch (error) {
                    errors.push({
                        row: rowNumber,
                        phone: userPhone,
                        error: `Database error while finding user: ${error.message}`,
                        data: row
                    });
                    continue;
                }

                if (!user) {
                    errors.push({
                        row: rowNumber,
                        phone: userPhone,
                        error: "User not found with this phone number. Please create user first.",
                        data: row
                    });
                    continue;
                }

                // Validate user has required fields
                if (!user._id) {
                    errors.push({
                        row: rowNumber,
                        phone: userPhone,
                        error: "User found but missing ID",
                        data: row
                    });
                    continue;
                }

                // Get user's coordinates with multiple fallback options
                const userCoordinates = user.location?.coordinates ||
                    user.address?.coordinates ||
                    user.currentLocation?.coordinates ||
                    (user.latitude && user.longitude ? [user.longitude, user.latitude] : null);

                // Validate coordinates from CSV or user
                // Get coordinates from CSV first
                const csvLat = row.latitude || row.lat;
                const csvLng = row.longitude || row.lng || row.lon;

                let finalCoordinates = null;

                // 1. Check CSV coordinates
                if (csvLat && csvLng && validateCoordinates(csvLat, csvLng)) {
                    finalCoordinates = [
                        parseFloat(csvLng),
                        parseFloat(csvLat)
                    ];
                }

                // 2. Check user latest location
                else if (
                    user?.latestLocation?.coordinates &&
                    user.latestLocation.coordinates.length === 2 &&
                    validateCoordinates(
                        user.latestLocation.coordinates[1],
                        user.latestLocation.coordinates[0]
                    )
                ) {
                    finalCoordinates = user.latestLocation.coordinates;
                }

                // 3. Check partner latest location
                else if (
                    partnerUser?.latestLocation?.coordinates &&
                    partnerUser.latestLocation.coordinates.length === 2 &&
                    validateCoordinates(
                        partnerUser.latestLocation.coordinates[1],
                        partnerUser.latestLocation.coordinates[0]
                    )
                ) {
                    finalCoordinates = partnerUser.latestLocation.coordinates;
                }



                if (!finalCoordinates) {
                    errors.push({
                        row: rowNumber,
                        phone: userPhone,
                        error: "Valid coordinates not found. Please provide latitude/longitude in CSV or ensure user has location set.",
                        data: row
                    });
                    continue;
                }

                // Check for duplicate employee
                let existingEmployee;
                try {
                    existingEmployee = await Employee.findOne({
                        companyId: companyId,
                        userId: user._id
                    }).session(session);
                } catch (error) {
                    errors.push({
                        row: rowNumber,
                        phone: userPhone,
                        error: `Database error while checking existing employee: ${error.message}`,
                        data: row
                    });
                    continue;
                }

                if (existingEmployee) {
                    errors.push({
                        row: rowNumber,
                        phone: userPhone,
                        error: "Employee already exists for this company",
                        existingEmployeeId: existingEmployee._id,
                        data: row
                    });
                    continue;
                }

                // Validate and process shift ID
                let shiftId = defaultShiftId;
                if (row.shiftId) {
                    try {
                        const shiftExists = await Shift.findById(row.shiftId).session(session);
                        if (shiftExists && shiftExists.companyId.toString() === companyId.toString()) {
                            shiftId = row.shiftId;
                        } else {
                            warnings.push({
                                row: rowNumber,
                                phone: userPhone,
                                warning: "Invalid shift ID provided, using default shift"
                            });
                        }
                    } catch (error) {
                        warnings.push({
                            row: rowNumber,
                            phone: userPhone,
                            warning: `Error validating shift ID: ${error.message}, using default shift`
                        });
                    }
                }

                // Validate date if provided
                if (row.joiningDate && !validateDate(row.joiningDate)) {
                    warnings.push({
                        row: rowNumber,
                        phone: userPhone,
                        warning: "Invalid joining date format, using current date"
                    });
                }

                // Prepare employee data with validation
                const employeeData = {
                    companyId: companyId,
                    shift: shiftId,
                    userId: user._id,
                    user_name: (row.user_name || user.name || `${user.firstName || ''} ${user.lastName || ''}`).trim() || user.phone,
                    weeklyOff: row.weeklyOff ? row.weeklyOff.split(",").map(day => day.trim()) : ["Sunday"],
                    empCode: row.empCode ? row.empCode.trim() : `EMP${Date.now()}${rowNumber}`,
                    referalCode: row.referalCode ? row.referalCode.trim() : null || user.referalCode ,
                    jobInfo: {
                        designation: (row.designation || "Staff").trim(),
                        department: (row.department || "General").trim(),
                        department_code: (row.department_code || "GEN").trim().toUpperCase(),
                        grade: (row.grade || "A").trim().toUpperCase(),
                        grade_code: (row.grade_code || "A1").trim().toUpperCase(),
                        joiningDate: row.joiningDate && validateDate(row.joiningDate) ? new Date(row.joiningDate) : new Date(),
                        reportingManager: row.reportingManagerId && mongoose.Types.ObjectId.isValid(row.reportingManagerId) ? row.reportingManagerId : null
                    },
                    employeeType: ["non_sales", "sales", "pro_sales"].includes(row.employeeType) ? row.employeeType : "non_sales",
                    role: ["employee", "manager", "hr", "admin", "sales", "super_admin"].includes(row.role) ? row.role : "employee",
                    salaryStructure: {
                        basic: parseNumericValue(row.basic, 0),
                        hra: parseNumericValue(row.hra, 0),
                        da: parseNumericValue(row.da, 0),
                        bonus: parseNumericValue(row.bonus, 0),
                        perDay: parseNumericValue(row.perDay, 0),
                        perHour: parseNumericValue(row.perHour, 0),
                        overtimeRate: parseNumericValue(row.overtimeRate, 0)
                    },
                    bankDetails: {
                        accountNo: row.accountNo ? row.accountNo.toString().trim() : "",
                        ifsc: row.ifsc ? row.ifsc.toString().trim().toUpperCase() : "",
                        bankName: row.bankName ? row.bankName.toString().trim() : ""
                    },
                    officeLocation: {
                        type: "Point",
                        coordinates: finalCoordinates,
                        locationtype: ["current", "employee"].includes(row.locationtype) ? row.locationtype : "employee",
                        radius: parseNumericValue(row.radius, 200),
                        manual: row.manualAddress ? row.manualAddress.toString().trim() : ""
                    },
                    employmentStatus: "active"
                };

                // Create employee with error handling
                let employee;
                try {
                    employee = new Employee(employeeData);
                    await employee.save({ session });
                    successfulRows++;

                    createdEmployees.push({
                        row: rowNumber,
                        employeeId: employee._id,
                        userId: user._id,
                        name: employee.user_name,
                        empCode: employee.empCode,
                        phone: userPhone
                    });
                } catch (error) {
                    // Handle mongoose validation errors
                    if (error.name === 'ValidationError') {
                        const validationErrors = Object.values(error.errors).map(e => e.message);
                        errors.push({
                            row: rowNumber,
                            phone: userPhone,
                            error: `Validation failed: ${validationErrors.join(', ')}`,
                            data: row
                        });
                    } else if (error.code === 11000) {
                        errors.push({
                            row: rowNumber,
                            phone: userPhone,
                            error: "Duplicate key error - Employee may already exist",
                            data: row
                        });
                    } else {
                        errors.push({
                            row: rowNumber,
                            phone: userPhone,
                            error: `Failed to save employee: ${error.message}`,
                            data: row
                        });
                    }
                    continue;
                }

            } catch (error) {
                console.error(`Unexpected error processing row ${rowNumber}:`, error);
                errors.push({
                    row: rowNumber,
                    error: `Unexpected error: ${error.message}`,
                    data: row
                });
            }
        }

        // Commit transaction if at least one employee was created successfully
        if (successfulRows > 0) {
            await session.commitTransaction();
        } else {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: "No employees were created",
                error: "All rows failed validation or processing",
                details: {
                    totalRows: csvData.length,
                    errors: errors.length,
                    warnings: warnings.length,
                    errorsList: errors.slice(0, 10), // Limit error display
                    warningsList: warnings.slice(0, 10)
                }
            });
        }

        session.endSession();

        // Return response with comprehensive summary
        return res.status(successfulRows > 0 ? 200 : 400).json({
            success: successfulRows > 0,
            message: successfulRows > 0 ? "Employee creation completed" : "Employee creation failed",
            summary: {
                totalRowsInCSV: csvData.length,
                successfullyCreated: createdEmployees.length,
                failedRows: errors.length,
                warnings: warnings.length,
                successRate: `${((createdEmployees.length / csvData.length) * 100).toFixed(2)}%`
            },
            data: {
                createdEmployees: createdEmployees.slice(0, 100), // Limit response size
                companyInfo: {
                    companyId: companyId,
                    companyName: partnerUser.name || partnerUser.email || partnerUser.phone,
                    companyPhone: partnerUser.phone,
                    usedShiftId: defaultShiftId,
                    shiftName: availableShifts[0]?.name || "Default Shift"
                }
            },
            errors: {
                count: errors.length,
                list: errors.slice(0, 20), // Limit error display
                message: errors.length > 20 ? `And ${errors.length - 20} more errors...` : undefined
            },
            warnings: {
                count: warnings.length,
                list: warnings.slice(0, 10)
            }
        });

    } catch (error) {
        // Rollback transaction on any unexpected error
        await session.abortTransaction();
        session.endSession();

        console.error("Critical error in createEmployeesFromCSV:", error);

        // Handle specific error types
        if (error.name === 'MongoNetworkError') {
            return res.status(503).json({
                success: false,
                message: "Database connection error",
                error: "Unable to connect to database. Please try again later."
            });
        }

        if (error.name === 'MongooseError') {
            return res.status(500).json({
                success: false,
                message: "Database operation error",
                error: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? error.message : "An unexpected error occurred",
            errorType: error.name
        });
    }
};

// Export additional helper functions for testing
export const helpers = {
    validatePhoneNumber,
    validateCoordinates,
    parseNumericValue,
    validateDate
};