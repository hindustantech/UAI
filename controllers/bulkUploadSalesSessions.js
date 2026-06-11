import mongoose from "mongoose";
import { SalesSession } from "../models/Attandance/Salses/Salses.js";
import User from "../models/userModel.js";
import xlsx from "xlsx";
import csv from "csv-parser";
import fs from "fs";

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

        // Get the uploading user's details
        const uploaderUser = await User.findById(req.user._id)
            .select('_id name email type latestLocation companyId');

        if (!uploaderUser) {
            return res.status(404).json({
                success: false,
                message: "Uploader user not found"
            });
        }

        // Determine company ID based on user type
        const companyId = await getCompanyId(uploaderUser);

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
COMPANY ID RESOLVER
============================================================ */

/**
 * Get company ID based on user type
 */
const getCompanyId = async (user) => {
    try {
       

        // If user is partner/agency, find their parent company
        if (user.type === 'partner' || user.type === 'agency') {
            // Look for company field or find parent admin
            const parentCompany = await User.findOne({
                _id: user.companyId || user.referredBy,
            });

            if (parentCompany) {
                return parentCompany._id;
            }

            // If no parent found, use the user's own ID
            return user._id;
        }

        // For regular users, find the company they belong to
        if (user.type === 'user') {
            // Check if user has a company reference
            if (user.companyId) {
                const company = await User.findById(user.companyId);
                if (company && (company.type === 'admin' || company.type === 'super_admin')) {
                    return company._id;
                }
            }

            // Check referral chain
            if (user.referredBy) {
                const referrer = await User.findOne({
                    referalCode: user.referredBy,
                    type: { $in: ['admin', 'super_admin', 'agency', 'partner'] }
                });

                if (referrer) {
                    // If referrer is admin/super_admin, they are the company
                    if (referrer.type === 'admin' || referrer.type === 'super_admin') {
                        return referrer._id;
                    }

                    // If referrer is partner/agency, find their parent company
                    const parentCompany = await User.findOne({
                        _id: referrer.referredBy,
                        type: { $in: ['admin', 'super_admin'] }
                    });

                    if (parentCompany) {
                        return parentCompany._id;
                    }
                }
            }
        }

        // Default: return the user's own ID
        return user._id;

    } catch (error) {
        console.error("Error resolving company ID:", error);
        return user._id; // Fallback to user's own ID
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
        'customer_id',
        'company_name',
        'contact_name',
        'phone_number',
        'address'
    ];

    const missingFields = requiredFields.filter(field => !(field in firstRecord));

    if (missingFields.length > 0) {
        throw new Error(`Missing required columns: ${missingFields.join(', ')}. Required columns are: customer_id, company_name, contact_name, phone_number, address`);
    }

    // At least one of these should be present
    const salespersonFields = ['referral_code', 'salesperson_id', 'assigned_to'];
    const hasSalespersonField = salespersonFields.some(field => field in firstRecord);

    if (!hasSalespersonField) {
        throw new Error(`At least one of these columns is required: ${salespersonFields.join(', ')}`);
    }
};

/* ============================================================
RECORD PROCESSING FUNCTIONS
============================================================ */

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

            // Prepare customer data with user's location
            const customerData = prepareCustomerData(record, userLocation);

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
                punchInTime: new Date()
            };

            // Save to database
            const salesSession = new SalesSession(sessionData);
            await salesSession.save();

            successful.push({
                row: rowNumber,
                sessionId: salesSession.sessionId,
                customerId: customerData.customerId,
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
            if (record.referral_code && salesperson.referalCode === record.referral_code) {
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

/* ============================================================
SALESPERSON FINDER (WITH COMPANY SCOPE)
============================================================ */

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

        // Add company scope for non-admin users
        if (uploaderUser.type !== 'super_admin') {
            query.$or = [
                { _id: companyId }, // The company itself
                { companyId: companyId }, // Users belonging to this company
                { referredBy: { $in: await getCompanyReferralCodes(companyId) } }
            ];
        }

        // Try finding by referral code first
        if (record.referral_code) {
            salesperson = await User.findOne({
                ...query,
                referalCode: record.referral_code,
                type: { $in: ['partner', 'agency', 'admin', 'user'] }
            }).select('_id name email uid referalCode referaluseCount type');
        }

        // If not found by referral code, try by salesperson ID (UID)
        if (!salesperson && record.salesperson_id) {
            salesperson = await User.findOne({
                ...query,
                uid: record.salesperson_id,
                type: { $in: ['partner', 'agency', 'admin', 'user'] }
            }).select('_id name email uid referalCode referaluseCount type');
        }

        // If not found by UID, try by user ID directly
        if (!salesperson && record.assigned_to) {
            if (mongoose.Types.ObjectId.isValid(record.assigned_to)) {
                salesperson = await User.findOne({
                    ...query,
                    _id: record.assigned_to
                }).select('_id name email uid referalCode referaluseCount type');
            }
        }

        // If still not found and uploader is partner/agency, allow self-assignment
        if (!salesperson && (uploaderUser.type === 'partner' || uploaderUser.type === 'agency')) {
            // Check if any salesperson field is empty or matches uploader
            const noSalespersonSpecified = !record.referral_code && !record.salesperson_id && !record.assigned_to;
            if (noSalespersonSpecified) {
                salesperson = uploaderUser;
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

/* ============================================================
DATA PREPARATION (WITH USER'S LOCATION)
============================================================ */

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

        const companyId = await getCompanyId(uploaderUser);

        // Create sample data with uploader's info in notes
        const sampleData = [
            {
                customer_id: "CUST001",
                company_name: "ABC Electronics",
                contact_name: "John Doe",
                phone_number: "9876543210",
                address: "123 Main Street, Mumbai",
                landmark: "Near Central Mall",
                referral_code: "REF123ABC",
                salesperson_id: "U-A1B2C3",
                assigned_to: "",
                notes: `Location will be taken from uploader (${uploaderUser.name}) at [${uploaderUser.latestLocation?.coordinates || '0,0'}]`
            },
            {
                customer_id: "CUST002",
                company_name: "XYZ Traders",
                contact_name: "Jane Smith",
                phone_number: "9876543211",
                address: "456 Park Avenue, Delhi",
                landmark: "Opposite Metro Station",
                referral_code: "",
                salesperson_id: "",
                assigned_to: "",
                notes: "Will be assigned to uploader if no salesperson specified"
            }
        ];

        // Create workbook
        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.sheet_to_json(sampleData);

        // Add header information
        const headerInfo = [
            [`Uploaded By: ${uploaderUser.name} (${uploaderUser.uid})`],
            [`Company ID: ${companyId}`],
            [`User Type: ${uploaderUser.type}`],
            [`Location: [${uploaderUser.latestLocation?.coordinates?.join(', ') || 'Not available'}]`],
            [''], // Empty row
            ['Note: Location will be automatically taken from uploader\'s current location'],
            [''], // Empty row
        ];

        // Create worksheet with headers
        const ws = xlsx.utils.json_to_sheet(sampleData, {
            header: Object.keys(sampleData[0]),
            skipHeader: false
        });

        // Set column widths
        const colWidths = Object.keys(sampleData[0]).map(key => ({
            wch: Math.max(key.length, 20)
        }));
        ws['!cols'] = colWidths;

        xlsx.utils.book_append_sheet(workbook, ws, "Sales Sessions");

        // Generate buffer
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

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
        return res.status(500).json({
            success: false,
            message: "Error generating template"
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

        const companyId = await getCompanyId(uploaderUser);

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
7. referral_code (optional) - Salesperson's referral code
8. salesperson_id (optional) - Salesperson's UID
9. assigned_to (optional) - Salesperson's MongoDB ID
10. notes (optional) - Any additional notes

Note: At least ONE of these must be provided:
- referral_code
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