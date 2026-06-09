import Employee from "../../../models/Attandance/Employee.js";
import { SalesSession } from "../../../models/Attandance/Salses/Salses.js";
import { Parser } from "json2csv";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================
HELPER : HAVERSINE DISTANCE
============================================================ */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // KM

    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(dLat / 2) *
        Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Number((R * c).toFixed(2));
};

/* ============================================================
SAFE STRING CONVERSION - FIX FOR TYPE ERRORS
============================================================ */
const safeString = (value, defaultValue = "-") => {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return defaultValue;
        }
    }
    return String(value);
};

/* ============================================================
SAFE NUMBER CONVERSION
============================================================ */
const safeNumber = (value, defaultValue = 0) => {
    if (value === null || value === undefined) return defaultValue;
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
};

/* ============================================================
EXPORT SALES REPORT
============================================================ */
export const exportSalesPersonReport = async (req, res) => {
    let filePath = null;

    try {
        const { companyId, salesPersonId, fromDate, toDate } = req.query;

        /* ============================================================
        VALIDATION
        ============================================================ */

        if (!companyId || !salesPersonId) {
            return res.status(400).json({
                success: false,
                message: "companyId and salesPersonId are required"
            });
        }

        // Convert IDs to strings safely
        const companyIdStr = safeString(companyId);
        const salesPersonIdStr = safeString(salesPersonId);

        // Validate MongoDB ObjectIds
        if (!mongoose.Types.ObjectId.isValid(companyIdStr) ||
            !mongoose.Types.ObjectId.isValid(salesPersonIdStr)) {
            return res.status(400).json({
                success: false,
                message: "Invalid companyId or salesPersonId format"
            });
        }

        /* ============================================================
        DATE FILTER
        ============================================================ */

        let dateFilter = {};

        if (fromDate || toDate) {
            dateFilter.punchInTime = {};

            if (fromDate) {
                const fromDateObj = new Date(fromDate);
                if (isNaN(fromDateObj.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid fromDate format"
                    });
                }
                dateFilter.punchInTime.$gte = new Date(
                    fromDateObj.setHours(0, 0, 0, 0)
                );
            }

            if (toDate) {
                const toDateObj = new Date(toDate);
                if (isNaN(toDateObj.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid toDate format"
                    });
                }
                dateFilter.punchInTime.$lte = new Date(
                    toDateObj.setHours(23, 59, 59, 999)
                );
            }
        }

        /* ============================================================
        GET EMPLOYEE
        ============================================================ */

        const employee = await Employee.findOne({
            companyId: new mongoose.Types.ObjectId(companyIdStr),
            userId: new mongoose.Types.ObjectId(salesPersonIdStr)
        }).populate("userId", "name");

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }

        /* ============================================================
        GET SESSIONS
        ============================================================ */

        const sessions = await SalesSession.find({
            companyId: new mongoose.Types.ObjectId(companyIdStr),
            $or: [
                { employeeId: new mongoose.Types.ObjectId(salesPersonIdStr) },
                { assignedTo: new mongoose.Types.ObjectId(salesPersonIdStr) },
                { createdBy: new mongoose.Types.ObjectId(salesPersonIdStr) }
            ],
            ...dateFilter
        })
            .sort({ punchInTime: 1 })
            .lean();

        if (!sessions || sessions.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No sessions found"
            });
        }

        /* ============================================================
        BUILD EXPORT ROWS
        ============================================================ */

        let exportRows = [];
        let previousLocation = null;
        let srNo = 1;

        for (const session of sessions) {
            try {
                const customer = session.customer || {};
                const visitLogs = Array.isArray(session.visitLogs)
                    ? session.visitLogs
                    : [];
                const salesLogs = Array.isArray(session.salesLogs)
                    ? session.salesLogs
                    : [];
                const meetingLogs = Array.isArray(session.meetingLogs)
                    ? session.meetingLogs
                    : [];

                for (const log of visitLogs) {
                    try {
                        /* ============================================================
                        ONLY THIS SALESPERSON VISITS
                        ============================================================ */

                        if (
                            log.userId &&
                            log.userId.toString() !== salesPersonIdStr
                        ) {
                            continue;
                        }

                        /* ============================================================
                        DISTANCE CALCULATION - FIXED WITH SAFE NUMBER CONVERSION
                        ============================================================ */

                        const punchInCoords =
                            log?.punchInLocation?.coordinates || [];
                        const punchOutCoords =
                            log?.punchOutLocation?.coordinates || [];

                        let visitDistance = 0;

                        if (
                            Array.isArray(punchInCoords) &&
                            punchInCoords.length === 2 &&
                            Array.isArray(punchOutCoords) &&
                            punchOutCoords.length === 2
                        ) {
                            // FIXED: Ensure coordinates are properly parsed as numbers
                            const lat1 = parseFloat(punchInCoords[1]);
                            const lon1 = parseFloat(punchInCoords[0]);
                            const lat2 = parseFloat(punchOutCoords[1]);
                            const lon2 = parseFloat(punchOutCoords[0]);

                            if (!isNaN(lat1) && !isNaN(lon1) &&
                                !isNaN(lat2) && !isNaN(lon2)) {
                                visitDistance = calculateDistance(
                                    lat1, lon1, lat2, lon2
                                );
                            }
                        }

                        let previousDistance = 0;

                        if (
                            previousLocation &&
                            Array.isArray(punchInCoords) &&
                            punchInCoords.length === 2
                        ) {
                            const currentLat = parseFloat(punchInCoords[1]);
                            const currentLon = parseFloat(punchInCoords[0]);

                            if (!isNaN(currentLat) && !isNaN(currentLon)) {
                                previousDistance = calculateDistance(
                                    previousLocation.lat,
                                    previousLocation.lng,
                                    currentLat,
                                    currentLon
                                );
                            }
                        }

                        /* ============================================================
                        SAVE CURRENT LOCATION
                        ============================================================ */

                        if (
                            Array.isArray(punchOutCoords) &&
                            punchOutCoords.length === 2
                        ) {
                            const outLat = parseFloat(punchOutCoords[1]);
                            const outLon = parseFloat(punchOutCoords[0]);

                            if (!isNaN(outLat) && !isNaN(outLon)) {
                                previousLocation = {
                                    lat: outLat,
                                    lng: outLon
                                };
                            }
                        }

                        /* ============================================================
                        SALES DATA
                        ============================================================ */

                        const firstSalesLog = salesLogs[0] || {};
                        const firstMeetingLog = meetingLogs[0] || {};

                        /* ============================================================
                        CALL GENERATION - FIXED LOGIC
                        ============================================================ */

                        let callGeneration = "Own"; // Default value

                        if (Array.isArray(session?.assignedTo)) {
                            const isAssigned = session.assignedTo.some(
                                id => {
                                    try {
                                        return id && id.toString() === salesPersonIdStr;
                                    } catch {
                                        return false;
                                    }
                                }
                            );
                            callGeneration = isAssigned ? "Transferred" : "Own";
                        }

                        /* ============================================================
                        FORMAT DATES & TIMES SAFELY
                        ============================================================ */

                        const punchInTime = log?.punchInTime
                            ? new Date(log.punchInTime)
                            : null;
                        const punchOutTime = log?.punchOutTime
                            ? new Date(log.punchOutTime)
                            : null;
                        const nextMeetingDate =
                            session?.nextMeeting?.date
                                ? new Date(session.nextMeeting.date)
                                : null;

                        // Validate dates
                        const isValidDate = (date) => {
                            return date instanceof Date && !isNaN(date.getTime());
                        };

                        /* ============================================================
                        PUSH ROW - ALL VALUES AS STRINGS TO PREVENT TYPE ERRORS
                        ============================================================ */

                        exportRows.push({
                            "S.N": String(srNo++),
                            "Call Id": safeString(session.sessionId, "-"),
                            "Date": isValidDate(punchInTime)
                                ? punchInTime.toLocaleDateString("en-IN")
                                : "-",
                            "Sales Person Name": safeString(
                                employee?.userId?.name ||
                                employee?.user_name
                            ),
                            "Call Generation": safeString(callGeneration),
                            "Check In": isValidDate(punchInTime)
                                ? punchInTime.toLocaleTimeString("en-IN")
                                : "-",
                            "Check Out": isValidDate(punchOutTime)
                                ? punchOutTime.toLocaleTimeString("en-IN")
                                : "-",
                            "Distance Between CheckIn & CheckOut (KM)":
                                String(safeNumber(visitDistance)),
                            "Distance From Previous Call (KM)":
                                String(safeNumber(previousDistance)),
                            "Company Name": safeString(customer.companyName),
                            "Contact Person": safeString(customer.contactName),
                            "Contact Number": safeString(customer.phoneNumber),
                            "Customer Address": safeString(customer.address),
                            "Sales Service Outcome": safeString(
                                firstSalesLog?.dealStatus
                            ),
                            "Payment": firstSalesLog?.paymentCollected
                                ? "Collected"
                                : "Pending",
                            "Amount": String(safeNumber(firstSalesLog?.amount)),
                            "Payment Mode": safeString(
                                firstSalesLog?.paymentMode
                            ),
                            "Sales Status": safeString(session?.SalesStatus),
                            "Next Meeting Date": isValidDate(nextMeetingDate)
                                ? nextMeetingDate.toLocaleDateString("en-IN")
                                : "-",
                            "Meeting Notes": safeString(
                                firstMeetingLog?.notes
                            ),
                            "Session Status": safeString(session?.status)
                        });
                    } catch (logError) {
                        console.error("Error processing log:", logError);
                        continue;
                    }
                }
            } catch (sessionError) {
                console.error("Error processing session:", sessionError);
                continue;
            }
        }

        /* ============================================================
        VALIDATION: CHECK IF ROWS EXIST
        ============================================================ */

        if (!exportRows || exportRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No data available for export"
            });
        }

        /* ============================================================
        CSV PARSER - ENSURE ALL FIELDS ARE STRINGS
        ============================================================ */

        const fields = Object.keys(exportRows[0]);

        const json2csvParser = new Parser({
            fields,
            header: true,
            delimiter: ",",
            quote: '"',
            // Add escape character handling
            escapedQuote: '""'
        });

        let csv = "";
        try {
            csv = json2csvParser.parse(exportRows);

            // Add BOM for Excel compatibility
            const BOM = '\uFEFF';
            csv = BOM + csv;

        } catch (parseError) {
            console.error("CSV PARSE ERROR:", parseError);
            return res.status(500).json({
                success: false,
                message: "Failed to parse CSV",
                error: parseError.message
            });
        }

        /* ============================================================
        EXPORT DIRECTORY
        ============================================================ */

        const exportDir = path.join(process.cwd(), "exports");

        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        /* ============================================================
        FILE PATH
        ============================================================ */

        const timestamp = Date.now();
        const sanitizedFileName = `sales_report_${salesPersonIdStr}_${timestamp}.csv`
            .replace(/[^a-zA-Z0-9_.-]/g, '_'); // Sanitize filename

        filePath = path.join(exportDir, sanitizedFileName);

        /* ============================================================
        WRITE FILE WITH PROPER ENCODING
        ============================================================ */

        fs.writeFileSync(filePath, csv, { encoding: "utf8" });

        // Verify file was created and has content
        if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
            return res.status(500).json({
                success: false,
                message: "Failed to create export file"
            });
        }

        /* ============================================================
        SET RESPONSE HEADERS
        ============================================================ */

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${sanitizedFileName}"`
        );
        res.setHeader("Content-Length", fs.statSync(filePath).size);
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

        /* ============================================================
        SEND FILE
        ============================================================ */

        const fileStream = fs.createReadStream(filePath, {
            encoding: "utf-8",
            highWaterMark: 64 * 1024 // 64KB chunks for better performance
        });

        fileStream.on("error", (err) => {
            console.error("STREAM ERROR:", err);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: "Error reading file",
                    error: err.message
                });
            }
        });

        // Use pipeline for better error handling
        const { pipeline } = await import('stream');
        pipeline(fileStream, res, (err) => {
            if (err) {
                console.error("PIPELINE ERROR:", err);
            }

            // Cleanup after sending
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (cleanupErr) {
                console.error("CLEANUP ERROR:", cleanupErr);
            }
        });

    } catch (error) {
        console.error("EXPORT ERROR:", error);

        // Cleanup file if error occurs
        try {
            if (filePath && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (cleanupErr) {
            console.error("CLEANUP ERROR:", cleanupErr);
        }

        return res.status(500).json({
            success: false,
            message: "Failed to export report",
            error: error.message
        });
    }
};

/**
 * @desc    Export Sales Reports (Company-specific data only)
 * @route   GET /api/sales/reports/export
 * @access  Private (Company Admin/Manager - only sees their company data)
 */

export const exportSalesReport = async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            employeeId,      // Single employee ID
            employeeIds,     // Multiple employee IDs
            status,          // SalesStatus filter
            sessionStatus,   // Session status filter
            format = 'csv'
        } = req.query;

        // ============================================
        // SECURITY: Extract company ID from authenticated user
        // ============================================
        const companyId = req.user?._id || re.use?.id;
        console.log("Authenticated User ID:", req.user?._id);
        console.log("Company ID:", companyId);
        if (!companyId) {
            return res.status(403).json({
                success: false,
                message: "Access denied. Company ID not found."
            });
        }

        // ============================================
        // STEP 1: Get ALL employees of this company
        // ============================================
        const companyEmployees = await Employee.find({
            companyId: companyId,
            employmentStatus: "active"
        }).select('userId user_name empCode employeeType role').lean();
        console.log(`Found ${companyEmployees.length} active employees for company`);

        if (!companyEmployees || companyEmployees.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No employees found for this company"
            });
        }

        // Create valid employee IDs set
        const validEmployeeIds = new Set(
            companyEmployees.map(emp => emp.userId?.toString()).filter(Boolean)
        );

        // Employee details map
        const employeeDetailsMap = new Map();
        companyEmployees.forEach(emp => {
            if (emp.userId) {
                employeeDetailsMap.set(emp.userId.toString(), {
                    userId: emp.userId,
                    user_name: emp.user_name || 'Unknown',
                    empCode: emp.empCode || 'N/A',
                    employeeType: emp.employeeType || 'non_sales',
                    role: emp.role || 'employee'
                });
            }
        });

        // ============================================
        // STEP 2: Determine which employees to filter
        // ============================================
        let targetEmployeeIds = [];

        // Handle single employeeId
        if (employeeId) {
            const empIdStr = employeeId.toString();
            if (!validEmployeeIds.has(empIdStr)) {
                return res.status(403).json({
                    success: false,
                    message: "Access denied. Employee does not belong to your company."
                });
            }
            targetEmployeeIds = [empIdStr];
        }
        // Handle multiple employeeIds
        else if (employeeIds) {
            const parsedIds = Array.isArray(employeeIds)
                ? employeeIds
                : employeeIds.split(',').map(id => id.trim());

            // Validate all belong to company
            const invalidIds = parsedIds.filter(id => !validEmployeeIds.has(id.toString()));
            if (invalidIds.length > 0) {
                return res.status(403).json({
                    success: false,
                    message: `Access denied. Employees [${invalidIds.join(', ')}] do not belong to your company.`
                });
            }
            targetEmployeeIds = parsedIds.map(id => id.toString());
        }
        // If no employee filter, get ALL company employees
        else {
            targetEmployeeIds = [...validEmployeeIds];
        }

        // Remove duplicates
        targetEmployeeIds = [...new Set(targetEmployeeIds)];

        // ============================================
        // STEP 3: Build query - GET ALL SESSIONS associated with these employees
        // ============================================
        const query = {
            companyId: companyId  // Always filter by company first
        };

        // CRITICAL FIX: Use $or to find sessions where employee appears ANYWHERE
        // This will get ALL sales records associated with the employee(s)
        query.$or = [
            { employeeId: { $in: targetEmployeeIds } },           // Main employee
            { createdBy: { $in: targetEmployeeIds } },            // Created by
            { assignedTo: { $in: targetEmployeeIds } },           // Assigned to
            { 'visitLogs.userId': { $in: targetEmployeeIds } },    // In visit logs
            { 'salesLogs.userId': { $in: targetEmployeeIds } },    // In sales logs
            { 'meetingLogs.userId': { $in: targetEmployeeIds } }   // In meeting logs
        ];

        // ============================================
        // STEP 4: Date range filter (if provided)
        // ============================================
        if (startDate || endDate) {
            const dateFilter = {};

            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                dateFilter.$gte = start;
            }

            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                dateFilter.$lte = end;
            }

            // Check multiple date fields
            query.$or.push(
                { punchInTime: dateFilter },
                { createdAt: dateFilter },
                { 'visitLogs.punchInTime': dateFilter }
            );
        }

        // ============================================
        // STEP 5: Status filters
        // ============================================
        if (status) {
            const validStatuses = ["open", "closed", "follow_up"];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
                });
            }
            query.SalesStatus = status;
        }

        if (sessionStatus) {
            const validSessionStatuses = ["in_progress", "completed"];
            if (!validSessionStatuses.includes(sessionStatus)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid session status. Must be one of: ${validSessionStatuses.join(', ')}`
                });
            }
            query.status = sessionStatus;
        }

        console.log("Target Employee IDs:", targetEmployeeIds);
        console.log("Final Query:", JSON.stringify(query, null, 2));

        // ============================================
        // STEP 6: Fetch sessions
        // ============================================
        const sessions = await SalesSession.find(query)
            .populate({
                path: 'employeeId',
                select: 'user_name empCode'
            })
            .populate({
                path: 'createdBy',
                select: 'user_name empCode'
            })
            .populate({
                path: 'assignedTo',
                select: 'user_name empCode'
            })
            .populate({
                path: 'visitLogs.userId',
                select: 'user_name empCode'
            })
            .populate({
                path: 'salesLogs.userId',
                select: 'user_name empCode'
            })
            .populate({
                path: 'meetingLogs.userId',
                select: 'user_name empCode'
            })
            .sort({ createdAt: -1 })
            .lean();

        console.log(`Found ${sessions.length} sessions for employee(s)`);

        if (!sessions || sessions.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No sales data found for the given criteria",
                filters: {
                    companyId: companyId.toString(),
                    employeeIds: targetEmployeeIds,
                    startDate,
                    endDate,
                    status,
                    sessionStatus
                }
            });
        }

        // ============================================
        // STEP 7: Process sessions and create report rows
        // ============================================
        const reportData = [];

        for (const session of sessions) {
            // Get ALL employees involved in this session that belong to the company
            const involvedEmployees = new Map();

            const addEmployeeIfValid = (userId, populatedUser) => {
                if (!userId) return;
                const userIdStr = userId._id ? userId._id.toString() : userId.toString();

                // Only include if employee belongs to this company AND is in our target list
                if (validEmployeeIds.has(userIdStr) && targetEmployeeIds.includes(userIdStr)) {
                    if (!involvedEmployees.has(userIdStr)) {
                        const empDetails = employeeDetailsMap.get(userIdStr);
                        involvedEmployees.set(userIdStr, {
                            userId: userId._id || userId,
                            empCode: populatedUser?.empCode || empDetails?.empCode || 'N/A',
                            user_name: populatedUser?.user_name || empDetails?.user_name || 'Unknown',
                            employeeType: empDetails?.employeeType || 'non_sales',
                            role: empDetails?.role || 'employee'
                        });
                    }
                }
            };

            // Check all possible locations where employee could appear
            if (session.employeeId) addEmployeeIfValid(session.employeeId._id, session.employeeId);
            if (session.createdBy) addEmployeeIfValid(session.createdBy._id, session.createdBy);

            if (session.assignedTo && Array.isArray(session.assignedTo)) {
                session.assignedTo.forEach(assigned => {
                    if (assigned) addEmployeeIfValid(assigned._id || assigned, assigned);
                });
            }

            session.visitLogs?.forEach(log => {
                if (log.userId) addEmployeeIfValid(log.userId._id, log.userId);
            });

            session.salesLogs?.forEach(log => {
                if (log.userId) addEmployeeIfValid(log.userId._id, log.userId);
            });

            session.meetingLogs?.forEach(log => {
                if (log.userId) addEmployeeIfValid(log.userId._id, log.userId);
            });

            // Create rows for each involved employee
            if (involvedEmployees.size === 0 && targetEmployeeIds.length > 0) {
                // If session has no direct employee match but should be included
                // Create a row with session data but unknown employee
                reportData.push({
                    ...createCompanyReportRow(session, null),
                    empCode: 'N/A',
                    empName: 'Unknown Employee',
                    employeeType: 'N/A',
                    role: 'N/A'
                });
            } else {
                for (const [empId, empData] of involvedEmployees) {
                    reportData.push(createCompanyReportRow(session, empData));
                }
            }
        }

        // ============================================
        // STEP 8: Generate CSV
        // ============================================
        if (reportData.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No report data to export"
            });
        }

        const fields = [
            { label: 'Date', value: 'date' },
            { label: 'Employee Code', value: 'empCode' },
            { label: 'Employee Name', value: 'empName' },
            { label: 'Employee Type', value: 'employeeType' },
            { label: 'Role', value: 'role' },
            { label: 'Customer ID', value: 'customerId' },
            { label: 'Company Name', value: 'companyName' },
            { label: 'Contact Name', value: 'contactName' },
            { label: 'Phone Number', value: 'phoneNumber' },
            { label: 'Address', value: 'address' },
            { label: 'Landmark', value: 'landmark' },
            { label: 'Customer Location', value: 'customerLocation' },
            { label: 'Sales Logs', value: 'salesLogs' },
            { label: 'Total Sales Amount', value: 'totalSalesAmount' },
            { label: 'Payment Collected', value: 'paymentCollected' },
            { label: 'Meeting Logs', value: 'meetingLogs' },
            { label: 'Next Meeting Decided', value: 'nextMeetingDecided' },
            { label: 'Next Meeting Date', value: 'nextMeetingDate' },
            { label: 'Next Meeting Time', value: 'nextMeetingTime' },
            { label: 'Next Meeting Notes', value: 'nextMeetingNotes' },
            { label: 'Sales Status', value: 'salesStatus' },
            { label: 'Session Status', value: 'sessionStatus' },
            { label: 'Form Completed', value: 'formCompleted' },
            { label: 'Session Created', value: 'sessionCreated' },
            { label: 'Punch In Time', value: 'punchInTime' },
            { label: 'Punch In Location', value: 'punchInLocation' },
            { label: 'Punch Out Time', value: 'punchOutTime' },
            { label: 'Punch Out Location', value: 'punchOutLocation' },
            { label: 'Punch Out Address', value: 'punchOutAddress' },
            { label: 'Duration (minutes)', value: 'duration' },
            { label: 'Total Distance (km)', value: 'totalDistance' }
        ];

        const json2csvParser = new Parser({ fields, delimiter: ',', quote: '"', header: true });
        const csv = json2csvParser.parse(reportData);

        // Generate filename
        const companyName = req.user?.companyName || 'Company';
        const employeeName = targetEmployeeIds.length === 1
            ? employeeDetailsMap.get(targetEmployeeIds[0])?.user_name || 'Employee'
            : 'Multiple_Employees';
        const dateRange = startDate && endDate
            ? `${startDate.split('T')[0]}_to_${endDate.split('T')[0]}`
            : new Date().toISOString().split('T')[0];
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `Sales_Report_${companyName}_${employeeName}_${dateRange}_${timestamp}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const BOM = '\uFEFF';
        return res.status(200).send(BOM + csv);

    } catch (error) {
        console.error("Export Sales Report Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to generate sales report",
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

/**
 * Helper function to create a formatted row for company report
 */
const createCompanyReportRow = (session, employeeData) => {
    // Format sales logs for this employee only
    const salesLogsFormatted = (session.salesLogs || [])
        .filter(log => {
            if (!employeeData) return true; // Include all if no specific employee
            const logUserId = log.userId?._id?.toString() || log.userId?.toString();
            return logUserId === employeeData.userId?.toString();
        })
        .map(log => {
            const parts = [];
            if (log.dealStatus) parts.push(`Status: ${log.dealStatus}`);
            if (log.amount) parts.push(`Amount: ₹${log.amount.toLocaleString()}`);
            if (log.paymentCollected !== undefined) parts.push(`Payment: ${log.paymentCollected ? 'Yes' : 'No'}`);
            if (log.paymentMode) parts.push(`Mode: ${log.paymentMode}`);
            if (log.note) parts.push(`Note: ${log.note}`);
            if (log.createdAt) parts.push(`Date: ${new Date(log.createdAt).toLocaleDateString()}`);
            return parts.join(' | ');
        })
        .filter(Boolean)
        .join('\n');

    // Calculate total sales amount for this employee
    const employeeSalesAmount = (session.salesLogs || [])
        .filter(log => {
            if (!employeeData) return true;
            const logUserId = log.userId?._id?.toString() || log.userId?.toString();
            return logUserId === employeeData.userId?.toString();
        })
        .reduce((sum, log) => sum + (log.amount || 0), 0);

    // Check if payment was collected
    const hasPaymentCollected = (session.salesLogs || [])
        .filter(log => {
            if (!employeeData) return true;
            const logUserId = log.userId?._id?.toString() || log.userId?.toString();
            return logUserId === employeeData.userId?.toString();
        })
        .some(log => log.paymentCollected);

    // Format meeting logs for this employee only
    const meetingLogsFormatted = (session.meetingLogs || [])
        .filter(log => {
            if (!employeeData) return true;
            const logUserId = log.userId?._id?.toString() || log.userId?.toString();
            return logUserId === employeeData.userId?.toString();
        })
        .map(log => {
            const parts = [];
            if (log.date) parts.push(`Date: ${new Date(log.date).toLocaleDateString()}`);
            if (log.time) parts.push(`Time: ${log.time}`);
            if (log.notes) parts.push(`Notes: ${log.notes}`);
            return parts.join(' | ');
        })
        .filter(Boolean)
        .join('\n');

    // Format locations
    const formatCoordinates = (location) => {
        if (location?.coordinates?.length === 2) {
            return `${location.coordinates[1].toFixed(6)}, ${location.coordinates[0].toFixed(6)}`;
        }
        return '';
    };

    return {
        // Date & Employee Info
        date: session.createdAt ? new Date(session.createdAt).toISOString().split('T')[0] : '',
        empCode: employeeData?.empCode || 'N/A',
        empName: employeeData?.user_name || 'Unknown',
        employeeType: employeeData?.employeeType || 'N/A',
        role: employeeData?.role || 'N/A',

        // Customer Information
        customerId: session.customer?.customerId || '',
        companyName: session.customer?.companyName || '',
        contactName: session.customer?.contactName || '',
        phoneNumber: session.customer?.phoneNumber || '',
        address: session.customer?.address || '',
        landmark: session.customer?.landmark || '',
        customerLocation: formatCoordinates(session.customer?.location),

        // Sales Information
        salesLogs: salesLogsFormatted || 'No sales logs',
        totalSalesAmount: employeeSalesAmount || 0,
        paymentCollected: hasPaymentCollected ? 'Yes' : 'No',

        // Meeting Information
        meetingLogs: meetingLogsFormatted || 'No meeting logs',
        nextMeetingDecided: session.nextMeeting?.decided ? 'Yes' : 'No',
        nextMeetingDate: session.nextMeeting?.date
            ? new Date(session.nextMeeting.date).toLocaleDateString()
            : '',
        nextMeetingTime: session.nextMeeting?.time || '',
        nextMeetingNotes: session.nextMeeting?.notes || '',

        // Status
        salesStatus: session.SalesStatus || 'N/A',
        sessionStatus: session.status || 'N/A',
        formCompleted: session.formCompleted ? 'Yes' : 'No',

        // Time Tracking
        sessionCreated: session.createdAt ? new Date(session.createdAt).toLocaleString() : '',
        punchInTime: session.punchInTime ? new Date(session.punchInTime).toLocaleString() : '',
        punchInLocation: formatCoordinates(session.punchInLocation),
        punchOutTime: session.punchOutTime ? new Date(session.punchOutTime).toLocaleString() : '',
        punchOutLocation: formatCoordinates(session.punchOutLocation),
        punchOutAddress: session.punchOutAddress || '',
        duration: session.duration ? Math.round(session.duration / 60) : 0,
        totalDistance: session.totalDistance ? Math.round(session.totalDistance / 1000 * 100) / 100 : 0
    };
};






/* ============================================================
CONTROLLER: Export Sales Data to CSV
============================================================ */

export const exportDataSalesCSV = async (req, res) => {
    try {
        const { companyId, startDate, endDate } = req.query;

        // Build query filter
        let matchFilter = {};

        if (companyId) {
            matchFilter.companyId = new mongoose.Types.ObjectId(companyId);
        }

        if (startDate || endDate) {
            matchFilter.createdAt = {};
            if (startDate) matchFilter.createdAt.$gte = new Date(startDate);
            if (endDate) {
                // Include the full end date (up to 23:59:59)
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                matchFilter.createdAt.$lte = end;
            }
        }

        const salesData = await SalesSession.aggregate([
            { $match: matchFilter },

            // Unwind salesLogs to get individual sales entries
            {
                $unwind: {
                    path: "$salesLogs",
                    preserveNullAndEmptyArrays: true
                }
            },

            // Unwind visitLogs to get individual visit/call entries
            {
                $unwind: {
                    path: "$visitLogs",
                    preserveNullAndEmptyArrays: true
                }
            },

            // ─────────────────────────────────────────────────────────
            // GROUP BY EMPLOYEE ONLY (no date) → summary for full range
            // ─────────────────────────────────────────────────────────
            {
                $group: {
                    _id: {
                        employeeId: "$employeeId",
                        createdBy: "$createdBy"
                    },

                    // Total visits/calls across all sessions
                    totalCalls: {
                        $sum: {
                            $cond: [{ $ifNull: ["$visitLogs", false] }, 1, 0]
                        }
                    },

                    // Total call duration in minutes
                    totalCallDuration: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        "$visitLogs.punchInTime",
                                        "$visitLogs.punchOutTime"
                                    ]
                                },
                                {
                                    $divide: [
                                        {
                                            $subtract: [
                                                "$visitLogs.punchOutTime",
                                                "$visitLogs.punchInTime"
                                            ]
                                        },
                                        60000 // ms → minutes
                                    ]
                                },
                                0
                            ]
                        }
                    },

                    // Total amount collected across all paid sales
                    totalAmountCollected: {
                        $sum: {
                            $cond: [
                                { $eq: ["$salesLogs.paymentCollected", true] },
                                { $ifNull: ["$salesLogs.amount", 0] },
                                0
                            ]
                        }
                    },

                    // Total paid sales count
                    totalPaidCount: {
                        $sum: {
                            $cond: [
                                { $eq: ["$salesLogs.paymentCollected", true] },
                                1,
                                0
                            ]
                        }
                    },

                    // Date range actually covered by this employee's data
                    firstDate: { $min: "$createdAt" },
                    lastDate: { $max: "$createdAt" },

                    // Keep refs for lookup
                    employeeIdRef: { $first: "$employeeId" },
                    createdByRef: { $first: "$createdBy" }
                }
            },

            // Lookup employee user details
            {
                $lookup: {
                    from: "users",
                    localField: "employeeIdRef",
                    foreignField: "_id",
                    as: "employeeDetails"
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "createdByRef",
                    foreignField: "_id",
                    as: "createdByDetails"
                }
            },

            // Flatten user details
            {
                $addFields: {
                    employeeName: {
                        $ifNull: [
                            { $arrayElemAt: ["$employeeDetails.name", 0] },
                            { $arrayElemAt: ["$createdByDetails.name", 0] }
                        ]
                    },
                    employeeEmail: {
                        $arrayElemAt: ["$employeeDetails.email", 0]
                    }
                }
            },

            // Average call time = totalDuration / totalCalls
            {
                $addFields: {
                    avgCallTime: {
                        $cond: [
                            { $eq: ["$totalCalls", 0] },
                            0,
                            { $divide: ["$totalCallDuration", "$totalCalls"] }
                        ]
                    }
                }
            },

            // Final projection
            {
                $project: {
                    _id: 0,
                    salesPersonName: { $ifNull: ["$employeeName", "Unknown"] },
                    employeeEmail: { $ifNull: ["$employeeEmail", ""] },
                    periodFrom: {
                        $dateToString: { format: "%Y-%m-%d", date: "$firstDate" }
                    },
                    periodTo: {
                        $dateToString: { format: "%Y-%m-%d", date: "$lastDate" }
                    },
                    totalCalls: "$totalCalls",
                    avgCallTime: { $round: ["$avgCallTime", 2] },
                    totalAmountCollected: { $round: ["$totalAmountCollected", 2] },
                    totalPaidCount: "$totalPaidCount"
                }
            },

            { $sort: { salesPersonName: 1 } }
        ]);

        if (!salesData.length) {
            return res.status(404).json({
                success: false,
                message: "No data found for the selected criteria"
            });
        }

        // ── Build CSV ──────────────────────────────────────────────
        const csvRows = [];

        // Report meta header (shows the queried date range)
        const rangeFrom = startDate
            ? new Date(startDate).toISOString().slice(0, 10)
            : "All time";
        const rangeTo = endDate
            ? new Date(endDate).toISOString().slice(0, 10)
            : "All time";

        csvRows.push(`"Sales Summary Report"`);
        csvRows.push(`"Period:","${rangeFrom} to ${rangeTo}"`);
        csvRows.push(`"Generated:","${new Date().toISOString().slice(0, 19).replace("T", " ")}"`);
        csvRows.push(""); // blank separator row

        // Column headers
        csvRows.push([
            "Sales Person Name",
            "Email",
            "Period From",
            "Period To",
            "Total Calls",
            "Avg Call Time (min)",
            "Total Amount Collected",
            "Total Paid Count"
        ].join(","));

        // Data rows — one row per employee
        for (const row of salesData) {
            csvRows.push([
                `"${row.salesPersonName.replace(/"/g, '""')}"`,
                `"${row.employeeEmail.replace(/"/g, '""')}"`,
                row.periodFrom || "",
                row.periodTo || "",
                row.totalCalls || 0,
                row.avgCallTime || 0,
                row.totalAmountCollected || 0,
                row.totalPaidCount || 0
            ].join(","));
        }

        // Grand total row
        const grandTotal = salesData.reduce(
            (acc, r) => {
                acc.totalCalls += r.totalCalls || 0;
                acc.totalAmountCollected += r.totalAmountCollected || 0;
                acc.totalPaidCount += r.totalPaidCount || 0;
                return acc;
            },
            { totalCalls: 0, totalAmountCollected: 0, totalPaidCount: 0 }
        );

        csvRows.push([
            '"TOTAL"', '""', '""', '""',
            grandTotal.totalCalls,
            '""',
            grandTotal.totalAmountCollected.toFixed(2),
            grandTotal.totalPaidCount
        ].join(","));

        const csvContent = csvRows.join("\n");

        // ── Send file ──────────────────────────────────────────────
        const filename = `sales_summary_${rangeFrom}_to_${rangeTo}.csv`;

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`
        );

        res.send("\uFEFF" + csvContent); // BOM for Excel UTF-8

    } catch (error) {
        console.error("Error exporting sales CSV:", error);
        res.status(500).json({
            success: false,
            message: "Failed to export sales data",
            error: error.message
        });
    }
};