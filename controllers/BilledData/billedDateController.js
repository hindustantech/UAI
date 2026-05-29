// controllers/BilledData/billedDateController.js
import Bill from '../../models/BilledDate/billedDate.js';
import fs from 'fs';
import csv from 'csv-parser';
import XLSX from 'xlsx';
import path from 'path';

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

// Helper function to parse Excel files
const parseExcelFile = (filePath) => {
    return new Promise((resolve, reject) => {
        try {
            log.info('Reading Excel file:', { filePath });

            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            log.info('Excel file details:', {
                sheetName,
                sheets: workbook.SheetNames,
                rows: XLSX.utils.sheet_to_json(worksheet).length
            });

            const data = XLSX.utils.sheet_to_json(worksheet);
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
            .pipe(csv())
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

        // customerName variations
        'customername': 'customerName',
        'customer name': 'customerName',
        'customer_name': 'customerName',
        'name': 'customerName',
        'clientname': 'customerName',
        'client name': 'customerName',

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

export const getFilteredUsers = async (req, res) => {
    log.startProcess('Filter Billed Users');

    try {
        const {
            service_name,
            serviceName,
            fromDate,
            toDate,
            offer,
        } = req.body;

        log.info('Filter parameters received:', {
            serviceName: serviceName || service_name,
            fromDate,
            toDate,
            offer
        });

        const serviceFilter = serviceName || service_name;
        const startDate = fromDate ? new Date(fromDate + 'T00:00:00.000Z') : new Date('1970-01-01');
        const endDate = toDate ? new Date(toDate + 'T23:59:59.999Z') : new Date();

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            log.error('Invalid date parameters');
            return res.status(400).json({
                success: false,
                message: 'Invalid fromDate or toDate value',
            });
        }

        log.info('Executing aggregation pipeline...');

        const users = await Bill.aggregate([
            {
                $sort: {
                    billDate: 1,
                },
            },
            {
                $group: {
                    _id: '$phone',
                    name: {
                        $last: '$customerName',
                    },
                    phone: {
                        $last: '$phone',
                    },
                    visits: {
                        $push: {
                            serviceName: '$serviceName',
                            billDate: '$billDate',
                        },
                    },
                },
            },
        ]);

        log.info(`Aggregation returned ${users.length} unique users`);

        const finalUsers = [];
        let filteredCount = 0;
        let skippedServiceFilter = 0;
        let skippedDateRange = 0;
        let skippedRepeatService = 0;

        for (const user of users) {
            const visits = user.visits || [];

            for (const currentVisit of visits) {
                if (serviceFilter && currentVisit.serviceName !== serviceFilter) {
                    skippedServiceFilter++;
                    continue;
                }

                const currentBillDate = new Date(currentVisit.billDate);
                if (currentBillDate < startDate || currentBillDate > endDate) {
                    skippedDateRange++;
                    continue;
                }

                const sameServiceAgain = visits.some(
                    (nextVisit) =>
                        nextVisit.serviceName === currentVisit.serviceName &&
                        new Date(nextVisit.billDate) > currentBillDate
                );

                if (sameServiceAgain) {
                    skippedRepeatService++;
                    continue;
                }

                finalUsers.push({
                    name: user.name,
                    phone: user.phone,
                    service_name: currentVisit.serviceName,
                    bill_date: currentVisit.billDate,
                    offer,
                });

                filteredCount++;
            }
        }

        log.success('Filtering completed', {
            totalUsers: users.length,
            finalResults: finalUsers.length,
            skipped: {
                serviceFilter: skippedServiceFilter,
                dateRange: skippedDateRange,
                repeatService: skippedRepeatService
            }
        });

        log.endProcess('Filter Billed Users');

        return res.status(200).json({
            success: true,
            total: finalUsers.length,
            data: finalUsers,
        });
    } catch (error) {
        log.error('Error in getFilteredUsers', error);
        log.endProcess('Filter Billed Users (with error)');
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

export const uploadCSVFile = async (req, res) => {
    log.startProcess('File Upload Process');

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
                message: 'Unsupported file format. Please upload CSV or Excel files.',
            });
        }

        const results = [];

        // Process each row
        log.info(`Processing ${rowCount} rows...`);

        for (let i = 0; i < rawData.length; i++) {
            const originalData = rawData[i];

            // Normalize column names
            const data = {};
            Object.keys(originalData).forEach(key => {
                const normalizedKey = normalizeColumnName(key);
                data[normalizedKey] = originalData[key];
            });

            if (i < 3) {
                log.info(`Sample row ${i + 1}:`, {
                    original: originalData,
                    normalized: data
                });
            }

            // Extract fields with normalized names
            const bill_id = data.bill_id;
            const billDate = data.billDate;
            const customerName = data.customerName;
            const phone = data.phone;
            const serviceName = data.serviceName;

            // Check required fields
            if (!billDate || !customerName || !phone || !serviceName || !bill_id) {
                const missing = [];
                if (!billDate) missing.push('billDate');
                if (!customerName) missing.push('customerName');
                if (!phone) missing.push('phone');
                if (!serviceName) missing.push('serviceName');
                if (!bill_id) missing.push('bill_id');

                log.warn(`Row ${i + 1} - Missing fields:`, {
                    missing,
                    rawData: originalData
                });

                errors.push({
                    row: i + 1,
                    data: originalData,
                    missing: missing,
                    message: `Missing required fields: ${missing.join(', ')}`,
                });
                continue;
            }

            // Validate date
            const parsedDate = new Date(billDate);
            if (isNaN(parsedDate.getTime())) {
                log.warn(`Row ${i + 1} - Invalid date:`, { billDate });
                errors.push({
                    row: i + 1,
                    data: originalData,
                    message: `Invalid date format: ${billDate}`,
                });
                continue;
            }

            // Clean phone number
            const cleanPhone = phone.toString().replace(/[\s\-\(\)\.]/g, '');

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
                    createdBy: req.user?.username || 'system',
                    uploadedAt: new Date()
                },
            };

            results.push(billData);

            if ((i + 1) % 100 === 0) {
                log.info(`Processed ${i + 1}/${rowCount} rows. Valid: ${results.length}, Errors: ${errors.length}`);
            }
        }

        log.success('Data processing completed', {
            totalRows: rowCount,
            validRows: results.length,
            errorRows: errors.length
        });

        // Delete uploaded file after parsing
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            log.info('Temporary file deleted:', { path: req.file.path });
        }

        // If no valid data
        if (results.length === 0) {
            log.error('No valid data to insert');
            return res.status(400).json({
                success: false,
                message: 'No valid data found in the uploaded file',
                totalRows: rowCount,
                errors: errors.slice(0, 50), // Return first 50 errors
            });
        }

        // Check for duplicates in uploaded data
        log.info('Checking for duplicates...');
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
            } else {
                seenBillIds.add(row.bill_id);
            }
        });

        if (duplicates.length > 0) {
            log.warn(`Found ${duplicates.length} duplicate bill_ids in file`, duplicates.slice(0, 5));
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
            log.warn(`Found ${existingBills.length} existing records in database`,
                existingBills.slice(0, 5).map(b => ({ bill_id: b.bill_id, name: b.customerName }))
            );

            finalResults = results.filter(r => !existingIds.has(r.bill_id));
            skippedCount = results.length - finalResults.length;

            log.info(`Filtered results: ${finalResults.length} new records to insert, ${skippedCount} skipped`);

            if (finalResults.length === 0) {
                log.warn('All records already exist in database');
                return res.status(409).json({
                    success: false,
                    message: 'All bill_ids already exist in database',
                    existingCount: existingBills.length,
                    duplicatesFound: existingBills.slice(0, 10).map(b => b.bill_id),
                });
            }
        }

        // Insert into database
        log.info(`Inserting ${finalResults.length} records into database...`);

        let insertedCount = 0;
        let insertErrors = [];

        try {
            // Insert in batches for large files
            const batchSize = 500;
            for (let i = 0; i < finalResults.length; i += batchSize) {
                const batch = finalResults.slice(i, i + batchSize);
                const inserted = await Bill.insertMany(batch, {
                    ordered: false,
                    timeout: 30000,
                });
                insertedCount += inserted.length;

                log.info(`Batch ${Math.floor(i / batchSize) + 1} inserted: ${inserted.length} records. Total: ${insertedCount}/${finalResults.length}`);
            }

            log.success(`All records inserted successfully: ${insertedCount}`);
        } catch (error) {
            log.error('Error during batch insertion', error);

            if (error.writeErrors) {
                insertedCount = error.result?.result?.nInserted || 0;
                insertErrors = error.writeErrors.map(err => ({
                    index: err.index,
                    message: err.errmsg,
                }));
                log.warn(`Partial insertion: ${insertedCount} inserted, ${insertErrors.length} failed`);
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
            processingTime: new Date() - new Date(req.file.startTime || Date.now()),
        };

        log.success('Upload completed successfully', summary);
        log.endProcess('File Upload Process');

        return res.status(201).json({
            success: true,
            message: `File processed: ${insertedCount} records uploaded successfully`,
            summary: summary,
            data: {
                inserted: insertedCount,
                failed: insertErrors.length,
                skipped: skippedCount,
                totalErrors: errors.length,
                errors: errors.slice(0, 50), // First 50 errors
                duplicateWarnings: duplicates.slice(0, 50), // First 50 duplicates
                logs: {
                    fileReceived: req.file.originalname,
                    fileType: fileExtension,
                    totalRowsProcessed: rowCount,
                    validRecordsFound: results.length,
                    recordsInserted: insertedCount,
                    recordsSkipped: skippedCount,
                    recordsFailed: insertErrors.length,
                    duplicateInFile: duplicates.length,
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
            stack: error.stack,
            fileInfo: req.file ? {
                name: req.file.originalname,
                size: req.file.size
            } : 'No file'
        });

        log.endProcess('File Upload Process (with error)');

        // Handle specific errors
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'Some records already exist in the database',
                error: 'Duplicate entries found',
                log: 'Duplicate key violation detected'
            });
        }

        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: Object.values(error.errors).map(err => err.message),
                log: 'Schema validation failed'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Failed to process uploaded file',
            error: error.message,
            log: `Fatal error: ${error.message}`
        });
    }
};