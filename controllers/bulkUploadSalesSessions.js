import mongoose from "mongoose";
import { SalesSession } from "../models/Attandance/Salses/Salses.js";
import Employee from "../models/Attandance/Employee.js";
import User from "../models/userModel.js";
import xlsx from "xlsx";
import csv from "csv-parser";
import fs from "fs";
import { generateUniqueCustomerIdWithRetry } from "../utils/nanoid.js";

/* ============================================================
BULK UPLOAD CONTROLLER (UPDATED)
============================================================ */

/**
 * Bulk upload sales sessions with customer details
 * Gets location from uploading user and company from user's company
 */
export const bulkUploadSalesSessions = async (req, res) => {
    try {
        // Check if file exists
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Please upload a file (Excel or CSV)"
            });
        }

        const companyId = req.user._id || req.user.id || req.user.companyId;
        // Get the uploading user's details
        const uploaderUser = await User.findById(companyId)
            .select('_id name email type latestLocation companyId');

        if (!uploaderUser) {
            return res.status(404).json({
                success: false,
                message: "Uploader user not found"
            });
        }

        // Determine company ID based on user type


        if (!companyId) {
            return res.status(400).json({
                success: false,
                message: "Could not determine company for this user"
            });
        }

        // Get user's current location
        const userLocation = uploaderUser.latestLocation || {
            type: "Point",
            coordinates: [0, 0] // Default if no location
        };

        const filePath = req.file.path;
        const fileExtension = req.file.originalname.split('.').pop().toLowerCase();

        let records = [];

        // Parse file based on extension
        if (fileExtension === 'xlsx' || fileExtension === 'xls') {
            records = await parseExcelFile(filePath);
        } else if (fileExtension === 'csv') {
            records = await parseCSVFile(filePath);
        } else {
            return res.status(400).json({
                success: false,
                message: "Unsupported file format. Please upload Excel or CSV file"
            });
        }

        if (!records || records.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No records found in the uploaded file"
            });
        }

        // Process records with uploader's location and company
        const results = await processBulkRecords(
            records,
            companyId,
            uploaderUser,
            userLocation
        );

        // Clean up uploaded file
        fs.unlinkSync(filePath);

        return res.status(200).json({
            success: true,
            message: "Bulk upload completed successfully",
            data: {
                uploadedBy: {
                    userId: uploaderUser._id,
                    userName: uploaderUser.name,
                    userType: uploaderUser.type
                },
                companyId: companyId,
                locationUsed: userLocation.coordinates,
                summary: {
                    total: records.length,
                    successful: results.successful.length,
                    failed: results.failed.length
                },
                successfulRecords: results.successful,
                failedRecords: results.failed
            }
        });

    } catch (error) {
        console.error("Bulk upload error:", error);

        // Clean up file if exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error during bulk upload",
            error: error.message
        });
    }
};



/* ============================================================
FILE PARSING FUNCTIONS
============================================================ */

/**
 * Parse Excel file
 */
const parseExcelFile = (filePath) => {
    try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const records = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

        // Validate required columns
        validateRequiredColumns(records);

        return records;
    } catch (error) {
        throw new Error(`Excel parsing error: ${error.message}`);
    }
};

/**
 * Parse CSV file
 */
const parseCSVFile = (filePath) => {
    return new Promise((resolve, reject) => {
        const records = [];

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                // Clean up keys (remove spaces, convert to lowercase)
                const cleanedRow = {};
                Object.keys(row).forEach(key => {
                    const cleanedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
                    cleanedRow[cleanedKey] = row[key]?.trim();
                });
                records.push(cleanedRow);
            })
            .on('end', () => {
                validateRequiredColumns(records);
                resolve(records);
            })
            .on('error', (error) => {
                reject(new Error(`CSV parsing error: ${error.message}`));
            });
    });
};

/**
 * Validate required columns (removed latitude/longitude as not required)
 */
const validateRequiredColumns = (records) => {
    if (!records || records.length === 0) {
        throw new Error("No records found");
    }

    const firstRecord = records[0];
    const requiredFields = [

        'company_name',
        'contact_name',
        'phone_number',
        'address'
    ];

    const missingFields = requiredFields.filter(field => !(field in firstRecord));

    if (missingFields.length > 0) {
        throw new Error(`Missing required columns: ${missingFields.join(', ')}. Required columns are: company_name, contact_name, phone_number, address`);
    }

    // At least one of these should be present
    const salespersonFields = ['salesperson_referral_code', 'salesperson_id', 'assigned_to'];
    const hasSalespersonField = salespersonFields.some(field => field in firstRecord);

    if (!hasSalespersonField) {
        throw new Error(`At least one of these columns is required: ${salespersonFields.join(', ')}`);
    }
};


/**
 * Process bulk records with validation and error handling
 */

const processBulkRecords = async (records, companyId, uploaderUser, userLocation) => {
    const successful = [];
    const failed = [];

    for (let i = 0; i < records.length; i++) {
        try {
            const record = records[i];
            const rowNumber = i + 2; // Excel row number (accounting for header)

            // Find salesperson by referral code or UID
            const salesperson = await findSalesperson(record, companyId, uploaderUser);

            if (!salesperson) {
                failed.push({
                    row: rowNumber,
                    error: `Salesperson not found with provided ID/Referral Code in company ${companyId}`,
                    data: record
                });
                continue;
            }

            // Generate unique customer ID using the helper function
            let customerId;
            try {
                // Use the provided customer_id if available, otherwise generate one
                if (record.customer_id && record.customer_id.toString().trim() !== '') {
                    // Check if the provided customer_id already exists
                    const existingCustomer = await SalesSession.findOne({
                        "customer.customerId": record.customer_id.toString().trim()
                    });

                    if (existingCustomer) {
                        // If provided ID exists, generate a new one
                        customerId = await generateUniqueCustomerIdWithRetry(SalesSession);
                    } else {
                        // Use the provided ID if it doesn't exist
                        customerId = record.customer_id.toString().trim();
                    }
                } else {
                    // Generate new customer ID if not provided
                    customerId = await generateUniqueCustomerIdWithRetry(SalesSession);
                }
            } catch (genError) {
                failed.push({
                    row: rowNumber,
                    error: `Failed to generate unique customer ID: ${genError.message}`,
                    data: record
                });
                continue;
            }

            // Prepare customer data with generated ID and user's location
            const customerData = prepareCustomerData(record, userLocation, customerId);

            // Create sales session
            const sessionData = {
                sessionId: await generateSessionId(),
                customer: customerData,
                companyId: companyId,
                createdBy: uploaderUser._id,
                assignedTo: [salesperson._id],
                employeeId: salesperson._id,
                status: "in_progress",
                SalesStatus: "open",
                // Use uploader's location for punch-in
                punchInLocation: userLocation,
                punchOutLocation: userLocation,
            
                punchOutTime: new Date(),
                punchInTime: new Date(),
                routePath: userLocation
            };

            // Save to database
            const salesSession = new SalesSession(sessionData);
            await salesSession.save();

            successful.push({
                row: rowNumber,
                sessionId: salesSession.sessionId,
                customerId: customerId,
                companyName: customerData.companyName,
                assignedTo: {
                    id: salesperson._id,
                    name: salesperson.name,
                    uid: salesperson.uid,
                    referralCode: salesperson.referalCode
                },
                locationUsed: userLocation.coordinates
            });

            // Update referral count if referral code was used
            if (record.salesperson_referral_code && salesperson.referalCode === record.salesperson_referral_code) {
                await updateReferralCount(salesperson._id);
            }

        } catch (error) {
            console.error(`Error processing row ${i + 2}:`, error);
            failed.push({
                row: i + 2,
                error: error.message,
                data: records[i]
            });
        }
    }

    return { successful, failed };
};


/**
 * Find salesperson by referral code or UID within company scope
 */
const findSalesperson = async (record, companyId, uploaderUser) => {
    try {
        let salesperson = null;
        let query = {
            accountStatus: "ACTIVE",
            suspend: false
        };

        // Try finding by referral code first
        if (record.salesperson_referral_code) {
            salesperson = await User.findOne({
                ...query,
                referalCode: record.salesperson_referral_code
            }).select('_id name email uid referalCode type');
        }

        // If not found, try by salesperson ID (UID)
        if (!salesperson && record.salesperson_id) {
            salesperson = await User.findOne({
                ...query,
                uid: record.salesperson_id
            }).select('_id name email uid referalCode type');
        }

        // If not found, try by user ID directly
        if (!salesperson && record.assigned_to) {
            if (mongoose.Types.ObjectId.isValid(record.assigned_to)) {
                salesperson = await User.findById(record.assigned_to)
                    .select('_id name email uid referalCode type');
            }
        }

        // Self-assignment for partner/agency
        if (!salesperson && (uploaderUser.type === 'partner' || uploaderUser.type === 'agency')) {
            const noSalespersonSpecified = !record.salesperson_referral_code &&
                !record.salesperson_id &&
                !record.assigned_to;
            if (noSalespersonSpecified) {
                salesperson = uploaderUser;
            }
        }

        // Check in Employee table
        if (salesperson) {
            const employee = await Employee.findOne({
                userId: salesperson._id,
                companyId: companyId,
                employmentStatus: 'active'
            });

            if (!employee) return null;

            // Check employee type
            if (employee.employeeType !== 'sales' && employee.employeeType !== 'pro_sales') {
                return null;
            }
        }

        return salesperson;
    } catch (error) {
        console.error("Error finding salesperson:", error);
        return null;
    }
};

/**
 * Get all referral codes for a company
 */
const getCompanyReferralCodes = async (companyId) => {
    try {
        const company = await User.findById(companyId).select('referalCode');
        if (!company || !company.referalCode) return [];
        return [company.referalCode];
    } catch (error) {
        console.error("Error getting company referral codes:", error);
        return [];
    }
};


/**
 * Prepare customer data with uploader's location
 */
const prepareCustomerData = (record, userLocation) => {
    // Use uploader's location for the customer location
    const location = userLocation && userLocation.coordinates ? {
        type: "Point",
        coordinates: userLocation.coordinates
    } : {
        type: "Point",
        coordinates: [0, 0] // Default coordinates
    };

    return {
        customerId: record.customer_id?.toString() || "",
        companyName: record.company_name || "",
        contactName: record.contact_name || "",
        phoneNumber: record.phone_number?.toString() || "",
        address: record.address || "",
        landmark: record.landmark || "",
        location: location // Using uploader's location instead of CSV coordinates
    };
};

/* ============================================================
UTILITY FUNCTIONS
============================================================ */

/**
 * Generate unique session ID
 */
const generateSessionId = async () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const sessionId = `SESS-${timestamp}-${random}`;

    // Check if session ID already exists
    const existingSession = await SalesSession.findOne({ sessionId });
    if (existingSession) {
        return generateSessionId(); // Recursive call if duplicate
    }

    return sessionId;
};

/**
 * Update referral count for salesperson
 */
const updateReferralCount = async (userId) => {
    try {
        await User.findByIdAndUpdate(
            userId,
            { $inc: { referaluseCount: 1 } },
            { new: true }
        );
    } catch (error) {
        console.error("Error updating referral count:", error);
        // Don't throw error as this is not critical
    }
};

/* ============================================================
ADDITIONAL CONTROLLERS
============================================================ */

/**
 * Get bulk upload template (simplified - no lat/long)
 */
export const getBulkUploadTemplate = async (req, res) => {
    try {
        // Get uploader's info for template customization
        const uploaderUser = await User.findById(req.user._id)
            .select('name uid referalCode type latestLocation');

        if (!uploaderUser) {
            return res.status(404).json({
                success: false,
                message: "Uploader user not found"
            });
        }

        const companyId = req.user._id || req.user.id || req.user.companyId
        // Create sample data with uploader's info in notes
        const sampleData = [
            {
                company_name: "ABC Electronics",
                contact_name: "John Doe",
                phone_number: "9876543210",
                address: "123 Main Street, Mumbai",
                landmark: "Near Central Mall",
                salesperson_referral_code: "REF123ABC",


            },
            {
                company_name: "XYZ Traders",
                contact_name: "Jane Smith",
                phone_number: "9876543211",
                address: "456 Park Avenue, Delhi",
                landmark: "Opposite Metro Station",
                salesperson_referral_code: "",
            }
        ];

        // Create workbook and worksheet
        const workbook = xlsx.utils.book_new();

        // Create worksheet directly from data
        const ws = xlsx.utils.json_to_sheet(sampleData);



        // Shift the data down to accommodate headers
        // Move existing data to start after header rows
        const headerRows = 7; // Number of rows used by headers

        // Set column widths
        const colWidths = Object.keys(sampleData[0]).map(key => ({
            wch: Math.max(key.length, 20)
        }));
        ws['!cols'] = colWidths;

        xlsx.utils.book_append_sheet(workbook, ws, "Sales Sessions");

        // Generate buffer
        const buffer = xlsx.write(workbook, {
            type: 'buffer',
            bookType: 'xlsx'
        });

        // Set headers
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            'attachment; filename=sales_session_template.xlsx'
        );

        return res.send(buffer);

    } catch (error) {
        console.error("Template generation error:", error);
        // Log more details for debugging
        console.error("Error details:", {
            message: error.message,
            stack: error.stack,
            user: req.user?._id
        });

        return res.status(500).json({
            success: false,
            message: "Error generating template",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get uploader's current information
 */
export const getUploaderInfo = async (req, res) => {
    try {
        const uploaderUser = await User.findById(req.user._id)
            .select('name email uid referalCode type latestLocation');

        const companyId = req.user._id || req.user.id || req.user.companyId

        const company = await User.findById(companyId)
            .select('name email uid type');

        return res.status(200).json({
            success: true,
            data: {
                uploader: {
                    id: uploaderUser._id,
                    name: uploaderUser.name,
                    uid: uploaderUser.uid,
                    type: uploaderUser.type,
                    referralCode: uploaderUser.referalCode,
                    currentLocation: uploaderUser.latestLocation?.coordinates
                },
                company: {
                    id: company?._id,
                    name: company?.name,
                    type: company?.type
                }
            }
        });

    } catch (error) {
        console.error("Error getting uploader info:", error);
        return res.status(500).json({
            success: false,
            message: "Error getting uploader information"
        });
    }
};

/* ============================================================
SIMPLIFIED CSV COLUMNS (No lat/long required)
============================================================ */

/*
CSV/Excel File Required Columns:

1. customer_id (required) - Unique identifier for the customer
2. company_name (required) - Customer's company or business name
3. contact_name (required) - Contact person's name
4. phone_number (required) - Contact phone number (10-15 digits)
5. address (required) - Business or meeting address
6. landmark (optional) - Nearby landmark for easy location
7. salesperson_referral_code (optional) - Salesperson's referral code
8. salesperson_id (optional) - Salesperson's UID
9. assigned_to (optional) - Salesperson's MongoDB ID
10. notes (optional) - Any additional notes

Note: At least ONE of these must be provided:
- salesperson_referral_code
- salesperson_id  
- assigned_to

If none provided, the system will assign to the uploader (if they are partner/agency)

LOCATION: Automatically taken from uploader's current GPS location
COMPANY: Automatically determined from uploader's company/organization
*/

export default {
    bulkUploadSalesSessions,
    getBulkUploadTemplate,
    getUploaderInfo
};