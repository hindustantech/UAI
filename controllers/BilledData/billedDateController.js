// controllers/BilledData/billedDateController.js
import Bill, { extractServiceInfo, getDefaultServiceDays } from '../../models/BilledDate/billedDate.js';
import fs from 'fs';
import csv from 'csv-parser';
import XLSX from 'xlsx';
import path from 'path';
import axios from "axios";
import _ from "lodash";

// Helper function for logging
const log = {
    info: (message, data = null) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ℹ️ INFO: ${message}`;
        console.log(logMessage);
        if (data) console.log(JSON.stringify(data, null, 2));
    },
    success: (message, data = null) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ✅ SUCCESS: ${message}`;
        console.log(logMessage);
        if (data) console.log(JSON.stringify(data, null, 2));
    },
    error: (message, error = null) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ❌ ERROR: ${message}`;
        console.error(logMessage);
        if (error) console.error(error);
    },
    warn: (message, data = null) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ⚠️ WARNING: ${message}`;
        console.warn(logMessage);
        if (data) console.warn(JSON.stringify(data, null, 2));
    },
    startProcess: (processName) => {
        console.log('\n' + '='.repeat(60));
        console.log(`🚀 STARTING: ${processName}`);
        console.log(`⏰ Time: ${new Date().toISOString()}`);
        console.log('='.repeat(60) + '\n');
    },
    endProcess: (processName) => {
        console.log('\n' + '='.repeat(60));
        console.log(`🏁 COMPLETED: ${processName}`);
        console.log(`⏰ Time: ${new Date().toISOString()}`);
        console.log('='.repeat(60) + '\n');
    }
};

/**
 * Parse date in DD-MM-YYYY format (primary format)
 * Also handles variations like DD/MM/YYYY, DD.MM.YYYY, DD MM YYYY
 * Supports 2-digit years: DD-MM-YY (assumes 20YY)
 */
const parseDate_DDMMYYYY = (dateValue) => {
    if (!dateValue) return null;

    // If it's already a Date object
    if (dateValue instanceof Date) {
        return isNaN(dateValue.getTime()) ? null : dateValue;
    }

    // Convert to string and trim
    let dateStr = String(dateValue).trim();

    console.log(`\n📅 Parsing date: "${dateStr}"`);

    // Handle Excel serial numbers (if date appears as a number like 45678)
    if (/^\d{4,5}$/.test(dateStr)) {
        const excelDate = parseInt(dateStr);
        if (excelDate > 30000 && excelDate < 80000) {
            // Excel serial number (days since 1900-01-01)
            const date = new Date((excelDate - 25569) * 86400 * 1000);
            console.log(`   ✅ Excel serial number detected: ${dateStr} -> ${formatDate(date)}`);
            return date;
        }
    }

    // Remove any time portion if present (e.g., "31-12-2025 10:30:00")
    dateStr = dateStr.split(' ')[0];
    dateStr = dateStr.split('T')[0];

    // Normalize all separators to "-"
    // Replace /, ., and spaces with -
    let normalized = dateStr.replace(/[\/.\s]+/g, '-');

    // Remove any non-digit, non-dash characters
    normalized = normalized.replace(/[^\d-]/g, '');

    console.log(`   Normalized: "${normalized}"`);

    // Match DD-MM-YYYY or DD-MM-YY pattern
    const pattern = /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/;
    const match = normalized.match(pattern);

    if (!match) {
        console.log(`   ❌ Does not match DD-MM-YYYY pattern`);
        return null;
    }

    let [_, day, month, year] = match;

    day = parseInt(day, 10);
    month = parseInt(month, 10);
    year = parseInt(year, 10);

    console.log(`   Extracted: Day=${day}, Month=${month}, Year=${year}`);

    // Handle 2-digit years (assume 20xx for years 00-99)
    if (year < 100) {
        year += 2000;
        console.log(`   Converted 2-digit year to: ${year}`);
    }

    // Validate ranges
    if (day < 1 || day > 31) {
        console.log(`   ❌ Invalid day: ${day} (must be 1-31)`);
        return null;
    }

    if (month < 1 || month > 12) {
        console.log(`   ❌ Invalid month: ${month} (must be 1-12)`);
        return null;
    }

    if (year < 1900 || year > 2100) {
        console.log(`   ❌ Invalid year: ${year} (must be 1900-2100)`);
        return null;
    }

    // Create date object (Month is 0-indexed in JavaScript)
    const date = new Date(year, month - 1, day);

    // Verify the date is valid (catches cases like 31-02-2025)
    if (
        date.getDate() !== day ||
        date.getMonth() !== month - 1 ||
        date.getFullYear() !== year
    ) {
        console.log(`   ❌ Invalid date combination: ${day}-${month}-${year}`);
        return null;
    }

    // Additional check: Warn if day > 12 (might indicate wrong format)
    if (day > 12) {
        console.log(`   💡 Note: Day is ${day} (>12), confirming DD-MM-YYYY format`);
    }

    console.log(`   ✅ Successfully parsed: ${formatDate(date)}`);
    return date;
};

/**
 * Format date as DD-MM-YYYY for display
 */
const formatDate = (date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
};

// Helper function to parse Excel files
const parseExcelFile = (filePath) => {
    return new Promise((resolve, reject) => {
        try {
            log.info('Reading Excel file:', { filePath });

            const workbook = XLSX.readFile(filePath, {
                cellDates: false, // Don't auto-convert dates
                raw: true, // Get raw values
            });

            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            log.info('Excel file details:', {
                sheetName,
                sheets: workbook.SheetNames,
            });

            // Get raw data first
            const rawData = XLSX.utils.sheet_to_json(worksheet, {
                raw: true,
                defval: '',
            });

            // Process each row to handle dates properly
            const data = rawData.map(row => {
                const processedRow = {};

                for (const key in row) {
                    let value = row[key];

                    // Handle Excel date serial numbers
                    if (typeof value === 'number' && value > 30000 && value < 80000) {
                        // Convert Excel serial number to DD-MM-YYYY string
                        const date = new Date((value - 25569) * 86400 * 1000);
                        const day = String(date.getDate()).padStart(2, '0');
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const year = date.getFullYear();
                        value = `${day}-${month}-${year}`;
                        console.log(`   Converted Excel date serial ${row[key]} -> ${value}`);
                    }

                    processedRow[key] = value;
                }

                return processedRow;
            });

            log.success(`Excel parsed: ${data.length} rows`);
            resolve(data);
        } catch (error) {
            log.error('Failed to parse Excel file', error);
            reject(error);
        }
    });
};

// Helper function to parse CSV files
const parseCSVFile = (filePath) => {
    return new Promise((resolve, reject) => {
        const results = [];
        let rowCount = 0;

        log.info('Reading CSV file:', { filePath });

        fs.createReadStream(filePath)
            .pipe(csv({
                mapHeaders: ({ header }) => header.trim(),
                skipLines: 0,
                strict: false
            }))
            .on('data', (data) => {
                rowCount++;
                results.push(data);

                if (rowCount % 100 === 0) {
                    log.info(`Processed ${rowCount} rows from CSV...`);
                }
            })
            .on('end', () => {
                log.success(`CSV parsing completed. Total rows: ${rowCount}`);
                resolve(results);
            })
            .on('error', (error) => {
                log.error('CSV parsing failed', error);
                reject(error);
            });
    });
};

// Helper function to normalize column names
const normalizeColumnName = (key) => {
    const columnMap = {
        // bill_id variations
        'bill_id': 'bill_id',
        'billid': 'bill_id',
        'bill id': 'bill_id',
        'bill-id': 'bill_id',
        'billno': 'bill_id',
        'bill no': 'bill_id',
        'billnumber': 'bill_id',
        'bill number': 'bill_id',

        // billDate variations
        'billdate': 'billDate',
        'bill date': 'billDate',
        'bill_date': 'billDate',
        'date': 'billDate',
        'billing date': 'billDate',
        'billing_date': 'billDate',
        'invoice date': 'billDate',
        'invoice_date': 'billDate',

        // customerName variations
        'customername': 'customerName',
        'customer name': 'customerName',
        'customer_name': 'customerName',
        'name': 'customerName',
        'clientname': 'customerName',
        'client name': 'customerName',
        'client_name': 'customerName',

        // phone variations
        'phone': 'phone',
        'mobile': 'phone',
        'contact': 'phone',
        'phone number': 'phone',
        'phone_number': 'phone',
        'mobileno': 'phone',
        'mobile no': 'phone',
        'contactno': 'phone',
        'contact no': 'phone',
        'telephone': 'phone',

        // serviceName variations
        'servicename': 'serviceName',
        'service name': 'serviceName',
        'service_name': 'serviceName',
        'service': 'serviceName',
        'product': 'serviceName',
        'item': 'serviceName',

        // Other fields
        'status': 'status',
        'remarks': 'remarks',
        'note': 'remarks',
        'notes': 'remarks',
        'followupmax': 'followUpMax',
        'follow up max': 'followUpMax',
        'follow_up_max': 'followUpMax',
        'followupcount': 'followUpCount',
        'follow up count': 'followUpCount',
        'follow_up_count': 'followUpCount',
    };

    const normalized = key.toLowerCase().trim().replace(/[\s-]+/g, '');
    return columnMap[normalized] || key;
};




// Enhanced function with server selection
export const getAllBillsWithReminderStatus = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const oneYearAgo = new Date(today);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        // Get all bills
        const allBills = await Bill.find({
            status: { $ne: 'cancelled' }
        })
            .select('billDate bill_id customerName phone serviceName baseServiceName staffName status followUpCount followUpMax reminderStatus lastReminderSentAt nextReminderDate serviceIntervalDays createdAt serverLocation')
            .sort({ billDate: -1 })
            .lean();

        if (!allBills || allBills.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No bills found',
                totalBills: 0,
                summary: { due: 0, valid: 0, expired: 0, maxReached: 0, totalGroups: 0 },
                data: [],
                availableServices: [],
                availableServers: []
            });
        }

        // Extract unique servers
        const availableServers = [...new Set(allBills.map(bill => bill.serverLocation || 'Default').filter(Boolean))].sort();

        // Group by phone + baseServiceName
        const groupedBills = {};

        for (const bill of allBills) {
            const baseName = bill.baseServiceName || extractServiceInfo(bill.serviceName).baseName;
            const key = `${bill.phone}_${baseName}`;

            if (!groupedBills[key]) {
                groupedBills[key] = {
                    baseServiceName: baseName,
                    phone: bill.phone,
                    bills: []
                };
            }
            groupedBills[key].bills.push(bill);
        }

        // Process groups with server filtering
        const processedBills = [];
        const summary = {
            due: 0,
            valid: 0,
            expired: 0,
            maxReached: 0,
            totalGroups: Object.keys(groupedBills).length
        };

        const { server, filterStatus, search, service, dateRange, timeRange, page = 1, limit = 10 } = req.query;

        for (const [key, group] of Object.entries(groupedBills)) {
            const bills = group.bills;

            // Filter by server if specified
            let filteredBills = bills;
            if (server && server !== 'all') {
                filteredBills = bills.filter(bill => bill.serverLocation === server);
                if (filteredBills.length === 0) continue;
            }

            const serviceInterval = getDefaultServiceDays(group.baseServiceName);

            let hasRecentService = false;
            let oldestDueBill = null;
            let maxDaysDiff = 0;

            // Check all bills in group
            for (const bill of filteredBills) {
                const billDate = new Date(bill.billDate);
                const diffDays = Math.floor((today - billDate) / (1000 * 60 * 60 * 24));

                if (diffDays < serviceInterval) {
                    hasRecentService = true;
                    break;
                }

                if (diffDays >= serviceInterval && diffDays <= 365) {
                    if (diffDays > maxDaysDiff) {
                        maxDaysDiff = diffDays;
                        oldestDueBill = bill;
                    }
                }
            }

            // Assign status
            for (const bill of filteredBills) {
                const billDate = new Date(bill.billDate);
                const diffDays = Math.floor((today - billDate) / (1000 * 60 * 60 * 24));

                const enriched = {
                    ...bill,
                    baseServiceName: group.baseServiceName,
                    serviceDays: serviceInterval,
                    daysSinceService: diffDays,
                    groupKey: key,
                    groupSize: filteredBills.length
                };

                // Determine status
                if (bill.followUpCount >= bill.followUpMax) {
                    enriched.reminderStatus = 'max_reached';
                    summary.maxReached++;
                } else if (hasRecentService) {
                    enriched.reminderStatus = 'valid';
                    summary.valid++;
                } else if (diffDays > 365) {
                    enriched.reminderStatus = 'expired';
                    summary.expired++;
                } else if (oldestDueBill && bill._id.toString() === oldestDueBill._id.toString()) {
                    enriched.reminderStatus = 'due';
                    enriched.daysSinceService = maxDaysDiff;
                    summary.due++;
                } else if (diffDays >= serviceInterval && diffDays <= 365) {
                    enriched.reminderStatus = 'due_duplicate';
                    summary.due++;
                } else {
                    enriched.reminderStatus = 'valid';
                    summary.valid++;
                }

                processedBills.push(enriched);
            }
        }

        // Apply date and time filters
        let filteredResults = [...processedBills];

        if (dateRange && dateRange.start && dateRange.end) {
            const startDate = new Date(dateRange.start);
            const endDate = new Date(dateRange.end);
            filteredResults = filteredResults.filter(bill => {
                const billDate = new Date(bill.billDate);
                return billDate >= startDate && billDate <= endDate;
            });
        }

        if (timeRange && timeRange.start && timeRange.end) {
            filteredResults = filteredResults.filter(bill => {
                const billTime = new Date(bill.createdAt || bill.billDate);
                const hours = billTime.getHours();
                const minutes = billTime.getMinutes();
                const timeValue = hours + minutes / 60;
                return timeValue >= timeRange.start && timeValue <= timeRange.end;
            });
        }

        // Apply other filters
        if (service) {
            filteredResults = filteredResults.filter(b =>
                b.baseServiceName === service || b.serviceName === service
            );
        }

        if (filterStatus) {
            filteredResults = filteredResults.filter(b => b.reminderStatus === filterStatus);
        }

        if (search) {
            const s = search.toLowerCase();
            filteredResults = filteredResults.filter(b =>
                b.customerName?.toLowerCase().includes(s) ||
                b.phone?.includes(s) ||
                b.serviceName?.toLowerCase().includes(s) ||
                b.baseServiceName?.toLowerCase().includes(s)
            );
        }

        // Sort
        filteredResults.sort((a, b) => {
            const order = { 'due': 1, 'due_duplicate': 2, 'valid': 3, 'expired': 4, 'max_reached': 5 };
            return (order[a.reminderStatus] || 99) - (order[b.reminderStatus] || 99);
        });

        // Extract unique services
        const uniqueServices = [...new Set(filteredResults.map(bill => bill.baseServiceName))].sort();

        // Pagination
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const paginatedBills = filteredResults.slice(startIndex, startIndex + parseInt(limit));

        return res.status(200).json({
            success: true,
            totalBills: processedBills.length,
            filteredCount: filteredResults.length,
            summary,
            availableServices: uniqueServices,
            availableServers,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(filteredResults.length / parseInt(limit)),
                limit: parseInt(limit),
                hasNext: (startIndex + parseInt(limit)) < filteredResults.length,
                hasPrevious: startIndex > 0
            },
            data: paginatedBills
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch bills',
            error: error.message
        });
    }
};




export const uploadCSVFile = async (req, res) => {
    log.startProcess('File Upload Process - Date Format: DD-MM-YYYY');

    try {
        // Check if file exists
        if (!req.file) {
            log.error('No file uploaded');
            return res.status(400).json({
                success: false,
                message: 'Please upload a file (CSV or Excel)',
            });
        }

        log.info('File details:', {
            originalname: req.file.originalname,
            size: `${(req.file.size / 1024).toFixed(2)} KB`,
            mimetype: req.file.mimetype,
            path: req.file.path
        });

        // Determine file type
        const fileExtension = path.extname(req.file.originalname).toLowerCase();
        const isExcel = ['.xlsx', '.xls'].includes(fileExtension);
        const isCSV = fileExtension === '.csv';

        log.info('File type detection:', {
            extension: fileExtension,
            isExcel,
            isCSV
        });

        let rawData = [];
        const errors = [];
        let rowCount = 0;

        // Parse based on file type
        if (isExcel) {
            log.info('Processing Excel file...');
            rawData = await parseExcelFile(req.file.path);
            rowCount = rawData.length;
            log.success(`Excel parsing completed. Rows: ${rowCount}`);
        } else if (isCSV) {
            log.info('Processing CSV file...');
            rawData = await parseCSVFile(req.file.path);
            rowCount = rawData.length;
            log.success(`CSV parsing completed. Rows: ${rowCount}`);
        } else {
            log.error('Unsupported file format');
            return res.status(400).json({
                success: false,
                message: 'Unsupported file format. Please upload CSV or Excel files (.csv, .xls, .xlsx)',
            });
        }

        if (rowCount === 0) {
            log.error('File is empty');
            return res.status(400).json({
                success: false,
                message: 'The uploaded file is empty. Please check the file and try again.',
            });
        }

        const results = [];
        const dateFormatStats = {
            successful: 0,
            failed: 0,
            excelSerialConverted: 0
        };

        // Process each row
        log.info(`Processing ${rowCount} rows...`);
        console.log(`\n📋 Expected date format: DD-MM-YYYY (e.g., 31-12-2025)\n`);

        for (let i = 0; i < rawData.length; i++) {
            const originalData = rawData[i];

            // Normalize column names
            const data = {};
            Object.keys(originalData).forEach(key => {
                const normalizedKey = normalizeColumnName(key);
                data[normalizedKey] = originalData[key];
            });

            // Log first 5 rows for debugging
            if (i < 5) {
                log.info(`Sample row ${i + 1}:`, {
                    original: originalData,
                    normalized: data
                });
            }

            // Extract fields with normalized names
            const bill_id = data.bill_id;
            const billDateRaw = data.billDate;
            const customerName = data.customerName;
            const phone = data.phone;
            const serviceName = data.serviceName;

            // Check required fields
            if (!billDateRaw || !customerName || !phone || !serviceName || !bill_id) {
                const missing = [];
                if (!billDateRaw) missing.push('billDate');
                if (!customerName) missing.push('customerName');
                if (!phone) missing.push('phone');
                if (!serviceName) missing.push('serviceName');
                if (!bill_id) missing.push('bill_id');

                console.log(`\n❌ Row ${i + 1} - Missing fields:`, missing.join(', '));

                errors.push({
                    row: i + 1,
                    data: originalData,
                    missing: missing,
                    message: `Missing required fields: ${missing.join(', ')}`,
                });
                continue;
            }

            // Parse date using DD-MM-YYYY format (PRIMARY FORMAT)
            const parsedDate = parseDate_DDMMYYYY(billDateRaw);

            if (!parsedDate || isNaN(parsedDate.getTime())) {
                console.log(`\n❌ Row ${i + 1} - Invalid date: "${billDateRaw}"`);
                console.log(`   Expected format: DD-MM-YYYY (e.g., 31-12-2025)`);
                console.log(`   Also accepts: DD/MM/YYYY, DD.MM.YYYY, DD MM YYYY`);

                dateFormatStats.failed++;

                errors.push({
                    row: i + 1,
                    data: originalData,
                    message: `Invalid date format: "${billDateRaw}". Required format: DD-MM-YYYY (e.g., 31-12-2025). Also accepts DD/MM/YYYY, DD.MM.YYYY`,
                    rawDate: billDateRaw
                });
                continue;
            }

            // Validate date is within reasonable range
            const now = new Date();
            const hundredYearsAgo = new Date();
            hundredYearsAgo.setFullYear(now.getFullYear() - 100);
            const oneYearFromNow = new Date();
            oneYearFromNow.setFullYear(now.getFullYear() + 1);

            if (parsedDate < hundredYearsAgo || parsedDate > oneYearFromNow) {
                console.log(`\n⚠️ Row ${i + 1} - Date out of range: ${formatDate(parsedDate)}`);

                errors.push({
                    row: i + 1,
                    data: originalData,
                    message: `Date out of reasonable range: ${billDateRaw} -> ${formatDate(parsedDate)}`,
                });
                continue;
            }

            dateFormatStats.successful++;

            // Clean phone number
            const cleanPhone = phone.toString().replace(/[\s\-\(\)\.\+\_]/g, '');

            // Validate phone number (basic check - 7 to 15 digits)
            if (!/^\d{7,15}$/.test(cleanPhone)) {
                console.log(`\n❌ Row ${i + 1} - Invalid phone: "${phone}" (cleaned: "${cleanPhone}")`);
                errors.push({
                    row: i + 1,
                    data: originalData,
                    message: `Invalid phone number: "${phone}". Must be 7-15 digits after cleaning.`,
                });
                continue;
            }

            // Prepare bill object
            const billData = {
                bill_id: bill_id.toString().trim(),
                billDate: parsedDate,
                customerName: customerName.toString().trim(),
                phone: cleanPhone,
                serviceName: serviceName.toString().trim(),
                status: data.status || 'issued',
                remarks: data.remarks || '',
                followUpMax: parseInt(data.followUpMax) || 3,
                followUpCount: parseInt(data.followUpCount) || 0,
                metadata: {
                    source: 'file_upload',
                    originalFile: req.file.originalname,
                    fileType: fileExtension,
                    originalDate: billDateRaw.toString(),
                    parsedDate: formatDate(parsedDate),
                    createdBy: req.user?.username || 'system',
                    uploadedAt: new Date()
                },
            };

            results.push(billData);

            // Progress update every 100 rows
            if ((i + 1) % 100 === 0) {
                log.info(`Progress: ${i + 1}/${rowCount} rows processed. Valid: ${results.length}, Errors: ${errors.length}`);
            }
        }

        // Final processing summary
        console.log('\n' + '='.repeat(60));
        console.log('📊 DATA PROCESSING SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total rows in file:     ${rowCount}`);
        console.log(`Valid records:          ${results.length}`);
        console.log(`Invalid records:        ${errors.length}`);
        console.log(`Date parsing - Success: ${dateFormatStats.successful}`);
        console.log(`Date parsing - Failed:  ${dateFormatStats.failed}`);
        console.log('='.repeat(60) + '\n');

        // Delete uploaded file after parsing
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            log.info('Temporary file deleted');
        }

        // If no valid data
        if (results.length === 0) {
            log.error('No valid data to insert');

            // Show sample of errors
            console.log('\n📝 Sample of errors found:');
            errors.slice(0, 5).forEach(err => {
                console.log(`   Row ${err.row}: ${err.message}`);
            });
            if (errors.length > 5) {
                console.log(`   ... and ${errors.length - 5} more errors`);
            }

            return res.status(400).json({
                success: false,
                message: 'No valid data found in the uploaded file. All rows failed validation.',
                totalRows: rowCount,
                errors: errors.slice(0, 50),
                dateFormatStats,
                hint: 'Required date format: DD-MM-YYYY (Example: 31-12-2025)'
            });
        }

        // Check for duplicates in uploaded data
        log.info('Checking for duplicates within file...');
        const seenBillIds = new Set();
        const duplicates = [];

        results.forEach((row, index) => {
            if (seenBillIds.has(row.bill_id)) {
                duplicates.push({
                    row: index + 1,
                    bill_id: row.bill_id,
                    customerName: row.customerName,
                    phone: row.phone,
                });
                console.log(`   ⚠️ Duplicate bill_id found at row ${index + 1}: ${row.bill_id}`);
            } else {
                seenBillIds.add(row.bill_id);
            }
        });

        if (duplicates.length > 0) {
            log.warn(`Found ${duplicates.length} duplicate bill_ids in file`);
        }

        // Check for existing bill_ids in database
        log.info('Checking existing records in database...');
        const billIds = results.map(r => r.bill_id);

        const existingBills = await Bill.find(
            { bill_id: { $in: billIds } },
            { bill_id: 1, customerName: 1 }
        );

        let finalResults = results;
        let skippedCount = 0;

        if (existingBills.length > 0) {
            const existingIds = new Set(existingBills.map(b => b.bill_id));
            console.log(`\n⚠️ Found ${existingBills.length} records already in database:`);
            existingBills.slice(0, 5).forEach(b => {
                console.log(`   - Bill ID: ${b.bill_id}, Customer: ${b.customerName}`);
            });
            if (existingBills.length > 5) {
                console.log(`   ... and ${existingBills.length - 5} more`);
            }

            finalResults = results.filter(r => !existingIds.has(r.bill_id));
            skippedCount = results.length - finalResults.length;

            console.log(`\n📊 After filtering: ${finalResults.length} new records to insert, ${skippedCount} skipped (already exist)\n`);

            if (finalResults.length === 0) {
                log.warn('All records already exist in database');
                return res.status(409).json({
                    success: false,
                    message: 'All bill_ids already exist in database. No new records to insert.',
                    existingCount: existingBills.length,
                    duplicatesFound: existingBills.slice(0, 10).map(b => ({ bill_id: b.bill_id, customer: b.customerName })),
                });
            }
        }

        // Insert into database
        log.info(`Inserting ${finalResults.length} records into database...`);

        let insertedCount = 0;
        let insertErrors = [];

        try {
            // Insert in batches for better performance with large files
            const batchSize = 500;
            const totalBatches = Math.ceil(finalResults.length / batchSize);

            for (let i = 0; i < finalResults.length; i += batchSize) {
                const batch = finalResults.slice(i, i + batchSize);
                const batchNumber = Math.floor(i / batchSize) + 1;

                console.log(`   Inserting batch ${batchNumber}/${totalBatches} (${batch.length} records)...`);

                const inserted = await Bill.insertMany(batch, {
                    ordered: false, // Continue inserting even if some fail
                    timeout: 30000,
                });

                insertedCount += inserted.length;
                console.log(`   ✅ Batch ${batchNumber} complete: ${inserted.length} inserted. Total: ${insertedCount}`);
            }

            console.log(`\n✅ All records inserted successfully! Total: ${insertedCount}`);
        } catch (error) {
            log.error('Error during insertion', error);

            if (error.writeErrors) {
                insertedCount = error.result?.result?.nInserted || 0;
                insertErrors = error.writeErrors.map(err => ({
                    index: err.index,
                    message: err.errmsg,
                }));
                console.log(`\n⚠️ Partial insertion: ${insertedCount} inserted, ${insertErrors.length} failed`);

                // Log first few insertion errors
                insertErrors.slice(0, 5).forEach(err => {
                    console.log(`   - Index ${err.index}: ${err.message}`);
                });
            } else {
                throw error;
            }
        }

        // Final summary
        const summary = {
            fileName: req.file.originalname,
            fileType: fileExtension,
            fileSize: req.file.size,
            totalRowsInFile: rowCount,
            validRows: results.length,
            invalidRows: errors.length,
            duplicatesInFile: duplicates.length,
            existingInDB: skippedCount,
            successfullyInserted: insertedCount,
            failedInserts: insertErrors.length,
            dateFormatStats,
        };

        console.log('\n' + '='.repeat(60));
        console.log('🎉 UPLOAD COMPLETED SUCCESSFULLY');
        console.log('='.repeat(60));
        console.log(`File:            ${summary.fileName}`);
        console.log(`Total rows:      ${summary.totalRowsInFile}`);
        console.log(`Valid:           ${summary.validRows}`);
        console.log(`Inserted:        ${summary.successfullyInserted}`);
        console.log(`Skipped (exist): ${summary.existingInDB}`);
        console.log(`Failed:          ${summary.invalidRows + summary.failedInserts}`);
        console.log('='.repeat(60) + '\n');

        log.endProcess('File Upload Process');

        return res.status(201).json({
            success: true,
            message: `File processed successfully! ${insertedCount} records uploaded.`,
            summary: summary,
            data: {
                inserted: insertedCount,
                failed: insertErrors.length,
                skipped: skippedCount,
                totalErrors: errors.length,
                errors: errors.slice(0, 50),
                duplicateWarnings: duplicates.slice(0, 50),
                dateFormatStats,
                logs: {
                    fileReceived: req.file.originalname,
                    fileType: fileExtension,
                    totalRowsProcessed: rowCount,
                    validRecordsFound: results.length,
                    recordsInserted: insertedCount,
                    recordsSkipped: skippedCount,
                    recordsFailed: insertErrors.length,
                    duplicateInFile: duplicates.length,
                    dateParsingStats: dateFormatStats,
                }
            },
        });

    } catch (error) {
        // Clean up file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            log.info('File cleaned up after error');
        }

        log.error('File upload failed', {
            error: error.message,
            stack: error.stack
        });

        log.endProcess('File Upload Process (with error)');

        // Handle specific errors
        if (error.code === 11000) {
            console.log('\n❌ Duplicate key error - Records already exist');
            return res.status(409).json({
                success: false,
                message: 'Some records already exist in the database (duplicate bill_id).',
                error: 'Duplicate entries found',
            });
        }

        if (error.name === 'ValidationError') {
            console.log('\n❌ Schema validation error');
            console.log(Object.values(error.errors).map(err => err.message));
            return res.status(400).json({
                success: false,
                message: 'Data validation error. Please check your data format.',
                errors: Object.values(error.errors).map(err => err.message),
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Failed to process uploaded file. Server error.',
            error: error.message,
        });
    }
};



// _____________NEW IMPLEMENTATION WITH RATE LIMITING AND RETRY LOGIC_____________

const WHATSAPP_API_URL = "https://whatsapp.quickhub.ai/public/whatsapp/send-template";
const RATE_LIMIT = 40; // messages per minute
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute in milliseconds
const BATCH_SIZE = 10; // Reduced batch size for better control
const BATCH_DELAY_MS = 1500; // 1.5 seconds between batches (40 msgs/min = 1.5 sec per msg)

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Rate limiter class using token bucket algorithm
class RateLimiter {
    constructor(maxRequests, windowMs) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.tokens = maxRequests;
        this.lastRefill = Date.now();
    }

    async waitForToken() {
        while (this.tokens <= 0) {
            const now = Date.now();
            const timePassed = now - this.lastRefill;

            if (timePassed >= this.windowMs) {
                // Refill tokens
                this.tokens = this.maxRequests;
                this.lastRefill = now;
            } else {
                // Wait for next refill
                const waitTime = this.windowMs - timePassed;
                await delay(waitTime + 100); // Add small buffer
                this.tokens = this.maxRequests;
                this.lastRefill = Date.now();
            }
        }

        this.tokens--;
        return true;
    }
}

const rateLimiter = new RateLimiter(RATE_LIMIT, RATE_LIMIT_WINDOW_MS);

const sendWhatsAppReminder = async (bill) => {
    try {
        await rateLimiter.waitForToken();

        const customer = {
            phone: bill.phone,
            name: bill.customerName,
            billId: bill.bill_id,
            serviceName: bill.baseServiceName
        };

        const response = await axios.post(
            WHATSAPP_API_URL,
            {
                to: `+91${customer.phone}`,
                templateName: "hair_cute",
                variables: {
                    body: {
                        "Customer Name": customer.name,
                    },
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.QUICKHUB_API_KEY}`,
                    "Content-Type": "application/json",
                },
                timeout: 10000,
            }
        );

        const remark = `WhatsApp reminder sent successfully at ${new Date().toISOString()} - Template: hair_cute, Service: ${customer.serviceName}`;

        // Direct database update instead of using instance method
        const updatedBill = await Bill.findOneAndUpdate(
            { bill_id: bill.bill_id },
            {
                $push: {
                    followUps: {
                        date: new Date(),
                        status: 'sent',
                        note: remark,
                        reminderType: 'whatsapp'
                    }
                },
                $inc: { followUpCount: 1 },
                $set: {
                    lastReminderSentAt: new Date(),
                    reminderStatus: 'sent',
                    nextReminderDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                }
            },
            { new: true }
        );

        return {
            success: true,
            data: response.data,
            remark: remark,
            billId: bill.bill_id
        };

    } catch (error) {
        const errorRemark = `WhatsApp reminder failed at ${new Date().toISOString()} - Error: ${error.response?.data?.message || error.message}`;

        // Log the failure in database
        await Bill.findOneAndUpdate(
            { bill_id: bill.bill_id },
            {
                $push: {
                    followUps: {
                        date: new Date(),
                        status: 'failed',
                        note: errorRemark,
                        reminderType: 'whatsapp'
                    }
                },
                $inc: { followUpCount: 1 }
            }
        );

        throw error;
    }
};

export const sendBulkReminder = async (req, res) => {
    const { bills } = req.body;

    // Avoid the platform/proxy default socket timeout killing a long-running
    // bulk job. This does NOT send any headers/bytes, so res.json() later
    // is still completely safe to call.
    req.setTimeout(15 * 60 * 1000);  // 15 minutes
    res.setTimeout(15 * 60 * 1000);

    if (!bills?.length) {
        return res.status(400).json({
            success: false,
            message: "No bills provided"
        });
    }

    // Fetch bills from database if IDs are provided
    let billDocuments = bills;
    if (typeof bills[0] === 'string') {
        billDocuments = await Bill.find({
            _id: { $in: bills },
            reminderStatus: 'pending',
            status: { $ne: 'cancelled' }
        });

        if (billDocuments.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No pending reminders found for the provided bill IDs"
            });
        }
    }

    const results = [];
    const startTime = Date.now();

    console.log(`Starting bulk send for ${billDocuments.length} customers. Rate limit: ${RATE_LIMIT}/min`);

    try {
        // Process bills sequentially to maintain rate limit
        for (let i = 0; i < billDocuments.length; i++) {
            const bill = billDocuments[i];

            try {
                const result = await sendWhatsAppReminder(bill);
                results.push({
                    billId: bill.bill_id,
                    phone: bill.phone,
                    name: bill.customerName,
                    success: true,
                    remark: result.remark,
                    index: i + 1
                });

                console.log(`✅ Sent reminder to ${bill.customerName} (${bill.phone})`);

            } catch (error) {
                results.push({
                    billId: bill.bill_id,
                    phone: bill.phone,
                    name: bill.customerName,
                    success: false,
                    error: error.response?.data?.message || error.message,
                    status: error.response?.status,
                    index: i + 1
                });

                console.log(`❌ Failed reminder for ${bill.customerName} (${bill.phone})`);
            }

            // Progress logging (server-side only — no response writes)
            if ((i + 1) % 10 === 0 || i === billDocuments.length - 1) {
                const elapsedMinutes = (Date.now() - startTime) / 60000;
                const progress = ((i + 1) / billDocuments.length * 100).toFixed(1);
                console.log(`Progress: ${i + 1}/${billDocuments.length} (${progress}%) - ${elapsedMinutes.toFixed(1)} min elapsed`);
            }
        }
    } catch (error) {
        console.error('Bulk send interrupted:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalTime = ((Date.now() - startTime) / 60000).toFixed(1);

    // Single, final response — safe because headers were never sent early
    return res.status(200).json({
        success: true,
        total: billDocuments.length,
        sent,
        failed,
        timeMinutes: totalTime,
        estimatedTimeMinutes: Math.ceil(billDocuments.length / RATE_LIMIT),
        results: results.slice(0, 100),
        hasMoreResults: results.length > 100,
        summaryRemark: `Bulk reminder completed: ${sent} sent, ${failed} failed in ${totalTime} minutes`
    });
};



// Function to get reminder history with remarks
export const getReminderHistory = async (req, res) => {
    const { billId } = req.params;

    try {
        const bill = await Bill.findOne({ bill_id: billId });

        if (!bill) {
            return res.status(404).json({
                success: false,
                message: "Bill not found"
            });
        }

        // Format follow-ups with remarks
        const reminders = bill.followUps.map(followUp => ({
            date: followUp.date,
            status: followUp.status,
            remark: followUp.note,
            type: followUp.reminderType,
            reminderCount: bill.followUps.indexOf(followUp) + 1
        }));

        return res.status(200).json({
            success: true,
            billId: bill.bill_id,
            customerName: bill.customerName,
            phone: bill.phone,
            totalReminders: bill.followUpCount,
            reminderStatus: bill.reminderStatus,
            lastReminderSent: bill.lastReminderSentAt,
            nextReminderDate: bill.nextReminderDate,
            reminders: reminders
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch reminder history",
            error: error.message
        });
    }
};
// Optional: Get rate limit status endpoint
export const getRateLimitStatus = async (req, res) => {
    return res.status(200).json({
        success: true,
        rateLimit: RATE_LIMIT,
        windowMs: RATE_LIMIT_WINDOW_MS,
        messagesPerMinute: RATE_LIMIT
    });
};