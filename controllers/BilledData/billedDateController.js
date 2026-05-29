import Bill from '../../models/BilledDate/billedDate.js';
import fs from 'fs';
import csv from 'csv-parser';


export const getFilteredUsers = async (req, res) => {
    try {
        const {
            service_name,
            serviceName,
            fromDate,
            toDate,
            offer,
        } = req.body;

        const serviceFilter = serviceName || service_name;
        const startDate = fromDate ? new Date(fromDate + 'T00:00:00.000Z') : new Date('1970-01-01');
        const endDate = toDate ? new Date(toDate + 'T23:59:59.999Z') : new Date();

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid fromDate or toDate value',
            });
        }

        const users = await Bill.aggregate([ // Fixed model reference
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

        const finalUsers = [];

        for (const user of users) {
            const visits = user.visits || [];

            for (const currentVisit of visits) {
                if (serviceFilter && currentVisit.serviceName !== serviceFilter) {
                    continue;
                }

                const currentBillDate = new Date(currentVisit.billDate);
                if (currentBillDate < startDate || currentBillDate > endDate) {
                    continue;
                }

                const sameServiceAgain = visits.some(
                    (nextVisit) =>
                        nextVisit.serviceName === currentVisit.serviceName &&
                        new Date(nextVisit.billDate) > currentBillDate
                );

                if (sameServiceAgain) {
                    continue;
                }

                finalUsers.push({
                    name: user.name,
                    phone: user.phone,
                    service_name: currentVisit.serviceName,
                    bill_date: currentVisit.billDate,
                    offer,
                });
            }
        }

        return res.status(200).json({
            success: true,
            total: finalUsers.length,
            data: finalUsers,
        });
    } catch (error) {
        console.error('Error in getFilteredUsers:', error);
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};



export const uploadCSVFile = async (req, res) => {
    try {
        console.log('=== CSV Upload Started ===');
        console.log('Time:', new Date().toISOString());

        // Check if file exists
        if (!req.file) {
            console.log('❌ No file uploaded');
            return res.status(400).json({
                success: false,
                message: 'Please upload a CSV file',
            });
        }

        console.log('📁 File received:', req.file.originalname);
        console.log('📏 File size:', (req.file.size / 1024).toFixed(2), 'KB');

        const results = [];
        const errors = [];
        let rowCount = 0;

        // Read and parse CSV file
        await new Promise((resolve, reject) => {
            fs.createReadStream(req.file.path)
                .pipe(csv())
                .on('data', (data) => {
                    rowCount++;
                    console.log(`\n📄 Processing Row ${rowCount}:`, data);

                    // Clean and validate data - bill_id from CSV
                    const bill_id = data.bill_id || data.billId || data.BillId || data.BILL_ID;
                    const billDate = data.billDate || data.date || data.bill_date;
                    const customerName = data.customerName || data.name || data.customer_name;
                    const phone = data.phone || data.mobile || data.contact;
                    const serviceName = data.serviceName || data.service || data.service_name;

                    // Check required fields
                    if (!billDate || !customerName || !phone || !serviceName || !bill_id) {
                        const missing = [];
                        if (!billDate) missing.push('billDate');
                        if (!customerName) missing.push('customerName');
                        if (!phone) missing.push('phone');
                        if (!serviceName) missing.push('serviceName');
                        if (!bill_id) missing.push('bill_id');

                        console.log(`❌ Row ${rowCount} - Missing fields:`, missing);
                        errors.push({
                            row: rowCount,
                            data: data,
                            missing: missing,
                            message: `Missing required fields: ${missing.join(', ')}`,
                        });
                        return;
                    }

                    // Validate date
                    const parsedDate = new Date(billDate);
                    if (isNaN(parsedDate.getTime())) {
                        console.log(`❌ Row ${rowCount} - Invalid date:`, billDate);
                        errors.push({
                            row: rowCount,
                            data: data,
                            message: `Invalid date format: ${billDate}`,
                        });
                        return;
                    }

                    // Clean phone number
                    const cleanPhone = phone.toString().replace(/[\s\-\(\)\.]/g, '');

                    // Prepare valid bill object
                    const billData = {
                        bill_id: bill_id.toString().trim(), // Ensure bill_id is string and trimmed
                        billDate: parsedDate,
                        customerName: customerName.trim(),
                        phone: cleanPhone,
                        serviceName: serviceName.trim(),
                        status: data.status || 'issued',
                        remarks: data.remarks || data.note || '',
                        followUpMax: parseInt(data.followUpMax || data.follow_up_max) || 3,
                        followUpCount: parseInt(data.followUpCount || data.follow_up_count) || 0,
                        metadata: {
                            source: 'csv_upload',
                            createdBy: req.user?.username || 'system',
                        },
                    };

                    results.push(billData);
                    console.log(`✅ Row ${rowCount} - Valid:`, {
                        bill_id: billData.bill_id,
                        customerName: billData.customerName,
                        phone: billData.phone,
                        serviceName: billData.serviceName,
                        billDate: billData.billDate,
                    });
                })
                .on('end', () => {
                    console.log('\n📊 CSV Parsing Complete');
                    console.log('Total rows:', rowCount);
                    console.log('Valid rows:', results.length);
                    console.log('Error rows:', errors.length);
                    resolve();
                })
                .on('error', (error) => {
                    console.error('❌ CSV Parsing Error:', error);
                    reject(error);
                });
        });

        // Delete uploaded file after parsing
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            console.log('🗑️  Temporary file deleted');
        }

        // If no valid data
        if (results.length === 0) {
            console.log('❌ No valid data to insert');
            return res.status(400).json({
                success: false,
                message: 'No valid data found in CSV file',
                totalRows: rowCount,
                errors: errors,
            });
        }

        // Check for duplicates in CSV data (check by bill_id)
        console.log('\n🔍 Checking for duplicates...');
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
            console.log('⚠️  Duplicate bill_ids found in CSV:', duplicates);
        }

        // Check for existing bill_ids in database
        console.log('\n🔍 Checking existing bill_ids in database...');
        const billIds = results.map(r => r.bill_id);
        const existingBills = await Bill.find({ bill_id: { $in: billIds } }, { bill_id: 1 });

        if (existingBills.length > 0) {
            const existingIds = existingBills.map(b => b.bill_id);
            console.log(`⚠️  Found ${existingBills.length} bill_ids that already exist:`, existingIds);

            // Filter out existing bills
            const newBills = results.filter(r => !existingIds.includes(r.bill_id));
            console.log(`📊 New bills to insert: ${newBills.length}`);

            if (newBills.length === 0) {
                return res.status(409).json({
                    success: false,
                    message: 'All bill_ids already exist in database',
                    existingIds: existingIds,
                });
            }

            // Update results to only new bills
            results.length = 0;
            results.push(...newBills);
        }

        // Insert into database
        console.log('\n💾 Inserting into database...');
        console.log('Records to insert:', results.length);

        let insertedCount = 0;
        let insertErrors = [];

        try {
            const inserted = await Bill.insertMany(results, {
                ordered: false, // Continue even if some fail
                timeout: 30000,
            });
            insertedCount = inserted.length;
            console.log(`✅ Successfully inserted: ${insertedCount} records`);
        } catch (error) {
            if (error.writeErrors) {
                // Some records were inserted despite errors
                insertedCount = error.result?.result?.nInserted || 0;
                insertErrors = error.writeErrors.map(err => ({
                    index: err.index,
                    message: err.errmsg,
                }));
                console.log(`⚠️  Partial success - ${insertedCount} inserted, ${insertErrors.length} failed`);
                console.log('Insert errors:', insertErrors);
            } else {
                throw error;
            }
        }

        // Final summary
        const summary = {
            totalRowsInCSV: rowCount,
            validRows: results.length,
            invalidRows: errors.length,
            successfullyInserted: insertedCount,
            failedInserts: insertErrors.length,
            duplicatesInCSV: duplicates.length,
            existingInDB: existingBills?.length || 0,
        };

        console.log('\n=== Upload Summary ===');
        console.log(JSON.stringify(summary, null, 2));
        console.log('=== CSV Upload Completed ===\n');

        return res.status(201).json({
            success: true,
            message: `CSV processed: ${insertedCount} bills uploaded successfully`,
            summary: summary,
            data: {
                inserted: insertedCount,
                failed: insertErrors.length,
                skipped: existingBills?.length || 0,
                errors: errors.slice(0, 10), // Show first 10 errors only
                duplicateWarnings: duplicates,
            },
        });

    } catch (error) {
        // Clean up file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            console.log('🗑️  File cleaned up after error');
        }

        console.error('\n❌ CSV Upload Failed');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);

        // Handle specific errors
        if (error.code === 11000) {
            console.log('Duplicate key error - Some records already exist');
            return res.status(409).json({
                success: false,
                message: 'Some bills already exist in the database',
                error: 'Duplicate entries found',
            });
        }

        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: Object.values(error.errors).map(err => err.message),
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Failed to upload CSV file',
            error: error.message,
        });
    }
};